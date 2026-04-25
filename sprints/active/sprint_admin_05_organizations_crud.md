# Sprint admin_05: CRUD organizations — listagem, criação, detalhe, suspender/reativar

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 05 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 05
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-ORG-1..9, RF-AUDIT-1, INV-4, G-02, G-07, G-16, G-18
> **Dependências satisfeitas:** sprint_admin_01 ✅ (plans+subscriptions+org interna) · sprint_admin_02 ✅ (platform_admins + RBAC + `requirePlatformAdminRole`) · sprint_admin_03 ✅ (`audit_write` + `writeAudit` helper) · sprint_admin_04 ✅ (shell `(admin)` + AAL2 + AdminShell)
> **Estado do banco consultado direto via MCP em 2026-04-25** — não usar `docs/schema_snapshot.json` para esta sprint.

---

## 🎯 Objetivo de Negócio

Primeiro CRUD útil da área administrativa. Ao final desta sprint, a equipe Axon onboarda novos clientes, suspende e reativa orgs **sem SQL manual** — fechando o gap operacional principal descrito no §2 do PRD ("ausência dessa área força a equipe a executar tarefas críticas manualmente no banco").

Cobre RF-ORG-1..9 (listagem, busca, filtros, criação, detalhe, suspensão, reativação, proteção da org interna, formato/imutabilidade do slug — apenas a regra de formato/uniqueness; a imutabilidade pós-login é Sprint 13). Cada mutation grava `audit_log` na mesma transação (RF-AUDIT-1, INV-6).

**Métrica de sucesso:**
- Onboarding admin-gated funciona end-to-end: admin cria org → primeiro user recebe convite → loga e completa signup.
- Suspensão de org bloqueia customer users imediatamente em 100% das queries de domínio (defesa em profundidade: middleware + RLS).
- Listagem com 1.000 orgs responde em < 500ms (RNF-PERF-2).
- Tentativa de suspender ou cancelar a org interna AxonAI (`slug='axon'`, `is_internal=true`) é rejeitada com erro tipado — independente do papel do platform admin (G-07, INV-4).

---

## 👤 User Stories

- Como **platform admin owner**, quero ver lista paginada de todas as organizations com filtros por status (ativa/suspensa), plano atual, status da subscription e data de criação, para que eu encontre rapidamente uma org alvo para diagnóstico ou ação.
- Como **platform admin owner**, quero criar uma nova organization informando nome, slug, plano inicial e e-mail do primeiro admin, para que o onboarding aconteça sem SQL manual e o convite saia automaticamente.
- Como **platform admin owner ou billing**, quero abrir o detalhe de uma org e ver subscription vigente, plano, contagem de users, data da última atividade, para que eu tenha contexto antes de qualquer ação.
- Como **platform admin owner**, quero suspender uma org (digitando o slug para confirmar) e ver o efeito imediato — customer users daquela org são bloqueados em login/queries — para que eu possa responder a fraude/abuso/inadimplência sem esperar deploy.
- Como **platform admin support**, quero ler a listagem e o detalhe de qualquer org (incluindo a interna), para que eu apoie o cliente em chamados — mas não devo conseguir suspender, reativar nem criar org (G-06).
- Como **customer user de org suspensa**, quero ver uma tela explicativa "sua conta foi suspensa, contate o suporte" ao tentar logar ou usar o app, em vez de erro 401/403 genérico — para que eu saiba o que fazer.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx` (sidebar + topbar + banner "Axon Admin"). Esta sprint **adiciona páginas** dentro desse shell, sem mexer no layout.
- **Padrão de listagem:** estruturalmente espelhada em `src/app/(app)/dashboard/leads/` — paginação server-side, filtros via query params, busca por nome/slug, toolbar de ações no topo. **Não** copiar tokens nem variantes de cor — usar tokens semânticos do design system (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`).
- **Componentes a reutilizar de `src/components/ui/`:** `Button`, `Input`, `Select`, `Dialog`, `Table` (ou primitive-headless equivalente), `Badge`, `Pagination`. **Antes de criar botão inline, verifique a variante existente** — registrado em APRENDIZADOS 2026-04-21 ([AGENT-DRIFT] @frontend+ repetiu botões inline).
- **Confirmação destrutiva:** dialog que pede o admin digitar o **slug** da org alvo (RNF-UX-2). Componente novo `OrgSuspendDialog`/`OrgReactivateDialog` no padrão de `MarkAsLostDialog`/`DeleteLeadDialog`.
- **Tela "conta suspensa" (customer app):** página simples informativa, mesma paleta do customer app (não admin). Sem login form, sem link para área admin.

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.** Não há módulo CRUD admin existente — esta sprint cria o primeiro. O agente backend usa duas fontes:

