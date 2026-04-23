# 06 — Handoff para Nova Sessão

Este documento é o **ponto de entrada** para um Tech Lead que abre uma sessão nova e precisa retomar o trabalho da área admin.

## Gatilho canônico

Em uma sessão limpa, o usuário deve digitar:

```
Tech Lead, leia docs/admin_area/ por completo e execute o Sprint 0.
```

Ou, se quiser revisar antes de executar:

```
Tech Lead, leia docs/admin_area/ e me dê um resumo do que entendeu antes de executar.
```

## Comportamento esperado do Tech Lead ao receber o gatilho

### Passo 1 — Ler o boot (automático)

`CLAUDE.md` já é carregado automaticamente pelo harness. O Tech Lead confirma o gatilho "Tech Lead..." e procede.

### Passo 2 — Ler `agents/00_TECH_LEAD.md`

Conforme o protocolo do framework, este arquivo é a fonte autoritativa de workflow. Ler por completo.

### Passo 3 — Ler os 3 arquivos obrigatórios

Conforme `00_TECH_LEAD.md`:
1. `docs/conventions/standards.md`
2. `docs/schema_snapshot.json`
3. `docs/APRENDIZADOS.md`

### Passo 4 — Ler esta pasta completa

Ler **em ordem**:
1. [README.md](./README.md) — índice e status
2. [00-contexto-e-decisoes.md](./00-contexto-e-decisoes.md) — contexto e decisões
3. [01-arquitetura.md](./01-arquitetura.md) — como tudo encaixa
4. [02-schema-banco.md](./02-schema-banco.md) — 7 tabelas novas
5. [03-seguranca.md](./03-seguranca.md) — modelo de segurança
6. [04-mudancas-framework.md](./04-mudancas-framework.md) — spec do Sprint 0
7. [05-roadmap-sprints.md](./05-roadmap-sprints.md) — roadmap completo

### Passo 5 — Confirmar entendimento com o usuário

Antes de executar, apresentar resumo curto (3-5 linhas) do que será feito no Sprint 0 e aguardar confirmação.

Exemplo de resumo esperado:

> Entendi. Vou executar o Sprint 0 (LIGHT, ~45min, Target: shared) que prepara o framework para a introdução da área admin. Afeta 6 arquivos aditivamente: `standards.md`, `security.md`, ESLint config, `@backend`, `@guardian`, template de sprint. Nenhum sprint concluído nem código do customer é alterado. Confirma?

### Passo 6 — Executar Sprint 0

Seguir workflow Opção 1 (Sprint LIGHT → Opção 1 forçada). Gerar sprint file em `sprints/active/sprint_S0_framework_admin_area_prep.md` via `@sprint-creator`, apresentar ao usuário, aguardar `"execute"`, então executar.

## Decisões já tomadas (não rediscutir)

O Tech Lead **não deve** fazer as seguintes perguntas ao usuário — já foram respondidas e estão em [00-contexto-e-decisoes.md](./00-contexto-e-decisoes.md):

| Pergunta | Resposta fixada |
|---|---|
| Opção 1 (monorepo), 2 (repo separado) ou 3 (route group)? | **Opção 3** (route group) |
| Como identificar super admin? | **Tabela `platform_admins`** isolada |
| Billing no MVP? | **Não** — fase 2 |
| Impersonation day-1? | **Sim** — Sprint S3 |
| Métricas v1? | **3 KPIs** simples (orgs ativas, users totais, leads totais) |
| Banco separado para admin? | **Não** — mesmo Supabase, acesso via service_role gated |
| Auth separado? | **Não** — mesmo `auth.users`, separação lógica |
| Settings escopo? | Feature flags + trial limits + integration keys + usage policies |

## Decisões ainda em aberto (aguardam o sprint correspondente)

Essas perguntas **devem** ser feitas ao usuário quando o sprint correspondente iniciar — não antes:

| Pergunta | Sprint onde perguntar |
|---|---|
| Admin em subdomínio (`admin.axonai.com.br`) ou path (`/admin/*`)? | S2 (Admin shell) |
| Gateway de pagamento (Stripe / Pagar.me / Asaas)? | Fase 2 — quando chegar |
| Escopo exato das feature flags (quais módulos/features ligar/desligar por plano)? | S8 (Platform settings) |
| Cifragem de credenciais: pgsodium nativo ou cifragem na aplicação? | S8 (depende de ambiente Supabase) |
| Lista final de campos do form de plano | S5 (quando iniciar) — usar [02-schema-banco.md](./02-schema-banco.md) `plans` como base |

## Pré-requisitos de ambiente antes de executar

O Tech Lead deve validar (preflight do framework):

1. **Git limpo:** `git status --porcelain` → vazio
2. **`.env.local` válido:** as 3 variáveis Supabase configuradas
3. **Bootstrap:** `package.json` e `src/` existem (este projeto já passou do bootstrap há muito)
4. **DB framework:** migrations rodando corretamente (schema_snapshot.json recente)

Se qualquer item falhar, seguir o protocolo de preflight do framework — **não improvisar**.

## Lista de arquivos que serão criados ao longo do roadmap completo

Para referência/visualização do destino final. Nenhum existe ainda, exceto os que já fazem parte do framework (marcados com ✓).

