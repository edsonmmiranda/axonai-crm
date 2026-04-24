# Standards & Contracts — Fonte Única

Regras **invioláveis** do framework. Nenhum outro arquivo redefine estas regras — todos apontam para cá. Se qualquer documento divergir deste, **este arquivo vence**.

**Leitores:** todos os agentes. **Writer:** Tech Lead (única autoridade para emendar).

---

## Hierarquia de autoridade entre documentos

Quando dois documentos dizem coisas diferentes, o mais alto na lista vence:

1. **`CLAUDE.md`** (boot do harness — regras duras do ambiente)
2. **`docs/conventions/standards.md`** (este arquivo — contratos e regras invioláveis)
3. **`docs/conventions/security.md`** (diretrizes de segurança — fonte autoritativa)
4. **`agents/00_TECH_LEAD.md`** (workflow, gates, orchestração)
5. **`docs/conventions/crud.md`** (padrões de UI e paths canônicos para CRUDs)
6. **`agents/stack/*.md`** e **`agents/ops/*.md`** (protocolos específicos de cada agente)
7. **`agents/skills/*.md`** (templates e padrões de implementação — exemplos, não regras)
8. **`docs/templates/*.md`** (skeletons de código — copie e adapte)

**Regra prática:** documentos de nível mais alto definem *o quê*; documentos de nível mais baixo definem *como*. Se um template contradiz uma regra deste arquivo, siga este arquivo.

---

## Modelo de execução: delegação entre agentes

Este framework descreve agentes como personas (`@frontend+`, `@backend`, `@guardian`, etc.), mas **todos são executados pela mesma LLM em single-thread**. Não existem processos paralelos.

**"Delegar ao @agente X"** significa:
1. Adotar a persona descrita no arquivo do agente X.
2. Ler os arquivos que aquele agente exige como pré-requisito.
3. Seguir o protocolo daquele agente até o fim.
4. Produzir o output no formato definido pelo contrato do agente.
5. Retornar à persona do Tech Lead.

**"Escalar ao Tech Lead"** dentro de um agente significa: parar a execução da persona atual, voltar ao papel de Tech Lead, e reportar o problema ao usuário seguindo o `escalation-protocol.md`.

**"Reportar ao Tech Lead"** significa: encerrar a persona atual e, como Tech Lead, decidir o próximo passo.

Consequências práticas:
- Não leia todos os arquivos de todos os agentes no boot. Leia o arquivo de cada agente **quando for adotar aquela persona**.
- Ao trocar de persona, descarte mentalmente o contexto do agente anterior — cada agente tem seu escopo de arquivos tocados.
- Se um agente (ex: `@guardian`) encontra um problema que outro agente (ex: `@frontend+`) deveria corrigir, **não corrija inline**. Volte ao Tech Lead, delegue ao agente correto com o contexto do erro.

---

## `ActionResponse<T>` — Contrato único

```typescript
interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: PaginationMeta; // apenas em listas
}

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}
```

- `success: true` + `data` = operação bem-sucedida
- `success: false` + `error` = operação falhou (mensagem amigável ao usuário)

**Nunca lance exceção para o cliente.** Erros internos são logados no servidor e transformados em mensagem amigável no campo `error`.

---

## Regras invioláveis de Server Actions

Aplicam-se a **toda** Server Action do framework, sem exceção:

1. **Input validado com Zod** antes de qualquer lógica
2. **Auth check** (`supabase.auth.getUser()`) antes de qualquer read/write
3. **Try/catch envolvendo tudo** — sem falhas silenciosas
4. **Log interno + mensagem amigável ao usuário** — nunca `error: error.message` direto
5. **Retorno sempre `ActionResponse<T>`** — nunca lance exceções para o cliente
6. **`revalidatePath` ou `revalidateTag`** após toda mutação
7. **Zod 4 usa `.issues`**, não `.errors` (armadilha registrada em `docs/APRENDIZADOS.md`)
8. **Lógica de negócio em TypeScript**, não em SQL (nem triggers, nem RPCs)
9. **Sem `any`** — tipos explícitos
10. **RLS faz isolamento de dados**, não o código de aplicação

---

## Regras invioláveis de código (qualquer arquivo sob `src/`)

1. **Código vive em `src/`** — nunca crie `app/`, `components/`, `lib/` na raiz do repo
2. **Sem literais de cor** (`#hex`, `rgb()`, `hsl()`, `oklch()`) em `src/` — apenas tokens semânticos
3. **Sem valores arbitrários do Tailwind** (`p-[17px]`, `bg-[#...]`, `w-[350px]`)
4. **Sem classes primitivas de cor** (`bg-blue-500`, `text-neutral-900`) — apenas classes semânticas
5. **Sem `any`** — TypeScript strict, tipos explícitos
6. **Ícones Lucide apenas** — logos de marca são assets SVG em `src/assets/brands/`
7. **Focus visible obrigatório** — `outline-none` exige `focus-visible:shadow-focus` no mesmo elemento
8. **Variantes via `cva`** — sem ternários ad-hoc para seleção de variante
9. **Componentes interativos sobre primitivo headless** (Radix/React Aria)
10. **Dark mode desde o primeiro commit** — sem `// TODO: dark mode`

