# Sprint admin_07: Hard-enforcement de limites + `plan_grants`

> **Nível:** STANDARD
> **Ciclo:** Admin Area · Sprint 07 de 13
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../../docs/admin_area/sprint_plan.md) § Sprint 07
> **PRD fonte:** [`docs/admin_area/admin_area_prd.md`](../../docs/admin_area/admin_area_prd.md) § RF-LIMIT-1, RF-PLAN-6, T-21, G-19, G-02, INV-1
> **Dependências satisfeitas:** sprint_admin_01 ✅ (`plans.max_*`, `subscriptions`, `get_current_subscription`) · sprint_admin_02 ✅ (`requirePlatformAdminRole`) · sprint_admin_03 ✅ (`audit_write` + `writeAudit` helper) · sprint_admin_04 ✅ (shell `(admin)` + AdminShell) · sprint_admin_05 ✅ (CRUD organizations + padrão de RPC com audit transacional) · sprint_admin_06 ✅ (CRUD plans + lifecycle de subscription)
> **Estado do banco consultado direto via MCP** — não usar `docs/schema_snapshot.json` para esta sprint.

---

## 🎯 Objetivo de Negócio

Toda criação de recurso contável (user, lead, produto, pipeline, integração, storage) no customer app passa a ser **rejeitada na mesma transação** se faz a org exceder o limite do plano vigente — fechando o gap descrito em RF-LIMIT-1 e T-21 do PRD ("hoje só `check_user_limit` existe; demais limites são frouxos").

Adicionalmente, esta sprint introduz o conceito de `plan_grants` — overrides de limite por organização, criados pelo admin Axon com razão e expiração opcional, para casos de exceção comercial (cliente piloto, upsell em negociação, courtesy bump). O frontend customer recebe erro tipado quando a operação é recusada e exibe mensagem padronizada "seu plano permite até N {recurso}; faça upgrade ou contate o suporte".

**Métrica de sucesso:**
- Tentativa de criar lead acima do limite via Server Action customer falha **antes** do INSERT chegar ao banco; nada persiste; UI exibe mensagem em pt-BR com nome do recurso e o limite vigente.
- Grant com `expires_at` no passado é tratado como ausente — `enforce_limit` só soma grants ativos (`expires_at IS NULL OR expires_at > now()`) e não-revogados (`revoked_at IS NULL`).
- Admin owner cria/revoga grants pela UI; cada ação grava `audit_log` com diff dos limites efetivos antes/depois.
- Cobertura: **6 limit_keys** mapeados (`users`, `leads`, `products`, `pipelines`, `active_integrations`, `storage_mb`) × **7 Server Actions de criação** (`leads.ts`, `products.ts`, `funnels.ts`, `invitations.ts`, `whatsapp-groups.ts`, `product-images.ts`, `product-documents.ts`) — todos exercitados por testes de integração.

---

## 👤 User Stories

- Como **platform admin owner**, quero abrir o detalhe de uma organization e ver a lista de grants ativos/expirados/revogados (limite-chave, valor de override, razão, expiração, quem criou), para que eu tenha visibilidade do que foi liberado fora do plano.
- Como **platform admin owner**, quero criar um grant para uma org informando limit_key, valor de override (ou "ilimitado"), razão obrigatória e expiração opcional, para que eu libere capacidade extra sem precisar trocar o plano.
- Como **platform admin owner**, quero revogar um grant existente, para que o override volte ao limite do plano imediatamente.
- Como **platform admin billing**, quero ler grants (lista e detalhe) para diagnóstico, mas **não** devo conseguir criar nem revogar (RBAC matrix: `billing` é R no escopo grants — owner-only para mutation).
- Como **customer user (qualquer role)**, quero receber mensagem clara em pt-BR ao tentar criar um lead/produto/pipeline acima do limite — algo como "Seu plano permite até 1.000 leads. Para criar mais, faça upgrade ou entre em contato com o suporte." — em vez de erro genérico.
- Como **customer owner**, quero que o sistema nunca consuma além do limite (nem por race condition entre tabs/usuários da mesma org), para que minha conta não estoure inadvertidamente.

---

## 🎨 Referências Visuais

- **Layout admin:** já existe — `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`. Esta sprint adiciona uma rota dentro do shell, sem mexer no layout.
- **Integração com detalhe da org:** rota `/admin/organizations/[id]/grants` segue o padrão de sub-rotas de `/admin/organizations/[id]` já estabelecido pelo Sprint 06 (`/admin/organizations/[id]/subscription`). Linkada como tab/seção lateral no detalhe da org (Sprint 05).
- **Componentes a reutilizar de `src/components/ui/`:** `Button`, `Input`, `Select`, `Dialog`, `Table`, `Badge`, `Pagination`. Variantes existentes — antes de criar botão inline, verificar a variante (APRENDIZADOS 2026-04-21).
- **Confirmação destrutiva (revogar grant):** dialog que pede confirmação digitando o `limit_key` do grant alvo (RNF-UX-2). Padrão `OrganizationSuspendDialog` do Sprint 05.
- **Mensagens de erro do customer app:** quando `enforce_limit` lança `plan_limit_exceeded`, o frontend customer renderiza Toast / inline error usando o mesmo componente de mensagem dos demais erros (`<Alert variant="error">` / sonner toast). Sem rota nova — apenas tradução do erro tipado.

