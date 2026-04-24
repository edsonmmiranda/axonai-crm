# Sprint 01 (Admin Area): Foundation DB — Planos, Assinaturas e Org Interna Axon

> **Nível:** STANDARD
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 01
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § 6.5, 6.6, RF-PLAN-6, RF-SUB-6, RF-SUB-7, INV-1, INV-4, INV-5, INV-8
> **Observação:** é a Sprint 01 do **ciclo de planejamento da Área Administrativa**. O repositório já tem `sprints/done/sprint_01_bootstrap.md … sprint_15_whatsapp_groups.md` do ciclo anterior (customer app). O nome `sprint_01_plans_subscriptions_internal_org.md` foi prescrito literalmente pelo plano.

---

## 🎯 Objetivo de Negócio

Substituir o mecanismo frágil atual de plano (`organizations.plan text CHECK`) por um modelo de negócio próprio: entidade `plans` (catálogo comercial com limites tipados) + `subscriptions` (vínculo org↔plano com status canônico). Criar a organização interna AxonAI que vai ancorar os platform admins nos sprints seguintes. Migrar as orgs existentes sem quebrar nenhum caminho do customer app.

**Por que agora:** é o pré-requisito técnico de *todos* os sprints 05+ do plano (onboarding, suspender, trocar plano, hard-enforcement de limites). Nada mais do roadmap é possível enquanto o plano comercial viver num `text CHECK`.

**Métrica de sucesso:**
- 100% das orgs existentes com exatamente uma subscription vigente.
- Zero regressão nos golden flows do customer app (login, criar lead, listar produtos, pipeline).
- Org interna AxonAI criada e marcada `is_internal=true` (base para INV-4/INV-5 nos próximos sprints).

## 👤 User Stories

- Como **platform admin (futuro)**, quero que planos comerciais sejam entidades próprias com limites tipados, para que eu possa operar catálogo e assinaturas sem SQL manual.
- Como **dono da Axon**, quero que a organização interna da Axon seja marcada distintivamente no banco, para que nenhuma ação destrutiva em UI futura atinja a conta de dogfood.
- Como **desenvolvedor**, quero um único helper `getOrgPlan(orgId)` lendo de `subscriptions`, para que o restante do código não dependa da coluna legada `organizations.plan`.

## 🎨 Referências Visuais

- **Sprint de infra de banco** — não cria telas novas.
- Única superfície de UI tocada: `src/app/(app)/settings/organization/page.tsx` + `src/components/settings/OrganizationForm.tsx`. O campo "Plano" hoje exibe `org.plan` readonly; passa a exibir o plano vindo de `subscriptions.plan_id` → `plans.name`. Visual não muda — só a fonte do dado.
- `/signup` público é **desativado** (D-1 do plano): não há tela nova, é remoção de roteamento.

## 🧬 Reference Module Compliance

**Não aplicável.** Esta sprint não cria novo módulo CRUD. É migração de schema + refactor de leituras. Qualquer Reference Module Copy aqui seria teatro.

O `@db-admin` segue os padrões já estabelecidos em migrations anteriores do próprio projeto (idempotência com `IF NOT EXISTS`, FORCE RLS em tabelas globais, policies org-scoped via JWT claim `organization_id`).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de Dados (autor: `@db-admin`)

- [ ] **Coluna nova em `organizations`:**
  - `is_internal boolean NOT NULL DEFAULT false` — marcador da org interna Axon (ancorará INV-4 e INV-5 nos próximos sprints).

- [ ] **Tabela `plans`** (FORCE RLS):
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `name text NOT NULL` (UNIQUE)
  - `description text`
  - `price_monthly_cents int NOT NULL DEFAULT 0`
  - `price_yearly_cents int NOT NULL DEFAULT 0`
  - `features_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb` (lista descritiva p/ UI customer)
  - `is_public boolean NOT NULL DEFAULT true`
  - `is_archived boolean NOT NULL DEFAULT false`
  - **Limites tipados (RF-PLAN-6)** — todos `int NULL` (NULL = ilimitado) exceto o último:
    - `max_users int`
    - `max_leads int`
    - `max_products int`
    - `max_pipelines int`
    - `max_active_integrations int`
    - `max_storage_mb int`
    - `allow_ai_features boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()` (trigger)
  - Policies: SELECT aberto a authenticated (planos são catálogo público filtrado por `is_public` no app); sem policies de INSERT/UPDATE/DELETE para `authenticated` (só service_role via RPCs que viriam no Sprint 06).

