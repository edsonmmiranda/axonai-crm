# 04 — Mudanças no Framework (Sprint 0)

O framework atual assume **um único app Next.js** com paths canônicos em `src/app/(app)/...`. A introdução da área admin (`src/app/(admin)/...`) exige **ajustes pontuais e aditivos** em 6 arquivos do framework — nada existente é removido ou reescrito.

Este documento é a **especificação do Sprint 0**. Um Sprint LIGHT que executa somente estas alterações antes do primeiro sprint de feature (S1).

## Resumo dos arquivos afetados

| # | Arquivo | Tipo de mudança | Linhas aprox |
|---|---|---|---|
| 1 | `docs/conventions/standards.md` | Adicionar seção "Admin Area" com paths canônicos e regras de isolamento | ~30 |
| 2 | `docs/conventions/security.md` | Adicionar seção "Platform Admin Area" com regras de `assertPlatformAdmin`, audit, impersonation, service_role | ~60 |
| 3 | `eslint.config.mjs` (ou equivalente) | Adicionar regras `no-restricted-imports` para cross-import e service_role | ~15 |
| 4 | `agents/backend.md` (ou `@backend` equivalente) | Adicionar sub-seção "Admin Server Actions" com o novo padrão | ~20 |
| 5 | `agents/guardian.md` | Adicionar checklist de validação para código em `(admin)/` | ~30 |
| 6 | `agents/on-demand/sprint-creator.md` + template de sprint file | Adicionar campo `**Target app:** customer \| admin \| shared` | ~10 |

**Opcional (verificar no Sprint 0 se é necessário):**
- `scripts/verify-design.mjs` — se hard-coda `(app)` no path, aceitar também `(admin)`

**Nível:** LIGHT
**Esforço estimado:** ~45 minutos
**Target app:** shared (é framework, afeta ambos)

---

## 1. `docs/conventions/standards.md`

### O que adicionar

Criar nova seção "Admin Area — Platform Dashboard" logo após a seção atual de paths canônicos. Conteúdo proposto:

```markdown
## Admin Area (Platform Dashboard)

A área administrativa do SaaS (acessada pelos donos da plataforma, não pelos clientes) vive em um route group separado.

### Paths canônicos

| Propósito | Customer (existente) | Admin (novo) |
|---|---|---|
| Route group | `src/app/(app)/` | `src/app/(admin)/` |
| Páginas | `src/app/(app)/[module]/page.tsx` | `src/app/(admin)/[module]/page.tsx` |
| Server Actions | `src/app/(app)/[module]/actions.ts` | `src/app/(admin)/[module]/actions.ts` |
| Layout | `src/app/(app)/layout.tsx` (AppLayout) | `src/app/(admin)/layout.tsx` (AdminLayout) |
| Componentes locais do módulo | `src/app/(app)/[module]/_components/` | `src/app/(admin)/[module]/_components/` |
| Componentes compartilhados só entre telas admin | N/A | `src/components/admin/` |

### Regras invioláveis de isolamento

1. **Cross-import proibido:** arquivos em `(app)/` não podem importar de `(admin)/` e vice-versa. Enforced por ESLint.
2. **Server Actions em `(admin)/` SEMPRE:**
   - Começam com `await assertPlatformAdmin()` (primeira linha executável).
   - Usam `createServiceRoleClient()` do `src/lib/supabase/service-role.ts`.
   - Chamam `logAdminAction()` após mutações bem-sucedidas.
3. **Server Actions em `(app)/` NUNCA** usam `createServiceRoleClient()` — sempre client de sessão (`createServerClient()`).
4. **Tabelas globais** (sem `organization_id`) têm `ENABLE ROW LEVEL SECURITY` mas **nenhuma policy** (DENY ALL default). Acesso exclusivo via `service_role`.

Detalhes de segurança: ver `docs/conventions/security.md` seção "Platform Admin Area".
```

### Critério de aceite

- Seção adicionada após a seção atual de paths
- Nenhuma linha existente foi alterada (change é aditivo)
- Tabela de paths está correta e completa