1. **Para padrão de listagem com filtros/paginação/server-side:** `src/app/(app)/dashboard/leads/` + `src/lib/actions/leads.ts` + `src/components/leads/LeadsList.tsx` + `LeadFilters.tsx` + `LeadsToolbar.tsx`. Copiar **estrutura e contratos** (Server Action que retorna `ActionResponse<{ items, metadata }>`, paginação via query params, filtros tipados via Zod).
2. **Para padrão de RPC com audit transacional dentro do PL/pgSQL:** referência conceitual em [`docs/conventions/audit.md`](../../docs/conventions/audit.md) § "Mutations com RPC dedicada — caminho padrão". Não há RPC existente como gold standard ainda — esta sprint estabelece o padrão para Sprints 06–13.

**O que copiar:** estrutura de Server Action de listagem (`getLeadsAction` → `getOrganizationsAction`), padrão de filtros Zod, padrão de `ActionResponse<T>`, padrão de error handling.
**O que trocar:** tabela alvo (`leads` → `organizations`), schemas Zod, joins (vai juntar com `subscriptions` + `plans`), filtros específicos do domínio admin.
**O que NÃO copiar:** lógica de tags, status de funnel, kanban, soft-delete via `is_active=false` no leads (em organizations, `is_active` significa "não suspensa", semântica oposta).

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

- [ ] **Drop da coluna legacy `organizations.plan`** (finaliza migração iniciada em sprint_admin_01):
  - Confirmar via grep em `src/` que **nenhum** caminho de código ainda lê `organizations.plan` (todos devem usar `getOrgPlan(orgId)` / `get_current_subscription`).
  - Migration: `ALTER TABLE public.organizations DROP COLUMN plan;`
  - Drop também o CHECK constraint `plan = ANY (ARRAY['free','basic','premium'])` automaticamente removido com a coluna.
  - **Idempotência:** `ALTER TABLE … DROP COLUMN IF EXISTS plan;`
  - **Reverso (rollback):** `ALTER TABLE … ADD COLUMN plan text DEFAULT 'free' CHECK (plan = ANY (ARRAY['free','basic','premium']));` + recompute via SELECT em `subscriptions`. Documentar no header da migration (G-17).

- [ ] **Helper `is_calling_org_active()` `RETURNS boolean` `STABLE` `SECURITY INVOKER`**:
  - Lê `auth.jwt() ->> 'organization_id'` e retorna `true` se a org existe e tem `is_active = true`. `false` em qualquer outro caso (org inexistente, suspensa, claim ausente).
  - `STABLE` — Postgres pode cachear dentro de uma query; aceitável (suspensão eventual entre queries é aceitável; defesa em profundidade tem middleware como camada primária).
  - **Justificativa de SECURITY INVOKER:** roda no contexto do caller; consulta `organizations` que tem RLS — mas a policy `Users can view own organization` permite SELECT da própria org via JWT claim, então a função funciona sem elevação.

- [ ] **Atualização de policies em tabelas customer (cross-cutting)** — adicionar `AND public.is_calling_org_active()` em **toda policy existente** (SELECT/INSERT/UPDATE/DELETE) das tabelas abaixo. RPC/function chamada via `WHERE` ou `WITH CHECK` da policy, não via trigger.

  **Tabelas afetadas (consultadas direto no banco em 2026-04-25 — pg_policies):**

  | Tabela | Policies a estender |
  |---|---|
  | `categories` | 3 |
  | `funnels` | 2 |
  | `funnel_stages` | 2 |
  | `invitations` | 3 |
  | `lead_origins` | 3 |
  | `lead_tags` | 3 |
  | `leads` | 3 |
  | `loss_reasons` | 3 |
  | `product_documents` | 3 |
  | `product_images` | 3 |
  | `products` | 3 |
  | `profiles` | 4 |
  | `tags` | 3 |
  | `whatsapp_groups` | 3 |

  Total: **41 policies em 14 tabelas**. **Não atualizar** policies de `organizations`, `subscriptions`, `plans`, `platform_admins`, `audit_log`, `signup_intents` (essas têm semântica própria e não devem bloquear ao suspender — operadores Axon ainda precisam ler subs/plans para diagnosticar; signup_intents tem deny-all explícito).

  **Padrão idempotente** por policy: `DROP POLICY IF EXISTS "<nome>" ON <tabela>; CREATE POLICY "<nome>" …` reescrevendo o `qual`/`with_check` original com `AND public.is_calling_org_active()` no final. Migration deve listar **todas as 41 policies textualmente** — sem geração dinâmica via DO block (auditável).

  > **Armadilha registrada (APRENDIZADOS 2026-04-22):** antes de "corrigir" qualquer policy flagada, verificar se a única call-site é `createServiceClient()` ou trigger SECURITY DEFINER — se sim, a policy é dead code. Aqui não é o caso; todas as policies dessas 14 tabelas são exercitadas pelo customer app via `authenticated`. Confirmar antes de migrar.