### Framework (modificados no S0)
- ✓ `docs/conventions/standards.md` (append seção "Admin Area")
- ✓ `docs/conventions/security.md` (append seção "Platform Admin Area")
- ✓ `eslint.config.mjs` (ou equivalente — adicionar regras)
- ✓ `agents/backend.md` (append sub-seção "Admin Server Actions")
- ✓ `agents/guardian.md` (append checklist admin)
- ✓ `agents/on-demand/sprint-creator.md` (adicionar campo `Target app`)
- ✓ (opcional) `scripts/verify-design.mjs`

### Migrations e seeds (S1)
- `supabase/migrations/<ts>_admin_area_foundation.sql`
- `docs/schema_snapshot.json` (atualizado com 7 tabelas novas)

### Shared libs (S2, S3)
- `src/lib/supabase/service-role.ts`
- `src/lib/admin/guards.ts`
- `src/lib/admin/audit.ts`
- `src/lib/admin/impersonation.ts`
- `src/lib/admin/encryption.ts` (S8, se Opção B)
- `src/middleware.ts` (modificado em S2)

### Admin app (S2 em diante)
- `src/app/(admin)/layout.tsx`
- `src/app/(admin)/dashboard/page.tsx`
- `src/app/(admin)/organizations/page.tsx`, `[id]/page.tsx`, `actions.ts`, `_components/*`
- `src/app/(admin)/plans/page.tsx`, `[id]/page.tsx`, `new/page.tsx`, `actions.ts`, `_components/*`
- `src/app/(admin)/subscriptions/page.tsx`, `[id]/page.tsx`, `actions.ts`, `_components/*`
- `src/app/(admin)/admins/page.tsx`, `[id]/page.tsx`, `new/page.tsx`, `actions.ts`, `_components/*`
- `src/app/(admin)/audit-log/page.tsx`, `_components/*`
- `src/app/(admin)/platform-settings/page.tsx`, sub-rotas, `actions.ts`, `_components/*`
- `src/app/(auth)/admin-login/page.tsx`
- `src/components/admin/AdminSidebar.tsx`, `AdminTopbar.tsx`

### Customer app (S3)
- `src/app/api/impersonation/start/route.ts`
- `src/app/api/impersonation/end/route.ts`
- `src/components/admin-impersonation/ImpersonationBanner.tsx`
- `src/app/(app)/layout.tsx` (modificado para montar o banner condicionalmente)

### Env vars a adicionar (S2)
- `IMPERSONATION_SECRET` — 64 bytes random, HMAC signing
- `PLATFORM_ENCRYPTION_KEY` (só se cifragem Opção B no S8)

## Protocolo de erro/bloqueio

Se o Tech Lead em sessão nova encontrar:

### "Não consigo prosseguir porque X não está claro"

1. **Verificar** se X está coberto em algum dos 7 docs desta pasta. Muitas "dúvidas" já têm resposta.
2. Se **sim** → aplicar a decisão documentada.
3. Se **não** → escalar ao usuário usando o formato do framework: *"Dúvida sobre [X]: [três opções possíveis]. Qual escolher?"*. **Não adivinhar.**

### "Acho que a decisão Y foi errada"

Não reabrir decisões fixadas sem consulta explícita ao usuário. Se tiver evidência forte de problema:
1. Registrar a descoberta claramente
2. Apresentar ao usuário: *"Ao executar [sprint], descobri que [decisão Y] causa [problema Z]. Alternativas: [A, B]. Como prosseguir?"*
3. **Aguardar** resposta antes de mudar rumo.

### "O código diverge dos docs"

Se ao executar S1, por exemplo, o `@db-admin` precisar ajustar SQL (ex: pgsodium não disponível, trocar por cifragem na aplicação):
1. Executar a adaptação necessária
2. **Atualizar este diretório** refletindo o que foi decidido/feito
3. Registrar em `docs/APRENDIZADOS.md` se for não-óbvio

## Rastreabilidade

Cada sprint file gerado (S0, S1, ..., S9) deve referenciar este diretório no header, por exemplo:

```markdown
**Planejamento fonte:** `docs/admin_area/05-roadmap-sprints.md` seção "S1"
```

Isso garante que qualquer revisor do sprint file saiba onde está o contexto expandido.

## Quando essa documentação fica obsoleta

Este diretório reflete o **estado de planejamento em 2026-04-23**. Ele serve como contexto de entrada para uma sessão limpa que vai executar o Sprint 0 e subsequentes.

À medida que os sprints executam:

- **Decisões que mudam em runtime** devem ser refletidas aqui (editar o doc correspondente).
- **Sprints concluídos** podem ser marcados como ✅ no `05-roadmap-sprints.md`.
- **Ao final do S9**, este diretório pode ser movido para `docs/admin_area/completed/` ou resumido em um único `OVERVIEW.md`.

Até lá, **a pasta é fonte autoritativa do que vai ser construído**. Se um sprint concluído diverge do planejamento, **atualizar a pasta** é parte do encerramento do sprint.

---

## Resumo executivo para humanos com pressa

Se você abriu este arquivo e está com pressa:

1. **Cole no chat:** `Tech Lead, leia docs/admin_area/ por completo e execute o Sprint 0.`
2. **Aguarde** o Tech Lead confirmar o entendimento.
3. **Responda** `execute` para iniciar.

Tudo o mais está nos outros 6 documentos desta pasta.