---

## 🧬 Reference Module Compliance

**Parcialmente aplicável.**

1. **Para padrão de RPC com audit transacional dentro do PL/pgSQL e Server Actions admin:** Sprint 05 (`admin_create_organization`, `admin_suspend_organization`) e Sprint 06 (`admin_change_plan`, `admin_extend_trial`) são o **gold standard** — copiar literalmente a estrutura de header de RPC, validações inline, autorização por `requirePlatformAdminRole`, `audit_write(...)` na mesma transação, `REVOKE EXECUTE FROM anon`, e mapeamento de erro tipado no Server Action wrapper.

2. **Para padrão de UI admin (lista + dialog + integração com detalhe da org):** `src/app/admin/organizations/[id]/subscription/page.tsx` (Sprint 06) é a referência — mesma estrutura de página em sub-rota da org, mesmo padrão de cards e badges.

3. **Para o cross-cutting nas Server Actions customer:** **não há reference module direto** — esta sprint estabelece o padrão de chamada `enforce_limit(...)` em mutation. O `@spec-writer` (Opção 2) define o snippet canônico que será replicado nas 7 Server Actions.

**O que copiar:** estrutura de RPC com audit, formato de ActionResponse mapeando erros tipados, padrão de UI lista+create-form+revoke-dialog do detalhe de org.
**O que trocar:** tabela alvo (`plan_grants`), schemas Zod, payloads de audit (action slugs `grant.create` / `grant.revoke`), enum de `limit_key`.
**O que NÃO copiar:** lógica de subscription/lifecycle do Sprint 06 — grants não têm "ciclo de vida"; são append-only com revogação opcional.

---

## 📋 Funcionalidades (Escopo)

### Backend

#### Banco de dados (autor: `@db-admin`)