- [ ] **Índices de performance em `organizations`** para listagem com filtros (RF-ORG-1, RNF-PERF-2):
  - `CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON public.organizations (created_at DESC);` — listagem default.
  - `CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm ON public.organizations USING gin (name gin_trgm_ops);` — busca por nome (extensão `pg_trgm` já habilitada? confirmar com `mcp__supabase__list_extensions` antes; se não, `CREATE EXTENSION IF NOT EXISTS pg_trgm;`). Slug já tem unique index — usado para busca exata.
  - `is_active`, `is_internal`, `slug` já têm índices.

- [ ] **RPC `admin_create_organization(p_name text, p_slug text, p_plan_id uuid, p_first_admin_email text, p_trial_days int DEFAULT 14, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS uuid`** `SECURITY DEFINER` `VOLATILE`:
  - **Autorização:** rejeita com `42501` (insufficient_privilege) se caller não é `platform_admin` ativo com role `'owner'` (apenas owner pode criar org — RBAC matrix Sprint 02).
  - **Validação inline (defesa em profundidade — Zod já valida no Server Action):**
    - `p_slug` casa `^[a-z0-9][a-z0-9-]{2,49}$` → senão `RAISE EXCEPTION 'invalid_slug_format'`.
    - `p_name` length entre 2 e 200 → senão `'invalid_name'`.
    - `p_first_admin_email` formato e-mail válido → senão `'invalid_email'`.
    - `p_plan_id` existe em `plans` e `is_archived = false` → senão `'invalid_plan'`.
    - Slug único → unique index já garante; tratar `unique_violation` e re-raise como `'slug_taken'`.
  - **Transação:**
    1. INSERT em `organizations` (`name`, `slug`, `is_active=true`, `is_internal=false`, `settings='{}'`).
    2. INSERT em `subscriptions` (`organization_id`, `plan_id=p_plan_id`, `status='trial'`, `period_start=now()`, `period_end=now() + (p_trial_days || ' days')::interval`, `metadata=jsonb_build_object('trial_days_override', p_trial_days)`). O partial unique `subscriptions_one_vigente_per_org` garante INV-1.
    3. INSERT em `signup_intents` (`email=p_first_admin_email`, `organization_id=<nova>`, `role='owner'`, `source='org_creation'`, `expires_at=now() + interval '7 days'`) — reusa a infra existente para que o admin destinatário consiga concluir signup.
    4. INSERT em `invitations` (`organization_id=<nova>`, `email=p_first_admin_email`, `role='admin'`, `invited_by=<actor>`, `expires_at=now() + interval '7 days'`).
    5. `PERFORM public.audit_write('org.create', 'organization', <nova>, <nova>, NULL, to_jsonb(v_org_after), jsonb_build_object('plan_id', p_plan_id, 'first_admin_email', p_first_admin_email, 'trial_days', p_trial_days), p_ip_address::inet, p_user_agent);`
  - **Retorna:** UUID da nova organization.
  - **`REVOKE EXECUTE FROM anon`** explícito (armadilha APRENDIZADOS 2026-04-24). Execute permitido para `authenticated` apenas — service_role nunca é caller no fluxo normal.
  - **Idempotência:** `CREATE OR REPLACE FUNCTION`.
  - **Nota sobre envio de e-mail:** esta sprint **não envia e-mail real** (provedor de e-mail é Sprint 10). O `signup_intents` + `invitations` são suficientes para o admin destinatário concluir signup pelo fluxo customer existente, mas o link é **gerado e exibido na UI admin** (próximo item) para que o owner Axon copie e envie manualmente — fallback offline previsto no PRD §RF-SET-7.

- [ ] **RPC `admin_suspend_organization(p_org_id uuid, p_reason text, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS void`** `SECURITY DEFINER` `VOLATILE`:
  - **Autorização:** rejeita com `42501` se caller não é platform admin com role `'owner'` (RBAC matrix).
  - **G-07 — Proteção org interna:** `IF (SELECT is_internal FROM organizations WHERE id = p_org_id) = true THEN RAISE EXCEPTION 'internal_org_protected' USING ERRCODE='P0001';` — bloqueia mesmo para owner.
  - **Validação:**
    - `p_reason` não-nulo, length entre 5 e 500 → senão `'invalid_reason'`.
    - org existe e está atualmente ativa (`is_active = true`) → senão `'org_not_active'` (idempotência: suspender já-suspensa é no-op com erro tipado, não silent).
  - **Transação:**
    1. `SELECT … FOR UPDATE` em `organizations` para travar contra race.
    2. UPDATE `organizations SET is_active = false WHERE id = p_org_id`.
    3. `PERFORM public.audit_write('org.suspend', 'organization', p_org_id, p_org_id, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('reason', p_reason), p_ip_address::inet, p_user_agent);`
  - **Efeito imediato:** o `is_calling_org_active()` retorna `false` na próxima query do customer user → todas as 41 policies bloqueiam → app vê listagens vazias → middleware customer (item abaixo) detecta e redireciona para tela "conta suspensa". Não invalidamos sessão (Supabase JWT continua válido até expiração); a tela é a barreira de UX.