---

## Regras invioláveis de Multi-tenancy (`organization_id`)

Estas regras se aplicam ao schema, ao RLS e às Server Actions — **sem exceção**, mesmo em projetos que hoje atendem um único cliente. A coluna existe desde a primeira migration para permitir expansão futura sem refactor destrutivo.

1. **Toda tabela de domínio em `public.*` DEVE ter coluna `organization_id uuid not null`** referenciando a tabela de organizações (FK). Não existe "esta tabela é single-tenant" — se armazena dado de cliente, tem `organization_id`.
2. **Toda policy RLS DEVE filtrar por `organization_id`**, combinada com `auth.uid() = user_id` quando houver dono individual:
   ```sql
   create policy "select_own_org" on public.nome_tabela for select
     using (organization_id = (auth.jwt() ->> 'organization_id')::uuid);
   ```
3. **Server Actions NUNCA aceitam `organization_id` como parâmetro do cliente.** O valor vem de `auth.jwt() ->> 'organization_id'` server-side (ver `docs/conventions/security.md` §2.2).
4. **O custom claim `organization_id` é populado via Supabase Auth Hook** (não via trigger em `auth.users` — hooks são o caminho oficial e sobrevivem a resets de sessão).
5. **Exceção única:** tabelas genuinamente globais e read-only (ex.: `countries`, `currencies`, catálogos compartilhados, feature flags do sistema) vivem em schema separado `public_ref` e são listadas explicitamente neste arquivo quando criadas. **Qualquer tabela em `public.*` exige `organization_id`.**

**Tabelas em `public_ref` atualmente registradas:** _(nenhuma — adicionar aqui quando criada)_

**Exceções em `public.*` (catálogos globais mantidos em `public` por decisão explícita):**

| Tabela | Justificativa | Sprint | Proteção compensatória |
|---|---|---|---|
| `public.plans` | Catálogo comercial compartilhado por todas as orgs; ligação com org é via `subscriptions.plan_id` | `admin_01` (2026-04-24) | RLS FORCE + policy SELECT só para planos públicos não arquivados + mutações bloqueadas (sem policy de INSERT/UPDATE/DELETE); writes futuros só via RPC `SECURITY DEFINER` |
| `public.platform_admins` | Catálogo global de operadores da Axon AI; escopado à org interna via FK `profile_id → profiles(id)` (org com `is_internal=true`); não pertence a um org-tenant | `admin_02` (2026-04-24) | RLS FORCE + policy SELECT restrita a `profile_id = auth.uid()` + mutações bloqueadas; writes via RPC `SECURITY DEFINER` (`seed_initial_platform_admin_owner`, e RPCs do Sprint 11) |

---

## Contrato de testes

Toda Server Action produzida pelo `@backend` **deve** ter integration test correspondente produzido pelo `@qa-integration` no mesmo sprint. Este é um contrato duro — enforçado via **GATE 4.5** no workflow (ver [`agents/00_TECH_LEAD.md`](../../agents/00_TECH_LEAD.md)).

1. **Infraestrutura base obrigatória:** `vitest.config.ts`, `tests/setup.ts` (mock centralizado do Supabase server client e do `getSessionContext`). Instalada uma única vez no sprint de bootstrap via [`docs/templates/vitest_setup.md`](../templates/vitest_setup.md).
2. **Um arquivo de teste por módulo:** `tests/integration/<module>.test.ts`. Nunca fragmentar por action.
3. **Cobertura mínima por Server Action exportada (não negociável):**
   - Happy path (`success: true`)
   - Falha de validação Zod → `success: false` **sem** chamar Supabase
   - Falha de auth (`getUser` retorna `null`) → `success: false` **sem** chamar Supabase
   - +1 teste por regra de negócio testável declarada no sprint file / PRD
4. **Sem mock inline.** Todo mock passa pelo `__mockSupabase` do `tests/setup.ts`. Testes individuais sobrescrevem com `mockResolvedValueOnce`/`mockReturnValueOnce`.
5. **Sem `it.skip`, `describe.skip`, `it.todo`.** Skip silencioso é violação que faz GATE 4.5 bloquear o commit.
6. **Integration tests validam a lógica da Server Action** (auth → validação → fluxo → retorno), **não** RLS nem constraints do banco. Validação de RLS continua sendo responsabilidade do `@db-auditor` (on-demand).
7. **Unit tests, component tests e E2E continuam opcionais** — produzidos apenas pelo `@qa` on-demand quando o usuário pede explicitamente.
8. **Regras de negócio no PRD se tornam testes.** Toda bullet enumerada como regra testável na seção "Contrato de API" do PRD vira um `it(...)` dedicado no arquivo de teste, com comentário referenciando a fonte (ex.: `// PRD §5.2`).