---

## 2. `docs/conventions/security.md`

### O que adicionar

Nova seção "§N — Platform Admin Area" no fim do arquivo (antes de referências/glossário, se houver).

Conteúdo resumido (texto completo deve cobrir o que está em [03-seguranca.md](./03-seguranca.md) desta pasta, adaptado ao tom do `security.md`):

```markdown
## §N — Platform Admin Area

Regras aplicáveis a código em `src/app/(admin)/**` e `src/lib/admin/**`.

### N.1 — assertPlatformAdmin obrigatório
Toda Server Action admin começa com:
\`\`\`ts
const admin = await assertPlatformAdmin()  // primeira linha executável
\`\`\`
Signatura e implementação em `src/lib/admin/guards.ts`. Valida:
- User autenticado (sessão Supabase)
- MFA satisfeito (AAL2)
- Entrada ativa em `platform_admins`

### N.2 — Service role client gated
Server Actions admin usam `createServiceRoleClient()` (em `src/lib/supabase/service-role.ts`) — bypassa RLS. ESLint proíbe o import fora de `(admin)/**` e `lib/admin/**`.

### N.3 — Audit log imutável
Toda mutação em dados sensíveis chama `logAdminAction(...)` após sucesso. Tabela `platform_audit_log` tem trigger que proíbe UPDATE/DELETE.

### N.4 — Impersonation
Token HMAC-SHA256 assinado, TTL 30min, single-use via nonce. Toda sessão grava em `impersonation_sessions` (imutável por trigger). Banner permanente na UI do customer.

### N.5 — MFA obrigatório
Platform admin sem MFA enrolled não executa actions — fluxo força enrollment TOTP no primeiro login.

### N.6 — Credenciais de integração cifradas
Chaves externas (Stripe, SMTP, WhatsApp) ficam em `platform_integration_credentials` cifradas (pgsodium ou cifragem na aplicação). Nunca logadas, nunca exibidas em listagem.

### N.7 — RLS das tabelas globais
Tabelas sem `organization_id` têm RLS habilitada mas sem policies (DENY ALL). Exceções: `plans` (SELECT público para authenticated) e `subscriptions` (SELECT para users da própria org).
```

### Critério de aceite

- Seção nova no final (antes de glossário)
- Numeração coerente com seções existentes
- Links internos funcionam

---

## 3. `eslint.config.mjs` (ou `eslint.config.js`)

### O que adicionar

Descobrir qual é o arquivo de config ESLint do projeto (ler `package.json` ou `ls` na raiz) e adicionar:

```js
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['**/app/(admin)/**'],
          message: 'Código em (app) não pode importar de (admin) — viola isolamento'
        },
        {
          group: ['**/app/(app)/**'],
          message: 'Código em (admin) não pode importar de (app) — viola isolamento'
        },
        {
          group: ['**/lib/supabase/service-role'],
          message: 'service_role só em src/app/(admin)/**/actions.ts ou src/lib/admin/**'
        }
      ]
    }]
  }
}
```

Com overrides permitindo:
- `src/app/(app)/**/*` pode importar qualquer coisa EXCETO `(admin)`
- `src/app/(admin)/**/*` pode importar qualquer coisa EXCETO `(app)`
- `src/lib/supabase/service-role.ts` (o arquivo fonte) pode existir sem se auto-proibir
- `src/app/(admin)/**/actions.ts` e `src/lib/admin/**/*` podem importar `service-role`

A estrutura final depende do formato do ESLint flat config vs legacy. `@backend` ou Tech Lead decide no Sprint 0.

### Critério de aceite

- `npm run lint` passa em código existente (não quebra customer)
- Teste manual: criar arquivo `src/app/(app)/test-import.ts` importando de `(admin)` → lint deve falhar
- Teste manual: importar service-role em arquivo customer → lint deve falhar

---

## 4. `agents/backend.md` (ou `@backend` correspondente)

### O que adicionar

Nova sub-seção "Admin Server Actions" no agente `@backend`, após a seção atual de padrões de Server Action.

```markdown
## Admin Server Actions