- [ ] **RPC `admin_reactivate_organization(p_org_id uuid, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS void`** — simétrica:
  - Autorização: owner only.
  - **Sem proteção `is_internal`** — a org interna nunca é suspensa, então reativá-la é no-op com erro `'org_not_suspended'` (não está suspensa).
  - Validação: org existe e `is_active = false` atualmente → senão `'org_not_suspended'`.
  - Transação: `SELECT … FOR UPDATE` → `UPDATE … SET is_active = true` → `audit_write('org.reactivate', …)`.

- [ ] **Migration idempotente** em `supabase/migrations/<timestamp>_admin_05_organizations_crud.sql`:
  - Header com seção de rollback documentada (G-17).
  - Drop coluna `organizations.plan` (item 1).
  - Função `is_calling_org_active()`.
  - 41 `DROP POLICY IF EXISTS … CREATE POLICY …` listadas textualmente.
  - Índices em `organizations`.
  - 3 RPCs (`admin_create_organization`, `admin_suspend_organization`, `admin_reactivate_organization`).
  - `REVOKE EXECUTE … FROM anon` em todas as 3 RPCs.
  - **Validar `dry-run` antes de aplicar (GATE 1).**

- [ ] **Atualizar `docs/conventions/audit.md`** — appendar à tabela "Tabela de ações registradas":

  | action slug | target_type | sprint | descrição |
  |---|---|---|---|
  | `org.create` | `organization` | admin_05 | Onboarding de nova org cliente via admin |
  | `org.suspend` | `organization` | admin_05 | Suspensão administrativa de org |
  | `org.reactivate` | `organization` | admin_05 | Reativação de org previamente suspensa |

- [ ] **Atualizar `docs/PROJECT_CONTEXT.md`** — registrar conclusão da migração `organizations.plan` (coluna deprecated finalmente removida) e marcar D-1 (admin-gated onboarding) como **operacionalmente entregue** nesta sprint.

#### Server Actions (autor: `@backend`)

- [ ] **`src/lib/actions/admin/organizations.ts`** (novo arquivo — convencionar subpasta `admin/` para todas as actions admin):
  - `getOrganizationsAction({ search, status, planId, isActive, page, perPage, sort })` → `ActionResponse<{ items: OrganizationListItem[]; metadata: PaginationMeta }>`. Faz JOIN com `subscriptions` (vigente) + `plans` (nome) + COUNT users por org (subquery). Params validados via Zod. Disponível para qualquer role admin (R/R/R na RBAC matrix).
  - `getOrganizationDetailAction(id)` → `ActionResponse<OrganizationDetail>` retornando metadados, subscription vigente, count de users, `last_activity_at` (max de `updated_at` em leads/profiles/etc — best-effort; sprint não otimiza isso, query plain). Disponível para qualquer role admin.
  - `createOrganizationAction(input)` → wrapper de RPC `admin_create_organization`. Retorna `{ id, signupLink }` onde `signupLink` é construído a partir do `invitations.token` recém-criado (formato `/dashboard/aceitar-convite?token=<uuid>`). **Apenas role `owner`** (`requirePlatformAdminRole(['owner'])`).
  - `suspendOrganizationAction({ id, reason, slugConfirmation })` → valida que `slugConfirmation === org.slug` (defesa contra clique acidental — RNF-UX-2) **antes** de chamar a RPC. Apenas role `owner`. Wrapper de `admin_suspend_organization`.
  - `reactivateOrganizationAction({ id, slugConfirmation })` → simétrica. Apenas role `owner`.
  - **Contratos invioláveis** (todas as actions): Zod input → `requirePlatformAdminRole([...])` → try/catch → log interno + mensagem amigável → retorno `ActionResponse<T>` → `revalidatePath('/admin/organizations')` em mutations → `revalidatePath('/admin/organizations/[id]')` no detalhe.
  - **Erros tipados retornados pela RPC:** mapear `'internal_org_protected'`, `'invalid_slug_format'`, `'slug_taken'`, `'invalid_plan'`, `'org_not_active'`, `'org_not_suspended'` para mensagens em pt-BR no campo `error`. Documentar mapping em comentário no topo do arquivo.

- [ ] **Schemas Zod** em `src/lib/actions/admin/organizations.schemas.ts`:
  - `slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,49}$/)`.
  - `createOrganizationSchema`, `suspendSchema`, `reactivateSchema`, `listFiltersSchema`.
  - Helper `slugifyName(name)` → utility para a UI sugerir slug (lowercase, sem acentos, espaços → hífen, trunca em 50). Determinístico — usar em duas camadas (server-side validação opcional, client-side preview).