- [ ] **Tabela `plan_grants`:**
  - Colunas:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
    - `limit_key text NOT NULL CHECK (limit_key IN ('users','leads','products','pipelines','active_integrations','storage_mb'))`
    - `value_override int NULL` — `NULL` significa **ilimitado**; `>= 0` em qualquer outro caso (CHECK `value_override IS NULL OR value_override >= 0`)
    - `reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500)`
    - `expires_at timestamptz NULL` — `NULL` = sem expiração
    - `created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT` — admin que criou
    - `revoked_at timestamptz NULL` — quando preenchido, grant é considerado inativo
    - `revoked_by uuid NULL REFERENCES public.profiles(id)`
    - `created_at timestamptz NOT NULL DEFAULT now()`
  - **FORCE RLS.** Policies:
    - SELECT: platform_admin ativo (qualquer role) — uso de helper `is_platform_admin(profile_id)` do Sprint 02.
    - INSERT/UPDATE: nenhuma policy direta — só via RPCs `SECURITY DEFINER`.
  - **Índices:** `(organization_id, limit_key)` parcial `WHERE revoked_at IS NULL` para o caminho quente do `enforce_limit`; `(organization_id, created_at DESC)` para listagem na UI admin.
  - **Idempotência da migration:** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY …`.

- [ ] **RPC `public.enforce_limit(p_org_id uuid, p_limit_key text, p_delta int DEFAULT 1) RETURNS void`** `SECURITY DEFINER` `VOLATILE`:
  - **Sem autorização do caller** (chamada de Server Actions customer authenticated — checagem de RLS já garante que o caller pertence à `p_org_id` antes de qualquer mutation; o RPC é defesa contra estouro, não contra IDOR).
  - **Lógica:**
    1. `SELECT ... FROM plans p JOIN subscriptions s ON s.plan_id = p.id WHERE s.organization_id = p_org_id AND s.status IN ('trial','ativa','past_due') LIMIT 1` — pega `max_<limit_key>` do plano vigente. Se zero linhas, `RAISE EXCEPTION 'no_active_subscription' USING ERRCODE='P0001'`.
    2. Mapeia `p_limit_key` → coluna do `plans` (`'users'` → `max_users`, `'leads'` → `max_leads`, `'products'` → `max_products`, `'pipelines'` → `max_pipelines`, `'active_integrations'` → `max_active_integrations`, `'storage_mb'` → `max_storage_mb`). Switch via `CASE`.
    3. Soma com grants ativos: `SELECT value_override FROM plan_grants WHERE organization_id = p_org_id AND limit_key = p_limit_key AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`. **Regra:** se houver grant ativo, ele **substitui** o limite do plano (não soma). `value_override IS NULL` no grant → ilimitado (skip checagem).
    4. Calcula `consumido_atual` via COUNT/SUM apropriado (ver tabela abaixo). Para `storage_mb`, soma bytes de `product_images` + `product_documents` filtrados por `organization_id` e converte para MB.
    5. Se `consumido_atual + p_delta > limite_efetivo` (e limite não é "ilimitado"): `RAISE EXCEPTION 'plan_limit_exceeded' USING ERRCODE='P0001', DETAIL=jsonb_build_object('limit_key', p_limit_key, 'limit', limite_efetivo, 'current', consumido_atual, 'delta', p_delta)::text`.
    6. Sucesso: `RETURN` sem mutation. Não escreve audit (`enforce_limit` é leitura+raise, não admin action).
  - **Mapping limit_key → query de consumo:**

    | limit_key | query |
    |---|---|
    | `users` | `SELECT count(*) FROM profiles WHERE organization_id = p_org_id` |
    | `leads` | `SELECT count(*) FROM leads WHERE organization_id = p_org_id` |
    | `products` | `SELECT count(*) FROM products WHERE organization_id = p_org_id` |
    | `pipelines` | `SELECT count(*) FROM funnels WHERE organization_id = p_org_id` |
    | `active_integrations` | `SELECT count(*) FROM whatsapp_groups WHERE organization_id = p_org_id AND is_active = true` (campo existente) |
    | `storage_mb` | `product_images` e `product_documents` **não têm `organization_id` direto** — JOIN via `products`. Soma: `COALESCE((SELECT SUM(pi.file_size) FROM product_images pi JOIN products p ON pi.product_id = p.id WHERE p.organization_id = p_org_id), 0) + COALESCE((SELECT SUM(pd.file_size) FROM product_documents pd JOIN products p ON pd.product_id = p.id WHERE p.organization_id = p_org_id), 0)` em **bytes**, convertido para MB via `ceil(total_bytes::numeric / 1048576)` (arredondar para cima — protege contra "ainda cabe 0.4MB"). Nome real da coluna: `file_size` (não `size_bytes`). |

  - **Race condition (T-13):** o Server Action customer chama `enforce_limit` **e** o INSERT subsequente dentro da mesma transação. Postgres não serializa COUNT por default — duas inserções concorrentes em tabs diferentes podem **ambas** passar pelo `enforce_limit` na borda do limite. Mitigação: `LOCK TABLE <alvo> IN SHARE ROW EXCLUSIVE MODE` é caro demais para hot path. **Decisão:** aceitar overshoot de 1 por race (PRD T-21 não exige hard-cap atômico, exige "rejeição sob carga normal"). Documentar no header da RPC.
  - **`REVOKE EXECUTE FROM anon`** explícito; `GRANT EXECUTE TO authenticated, service_role`.

- [ ] **RPC `public.admin_grant_limit(p_org_id uuid, p_limit_key text, p_value_override int, p_reason text, p_expires_at timestamptz DEFAULT NULL, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS uuid`** `SECURITY DEFINER` `VOLATILE`:
  - **Autorização:** rejeita com `42501` se caller não é platform admin role `'owner'`. Padrão idêntico ao `admin_suspend_organization` do Sprint 05.
  - **Validação inline:**
    - `p_org_id` existe → senão `'org_not_found'`.
    - `p_limit_key` válido (mesmo CHECK da tabela) → senão `'invalid_limit_key'`.
    - `p_value_override` é NULL **ou** `>= 0` → senão `'invalid_value_override'`.
    - `p_reason` length 5..500 → senão `'invalid_reason'`.
    - `p_expires_at` é NULL **ou** `> now()` → senão `'invalid_expires_at'` (não cria grant já expirado).
  - **Transação:** INSERT em `plan_grants` → `audit_write('grant.create', 'plan_grant', <id_grant>, p_org_id, NULL, to_jsonb(v_grant_after), jsonb_build_object('limit_key', p_limit_key, 'value_override', p_value_override, 'reason', p_reason, 'expires_at', p_expires_at), p_ip_address::inet, p_user_agent)`.
  - **Retorna:** UUID do grant criado.
  - **Idempotência:** sprint **não** unifica grants por (org, limit_key) — múltiplos grants sobrepostos podem coexistir; `enforce_limit` usa o mais recente não-revogado/não-expirado. Justificativa: histórico auditável por razão. UI revoga o anterior antes de criar novo se o admin escolher (não é regra do banco).
  - `REVOKE EXECUTE FROM anon`.

- [ ] **RPC `public.admin_revoke_grant(p_grant_id uuid, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL) RETURNS void`** `SECURITY DEFINER` `VOLATILE`:
  - **Autorização:** owner only.
  - **Validação:** grant existe e `revoked_at IS NULL` → senão `'grant_already_revoked'` ou `'grant_not_found'`.
  - **Transação:** `SELECT ... FOR UPDATE` → UPDATE `revoked_at = now(), revoked_by = <actor>` → `audit_write('grant.revoke', 'plan_grant', p_grant_id, <organization_id>, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('limit_key', v_grant.limit_key), p_ip_address::inet, p_user_agent)`.
  - `REVOKE EXECUTE FROM anon`.

- [ ] **Migration idempotente** em `supabase/migrations/<timestamp>_admin_07_limits_enforcement_grants.sql`:
  - Header com seção de rollback documentada (G-17).
  - `CREATE TABLE plan_grants` + índices + policies.
  - 3 RPCs (`enforce_limit`, `admin_grant_limit`, `admin_revoke_grant`).
  - `REVOKE EXECUTE … FROM anon` em todas; `GRANT EXECUTE TO authenticated` em `enforce_limit`.
  - Validar `dry-run` antes de aplicar (GATE 1).

- [ ] **Atualizar `docs/conventions/audit.md`** — appendar à tabela "Tabela de ações registradas":

  | action slug | target_type | sprint | descrição |
  |---|---|---|---|
  | `grant.create` | `plan_grant` | admin_07 | Criação de override de limite por org |
  | `grant.revoke` | `plan_grant` | admin_07 | Revogação de grant ativo |

- [ ] **Atualizar `docs/PROJECT_CONTEXT.md`** — registrar conclusão de RF-LIMIT-1 / T-21 e listar a convenção: "toda Server Action de criação de recurso contável **deve** chamar `enforce_limit(...)` na mesma transação do INSERT — code-review checklist (Guardian gate)".

#### Server Actions admin (autor: `@backend`)

- [ ] **`src/lib/actions/admin/grants.ts`** (novo arquivo — segue convenção `admin/` estabelecida no Sprint 05):
  - `getGrantsAction({ organizationId, includeRevoked, includeExpired })` → `ActionResponse<{ items: GrantListItem[] }>`. JOIN com `profiles` (created_by/revoked_by) + `plans` (limite atual do plano vigente para mostrar ao lado do override). Disponível para qualquer role admin (R/R/R).
  - `createGrantAction(input)` → wrapper de RPC `admin_grant_limit`. **Apenas role `owner`** (`requirePlatformAdminRole(['owner'])`). Input validado por Zod (ver schemas).
  - `revokeGrantAction({ grantId, limitKeyConfirmation })` → valida que `limitKeyConfirmation === grant.limit_key` antes de chamar a RPC (defesa contra clique acidental — RNF-UX-2). Apenas `owner`.
  - **Erros tipados retornados pela RPC:** mapear `'org_not_found'`, `'invalid_limit_key'`, `'invalid_value_override'`, `'invalid_reason'`, `'invalid_expires_at'`, `'grant_already_revoked'`, `'grant_not_found'` para mensagens em pt-BR. Documentar mapping em comentário no topo.
  - `revalidatePath('/admin/organizations/[id]/grants')` em mutations.

- [ ] **Schemas Zod** em `src/lib/actions/admin/grants.schemas.ts`:
  - `limitKeySchema = z.enum(['users','leads','products','pipelines','active_integrations','storage_mb'])`.
  - `createGrantSchema`: `organizationId` uuid, `limitKey`, `valueOverride: z.number().int().nonnegative().nullable()`, `reason: z.string().trim().min(5).max(500)`, `expiresAt: z.coerce.date().optional().nullable().refine(d => !d || d > new Date(), 'expires_at deve ser futuro')`.
  - `revokeGrantSchema`: `grantId: z.string().uuid()`, `limitKeyConfirmation: limitKeySchema`.
  - `listGrantsFiltersSchema`: `organizationId: z.string().uuid()`, `includeRevoked: z.boolean().default(false)`, `includeExpired: z.boolean().default(false)`.

#### Server Actions customer — cross-cutting (autor: `@backend`)

> **Padrão canônico** (a ser definido pelo `@spec-writer` na Opção 2 e replicado nas 7 actions). Esboço:
>
> ```ts
> // dentro de createLeadAction, antes do INSERT:
> const limitCheck = await supabase.rpc('enforce_limit', {
>   p_org_id: ctx.organizationId,
>   p_limit_key: 'leads',
>   p_delta: 1,
> });
> if (limitCheck.error) {
>   return mapEnforceLimitError(limitCheck.error, 'leads'); // ActionResponse<never> com mensagem pt-BR
> }
> // continua com INSERT…
> ```
>
> O helper `mapEnforceLimitError(err, limitKey)` mora em `src/lib/limits/enforceLimitError.ts` (novo) — recebe o `PostgrestError` da RPC e retorna `{ success: false, error: 'Seu plano permite até N <recurso>...' }`. Lê `err.details` (JSON) para extrair `limit` e formata mensagem por `limitKey`.

- [ ] **`src/lib/actions/leads.ts`** — `createLeadAction`: chamar `enforce_limit('leads', +1)` antes do INSERT. Bulk import (se existir) chama com `delta = batch.length` em uma única call.
- [ ] **`src/lib/actions/products.ts`** — `createProductAction`: idem para `'products'`.
- [ ] **`src/lib/actions/funnels.ts`** — `createFunnelAction`: idem para `'pipelines'`. Não bloquear `funnel_stages` (são filhos de funnels, não recurso contável próprio).
- [ ] **`src/lib/actions/invitations.ts`** — `createInvitationAction` (nome real do export): chamar `enforce_limit('users', +1)`. **Atenção:** o user só "consome" quando aceita o convite e cria `profiles`; mas a regra é checar **na criação do convite** (consistente com RF-PLAN-6 do PRD — "limite reservado"). Documentar na decisão.
- [ ] **`src/lib/actions/whatsapp-groups.ts`** — `createWhatsappGroupAction`: chamar `enforce_limit('active_integrations', +1)`. Reativar grupo após desativar também conta como +1; desativar não decrementa explicitamente — `enforce_limit` recomputa via COUNT(`is_active=true`).
- [ ] **`src/lib/actions/product-images.ts`** — `uploadProductImageAction`: chamar `enforce_limit('storage_mb', +ceil(file.size/1048576))` antes do upload para Storage (o limite per-product `MAX_IMAGE_BYTES`/`MAX_IMAGES_PER_PRODUCT` existente continua vigente como guardião adicional — não é substituído). **Ordem importa:** primeiro validações locais (mime, max bytes), então `enforce_limit`; só então `storage.upload`. Falha do upload pós-enforce não rola back o COUNT (é leitura), então não há vazamento.
- [ ] **`src/lib/actions/product-documents.ts`** — `uploadProductDocumentAction`: idem.
- [ ] **Helper `src/lib/limits/enforceLimitError.ts`** — função pura que recebe `PostgrestError` e `limitKey`, retorna mensagem padronizada pt-BR. Tabela de mensagens:

  | limitKey | mensagem |
  |---|---|
  | `users` | "Seu plano permite até {limit} usuários. Para convidar mais, faça upgrade ou contate o suporte." |
  | `leads` | "Seu plano permite até {limit} leads. Para criar mais, faça upgrade ou contate o suporte." |
  | `products` | "Seu plano permite até {limit} produtos. Para criar mais, faça upgrade ou contate o suporte." |
  | `pipelines` | "Seu plano permite até {limit} pipelines. Para criar mais, faça upgrade ou contate o suporte." |
  | `active_integrations` | "Seu plano permite até {limit} integrações ativas. Para ativar mais, faça upgrade ou contate o suporte." |
  | `storage_mb` | "Seu plano permite até {limit} MB de armazenamento. Para enviar mais arquivos, faça upgrade ou contate o suporte." |

  Quando o erro é `no_active_subscription` (extremamente raro — só se a invariante INV-1 do Sprint 01 quebrar): mensagem genérica "Sua organização não tem subscription vigente. Contate o suporte."

#### Integration tests (autor: `@qa-integration`)

- [ ] **`tests/integration/admin-grants.test.ts`** — cobertura das 3 Server Actions admin:
  - `getGrantsAction`: happy + auth fail + Zod fail + filtros (includeRevoked/includeExpired) — mínimo 5 testes.
  - `createGrantAction`:
    - Happy path role owner → `success: true` com id.
    - Role support/billing tentando criar → `success: false`.
    - `valueOverride` negativo → Zod fail.
    - `reason` curta (<5) → Zod fail.
    - `expiresAt` no passado → Zod fail.
    - `limitKey` inválido → Zod fail.
  - `revokeGrantAction`:
    - Happy path owner → `success: true`.
    - `limitKeyConfirmation` divergente → bloqueado antes da RPC.
    - Grant já revogado → `'grant_already_revoked'`.
    - Role billing → `success: false`.

- [ ] **`tests/integration/limits-enforcement.test.ts`** — cobertura do cross-cutting (ver edge cases para a matriz mínima):
  - Para cada uma das **7 Server Actions** customer alteradas, mínimo 2 testes:
    1. **Within limit** — happy path: criação procede normalmente.
    2. **At/over limit** — RPC `enforce_limit` raises `plan_limit_exceeded`; Server Action retorna `success: false` com mensagem pt-BR; **nada persiste** (verificar via mock ou contagem antes/depois quando o setup permite).
  - **Cobertura de grants:** 1 teste extra que cria grant via RPC `admin_grant_limit` e confirma que `createLeadAction` passa quando estaria sobre o limite do plano sem o grant.
  - **Edge case grant expirado:** grant com `expires_at` no passado é ignorado por `enforce_limit` — confirmar via teste que a Server Action ainda falha mesmo com grant expirado em vigor.

  Mock central via `tests/setup.ts` `__mockSupabase` — simular o `rpc('enforce_limit', ...)` retornando o `PostgrestError` com `code: 'P0001'`, `message: 'plan_limit_exceeded'`, `details: '{"limit_key":"leads","limit":1000,"current":1000,"delta":1}'`. Sem `it.skip`.

### Frontend (autor: `@frontend+`)

- [ ] **`src/app/admin/organizations/[id]/grants/page.tsx`** — listagem + criação:
  - Server Component: chama `getGrantsAction({ organizationId: id, includeRevoked: false, includeExpired: false })` no carregamento default.
  - Cards de resumo no topo: para cada `limit_key`, mostra `consumido / limite_efetivo` (consumido vem de query simples no SC; limite_efetivo é `plans.max_<key>` ou override mais recente). Visual inspirado em `OrganizationDetail` cards (Sprint 05).
  - Tabela de grants: `limit_key`, `value_override` (ou "Ilimitado"), `reason`, `expires_at` (ou "Sem expiração"), `created_by` (nome admin), `created_at`, `revoked_at` (se houver), ações.
  - Toggle "Mostrar revogados/expirados" — re-query com flags `true`.
  - Botão "Conceder grant" (apenas owner — guard via prop do server) abre `GrantCreateDialog`.
  - Botão "Revogar" (apenas owner, apenas em grants ativos) abre `GrantRevokeDialog`.
  - Empty state, loading skeleton, error state.

- [ ] **Componentes em `src/components/admin/grants/`:**
  - `GrantsList.tsx` (Client Component recebendo SSR data).
  - `GrantsSummaryCards.tsx` — cards consumido/limite por `limit_key`.
  - `GrantCreateDialog.tsx` — form: select `limit_key`, input `valueOverride` (com toggle "Ilimitado" que zera o valor para NULL), textarea `reason`, datepicker `expiresAt` (opcional), validação client-side via `react-hook-form` + `zodResolver`.
  - `GrantRevokeDialog.tsx` — input de `limitKeyConfirmation` + texto explicando consequência.
  - `GrantStatusBadge.tsx` — variantes: `Ativo` (verde), `Expirado` (cinza), `Revogado` (vermelho).
  - **Reuso obrigatório:** `<Button>` (sem variantes inline). `<Dialog>` do design system.

- [ ] **Integração com detalhe da org** (`src/app/admin/organizations/[id]/page.tsx` — Sprint 05):
  - Adicionar link/tab "Grants" no menu lateral do detalhe da org, ao lado de "Subscription" (Sprint 06).
  - Se a org tem grants ativos: badge contagem ao lado do link.

- [ ] **Sidebar admin update:** **não** adicionar item dedicado "Grants" no AdminSidebar — grants são contextuais à org, acessíveis via detalhe. Manter sidebar enxuto.

- [ ] **Customer app — UI das mensagens de erro:** **não há tela nova**. A tradução do erro já é responsabilidade do `enforceLimitError.ts`; cada Server Action retorna `{ success: false, error: '...' }` e a UI customer já mostra `error` via Toast/Alert (padrão existente). Verificar manualmente que o componente que mostra erro (`<FormError>` ou Toast) renderiza a mensagem completa sem truncar.

---

## 🧪 Edge Cases (obrigatório)

- [ ] **Org sem subscription vigente** (estado anômalo — INV-1 quebrada): `enforce_limit` lança `'no_active_subscription'`; Server Action retorna mensagem genérica; admin alertado via audit/log de aplicação.
- [ ] **Plano com `max_leads = 0`** (não previsto, mas defensivo): primeira criação rejeitada com `limit=0, current=0, delta=1`.
- [ ] **Plano com `max_leads = NULL`** (já existe `is_unlimited` no Sprint 01? confirmar via MCP — se NULL = ilimitado, RPC trata como "skip checagem").
- [ ] **Grant `value_override = NULL` (ilimitado)**: `enforce_limit` retorna sucesso sem checar consumo.
- [ ] **Grant `value_override = 0`** (curiosamente válido — admin "trava" recurso): primeira criação rejeitada.
- [ ] **Múltiplos grants ativos para mesma `(org, limit_key)`**: `enforce_limit` usa o **mais recente** (ORDER BY `created_at DESC LIMIT 1`). Documentado.
- [ ] **Grant expirado** (`expires_at < now()`): tratado como ausente em `enforce_limit`. UI mostra como "Expirado" (badge cinza) na lista, sem tomar ação.
- [ ] **Grant revogado e re-criado**: ambos persistem (revogado fica no histórico). Audit registra ambos.
- [ ] **Tentativa de criar grant com `limit_key` fora do enum** via Server Action: Zod bloqueia. Via RPC direta: CHECK constraint da tabela bloqueia.
- [ ] **Tentativa de criar grant com `expires_at` no passado**: Zod bloqueia no Server Action; RPC valida em redundância.
- [ ] **Tentativa de revogar grant já revogado**: `'grant_already_revoked'` → mensagem "Esse grant já foi revogado".
- [ ] **Race no enforce**: 2 tabs do mesmo customer criando lead simultâneo na borda do limite — overshoot de 1 aceitável (documentado no header da RPC). Próxima tentativa após overshoot é rejeitada.
- [ ] **Bulk import** (futuro — não previsto no MVP customer atual, mas se aparecer): chamar `enforce_limit` com `delta = batch.length` antes do INSERT em massa. Comentário `// enforce_limit` obrigatório em qualquer Server Action de criação nova (Guardian gate).
- [ ] **Upload com tamanho que estoura `max_storage_mb`**: `enforce_limit('storage_mb', +ceil(size_bytes/1048576))` antes do `storage.upload`. Mensagem: "Seu plano permite até X MB de armazenamento."
- [ ] **Customer user de role `viewer`** tentando criar lead: já bloqueado por RBAC do customer app antes de chegar em `enforce_limit`. `enforce_limit` não dispara.
- [ ] **Org suspensa (Sprint 05)**: `enforce_limit` é chamado, mas RLS das policies customer já bloqueia o INSERT — Server Action retorna erro de RLS antes mesmo do `enforce_limit` em alguns paths. Não há regressão; Sprint 05 tem prioridade.
- [ ] **Grant criado para org interna AxonAI** (`is_internal=true`): permitido — admin Axon pode liberar capacidade para si mesmo. Audit registra normalmente.

---

## 🚫 Fora de escopo

- **Histórico de uso (gráficos de consumo ao longo do tempo)** — Sprint 09 (dashboard).
- **Email de aviso ao customer quando atinge 80%/100% do limite** — Sprint 10 (email infra) ou fase 2.
- **Bulk import / import CSV** — não existe no customer app hoje; esta sprint **prepara o caminho** (`enforce_limit` aceita `p_delta > 1`) mas não cria UI de import.
- **Upgrade/downgrade automático ao estourar limite** — fase 2 (gateway de pagamento).
- **Hard-cap atômico (zero overshoot sob race)** — PRD T-21 não exige; aceito 1 de overshoot. Documentado.
- **Grants com escopo "user" ou "team"** — apenas `(organization_id, limit_key)`. Granularidade fina é fase 2.
- **Edição de grant existente** — não previsto. Para alterar valor/razão/expiração, revogar e criar novo. Justificativa: histórico auditável.
- **Storage real (bytes consumidos) sem cache** — `enforce_limit` para `storage_mb` faz SUM em runtime. Otimização (materialized view) é Sprint 09.

---

## ⚠️ Critérios de Aceite

- [ ] Tabela `plan_grants` criada com `FORCE RLS`, CHECK constraints listadas, índices criados, policies publicadas. Validar:
  ```sql
  SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'plan_grants';
  -- esperado: t, t
  ```
- [ ] 3 RPCs (`enforce_limit`, `admin_grant_limit`, `admin_revoke_grant`) criadas com `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon` confirmado:
  ```sql
  SELECT has_function_privilege('anon', 'public.enforce_limit(uuid,text,int)', 'execute'); -- false
  SELECT has_function_privilege('authenticated', 'public.enforce_limit(uuid,text,int)', 'execute'); -- true
  ```
- [ ] **G-19 (enforcement por caminho de criação)**: para cada uma das 7 Server Actions alteradas, teste de integração prova que:
  - Criação dentro do limite procede (`success: true`).
  - Criação acima do limite falha (`success: false`) com mensagem pt-BR contendo o nome do recurso e o limite.
  - **Nada persiste** quando rejeitado.
- [ ] **G-02 (cross-tenant isolation revalidada)**: testes confirmam que `enforce_limit` para `org_A` nunca soma consumo de `org_B`. Padrão: chamar `enforce_limit` com `org_A.id` e mock que retorna COUNT 0 para `org_A` mas alto para `org_B` → sucesso.
- [ ] **Grant ativo com `value_override = NULL`** faz `enforce_limit` retornar sucesso sem checar consumo (teste explícito).
- [ ] **Grant com `expires_at` no passado** é ignorado por `enforce_limit` (teste explícito).
- [ ] **Grant revogado** (`revoked_at IS NOT NULL`) é ignorado por `enforce_limit` (teste explícito).
- [ ] Toda mutation admin (`grant.create`, `grant.revoke`) deixa linha em `audit_log` com `target_organization_id` correto, `actor_profile_id` igual ao admin owner, `metadata` contendo `limit_key`/`value_override`/`reason`/`expires_at`.
- [ ] UI `/admin/organizations/[id]/grants` lista, cria e revoga grants conforme RBAC matrix (owner mutate; support/billing read).
- [ ] Mensagem de erro pt-BR aparece **completa** no customer app ao tentar criar lead acima do limite (verificar manualmente — Toast/Alert não trunca).
- [ ] Documentação `docs/conventions/audit.md` appendou as 2 ações novas (`grant.create`, `grant.revoke`).
- [ ] `docs/PROJECT_CONTEXT.md` atualizado: RF-LIMIT-1 / T-21 entregues; convenção "toda Server Action de criação de recurso contável chama `enforce_limit`" documentada como Guardian gate.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **GATE 4.5**: `tests/integration/admin-grants.test.ts` + `tests/integration/limits-enforcement.test.ts` passam com 0 falhas, 0 skips. Cobertura nas 3 Server Actions admin + 7 Server Actions customer alteradas.
- [ ] **Guardian aprova o código** (GATE 4) — incluindo verificação de que **todas** as Server Actions de criação chamam `enforce_limit` (checklist explícito ao invocar `@guardian`).
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **15**
  - DB: **+3** (nova tabela `plan_grants`)
  - API/Actions: **+6** (3 RPCs novas +2 + múltiplos endpoints — 3 Server Actions admin + 7 Server Actions customer alteradas — +4)
  - UI: **+2** (1 página nova + ~5 componentes novos — conta como "novos componentes")
  - Lógica: **+5** (nova regra de enforcement com grants override +3, validação de coexistência grant+plano + race overshoot + mapping limit_key→consumo +2)
  - Dependências: **+3** (interna: `audit_write` Sprint 03, `requirePlatformAdminRole` Sprint 02, `get_current_subscription` / `plans` Sprint 01; cross-cutting em 7 Server Actions — alto acoplamento)
  - **Total: 19** (cap em 15 para a árvore de decisão — qualquer ≥9 já força Opção 2)
- Reference Module: **parcial** — Sprint 05/06 para padrão de RPC com audit; Sprint 06 para padrão de UI sub-rota da org. **Sem reference module** para o cross-cutting `enforce_limit` em Server Actions customer — sprint estabelece o padrão.
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **sim, alta** — primeira sprint que adiciona enforcement sistemático em hot path do customer app; mapping `limit_key` → consumo tem 6 queries diferentes; coexistência de grant ativo + plano vigente + grant expirado tem regras precisas; race condition de overshoot é decisão consciente que o spec precisa fixar.
- Ambiguity Risk: **alto** — múltiplos pontos de design não-óbvios: (a) grant substitui ou soma com plano? (decidido aqui: substitui — único grant ativo por (org, limit_key) ganha), (b) `enforce_limit` escreve audit? (decidido aqui: não — leitura+raise), (c) ordem upload+enforce em storage (decidido aqui: enforce primeiro), (d) bulk import (decidido aqui: `delta` parametrizável, sem UI nesta sprint), (e) convite consome user na criação ou na aceitação? (decidido aqui: na criação — limite reservado), (f) hard-cap atômico vs overshoot 1 (decidido aqui: aceitar overshoot, documentar).

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** pulado; sprint file é o contrato
- **Modelo sugerido:** N/A — score ≥9 força Opção 2 pela rubrica.
- **Quando faz sentido:** **não faz sentido aqui.** O cross-cutting em 7 Server Actions customer é de alto risco — esquecer uma é um furo silencioso de receita/limite. O `@spec-writer` precisa enumerar exaustivamente as call-sites de criação e fixar o snippet canônico **antes** do `@backend` começar.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → `@spec-writer` (Implementation Plan) → `@sanity-checker` (loop ≤3×) → STOP & WAIT → `@db-admin` → `@backend` → `@qa-integration` → `@frontend+` → `@guardian` → gates → commit
- **PRD:** gerado em `prds/prd_admin_07_limits_enforcement_grants.md`
- **Modelo sugerido:** **Opus** — cold review do `@spec-writer` + sanity-checker pagam o custo; em Sonnet drifta com 7 Server Actions customer + 6 limit_keys + edge cases de grant.
- **Quando faz sentido:** **aqui.** Score ≥9 dispara Opção 2 forçada (item 1 da árvore). Lógica de negócio nova/ambígua dispara segunda regra (item 3). O `@spec-writer` precisa fixar antes da execução: (1) **lista textual e exaustiva** das call-sites de criação no customer app — `grep` por `INSERT`/`.from(...).insert(`/`storage.upload` confirmando que nenhum caminho escapa; (2) **snippet canônico** do bloco `enforce_limit` que será replicado em cada action, incluindo helper `mapEnforceLimitError`; (3) **mapping `limit_key` → query de consumo** auditado (especialmente `storage_mb` que soma 2 tabelas); (4) **decisão de coexistência grant+plano** (substitui vs soma — fixado aqui em "substitui pelo mais recente", spec confirma); (5) **estratégia de mock** dos integration tests para não depender do banco real ao validar `plan_limit_exceeded`; (6) **convenção de comentário** `// enforce_limit` ou similar para o Guardian poder verificar mecanicamente em sprints futuras.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus** (forçada pela rubrica)

**Justificativa:**
Score ≥9 dispara Opção 2 forçada (item 1 da árvore). Lógica de negócio nova/ambígua dispara item 3. O cross-cutting em 7 Server Actions customer é o ponto de maior risco — qualquer Server Action de criação que escape do `enforce_limit` é um furo silencioso de SLA de plano/receita. Revisar 7 actions inline durante execução em Sonnet vira drift garantido; o `@spec-writer` precisa enumerar e fixar o snippet canônico **antes** do `@backend` começar. O `@sanity-checker` valida contra RF-LIMIT-1, RF-PLAN-6, T-21, G-19 do PRD admin.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 2"` (recomendado) ou `"execute"` (aceita a recomendação). Opção 1 não é adequada aqui — a rubrica força Opção 2.

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza a linha do `@guardian` e a linha Git no encerramento.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| PRD Técnico (Implementation Plan) | `@spec-writer` | ⬜ Pendente | — |
| Sanity Check | `@sanity-checker` | ⬜ Pendente | — |
| Banco de dados | `@db-admin` | ✅ Concluído (GATE 1 ✅) | `supabase/migrations/20260426100000_admin_07_limits_enforcement_grants.sql` |
| Server Actions | `@backend` | ✅ Concluído (GATE 2 ✅ — build/lint/admin-isolation) | `src/lib/limits/{enforceLimit,enforceLimitError}.ts` · `src/lib/actions/admin/{grants,grants.schemas}.ts` · cross-cutting em 7 actions customer |
| Integration tests | `@qa-integration` | ✅ Concluído | `tests/integration/admin-grants.test.ts` (17 testes) · `tests/integration/limits-enforcement.test.ts` (18 testes) — 35/35; suíte total 122/122 |
| Frontend | `@frontend+` | ✅ Concluído (build + verify-design 0 violações + admin-isolation ok) | `src/app/admin/organizations/[id]/grants/page.tsx` · `src/components/admin/grants/` (5 componentes) · update `OrgDetailView.tsx` (links Subscription + Grants) |
| Guardian | `@guardian` | ✅ Concluído (APROVADO — 0 violações) | — |
| Git | Tech Lead | ▶️ Em andamento | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review · n/a — não aplicável