Quando o sprint file declara `**Target app:** admin`, siga o padrão abaixo em vez do padrão customer.

### Path canônico
`src/app/(admin)/[module]/actions.ts`

### Template de Server Action admin

\`\`\`ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertPlatformAdmin } from '@/lib/admin/guards'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { logAdminAction } from '@/lib/admin/audit'

const inputSchema = z.object({
  // ...
})

export async function exemploAction(input: z.infer<typeof inputSchema>) {
  const admin = await assertPlatformAdmin()                  // 1. guard
  const data = inputSchema.parse(input)                       // 2. validate
  const supabase = createServiceRoleClient()                  // 3. service role
  
  const { data: result, error } = await supabase              // 4. mutate
    .from('<table>')
    .insert(data)
    .select()
    .single()

  if (error) throw error

  await logAdminAction({                                      // 5. audit
    adminId: admin.id,
    action: '<resource>.<verb>',
    targetType: '<type>',
    targetId: result.id,
    metadata: { ... }
  })

  revalidatePath('/admin/<module>')                           // 6. revalidate
  return result
}
\`\`\`

### Regras obrigatórias

- Linha 1 executável: `await assertPlatformAdmin()`
- Nenhum import de `@/lib/supabase/server` (client de sessão) — sempre service-role
- Nenhum import de `src/app/(app)/**`
- Toda mutation (INSERT, UPDATE, DELETE) chama `logAdminAction` após sucesso
- Actions de leitura (select) não precisam chamar logAdminAction
```

### Critério de aceite

- Sub-seção adicionada
- Template de código é válido (compila se copiado literalmente em arquivo com as types certas)
- Não altera comportamento do `@backend` para sprints customer

---

## 5. `agents/guardian.md`

### O que adicionar

Nova sub-seção "Validações específicas de (admin)" no checklist do Guardian.

```markdown
## Validações de código em (admin)/

Quando `@guardian` revisar código em `src/app/(admin)/**` ou `src/lib/admin/**`, verificar ADICIONALMENTE ao checklist padrão:

### Para Server Actions em (admin)/**/actions.ts

- [ ] Primeira linha executável chama `await assertPlatformAdmin()`
- [ ] Import de `createServiceRoleClient` (não `createServerClient`)
- [ ] Nenhum import de `(app)/`
- [ ] Mutations (insert/update/delete) seguidas de `logAdminAction()`
- [ ] Validação Zod do input antes de qualquer query
- [ ] Erros não vazam detalhes internos ao client

### Para componentes em (admin)/

- [ ] Não importam componentes de `(app)/`
- [ ] Server components que precisam de dados usam Server Actions — não fetch direto
- [ ] Client components não recebem `SUPABASE_SERVICE_ROLE_KEY` como prop

### Para arquivos em src/lib/admin/

- [ ] `src/lib/supabase/service-role.ts` lê a env var mas não a exporta como string em nenhum lugar
- [ ] `src/lib/admin/audit.ts` usa service role, não client de sessão
- [ ] `src/lib/admin/guards.ts` valida AAL2 (MFA satisfeito)

Se qualquer item falha → GATE 4 reprova, relatório identifica arquivo + linha + regra violada, e delega correção ao agente que escreveu (geralmente `@backend` para actions ou `@frontend+` para componentes).
```

### Critério de aceite

- Checklist adicionado
- Não remove validações existentes
- Referência a `assertPlatformAdmin` e `logAdminAction` é explícita

---

## 6. Template de sprint file + `agents/on-demand/sprint-creator.md`

### O que adicionar no template

No header do template de sprint file, logo após `**Nível:**`, adicionar:

```markdown
**Nível:** LIGHT | STANDARD
**Target app:** customer | admin | shared
```

### O que adicionar no `sprint-creator.md`

Nova instrução no step onde o sprint-creator preenche o header:

```markdown
### Determinação do Target app

Inferir a partir do contexto do sprint:

- **customer** — módulos em `src/app/(app)/`, Server Actions customer, UI para usuários das empresas-clientes. É o default se não houver indicação contrária.
- **admin** — módulos em `src/app/(admin)/`, Server Actions admin, UI para donos do SaaS. Incluir sempre que o sprint toca em `platform_admins`, `plans`, `subscriptions`, `platform_audit_log`, `platform_settings` ou mencionar "admin dashboard", "SaaS owner", "platform".
- **shared** — sprints que tocam apenas framework, design system, migrations genéricas, ou infra compartilhada (ex: middleware, Supabase clients em `src/lib/`).

Sprints que tocam AMBOS os apps (ex: "customer app precisa suportar impersonation") declaram **Target app:** shared e o conteúdo do sprint detalha o que toca em cada lado.
```

### Como o Tech Lead usa

Ao ler o sprint file, o Tech Lead:
1. Extrai o `Target app` do header
2. Inclui como contexto no prompt de delegação para cada agente
3. Agentes ajustam seu comportamento (usar service-role, assertPlatformAdmin, etc)

### Critério de aceite

- Template atualizado
- Instrução adicionada ao sprint-creator
- Sprints existentes em `sprints/done/` NÃO precisam de migração retroativa — assume-se `Target app: customer` para tudo que existe hoje

---

## 7. (Opcional) `scripts/verify-design.mjs`

### Verificação

Ler o script e ver se hard-coda `(app)` em paths. Ex:

```js
// Se encontrar algo como:
glob('src/app/(app)/**/*.tsx')

// Mudar para:
glob(['src/app/(app)/**/*.tsx', 'src/app/(admin)/**/*.tsx'])
```

### Critério de aceite

- Script continua funcional para customer
- Se invocado em arquivo de `(admin)/`, roda as validações sem erro

**Se o script não hard-coda path, pular este passo.**

---

## Execução do Sprint 0

### Contrato do Sprint 0

- **Nível:** LIGHT
- **Target app:** shared
- **Workflow:** Opção 1 (sprint file = contrato, sem PRD)
- **Gates aplicáveis:**
  - ❌ GATE 1 (DB) — não há migrations
  - ✅ GATE 2 (build + lint) — após mudar ESLint
  - ❌ GATE 3 (API) — não há integração
  - ⚠️ GATE 4 (Guardian) — sprint toca framework, Guardian revisa coerência
  - ❌ GATE 5 (design) — não há mudança visual

### Sprint file proposto para S0

O `@sprint-creator` gera o sprint file seguindo o template atual, com conteúdo baseado neste documento. Localização: `sprints/active/sprint_S0_framework_admin_area_prep.md`.

### Após execução

- Commit único com mensagem tipo: `chore(framework): prepare for admin area (route group + security + agents)`
- Mover `sprint_S0_*.md` de `active/` para `done/`
- Iniciar Sprint 1 (DB Foundation) — que agora pode usar `**Target app:** admin` com certeza

## O que NÃO muda no framework

| Componente | Status |
|---|---|
| `CLAUDE.md` (boot file) | ✅ Sem mudanças |
| `agents/00_TECH_LEAD.md` (workflow dual, 5 gates, escalation) | ✅ Sem mudanças |
| `agents/db-admin.md` (protocolo de migrations) | ✅ Sem mudanças |
| `agents/frontend+.md` (reference module copy, design system) | ✅ Sem mudanças |
| `agents/api-integrator.md` | ✅ Sem mudanças |
| `docs/conventions/crud.md` (padrões CRUD customer) | ✅ Sem mudanças — admin CRUDs podem adicionar seção própria em sprint futuro |
| `design_system/` | ✅ Sem mudanças — design admin usa os mesmos tokens e componentes |
| `sprints/active/` e `sprints/done/` workflow | ✅ Sem mudanças |
| Workflow dual Opção 1/2 | ✅ Sem mudanças |
| Gates de validação | ✅ Sem mudanças |
| `@git-master` processo de commit | ✅ Sem mudanças |
| `docs/APRENDIZADOS.md` processo | ✅ Sem mudanças |