- [ ] **Customer middleware update** (`src/middleware.ts`) — adicionar **branch para rotas customer** que checa se a org da sessão está suspensa e redireciona para `/conta-suspensa`:
  - Após `getUser()` bem-sucedido, ler claim `organization_id` do JWT, fazer SELECT light em `organizations(id, is_active, is_internal)` (cache de request via React `cache()` ou simples — middleware roda em edge; usar `createClient` server normal).
  - Se `is_active = false` e rota não é `/conta-suspensa` nem `/login` nem `/logout` → redirect 302 para `/conta-suspensa`.
  - **Não tocar** branch `/admin/**` — esse já tem seu próprio enforcement (Sprint 04).
  - Atenção: middleware de Next.js tem custo por request — manter a query simples, sem joins.

#### Integration tests (autor: `@qa-integration`)

- [ ] **`tests/integration/admin-organizations.test.ts`** — cobertura mínima por Server Action exportada (GATE 4.5, contrato em `docs/conventions/standards.md` § "Contrato de testes"):

  - `getOrganizationsAction`:
    - Happy path com filtros aplicados → `success: true`, items > 0, metadata correto.
    - Falha de auth (`getSessionContext` retorna null) → `success: false`, sem chamar Supabase.
    - Filtros inválidos (Zod) → `success: false`, sem chamar Supabase.
    - Caller sem platform_admin ativo → `success: false` com erro padrão.
  - `getOrganizationDetailAction`: happy + auth fail + Zod fail + org inexistente.
  - `createOrganizationAction`:
    - Happy path com role owner → `success: true` com `id` e `signupLink`.
    - Role support tentando criar → `success: false` (autorização).
    - Slug formato inválido → `success: false`.
    - Slug duplicado → `success: false` com erro `'slug_taken'`.
    - Plan id não existe → `success: false`.
  - `suspendOrganizationAction`:
    - Happy path owner → `success: true`.
    - **G-07: tentativa contra org interna (`is_internal=true`)** → `success: false`, erro `'internal_org_protected'`. Teste obrigatório, não negociável.
    - `slugConfirmation` divergente → `success: false` antes de tocar Supabase.
    - Role billing/support → `success: false`.
    - Org já suspensa → `success: false` com `'org_not_active'`.
    - **Sem reason** ou reason curta demais → `success: false`.
  - `reactivateOrganizationAction`: simétrica + happy path → confirma `is_active=true` após.

  Mock central via `tests/setup.ts` `__mockSupabase` (sem mock inline). Sem `it.skip`/`describe.skip`.

### Frontend (autor: `@frontend+`)

- [ ] **`src/app/admin/organizations/page.tsx`** — listagem:
  - Server Component que chama `getOrganizationsAction` com query params (search/status/planId/isActive/page).
  - Toolbar superior: input de busca (debounced via `useTransition` no Client Component filho), select de plano, select de status subscription, toggle "ativas/suspensas/todas", botão "Nova organization" (visível apenas para role `owner` — usar `requirePlatformAdmin()` server-side e propagar via prop).
  - Tabela: nome (link para detalhe), slug, plano vigente, status subscription (badge colorido por status), is_active (badge verde/cinza), criada em, número de users.
  - Linha da org interna (`is_internal=true`) tem badge "Interna" e ícone de escudo Lucide (`Shield`); ações destrutivas escondidas mesmo via UI.
  - Paginação no rodapé (`Pagination` componente reusado).
  - Empty state, loading skeleton, error state.

- [ ] **`src/app/admin/organizations/new/page.tsx`** — criação:
  - Form: nome, slug (preview auto-sugerido via `slugifyName`, editável), plano (select populado por `plans` onde `is_archived=false`), e-mail do primeiro admin, dias de trial (default 14, range 1-90).
  - Validação client-side via `react-hook-form` + `zodResolver`.
  - Apenas role `owner` acessa — guard server-side com `requirePlatformAdminRole(['owner'])`; role inferior cai em `notFound()`.
  - Após sucesso: navega para `/admin/organizations/[id]` e exibe Toast com o `signupLink` copiável (RF-SET-7 — fallback offline).

- [ ] **`src/app/admin/organizations/[id]/page.tsx`** — detalhe:
  - Cards: metadados, subscription vigente (status, plano, period_start/end, dias restantes de trial), users count, last activity (best-effort), audit recente (últimas 10 linhas de `audit_log` filtradas por `target_organization_id = id` — leitura via policy `platform_admins_can_read_audit_log` já existente no Sprint 03).
  - Banner amarelo se `is_active=false`: "Organization suspensa em <data>. Razão: <reason do último audit>". Botão "Reativar" (apenas owner).
  - Banner cinza se `is_internal=true`: "Organization interna da Axon — protegida contra ações destrutivas".
  - Ações: "Suspender" (apenas owner, esconde se `is_active=false` ou `is_internal=true`), "Reativar" (apenas owner, mostra apenas se `is_active=false`). Ambas abrem dialog de confirmação.
  - **Não inclui** ações de subscription (trocar plano, estender trial, cancelar) — Sprint 06.
  - **Não inclui** Deep Inspect — Sprint 08.
  - **Não inclui** grants — Sprint 07.