**Ownership:**
- `tests/integration/**` → `@qa-integration` (único writer)
- `tests/unit/**`, `tests/components/**`, `tests/e2e/**` → `@qa` on-demand (único writer)
- `tests/setup.ts`, `vitest.config.ts`, `playwright.config.ts` → bootstrap sprint / `@qa` on-demand no primeiro setup (com aprovação explícita)

---

## Regras invioláveis do ambiente

1. **Nunca** modifique `.env.local`
2. **Nunca** rode `git reset --hard` nem `git push --force`
3. **Nunca** pule hooks (`--no-verify`) nem bypass signing
4. **Migrations** vivem em `supabase/migrations/` — único writer é `@db-admin`. Nunca leia como fonte de estado: são histórico write-only (podem refletir estado revertido). Estado real vem de `docs/schema_snapshot.json`.

---

## Ownership de arquivos persistentes

| Arquivo | Único writer | Outros agentes |
|---|---|---|
| `docs/schema_snapshot.json` | `@db-admin` (após cada introspecção) | Todos lêem; ninguém mais escreve |
| `docs/APRENDIZADOS.md` | Qualquer agente que descubra algo surpreendente | Todos lêem na fase de planejamento |
| `docs/conventions/standards.md` | Tech Lead | Todos lêem; ninguém mais escreve |
| `tests/integration/**` | `@qa-integration` | Todos lêem; ninguém mais escreve |
| `tests/unit/**`, `tests/components/**`, `tests/e2e/**` | `@qa` on-demand | Todos lêem; ninguém mais escreve |
| `tests/setup.ts`, `vitest.config.ts` | Bootstrap sprint (setup inicial) | Imutáveis após bootstrap — mudanças exigem sprint dedicado |

---

## Ordem de leitura por fase

### Ao adotar persona de agente
Leia **apenas** os arquivos listados como pré-requisito no arquivo do agente. Não leia arquivos de outros agentes.

### Ao adotar `@db-admin`
1. `agents/ops/db-admin.md`
2. `docs/templates/db_introspection.md`
3. `docs/conventions/security.md` §2 (RLS e isolamento de dados)

### Ao adotar `@backend`
1. `agents/stack/backend.md`
2. `docs/templates/server_actions.md`
3. `docs/conventions/crud.md` (se o sprint envolve CRUD)
4. `agents/skills/error-handling/SKILL.md` (se necessário)
5. `agents/skills/reference-module-copy/SKILL.md` (se Reference Module especificado)

### Ao adotar `@qa-integration`
1. `agents/stack/qa-integration.md`
2. `docs/templates/server_actions_test.md`
3. `docs/templates/vitest_setup.md` (apenas para conhecer o shape do mock central)
4. `src/lib/actions/<module>/actions.ts` e `src/lib/actions/<module>/schemas.ts` do módulo sob teste
5. Sprint file / PRD na seção de regras de negócio

### Ao adotar `@frontend+`
1. `agents/stack/frontend-plus.md` — leia primeiro, contém o protocolo de resolução de referência (3 níveis)
2. A referência visual resolvida pelo protocolo (tela pronta HTML, módulo de referência, ou design system)
3. `design_system/components/CONTRACT.md` — **apenas no Nível 3** (quando não existe tela pronta)
4. `design_system/enforcement/rules.md` — apenas se precisar confirmar regra de lint
5. `docs/conventions/crud.md` (se o sprint envolve CRUD)
6. `docs/conventions/security.md` §4.1 e §6 (XSS e exposição de dados) — já resumido no próprio `frontend-plus.md`

### Ao adotar `@guardian`
1. `agents/quality/guardian.md`
2. `docs/conventions/security.md` (fonte normativa para §3)
3. `design_system/enforcement/rules.md`
4. `design_system/components/CONTRACT.md`

### Ao adotar `@spec-writer`
1. `agents/product/spec-writer.md`
2. `docs/conventions/crud.md` (se o sprint envolve CRUD)
3. Template de PRD correspondente ao nível

### Ao adotar `@sanity-checker`
1. `agents/product/sanity-checker.md`
2. `agents/workflows/validation-checklist.md`

### Ao adotar `@git-master`
1. `agents/ops/git-master.md`

### Ao adotar `@api-integrator`
1. `agents/integrations/api-integrator.md`
2. `docs/templates/api_integration_patterns.md` (na Phase 2)
