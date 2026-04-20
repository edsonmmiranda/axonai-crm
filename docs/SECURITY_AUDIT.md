# Auditoria de Seguranca — Controle de Acesso e Isolamento Multi-Tenant

**Data:** 2026-04-20
**Escopo:** Protecao contra manipulacao de `userId`, `organizationId` e `role` via DevTools do navegador (IDOR — Insecure Direct Object Reference).

---

## 1. Resumo Executivo

O sistema esta **protegido na camada de aplicacao** contra o ataque descrito (usuario altera variaveis no cliente para acessar dados de outras empresas ou elevar privilegios). Todas as server actions derivam `userId` e `organizationId` do JWT do Supabase no servidor, nunca do cliente.

Porem, existem **lacunas na defesa em profundidade** que devem ser corrigidas para garantir que um bug futuro na camada de aplicacao nao exponha dados entre organizacoes.

---

## 2. O Que Esta Seguro (Validado)

### 2.1 Identidade derivada do servidor

| Aspecto | Status | Arquivo |
|---------|--------|---------|
| userId vem do JWT | OK | `src/lib/supabase/getSessionContext.ts:42` |
| organizationId vem do profile no banco | OK | `src/lib/supabase/getSessionContext.ts:48-62` |
| Diretiva `'server-only'` impede import no cliente | OK | `src/lib/supabase/getSessionContext.ts:1` |
| Sem sessao redireciona para `/login` | OK | `src/lib/supabase/getSessionContext.ts:44-46` |
| Profile inconsistente faz sign-out forcado | OK | `src/lib/supabase/getSessionContext.ts:63-69` |

### 2.2 Server Actions — Isolamento por organizacao

Todas as server actions seguem o padrao seguro:

```typescript
const ctx = await getSessionContext();   // JWT do servidor
// ...
.eq('organization_id', ctx.organizationId)  // NUNCA aceita do cliente
```

| Server Action | Filtro org_id | assertRole | Verificacao extra |
|---------------|:---:|:---:|---|
| `products.ts` | OK | OK (owner/admin p/ escrita) | — |
| `categories.ts` | OK | OK (owner/admin p/ escrita) | slug unico por org |
| `lead-origins.ts` | OK | OK (owner/admin p/ escrita) | nome unico por org |
| `loss-reasons.ts` | OK | OK (owner/admin p/ escrita) | — |
| `tags.ts` | OK | OK (owner/admin p/ escrita) | nome unico por org |
| `product-images.ts` | OK | OK | JOIN `products.organization_id` para verificar ownership |
| `product-documents.ts` | OK | OK | JOIN `products.organization_id` para verificar ownership |
| `invitations.ts` | OK | OK (owner/admin) | Valida limite de usuarios do plano |
| `team.ts` | OK | OK (owner/admin) | Impede editar a si mesmo, protege owner |
| `organization.ts` | OK | OK (owner/admin) | Filtra por `ctx.organizationId` |
| `profile.ts` | OK | — (proprio usuario) | Filtra por `ctx.userId` apenas |
| `auth.ts` | N/A | N/A | Signup: org_id via metadata do JWT |

### 2.3 Nenhum estado sensivel no cliente

- Nao ha React Context, Zustand ou `useState` armazenando `userId` ou `organizationId` para logica de negocio.
- Unico estado client-side: tema (light/dark/system) em `ThemeProvider.tsx`.

### 2.4 RPCs atomicas com validacao dupla

As funcoes `set_product_image_primary` e `reorder_product_images` fazem validacao de `organization_id` no banco (SECURITY DEFINER), alem da validacao na server action.

### 2.5 RLS no storage

Os buckets `products` e `product-documents` possuem 8 policies RLS no `storage.objects` que validam `organization_id` via path do arquivo.

---

## 3. Lacunas Identificadas — Acoes Necessarias

### 3.1 MEDIA — Policies RLS das tabelas nao estao no git

**Problema:** O `schema_snapshot.json` mostra que todas as 15 tabelas publicas possuem policies RLS definidas. Porem, as **definicoes SQL dessas policies nao estao nas migrations versionadas**. Foram criadas via Supabase Dashboard ou em scripts nao rastreados.

**Risco:** Se alguem modificar uma policy no Dashboard, nao ha audit trail. Nao e possivel verificar pelo git se as policies realmente filtram por `organization_id` corretamente.

**Acao:**
- [ ] Exportar todas as RLS policies atuais do banco para uma migration versionada
- [ ] Usar `supabase db dump --schema public` ou o RPC `get_table_policies()` para extrair as definicoes
- [ ] Revisionar cada policy para confirmar que filtra por `organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())`
- [ ] Adicionar a migration ao git para rastreabilidade futura

**Tabelas que precisam de revisao:**

| Tabela | Tem `organization_id` proprio? | Policies no snapshot |
|--------|:---:|:---:|
| organizations | sim (e a propria) | 3 (INSERT, UPDATE, SELECT) |
| profiles | sim | 5 (DELETE, UPDATE x2, INSERT, SELECT) |
| products | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| categories | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| leads | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| lead_origins | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| loss_reasons | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| tags | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| invitations | sim | 6 (INSERT, UPDATE x2, DELETE, SELECT x2) |
| whatsapp_groups | sim | 4 (DELETE, INSERT, UPDATE, SELECT) |
| funnels | sim | 2 (ALL p/ admin, SELECT) |
| funnel_stages | **NAO** (depende de `funnels`) | 2 (ALL p/ admin, SELECT) |
| lead_tags | **NAO** (junction table) | 3 (INSERT, DELETE, SELECT) |
| product_images | **NAO** (depende de `products`) | 4 (DELETE, INSERT, UPDATE, SELECT) |
| product_documents | **NAO** (depende de `products`) | 4 (DELETE, INSERT, UPDATE, SELECT) |