- [ ] **Componentes em `src/components/admin/organizations/`:**
  - `OrganizationsList.tsx` (Client Component recebendo SSR data — handle de search/filter via `router.replace` com query params).
  - `OrganizationsToolbar.tsx` (busca + filtros).
  - `OrganizationsRowActions.tsx` (kebab menu — esconde ações por role e por `is_internal`).
  - `OrganizationCreateForm.tsx`.
  - `OrganizationSuspendDialog.tsx` (input de slug confirmação + textarea de razão).
  - `OrganizationReactivateDialog.tsx` (input de slug confirmação).
  - `OrganizationStatusBadge.tsx` (mapeia `subscriptions.status` para variantes — `trial`, `ativa`, `past_due`, `trial_expired`, `cancelada`, `suspensa` → cores semânticas).
  - **Reuso obrigatório:** `<Button>` (com variantes `danger`/`secondary` existentes — sem botão inline com classes — APRENDIZADOS 2026-04-21).

- [ ] **Customer-facing "conta suspensa"** (`src/app/(app)/conta-suspensa/page.tsx`):
  - Página simples: ícone, "Sua conta foi suspensa", "Para mais informações, entre em contato com o suporte da Axon", e-mail/telefone de contato (placeholder por ora — Sprint 10 traz contato real do platform_settings).
  - Layout próprio sem AppShell — usuário não tem acesso ao app, então sidebar não aparece.
  - **Não** revela razão da suspensão (sensível — admin sabe via audit, customer não precisa).
  - Botão "Sair" que faz logout via Supabase auth.

- [ ] **Sidebar admin update** — adicionar item "Organizations" em `src/components/admin/AdminSidebar.tsx` com ícone Lucide `Building2` apontando para `/admin/organizations`. Visível para todos os roles admin (a página em si filtra ações).

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Listagem com 0 orgs** (banco recém-criado, ou filtro vazio): empty state explicativo, não 404.
- [ ] **Listagem com 1.000+ orgs**: paginação funciona; query < 500ms (seed de teste para validar — RNF-PERF-2). Índice `created_at DESC` deve ser usado (validar `EXPLAIN` no GATE 1).
- [ ] **Busca com caracteres especiais** (`%`, `_`, `'`, emoji): query via Supabase JS é parametrizada — sem SQL injection. Confirmar via teste.
- [ ] **Slug com underscores/maiúsculas/acentos** no form de criação: `slugifyName` normaliza; validação Zod regex rejeita os que escaparem.
- [ ] **Slug duplicado**: unique constraint do banco gera erro `'slug_taken'` — UI mostra mensagem inline no campo.
- [ ] **Plan archived no select de criação**: filtro client + server `is_archived=false`. Race: plano arquivado entre carregar form e submit → RPC retorna `'invalid_plan'` → mensagem "esse plano não está mais disponível".
- [ ] **Tentar suspender org interna** (`slug='axon'`, `is_internal=true`): tanto via UI (botão escondido) quanto via Server Action direta (caller burlando UI) quanto via RPC direta no banco — **G-07** rejeita em camada da RPC. Teste obrigatório.
- [ ] **Tentar suspender org já suspensa**: `'org_not_active'` — UI mostra "Organization já está suspensa".
- [ ] **Tentar reativar org não-suspensa**: `'org_not_suspended'`.
- [ ] **`slugConfirmation` divergente** no dialog de suspensão: bloqueia no Server Action antes de chegar na RPC (defesa em UX + camada de servidor).
- [ ] **Razão vazia** ou só espaços no dialog de suspensão: Zod valida `min(5).max(500).trim()`.
- [ ] **Customer user de org suspensa tenta logar**: login Supabase succeeds (auth.users intacto), middleware redireciona para `/conta-suspensa`. Tentativa de acessar `/dashboard/leads` direto via URL: middleware redireciona; se middleware falhar por algum motivo, RLS retorna empty results.
- [ ] **Customer user de org suspensa tenta criar lead via API direta**: RLS bloqueia o INSERT (policies têm `is_calling_org_active()`); resposta vazia/erro tipado.
- [ ] **Customer user da org interna AxonAI** (Edson dogfood): `is_internal=true` mas `is_active=true`; nada bloqueia; comportamento normal.
- [ ] **Suspender e reativar em rápida sucessão (race)**: `SELECT … FOR UPDATE` na RPC garante serialização. Audit registra ambos.
- [ ] **Caller deslogado** chamando Server Action direta: `requirePlatformAdmin()` redireciona via `notFound()`; nada toca o banco.
- [ ] **Role support tentando criar org**: Server Action retorna `success: false`, erro "permissão insuficiente". Não chega na RPC.
- [ ] **Audit log falhando** (improvável — `audit_write` é confiável): RPC inteira rola back via `RAISE`; org não é criada/suspensa. Confirma G-03 indiretamente via teste de injeção.