- [ ] **Tabela `subscriptions`** (FORCE RLS):
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`
  - `plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT` (INV-2: plano em uso não exclui)
  - `status text NOT NULL CHECK (status IN ('trial','ativa','past_due','trial_expired','cancelada','suspensa'))`
  - `period_start timestamptz NOT NULL DEFAULT now()`
  - `period_end timestamptz` (NULL para `ativa` perene; preenchido para `trial`/`cancelada`)
  - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` (inclui `trial_days_override` etc.)
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()` (trigger)
  - **Índice canônico:** `(organization_id, status)`.
  - **Partial UNIQUE index (INV-1, G-12):** `CREATE UNIQUE INDEX subscriptions_one_vigente_per_org ON subscriptions (organization_id) WHERE status IN ('trial','ativa','past_due');` — garante no máximo uma assinatura "vigente" por org. `trial_expired`/`cancelada`/`suspensa` podem coexistir historicamente.
  - Policies: SELECT `organization_id = auth.jwt() ->> 'organization_id'::text::uuid` (customer lê a própria). Sem INSERT/UPDATE/DELETE para `authenticated` — mudanças só via service_role/RPC (Sprint 06).

- [ ] **Seed de planos iniciais** — migrar os valores que hoje vivem no `CHECK`:
  - `free` → plano "Free" (`max_users=2`, `max_leads=100`, limites restritos)
  - `basic` → plano "Basic"
  - `premium` → plano "Premium" (ilimitado na maior parte)
  - `internal` → plano interno não-público (`is_public=false`, `is_archived=false`, todos os limites NULL = ilimitado, `allow_ai_features=true`). É o plano da org interna Axon.
  - Valores concretos de limite para cada plano **ficam para o Implementation Plan** (Opção 2) — o PRD e o plano não fixam números; é decisão comercial.

- [ ] **Seed da org interna AxonAI:**
  - `organizations (name='Axon AI', slug='axon', is_internal=true)`.
  - `subscriptions` vinculando `axon` ao plano `internal` com `status='ativa'`, `period_end=NULL`.
  - Idempotente: `INSERT … ON CONFLICT (slug) DO NOTHING`.

- [ ] **Backfill das orgs existentes (única janela crítica):**
  - Para cada `organizations` com `plan IN ('free','basic','premium')`: criar `subscriptions (organization_id, plan_id, status='ativa', period_start=organizations.created_at, period_end=NULL)`.
  - Orgs com `plan` fora do enumerado (eventualmente nulo ou valor exótico): **PARE** e reporte — não adivinhe.
  - Idempotente: rodar a migration 2×ᅠnão cria subscription duplicada (usa `ON CONFLICT` com partial unique index ou `WHERE NOT EXISTS`).

- [ ] **Coluna `organizations.plan` preservada com compat:**
  - **NÃO** remover ainda. O Sprint 05 do plano assume remoção depois que todo consumidor migrar.
  - Opcional (decisão no PRD Técnico): trigger `BEFORE UPDATE` em `organizations` que sincroniza `plan` ← nome do plano da subscription vigente, caso algum caller legado ainda escreva. **Recomendação:** pular o trigger e apenas marcar a coluna como "deprecated" via comentário SQL — nenhum caller no código atual escreve em `organizations.plan`, só lê. Decisão formal do `@spec-writer`.

- [ ] **RPC `get_current_subscription(org_id uuid) RETURNS subscriptions` — `SECURITY DEFINER`:**
  - Retorna a subscription vigente (status ∈ `trial|ativa|past_due`) da org solicitada.
  - Valida que o caller é membro da org (`auth.jwt() ->> 'organization_id' = org_id`), **exceto** se for service_role.
  - `RAISE EXCEPTION` com mensagem tipada se não encontrar (permite callers distinguirem "sem subscription" de "org inexistente").

- [ ] **Migration idempotente** (`IF NOT EXISTS`, `ON CONFLICT`), com **seção de rollback documentada no topo do arquivo** como comentário (G-17). O rollback real roda em ambiente de staging antes de prod, conforme runbook.

#### Código (autor: `@backend`)

- [ ] **Helper novo `src/lib/plans/getOrgPlan.ts`:**
  - Assinatura: `getOrgPlan(orgId: string): Promise<{ planName: string; limits: PlanLimits; subscriptionStatus: SubscriptionStatus }>`.
  - Lê via RPC `get_current_subscription` + join implícito em `plans` (RPC pode retornar joined já).
  - Tipos exportados: `PlanLimits`, `SubscriptionStatus` (alinhados ao `CHECK` do DB).
  - Cache por request (dedupe) — `React.cache` ou equivalente; TTL zero (sempre fresh dentro de um request).

- [ ] **Refactor de consumidores de `organizations.plan`:**
  - `src/app/(app)/settings/organization/page.tsx:44` — trocar `plan: org.plan` por `plan: (await getOrgPlan(org.id)).planName`.
  - `src/components/settings/OrganizationForm.tsx:124` — continua recebendo `organization.plan` como prop readonly; **zero mudança** no componente, só na origem do dado.
  - **Busca exaustiva antes de commitar:** `grep -rn "\.plan\b\|organizations\.plan\|org\.plan" src/` — mapear todos os callers e garantir que todos leiam do helper. Lista esperada pelo plano: `src/lib/actions/*.ts` + `getSessionContext`. A busca revelou apenas os dois arquivos acima; `@spec-writer` confirma no PRD Técnico.
  - **`getSessionContext` não precisa ler plano** hoje — a referência no plano ("getSessionContext substitua leitura de plan") é um cuidado defensivo. Validar que ele **de fato** não lê `plan` e documentar.

- [ ] **Desativar `/signup` público (D-1):**
  - Remover os 3 arquivos de `src/app/(auth)/signup/`:
    - `page.tsx`
    - `check-email/page.tsx`
    - `link-expired/page.tsx`
  - Remover quaisquer `<Link href="/signup">` (ex.: no login, em landing pages) — `grep -rn 'href="/signup"' src/` como parte da validação.
  - **Não** remover os handlers de confirmação de email (`auth/confirm`, `auth/callback`) — a infra de email ainda é usada por convites.
  - Flag `enable_public_signup` fica hardcoded `false` em um constante exportada de `src/lib/config/flags.ts`. A infra real de feature_flags vem no Sprint 09.
  - **Server Action `signupAction`** (se existir em `src/lib/actions/auth.ts` ou similar): manter o código mas adicionar guarda no topo — `if (!enablePublicSignup) return { error: 'Signup público desativado' }`. Não deletar; Sprint 2 (fase 2 do roadmap) reativa.

### Frontend

**N/A estrutural.** A única mudança visível é `settings/organization` mostrar o nome canônico do plano (Free/Basic/Premium/Internal) em vez do slug da coluna legada. Sem novo layout, sem nova rota, sem novos componentes.

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Org sem subscription vigente após backfill:** não deve existir (backfill cobre 100%). Se acontecer por bug, `get_current_subscription` lança erro tipado — UI traduz para "Plano não identificado, contate suporte". Testado com migration rodada em staging primeiro.
- [ ] **Duas tentativas simultâneas de criar subscription vigente para a mesma org** (cenário futuro, mas index precisa provar já): segunda INSERT falha com `unique_violation` — valida INV-1/G-12.
- [ ] **Plano referenciado por subscription ativa é deletado diretamente no DB:** FK `ON DELETE RESTRICT` bloqueia. (INV-2 — exercitado em Sprint 06, mas a constraint **está** agora.)
- [ ] **Rollback da migration** em staging: script testado, drop das tabelas + restore do backup de `organizations.plan` (se tiver sido alterado). Runbook anexo.
- [ ] **Caller legado escrevendo em `organizations.plan`:** não existe hoje; revalidado via grep. Se surgir no futuro, trigger opcional sincroniza (se instalado) ou causa drift detectável (se não).
- [ ] **Acesso a `/signup` após desativação:** retorna 404 (rota removida). Não é 403 nem redirect — simplesmente não existe mais.
- [ ] **Org interna AxonAI em ambiente de dev/staging:** seed idempotente; rerodar a migration 2× não duplica.

## 🚫 Fora de escopo

- UI admin de CRUD de planos — **Sprint 06** do plano.
- UI admin de gerenciar subscriptions (trocar plano, estender trial) — **Sprint 06**.
- RPCs `admin_suspend_organization`, `admin_create_organization` etc. — **Sprint 05**.
- Platform admins / RBAC / `platform_admins` tabela — **Sprint 02**.
- Audit log — **Sprint 03**.
- `plan_grants` e hard-enforcement dos limites — **Sprint 07**.
- Transições automáticas de status (pg_cron) — **Sprint 13**.
- Remoção definitiva de `organizations.plan` — **Sprint 05** (após janela de compat).
- Reativar `/signup` público — **Fase 2** do roadmap geral.
- Definir valores numéricos finais dos limites de cada plano comercial — decisão comercial do `@spec-writer` no PRD Técnico (ou defaults conservadores se diferido).

---

## ⚠️ Critérios de Aceite

- [ ] Migration aplicada em staging com `supabase db push --dry-run` passa sem erro.
- [ ] Todas as orgs existentes têm exatamente **uma** subscription com status ∈ `trial|ativa|past_due` (query de verificação incluída no PRD Técnico).
- [ ] Org `slug='axon'` existe, `is_internal=true`, subscription ativa no plano `internal`.
- [ ] `get_current_subscription(org_id)` retorna a subscription correta para qualquer org de teste.
- [ ] Partial UNIQUE index bloqueia INSERT de segunda subscription vigente (teste manual: `INSERT … status='ativa'` segunda vez falha) — **G-12 provado**.
- [ ] FK `plan_id` com `ON DELETE RESTRICT` bloqueia DELETE de plano referenciado — base para INV-2 no Sprint 06.
- [ ] Tela `/dashboard/settings/organization` exibe o nome canônico do plano (Free/Basic/Premium) em vez do valor antigo da coluna — golden flow rodado manualmente.
- [ ] `grep -rn "\.plan\b" src/lib/` só retorna consumidores via `getOrgPlan(...)` — nenhum acesso direto a `organizations.plan` fora do helper.
- [ ] Acesso a `/signup`, `/signup/check-email`, `/signup/link-expired` retorna 404.
- [ ] `npm run build` passa.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** (GATE 4).
- [ ] Script de rollback documentado e testado em staging (G-17).
- [ ] RLS habilitada em `plans` e `subscriptions` com FORCE (verificado no GATE 1 do Tech Lead).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **11** (conforme cálculo do plano)
  - DB: 5 (cap — duas tabelas novas + nova coluna em `organizations`)
  - API: 2 (RPC nova + refactor de leituras internas)
  - UI: 1 (mudança cosmética em settings/organization)
  - Business logic: 3 (regra de backfill, INV-1 via partial unique, semântica de `is_internal`, INV-8 embutida no design de `subscriptions.status`)
  - Dependências: 0 externas, internas já mapeadas
- Reference Module: **não** (sprint de infra, não CRUD)
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **sim** — decisões ainda não tomadas sobre valores concretos de limites por plano; política exata de compat da coluna `organizations.plan` (trigger ou só comentário); handling de orgs com `plan` fora do enum no backfill.
- Ambiguity Risk: **alto** — backfill em produção sobre dados reais + invariante INV-1 reforçada por partial unique (raro em Postgres) + janela de compat entre modelo velho e novo.

---

### Opção 1 — SIMPLES (sem PRD)

- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@guardian` → gates → `@git-master`
- **PRD:** pulado
- **Modelo sugerido:** N/A
- **Quando faz sentido:** **não faz sentido neste sprint.** Score 11, múltiplas tabelas novas, backfill sobre produção, lógica de negócio nova (partial unique WHERE em IN-list, ordem de migration das colunas, handling de enum legado). Cada um desses sozinho já dispararia a regra anti-viés.

### Opção 2 — COMPLETA (com PRD)

- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop até 3×) → STOP & WAIT → `@db-admin` → `@backend` → `@guardian` → gates → `@git-master`
- **PRD:** gerado em `prds/prd_plans_subscriptions_internal_org.md`
- **Modelo sugerido:** **Opus** (cold review + sanity-checker pagam em Opus; em Sonnet drifta)
- **Quando faz sentido:** **aqui.** Score ≥ 9 força Opção 2 pela rubrica (item 1 da árvore). Adicionalmente múltiplas tabelas novas (item 4) e lógica de negócio nova/ambígua (item 3). Três gatilhos independentes convergem.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score 11 dispara Opção 2 forçada (item 1 da árvore de decisão). Sprint toca três áreas de alto risco simultaneamente: schema novo com invariante não-trivial (partial unique index em IN-list), backfill em produção sobre dados reais, e janela de compat coordenada com Sprint 05. O `@spec-writer` precisa fixar antes da execução: (a) valores numéricos dos limites de cada plano, (b) decisão trigger-de-compat vs. apenas comentário "deprecated" em `organizations.plan`, (c) handling de orgs com valor de `plan` fora do enum no backfill, (d) query de verificação pós-migration que prova INV-1. O `@sanity-checker` revalida contra o PRD admin area (§6.5, §6.6, INV-1, INV-8) e contra o restante do `sprint_plan.md` para garantir que Sprint 05 vai conseguir remover a coluna depois. O custo de uma reversão deste sprint em produção é alto demais para pular Implementation Plan.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é segura aqui — a rubrica força Opção 2.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza as linhas de `@guardian` e `@git-master`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ✅ Concluído | `prds/prd_admin_01_plans_subscriptions_internal_org.md` |
| Sanity Check | `@sanity-checker` | ▶️ Em andamento | — |
| Banco de dados | `@db-admin` | ⬜ Pendente | `supabase/migrations/[timestamp]_plans_subscriptions_internal_org.sql` |
| Server-side refactor | `@backend` | ⬜ Pendente | `src/lib/plans/getOrgPlan.ts` + edits em `settings/organization/page.tsx` + remoção `/signup` |
| Guardian | `@guardian` | ⬜ Pendente | — |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