> **Atencao especial:** Tabelas sem `organization_id` proprio (`funnel_stages`, `lead_tags`, `product_images`, `product_documents`) precisam de policies com JOIN para validar isolamento. Confirmar que as policies fazem esse JOIN corretamente.

---

### 3.2 MEDIA — Bucket `avatars` sem RLS

**Problema:** Os buckets `products` e `product-documents` possuem policies RLS no storage. O bucket `avatars` **nao tem nenhuma policy RLS** (nenhuma referencia nas migrations).

**Risco:** Um usuario autenticado que conheca o path de um avatar (`{userId}/{timestamp}.ext`) poderia:
- Ler avatares de outros usuarios (baixo impacto)
- Sobrescrever avatares de outros usuarios (medio impacto)

**Acao:**
- [ ] Criar migration com RLS policies para o bucket `avatars`
- [ ] Policy sugerida: `(storage.foldername(name))[1]::uuid = auth.uid()` — cada usuario so acessa sua propria pasta

---

### 3.3 BAIXA — Middleware protege apenas `/dashboard`

**Problema:** O `middleware.ts` so redireciona usuarios nao autenticados em rotas que comecam com `/dashboard`. Outras rotas protegidas dependem exclusivamente do `getSessionContext()` no nivel da pagina.

**Risco:** Se um desenvolvedor criar uma nova rota protegida e esquecer de chamar `getSessionContext()`, a rota ficara desprotegida. Nao e uma vulnerabilidade hoje, mas e um risco de regressao.

**Acao:**
- [ ] Expandir `PROTECTED_PREFIXES` no `src/lib/supabase/middleware.ts:6` para incluir todas as rotas que exigem autenticacao:
  ```typescript
  const PROTECTED_PREFIXES = [
    '/dashboard',
    '/settings',
    '/products',
    '/leads',
    '/team',
  ];
  ```
- [ ] Ou inverter a logica: proteger TUDO por padrao e ter uma lista de rotas publicas (`/login`, `/accept-invite`, `/auth`)

---

### 3.4 BAIXA — Auth callback: redirectTo sem whitelist

**Problema:** O `src/app/auth/callback/route.ts:26` valida que `redirectTo` comeca com `/`, mas nao restringe a paths conhecidos.

**Risco:** Open redirect limitado (so paths internos). Baixo impacto pratico, mas e uma boa pratica restringir.

**Acao:**
- [ ] Validar `redirectTo` contra uma lista de prefixos permitidos:
  ```typescript
  const SAFE_PREFIXES = ['/dashboard', '/settings', '/products', '/leads', '/accept-invite'];
  const safe = SAFE_PREFIXES.some(p => redirectTo.startsWith(p)) ? redirectTo : '/dashboard';
  ```

---

### 3.5 BAIXA — Tabelas sem server action (whatsapp_groups, funnels, funnel_stages)

**Problema:** Estas tabelas existem no banco com RLS policies, mas nao possuem server actions no codigo. Quando forem implementadas, precisam seguir o padrao `getSessionContext()` + `.eq('organization_id', ctx.organizationId)`.

**Risco:** Nenhum risco atual (nao ha endpoint exposto). Risco futuro se o padrao nao for seguido na implementacao.

**Acao:**
- [ ] Ao implementar server actions para `whatsapp_groups`, `funnels` e `funnel_stages`, seguir exatamente o padrao das actions existentes
- [ ] Para `funnel_stages`: obrigatoriamente fazer JOIN com `funnels` para validar `organization_id`, ja que a tabela nao possui coluna propria de org

---

### 3.6 RECOMENDACAO — Audit logging

**Problema:** Nao ha registro de operacoes sensiveis (mudanca de role, exclusao de membros, convites, alteracao de dados de organizacao).

**Risco:** Dificulta investigacao de incidentes e deteccao de comportamento suspeito.

**Acao:**
- [ ] Implementar tabela `audit_logs` com campos: `id`, `organization_id`, `user_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at`
- [ ] Registrar pelo menos: mudancas de role, desativacao de membros, convites criados/revogados, alteracoes de organizacao

---

## 4. Matriz de Risco Consolidada

| # | Item | Severidade | Esforco | Prioridade |
|---|------|:---:|:---:|:---:|
| 3.1 | Versionar RLS policies no git | Media | Medio | **1** |
| 3.2 | RLS no bucket avatars | Media | Baixo | **2** |
| 3.3 | Expandir middleware protegido | Baixa | Baixo | **3** |
| 3.4 | Whitelist no redirectTo | Baixa | Baixo | **4** |
| 3.5 | Padrao para tabelas futuras | Baixa | N/A (doc) | **5** |
| 3.6 | Audit logging | Baixa | Alto | **6** |

---

## 5. Conclusao

**O ataque descrito (usuario manipula variaveis no DevTools para acessar dados de outra empresa) NAO funciona neste sistema.** O `organizationId` e o `userId` sao sempre derivados do JWT no servidor.

As lacunas identificadas sao de **defesa em profundidade** — camadas extras de protecao que evitam que um bug futuro na camada de aplicacao resulte em vazamento de dados entre organizacoes. A mais critica (3.1) e garantir que as policies RLS do banco estejam versionadas e auditadas.