---

## 🚫 Fora de escopo

- **Trocar plano de uma org / cancelar / estender trial / marcar past_due** — Sprint 06.
- **Hard-enforcement de limites e grants** — Sprint 07.
- **Deep Inspect (read-only de leads/users/products)** — Sprint 08.
- **Dashboard com KPIs reais e platform_settings** — Sprint 09.
- **CRUD de platform_admins (convidar, alterar papel, desativar)** — Sprint 11.
- **Audit log UI standalone com filtros completos** — Sprint 12. (Esta sprint mostra só as últimas 10 linhas no detalhe da org.)
- **Edição de slug e nome de uma org existente** — fora do MVP. RF-ORG-9 (slug imutável pós-login) é Sprint 13. Editar nome também não é prioridade desta sprint.
- **Soft delete / hard delete de organization** — não previsto no plano. Suspender é a única ação de "tirar do ar".
- **Convite por e-mail real** — Sprint 10. Esta sprint **gera link offline copiável** apenas (`signup_link` no Toast pós-criação).
- **Reset de senha do primeiro admin** — fluxo customer existente já cobre.
- **Telas de "trial expirou" / "cancelada"** específicas — Sprint 13 (transições automáticas).
- **Métrica `last_activity_at` precisa via materialized view** — Sprint 09. Aqui é best-effort (max de `updated_at` em leads, sem cache).

---

## ⚠️ Critérios de Aceite

- [ ] Coluna `organizations.plan` removida; build do customer app continua passando (nenhum caller residual).
- [ ] Função `is_calling_org_active()` criada; `STABLE`; retorna `true` para org interna (Edson dogfood) e `false` para qualquer org com `is_active=false`.
- [ ] 41 policies em 14 tabelas customer atualizadas com `AND public.is_calling_org_active()`. Validar via:
  ```sql
  SELECT tablename, COUNT(*) FILTER (WHERE qual LIKE '%is_calling_org_active%' OR with_check LIKE '%is_calling_org_active%') AS guarded,
                   COUNT(*) AS total
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('leads','products','product_images','product_documents','categories','tags','lead_tags','lead_origins','loss_reasons','funnels','funnel_stages','whatsapp_groups','invitations','profiles')
  GROUP BY tablename;
  ```
  → toda linha tem `guarded = total`.
- [ ] 3 RPCs (`admin_create_organization`, `admin_suspend_organization`, `admin_reactivate_organization`) criadas com `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon` confirmado por `has_function_privilege('anon', '<rpc>(<sig>)', 'execute') = false`.
- [ ] **G-07**: `SELECT public.admin_suspend_organization('c6d506ca-08f0-4714-b330-6eb1a11f679b','teste')` (UUID da org interna) falha com `internal_org_protected` mesmo com role owner.
- [ ] **INV-1 reforçada**: tentativa de criar segunda subscription `'trial'`/`'ativa'`/`'past_due'` para a mesma org falha pelo unique partial — comportamento existente do Sprint 01 não regrediu.
- [ ] Listagem `/admin/organizations` com 1.000 orgs de teste responde em <500ms (RNF-PERF-2). Validar via `EXPLAIN ANALYZE` antes/depois dos índices novos. Se não houver dataset disponível em staging, anotar limitação na seção de execução do sprint file.
- [ ] Suspender uma org de teste: customer user dessa org não consegue mais ler leads (RLS bloqueia via `is_calling_org_active()` = false); customer middleware redireciona para `/conta-suspensa`.
- [ ] Reativar a mesma org: customer recupera acesso integral.
- [ ] Toda mutation (`org.create`, `org.suspend`, `org.reactivate`) deixa linha em `audit_log` com `target_organization_id` correto, `actor_profile_id` igual ao admin owner que executou, `metadata` contendo `reason`/`plan_id`/`first_admin_email` quando aplicável.
- [ ] **G-16 (golden flow integrado)**: criar org → primeiro admin recebe link copiável → admin completa signup → admin loga e vê dashboard customer com sua org. Suspender essa org → admin redirecionado a `/conta-suspensa`. Reativar → admin volta ao dashboard. Documentado como sequência manual no PR description.
- [ ] Documentação `docs/conventions/audit.md` appendou as 3 ações novas (`org.create`, `org.suspend`, `org.reactivate`).
- [ ] `docs/PROJECT_CONTEXT.md` atualizado: D-1 entregue, coluna `organizations.plan` removida, Sprint 05 marcada como concluída.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `npm run build:check` (script de isolamento de imports do Sprint 04) continua passando — nenhum arquivo `(app)/` importou `@/lib/auth/platformAdmin`.
- [ ] **GATE 4.5**: `tests/integration/admin-organizations.test.ts` passa com 0 falhas, 0 skips. Cobertura nas 5 Server Actions exportadas.
- [ ] **Guardian aprova o código** (GATE 4).
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **15**
  - DB: **+3** (modificação de campo +1 — drop `organizations.plan`; múltiplas tabelas tocadas via cross-cutting RLS update em 14 tabelas customer +2)
  - API/Actions: **+4** (3 RPCs novas +2 + múltiplos endpoints/Server Actions de listagem-criação-detalhe-suspensão-reativação +2)
  - UI: **+2** (4 páginas novas + ~7 componentes novos — conta como "novos componentes")
  - Lógica: **+5** (nova regra de proteção da org interna +3, validação de slug + slug confirmation + razão obrigatória + camadas de defesa em RPC e Server Action +2)
  - Dependências: **+1** (interna: `audit_write` Sprint 03, `requirePlatformAdminRole` Sprint 02, `get_current_subscription` Sprint 01, `plans` seed)
- Reference Module: **parcial** — `src/app/(app)/dashboard/leads/` para padrão de listagem; admin shell já pronto. Não é cópia mecânica.
- Integração com API externa: **não** (envio de e-mail real é Sprint 10 — aqui apenas link offline)
- Lógica de negócio nova/ambígua: **sim, alta** — primeira RPC com audit transacional do projeto admin (Sprint 03 só criou a infra), cross-cutting RLS update tem armadilhas conhecidas (APRENDIZADOS 2026-04-22 sobre dead-code de policies), proteção da org interna é invariante crítica (G-07 / INV-4)
- Ambiguity Risk: **alto** — múltiplos pontos de design não-óbvios: (a) qual fonte de `last_activity_at` no detalhe (decidido aqui: best-effort, max de `updated_at`), (b) se o middleware customer faz query extra ou usa cache (decidido aqui: query simples por request), (c) lista exata das 14 tabelas a atualizar (decidida aqui via consulta direta a `pg_policies` — não via snapshot), (d) onde colocar a tela "conta suspensa" sem quebrar o layout customer existente (decidido aqui: rota fora de `/dashboard`)

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → `@git-master`
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score 15 força Opção 2 pela rubrica (≥9 = Opção 2 forçada).
- **Quando faz sentido:** **não faz sentido aqui.** Esta sprint estabelece o **padrão** de RPC-com-audit que os Sprints 06, 07, 11, 12 vão repetir. Erros de design aqui multiplicam dívida por 4 sprints. O cross-cutting RLS update (41 policies) é especialmente sensível: errar uma policy quebra o customer app silenciosamente para uma org.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → `@git-master`
- **PRD:** gerado em `prds/prd_admin_05_organizations_crud.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 41 policies para revisar.
- **Quando faz sentido:** **aqui.** Score 15 dispara Opção 2 forçada (item 1 da árvore). O `@spec-writer` precisa fixar antes da execução: (1) lista textual das 41 policies a reescrever (não geração dinâmica), confirmando que cada uma tem call-site real no customer app — defesa contra dead-code APRENDIZADOS 2026-04-22; (2) contrato de erro tipado das 3 RPCs e como o frontend traduz cada code para mensagem pt-BR; (3) shape exato do `OrganizationListItem` (joins necessários, COUNT de users, custo de query) e validação do plano de execução com `EXPLAIN`; (4) decisão sobre middleware customer — query nova por request vs cache de sessão (custo vs frescor de detecção de suspensão); (5) onde a página `/conta-suspensa` mora (rota fora de `(app)` pra não usar AppShell, mas dentro do customer host); (6) método de teste do G-07 sem precisar de owner real conectado ao banco real. O `@sanity-checker` revalida contra RF-ORG-1..9, RF-AUDIT-1, INV-4, G-02, G-07, G-16, G-18 do PRD admin.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score 15 dispara Opção 2 forçada (item 1 da árvore). Lógica de negócio nova/ambígua dispara segunda regra (item 3). Esta é a primeira sprint admin com mutation real e estabelece o padrão para Sprints 06, 07, 11 e 12 — um contrato mal especificado agora multiplica dívida por 4 sprints. O `@spec-writer` precisa resolver o cross-cutting de RLS (41 policies, lista textual, sem geração dinâmica) e o contrato de erros tipados das 3 RPCs antes do `@db-admin` começar — revisar 41 policies inline durante execução é ineficiente em qualquer modelo, e em Sonnet vira drift garantido. O `@sanity-checker` valida contra RF-ORG-1..9, INV-4 e G-07, gates que esta sprint precisa provar.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza as linhas de `@guardian` e `@git-master`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ⬜ Pendente | — |
| Sanity Check | `@sanity-checker` | ⬜ Pendente | — |
| Banco de dados | `@db-admin` | ⬜ Pendente | — |
| Server Actions | `@backend` | ⬜ Pendente | — |
| Integration tests | `@qa-integration` | ⬜ Pendente | — |
| Frontend | `@frontend+` | ⬜ Pendente | — |
| Guardian | `@guardian` | ⬜ Pendente | — |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
