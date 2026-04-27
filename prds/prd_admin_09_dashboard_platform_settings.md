# PRD: Dashboard home + platform settings base (flags + trial + políticas legais)

**Template:** PRD_COMPLETE
**Complexity Score:** 22 points (cap aplicado pela árvore de decisão — qualquer ≥9 força Opção 2)
**Sprint:** sprint_admin_09
**Created:** 2026-04-27
**Status:** Draft (aguardando Sanity Check)

> **Sprint file:** [`sprints/active/sprint_admin_09_dashboard_platform_settings.md`](../sprints/active/sprint_admin_09_dashboard_platform_settings.md) — contrato de negócio.
> **PRD source:** [`docs/admin_area/admin_area_prd.md`](../docs/admin_area/admin_area_prd.md) — RF-DASH-1..4, RF-SET-1..6, RNF-PERF-1, T-19, INV-6.
> **Plano fonte:** [`docs/admin_area/sprint_plan.md`](../docs/admin_area/sprint_plan.md) § Sprint 09.
> **Estado vivo do banco consultado via MCP** — não usar `docs/schema_snapshot.json`.

---

## 1. Overview

### Business Goal

Encerrar o gap operacional descrito em RF-DASH-1..4 e RF-SET-1..6 do PRD admin: hoje a equipe Axon não tem (a) visão consolidada de KPIs do negócio, (b) toggle de feature flags sem deploy, (c) configuração das durações de trial/grace que alimentam Sprints 05 e 13, nem (d) versionamento de políticas legais (Termos/Privacidade) — cada uma dessas peças bloqueia ou força workaround em outro sprint.

Esta sprint entrega as **4 tabelas + 7 RPCs + helpers TS** que compõem a infraestrutura permanente de settings, mais a **home do admin** com 3 KPIs cacheados em snapshot singleton (RNF-PERF-1: <1s mesmo com 10M leads).

### User Story

- Como **platform admin owner**, quero abrir `/admin/dashboard` e ver 3 KPIs (orgs ativas, usuários ativos, leads totais) com timestamp da última atualização, para acompanhar o pulso do negócio sem SQL manual.
- Como **platform admin owner**, quero ativar/desativar feature flags pela UI e configurar `trial_default_days`/`past_due_grace_days` em uma tela, para rampear experimentos e ajustar parâmetros comerciais sem deploy.
- Como **platform admin owner**, quero criar nova versão dos Termos com data de vigência (agora ou futura), para que customer app referencie a versão correta sem sobrescrever histórico legal.
- Como **customer user**, quero que `get_active_legal_policy('terms')` retorne a versão vigente atual para a tela de aceite (consumida em sprint posterior).

### Success Metrics

- **G-18 (perf dashboard):** `getDashboardMetricsAction` responde em **<1s** com 10M linhas em `leads`. Validação: `EXPLAIN ANALYZE` no SELECT do snapshot retorna <50ms (consulta a 1 linha em PK indexada).
- **RF-DASH-2:** KPIs excluem orgs com `is_internal=true`. Validação: teste explícito com 1 org interna + 1k leads na interna → `leadsTotal` desconsidera.
- **RF-SET-2:** Tentativa de `setFeatureFlagAction({ key: 'unknown_key', enabled: true })` retorna `success: false, error: 'Feature flag não registrada no sistema.'`. Validação: integration test cobre via Zod (cliente) e RPC (banco).
- **RF-SET-5 (append-only):** UPDATE/DELETE em `legal_policies` rejeitados em qualquer role (incluindo `service_role`) por trigger. Validação: integration test que tenta UPDATE retorna erro tipado.
- **Setting `trial_default_days` consumido pelo Sprint 05:** alterar `trial_default_days` de 14 → 30 e criar nova org via `createOrganizationAction` (sem informar `trialDays`) → subscription recém-criada tem `period_end - period_start = 30 days`. Validação: integration test no `admin-organizations.test.ts` (já existente, expandir).

---

## 2. Database Requirements

### New Tables

#### Table: `platform_settings`

**Purpose:** Key/value tipado e versionado por `value_type` para parâmetros globais da plataforma. Substitui hardcodes (Sprint 05: `14 days`; Sprint 06: `7 days grace`) e prepara settings de credenciais (Sprint 10) e retenção (Sprint 12).

**Fields:**
- `key text PRIMARY KEY` — slug snake_case; CHECK `length(key) BETWEEN 3 AND 64 AND key ~ '^[a-z][a-z0-9_]*$'`
- `value_type text NOT NULL CHECK (value_type IN ('text','int','bool','jsonb'))`
- `value_text text NULL`
- `value_int int NULL`
- `value_bool bool NULL`
- `value_jsonb jsonb NULL`
- `description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500)`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`
- **Table-level CHECK constraint** (`platform_settings_exactly_one_value`):
  ```sql
  CHECK (
    (value_type = 'text' AND value_text IS NOT NULL AND value_int IS NULL AND value_bool IS NULL AND value_jsonb IS NULL)
    OR (value_type = 'int'  AND value_int  IS NOT NULL AND value_text IS NULL AND value_bool IS NULL AND value_jsonb IS NULL)
    OR (value_type = 'bool' AND value_bool IS NOT NULL AND value_text IS NULL AND value_int  IS NULL AND value_jsonb IS NULL)
    OR (value_type = 'jsonb' AND value_jsonb IS NOT NULL AND value_text IS NULL AND value_int IS NULL AND value_bool IS NULL)
  )
  ```

**Indexes:**
- PK `(key)` — implícito.
- `idx_platform_settings_updated_at` em `(updated_at DESC)` — auditoria visual.

**Security (RLS):** `ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;`
- Policy SELECT: `EXISTS (SELECT 1 FROM is_platform_admin(auth.uid()) WHERE is_active=true)` — qualquer platform admin ativo lê (RBAC fina é no Server Action).
- **Sem policy de INSERT/UPDATE/DELETE.** Writes via RPC `admin_set_setting` (`SECURITY DEFINER`). `REVOKE EXECUTE FROM anon` em todas as RPCs.

**Constraints:**
- PK em `key`.
- CHECK exatidão de valor (acima).
- FK `updated_by → profiles(id) ON DELETE SET NULL` (admin desativado preserva histórico).

**Seeds iniciais (idempotente via `ON CONFLICT (key) DO NOTHING`):**
| key | value_type | value_int | description |
|---|---|---|---|
| `trial_default_days` | int | 14 | Dias default de trial para novas orgs (consumido por createOrganizationAction). |
| `past_due_grace_days` | int | 7 | Grace period em dias para subscriptions `past_due` antes do bloqueio. |
| `signup_link_offline_fallback_enabled` | bool | (true) | Habilita geração de link copiável quando email não está configurado (Sprint 10). |

> **Nota:** o seed não preenche `updated_by` (NULL) — registra o estado "originado pelo sistema". UI exibe "Configurado pelo sistema".

---

#### Table: `feature_flags`

**Purpose:** Toggles globais validados contra registry em código (`src/lib/featureFlags/registry.ts`). Defesa em profundidade: Zod valida client-side + RPC valida banco-side via `get_registered_feature_flag_keys()`.

**Fields:**
- `key text PRIMARY KEY` — CHECK `length(key) BETWEEN 3 AND 64 AND key ~ '^[a-z][a-z0-9_]*$'`
- `enabled bool NOT NULL DEFAULT false`
- `config jsonb NOT NULL DEFAULT '{}'::jsonb`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`

**Indexes:**
- PK `(key)`.

**Security (RLS):** `FORCE ROW LEVEL SECURITY`.
- Policy SELECT: `authenticated` callable (customer **e** admin lêem). O **filtro de visibilidade pública** acontece em código (`src/lib/featureFlags/getPublicFlags.ts` cruza com registry `isPublic=true`). Decisão: deixar a policy permissiva para SELECT mas a interface canônica para customer é a RPC `get_active_feature_flags()` (que **não** filtra — o helper TS filtra contra o registry).
- **Sem policy de INSERT/UPDATE/DELETE.** Writes via RPC `admin_set_feature_flag` (`SECURITY DEFINER`).

**Constraints:**
- PK em `key`.
- FK `updated_by`.

**Seeds iniciais** (idempotente):
| key | enabled | description |
|---|---|---|
| `enable_public_signup` | false | Formaliza D-1 (admin-gated onboarding). |
| `enable_ai_summarization` | false | Placeholder para feature futura. |

> Outras flags do registry (a serem listadas em `src/lib/featureFlags/registry.ts`) não recebem seed — UI mostra como "Não configurada" até primeira mutação.

---

#### Table: `legal_policies`

**Purpose:** Append-only versionado por `(kind, version)`. Customer app lê via `get_active_legal_policy(p_kind)` que retorna a versão com `effective_at <= now()` mais recente para o `kind`.

**Fields:**
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `kind text NOT NULL CHECK (kind IN ('terms','privacy','dpa','cookies'))`
- `version int NOT NULL` — calculado por trigger BEFORE INSERT
- `effective_at timestamptz NOT NULL` — pode ser passado/presente/futuro
- `content_md text NOT NULL CHECK (length(content_md) BETWEEN 50 AND 200000)`
- `summary text NOT NULL CHECK (length(summary) BETWEEN 10 AND 500)`
- `created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
- `created_at timestamptz NOT NULL DEFAULT now()`

**Indexes:**
- PK `(id)`.
- UNIQUE `(kind, version)` — `idx_legal_policies_kind_version`.
- `idx_legal_policies_kind_effective` em `(kind, effective_at DESC)` — query "vigente".

**Security (RLS):** `FORCE ROW LEVEL SECURITY`.
- Policy SELECT — admin: `EXISTS (SELECT 1 FROM is_platform_admin(auth.uid()) WHERE is_active=true)`.
- Policy SELECT — customer: `to authenticated` permissiva (todas as linhas), mas **a interface canônica para customer é a RPC** `get_active_legal_policy(p_kind)`. O acesso direto à tabela via PostgREST é técnicamente possível mas o customer app **não** consome assim.
- **Sem policy de INSERT/UPDATE/DELETE.** Writes via RPC `admin_create_legal_policy` (`SECURITY DEFINER`).

**Triggers:**

1. **`legal_policies_set_version` BEFORE INSERT** (auto-versioning sob concorrência):
   ```sql
   CREATE OR REPLACE FUNCTION legal_policies_set_version()
   RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     next_version int;
   BEGIN
     -- Lock por kind para evitar race em INSERTs concorrentes do mesmo kind
     PERFORM pg_advisory_xact_lock(hashtext('legal_policies:' || NEW.kind));
     SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
       FROM legal_policies WHERE kind = NEW.kind;
     NEW.version := next_version;
     RETURN NEW;
   END;
   $$;
   ```
   > **Decisão:** `pg_advisory_xact_lock` (não `SELECT ... FOR UPDATE`) — não há linhas existentes para travar no caso da primeira versão. UNIQUE `(kind, version)` é o cinto-e-suspensório se o lock falhar.

2. **`legal_policies_deny_update_delete` BEFORE UPDATE/DELETE/TRUNCATE** — append-only enforcement. Mesmo padrão do `audit_log` (Sprint 03). Bloqueia inclusive `service_role`:
   ```sql
   CREATE OR REPLACE FUNCTION legal_policies_deny_mutation()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'legal_policies is append-only (op=%)', TG_OP
       USING ERRCODE = '42501', HINT = 'Crie nova versão via admin_create_legal_policy.';
   END;
   $$;
   ```

**Constraints:**
- UNIQUE `(kind, version)`.
- CHECK `length(content_md)`, `length(summary)`.
- FK `created_by → profiles(id) ON DELETE RESTRICT` (deleta admin não derruba histórico legal).

**Seeds iniciais:** **nenhum**. Primeira versão é criada pelo admin via UI quando a feature for ativada.

---

#### Table: `platform_metrics_snapshot`

**Purpose:** Singleton (1 linha apenas) cacheando os 3 KPIs do dashboard. Evita `count(*)` em `leads` em hot path.

**Fields:**
- `id int PRIMARY KEY DEFAULT 1 CHECK (id = 1)` — singleton
- `active_orgs_count int NOT NULL DEFAULT 0`
- `active_users_count int NOT NULL DEFAULT 0`
- `leads_total int NOT NULL DEFAULT 0`
- `refreshed_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'::timestamptz`
- `refreshed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`

**Indexes:** PK `(id)`.

**Security (RLS):** `FORCE ROW LEVEL SECURITY`.
- Policy SELECT: `EXISTS (SELECT 1 FROM is_platform_admin(auth.uid()) WHERE is_active=true)`.
- Sem policy de mutação. Writes via RPC `refresh_platform_metrics` (`SECURITY DEFINER`).

**Seed inicial** (idempotente):
```sql
INSERT INTO platform_metrics_snapshot (id, active_orgs_count, active_users_count, leads_total, refreshed_at)
VALUES (1, 0, 0, 0, '1970-01-01T00:00:00Z'::timestamptz)
ON CONFLICT (id) DO NOTHING;
```
> Timestamp `1970-01-01` força lazy refresh no primeiro carregamento (`now() - refreshed_at > 15 min` é trivialmente true).

---

### Modified Tables

**Nenhuma mudança estrutural em tabelas existentes.** A alteração no fluxo `admin_create_organization` é **só no Server Action** — a RPC já aceita `p_trial_days` como parâmetro (assinatura confirmada via MCP).

---

### Existing Tables Used

#### Table: `organizations`
**Usage:** filtro `is_active=true AND is_internal=false` em `refresh_platform_metrics` para excluir org interna AxonAI dos KPIs (RF-DASH-2).
**Fields accessed:** `id`, `is_active`, `is_internal`.

#### Table: `profiles`
**Usage:** JOIN em `refresh_platform_metrics` para contar usuários distintos de orgs clientes ativas.
**Fields accessed:** `id`, `organization_id`.

#### Table: `leads`
**Usage:** COUNT em `refresh_platform_metrics`, filtrado por `is_active=true AND is_internal=false` na org.
**Fields accessed:** `id`, `organization_id`.

#### Table: `audit_log`
**Usage:** todas as 4 RPCs admin chamam `audit_write(...)` dentro do corpo PL/pgSQL (mesma transação) — convenção dos Sprints 05/06/07.

#### Table: `is_platform_admin` (function, retorna table)
**Usage:** RLS policies SELECT e validação de RBAC em RPCs admin.

---

### RPCs (todas `SECURITY DEFINER`, `REVOKE EXECUTE FROM anon`)

#### `admin_set_setting(p_key text, p_value_type text, p_value_text text, p_value_int int, p_value_bool bool, p_value_jsonb jsonb) RETURNS void`

**Authorization:** owner-only (`requirePlatformAdminRole(['owner'])` server-side; RPC valida via `is_platform_admin` + role check).

**Body:**
1. Resolve actor (`auth.uid()`) → `is_platform_admin(actor)` → confirma `is_active=true AND role='owner'` → senão `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unauthorized'`.
2. Valida coerência de `p_value_type` ↔ params não-null (RPC defende contra Zod com bug).
3. SELECT `value_*` antigo da row (para `diff_before`).
4. UPSERT em `platform_settings` com `updated_at=now()`, `updated_by=actor`.
5. `audit_write('setting.update', 'platform_setting', NULL, NULL, diff_before, diff_after, jsonb_build_object('key',p_key,'value_type',p_value_type), NULL, NULL)` — `target_id` é NULL pois `key` é text (não uuid); `key` vai para `metadata`.

#### `admin_set_feature_flag(p_key text, p_enabled bool, p_config jsonb) RETURNS void`

**Authorization:** owner-only.

**Body:**
1. Auth check (mesmo padrão).
2. `IF NOT (p_key = ANY (get_registered_feature_flag_keys())) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='feature_flag_key_not_registered', HINT=p_key;`
3. SELECT estado anterior para diff.
4. UPSERT.
5. `audit_write('feature_flag.set', 'feature_flag', NULL, NULL, diff_before, diff_after, jsonb_build_object('key',p_key), NULL, NULL)`.

#### `get_registered_feature_flag_keys() RETURNS text[]`

**STABLE, sem audit, sem auth check** — retorna array literal mantido em sync com `src/lib/featureFlags/registry.ts`. Atualização é parte do checklist de qualquer sprint que adicionar nova flag.

```sql
CREATE OR REPLACE FUNCTION get_registered_feature_flag_keys()
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY[
    'enable_public_signup',
    'enable_ai_summarization'
    -- NOTA: manter sincronizado com src/lib/featureFlags/registry.ts
  ]::text[];
$$;
```

> **Spec valida:** lista inicial de flags do registry é parte do output desta sprint. Mínimo: as 2 flags acima. `@spec-writer` pode propor expansão se justificável; default é manter conservador.

#### `get_active_feature_flags() RETURNS TABLE(key text, enabled bool, config jsonb)`

**`authenticated` callable** (customer + admin). `STABLE`, sem audit.

```sql
SELECT key, enabled, config FROM feature_flags;
```

> O filtro de visibilidade pública (`isPublic`) é aplicado em código (`src/lib/featureFlags/getPublicFlags.ts`) — RPC retorna todas as linhas. Justificativa: registry vive em código (TypeScript), não em SQL. Manter cross-cutting de visibilidade no banco implicaria duplicar registry em SQL.

#### `admin_create_legal_policy(p_kind text, p_effective_at timestamptz, p_content_md text, p_summary text) RETURNS uuid`

**Authorization:** owner-only.

**Body:**
1. Auth check.
2. `INSERT INTO legal_policies (kind, effective_at, content_md, summary, created_by) VALUES (p_kind, p_effective_at, p_content_md, p_summary, actor) RETURNING id, version` — trigger calcula `version`.
3. `audit_write('legal_policy.create', 'legal_policy', new_id, NULL, NULL, jsonb_build_object('kind',p_kind,'version',new_version,'effective_at',p_effective_at,'summary',p_summary), NULL, NULL, NULL)`. **`content_md` excluído do audit** — recuperável via `target_id`.
4. RETURN `new_id`.

#### `get_active_legal_policy(p_kind text) RETURNS legal_policies`

**`authenticated` callable. STABLE, sem audit.**

```sql
SELECT * FROM legal_policies
 WHERE kind = p_kind AND effective_at <= now()
 ORDER BY effective_at DESC, version DESC
 LIMIT 1;
```

Retorna NULL se não houver versão vigente (kind não inicializado ou primeira versão futura).

#### `refresh_platform_metrics() RETURNS platform_metrics_snapshot`

**Authorization:** owner+support callable (refresh manual usado em diagnóstico de suporte).

**Body:**
1. Auth check (owner OR support).
2. Compute:
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE o.is_active=true AND o.is_internal=false) AS active_orgs,
     COUNT(DISTINCT p.id) FILTER (WHERE o.is_active=true AND o.is_internal=false) AS active_users,
     (SELECT COUNT(*) FROM leads l JOIN organizations o2 ON l.organization_id=o2.id
       WHERE o2.is_active=true AND o2.is_internal=false) AS leads_total
     FROM organizations o LEFT JOIN profiles p ON p.organization_id = o.id;
   ```
3. SELECT snapshot atual (para `diff_before` e debounce check).
4. UPSERT (id=1) com novos counts, `refreshed_at=now()`, `refreshed_by=actor`.
5. **Debounce de audit:** `IF (now() - old.refreshed_at) > interval '60 seconds' OR old.refreshed_by IS DISTINCT FROM actor THEN audit_write('metrics.refresh', ...)`. Caso contrário, pula audit (evita poluir log).
6. RETURN nova linha.

---

## 3. API Contract

### Server Actions (admin)

> Todas seguem `ActionResponse<T>` ([standards.md §`ActionResponse<T>`](../docs/conventions/standards.md)). Auth check via `requirePlatformAdminRole(...)`. Try/catch envolvendo tudo. `revalidatePath` em mutations.

#### `getPlatformSettingsAction()`
**File:** `src/lib/actions/admin/platform-settings.ts`

**Input:** nenhum.

**Auth:** `requirePlatformAdmin()` (qualquer papel).

**Output:**
```typescript
type SettingValue = { type: 'text'; value: string } | { type: 'int'; value: number } | { type: 'bool'; value: boolean } | { type: 'jsonb'; value: unknown };
interface PlatformSetting {
  key: string;
  description: string;
  value: SettingValue;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
}
ActionResponse<PlatformSetting[]>
```

**Logic:** `SELECT * FROM platform_settings ORDER BY key`. Mapeia `value_*` para discriminated union em TS.

---

#### `updatePlatformSettingAction(input)`
**File:** `src/lib/actions/admin/platform-settings.ts`

**Input Schema (Zod):**
```typescript
const UpdatePlatformSettingSchema = z.discriminatedUnion('valueType', [
  z.object({ key: z.string().min(3).max(64).regex(/^[a-z][a-z0-9_]*$/), valueType: z.literal('text'), value: z.string() }),
  z.object({ key: z.string().min(3).max(64).regex(/^[a-z][a-z0-9_]*$/), valueType: z.literal('int'),  value: z.number().int() }),
  z.object({ key: z.string().min(3).max(64).regex(/^[a-z][a-z0-9_]*$/), valueType: z.literal('bool'), value: z.boolean() }),
  z.object({ key: z.string().min(3).max(64).regex(/^[a-z][a-z0-9_]*$/), valueType: z.literal('jsonb'), value: z.unknown() }),
]);
```

**Auth:** `requirePlatformAdminRole(['owner'])`.

**Output:** `ActionResponse<{ key: string }>`.

**Logic:**
1. Zod parse → fail returns `success: false` sem chamar Supabase.
2. Resolve params para chamada RPC: `{ p_key, p_value_type, p_value_text, p_value_int, p_value_bool, p_value_jsonb }` com 3 dos 4 value_* nulos.
3. `supabase.rpc('admin_set_setting', params)` → mapeia erros tipados (`unauthorized` → "Acesso negado.").
4. `revalidatePath('/admin/settings/trial')` + `revalidatePath('/admin/dashboard')` (configurações afetam dashboard de forma indireta).

**Regras testáveis (PRD §5.x para QA):**
- (PRD §3-update-1) `valueType='int'` com `value='abc'` → Zod fail.
- (PRD §3-update-2) Role `support` chamando → RPC raise `unauthorized` → action retorna `error: 'Acesso negado.'`.
- (PRD §3-update-3) Setting inexistente é criada (UPSERT comportamento).

---

#### `getFeatureFlagsAction()`
**File:** `src/lib/actions/admin/feature-flags.ts`

**Input:** nenhum.

**Auth:** `requirePlatformAdmin()`.

**Output:**
```typescript
interface FeatureFlagView {
  key: string;
  label: string;          // do registry
  description: string;    // do registry
  isPublic: boolean;      // do registry
  defaultEnabled: boolean;// do registry
  enabled: boolean;       // do banco ou defaultEnabled
  config: Record<string, unknown>;
  isInitialized: boolean; // !!persisted
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}
ActionResponse<FeatureFlagView[]>
```

**Logic:**
1. Lê `FEATURE_FLAG_REGISTRY` de `src/lib/featureFlags/registry.ts`.
2. `SELECT * FROM feature_flags WHERE key = ANY (registry.map(r => r.key))`.
3. Para cada item do registry: mescla com persisted (se existe) ou usa defaults; produz `FeatureFlagView`.
4. Retorna lista ordenada como o registry.

---

#### `setFeatureFlagAction(input)`
**File:** `src/lib/actions/admin/feature-flags.ts`

**Input Schema (Zod):**
```typescript
const SetFeatureFlagSchema = z.object({
  key: z.string().refine(k => FEATURE_FLAG_REGISTRY.some(r => r.key === k), { message: 'Feature flag não registrada no sistema.' }),
  enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
});
```

**Auth:** `requirePlatformAdminRole(['owner'])`.

**Output:** `ActionResponse<{ key: string; enabled: boolean }>`.

**Logic:**
1. Zod parse → key fora do registry retorna `error: 'Feature flag não registrada no sistema.'`.
2. `supabase.rpc('admin_set_feature_flag', { p_key, p_enabled, p_config })`.
3. Mapeia erros: `feature_flag_key_not_registered` (defesa em profundidade) → mesmo erro Zod; `unauthorized` → "Acesso negado.".
4. `revalidatePath('/admin/settings/feature-flags')`.

**Regras testáveis:**
- Key fora do registry **client-side** (Zod): bloqueado sem chamar RPC.
- Key dentro do registry **client-side** mas RPC retorna `feature_flag_key_not_registered` (cenário de drift entre TS e SQL): action retorna o mesmo erro padrão pt-BR.

---

#### `getLegalPolicyVersionsAction(input)`
**File:** `src/lib/actions/admin/legal-policies.ts`

**Input Schema:**
```typescript
const GetVersionsSchema = z.object({ kind: z.enum(['terms','privacy','dpa','cookies']) });
```

**Auth:** `requirePlatformAdmin()`.

**Output:**
```typescript
interface LegalPolicyVersion {
  id: string;
  kind: string;
  version: number;
  effectiveAt: string;
  summary: string;
  contentMd: string;       // incluído na visão admin (contraste com customer que só vê via get_active_legal_policy)
  createdAt: string;
  createdBy: { id: string; name: string };
}
ActionResponse<LegalPolicyVersion[]>
```

**Logic:** `SELECT * FROM legal_policies WHERE kind=$1 ORDER BY version DESC` + JOIN em `profiles` para nome.

---

#### `getActiveLegalPoliciesAction()`
**File:** `src/lib/actions/admin/legal-policies.ts`

**Input:** nenhum.

**Auth:** `requirePlatformAdmin()`.

**Output:**
```typescript
ActionResponse<{ kind: string; activeVersion: LegalPolicyVersion | null }[]>
```

**Logic:** para cada kind do enum (`terms`, `privacy`, `dpa`, `cookies`), chama `supabase.rpc('get_active_legal_policy', { p_kind })`. Retorna array com 4 entradas.

---

#### `createLegalPolicyAction(input)`
**File:** `src/lib/actions/admin/legal-policies.ts`

**Input Schema:**
```typescript
const CreateLegalPolicySchema = z.object({
  kind: z.enum(['terms','privacy','dpa','cookies']),
  effectiveAt: z.coerce.date(),    // sem restrição de min/max — passado/presente/futuro permitidos
  contentMd: z.string().min(50).max(200_000),
  summary: z.string().min(10).max(500),
});
```

**Auth:** `requirePlatformAdminRole(['owner'])`.

**Output:** `ActionResponse<{ id: string; kind: string; version: number }>`.

**Logic:**
1. Zod parse.
2. `supabase.rpc('admin_create_legal_policy', { p_kind, p_effective_at, p_content_md, p_summary })` retorna `new_id`.
3. SELECT da linha recém-criada para retornar `version`.
4. `revalidatePath('/admin/settings/legal')`.

---

#### `getDashboardMetricsAction()`
**File:** `src/lib/actions/admin/platform-metrics.ts`

**Input:** nenhum.

**Auth:** `requirePlatformAdmin()`.

**Output:**
```typescript
interface DashboardMetrics {
  activeOrgsCount: number;
  activeUsersCount: number;
  leadsTotal: number;
  refreshedAt: string;
  isStaleAfterFetch: boolean; // true só se o lazy refresh falhou
}
ActionResponse<DashboardMetrics>
```

**Logic:**
1. `SELECT * FROM platform_metrics_snapshot WHERE id=1`.
2. Se `now() - refreshed_at > interval '15 min'`: chama `supabase.rpc('refresh_platform_metrics')` (lazy refresh transparente). Erro de auth no refresh (ex: usuário billing) → ignora silenciosamente, retorna snapshot stale com `isStaleAfterFetch=true`.
3. Mapeia para output.

---

#### `refreshDashboardMetricsAction()`
**File:** `src/lib/actions/admin/platform-metrics.ts`

**Input:** nenhum.

**Auth:** `requirePlatformAdminRole(['owner','support'])`.

**Output:** `ActionResponse<DashboardMetrics>`.

**Logic:**
1. Auth check.
2. `supabase.rpc('refresh_platform_metrics')`.
3. Mapeia resultado para `DashboardMetrics`.
4. `revalidatePath('/admin/dashboard')`.

---

### Server Actions (alteração — apenas Sprint 05)

#### `createOrganizationAction` — alteração mínima

**File:** `src/lib/actions/admin/organizations.ts` (linha 362) + `organizations.schemas.ts` (linha 41).

**Mudança no schema** (`organizations.schemas.ts`):
```typescript
// ANTES:
trialDays: z.number().int().min(1).max(365).default(14),
// DEPOIS:
trialDays: z.number().int().min(1).max(365).optional(),
```

**Mudança na action** (`organizations.ts`):
```typescript
// Antes do RPC call:
const trialDays = parsed.data.trialDays ?? await getTrialDefaultDays();
// onde:
async function getTrialDefaultDays(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value_int')
    .eq('key', 'trial_default_days')
    .maybeSingle();
  if (error || data?.value_int == null) {
    console.warn('[admin] platform_settings.trial_default_days unavailable, falling back to 14');
    return 14;
  }
  return data.value_int;
}
```

> **Justificativa:** RPC `admin_create_organization` já aceita `p_trial_days`. Não muda schema do banco. Forma mais simples + idempotente.

---

### Helpers TS

#### `src/lib/featureFlags/registry.ts`
```typescript
export interface FeatureFlagSpec {
  key: string;
  label: string;
  description: string;
  isPublic: boolean;       // visível ao customer app
  defaultEnabled: boolean;
}
export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagSpec[] = [
  { key: 'enable_public_signup', label: 'Signup público', description: 'Habilita /signup público no customer app.', isPublic: false, defaultEnabled: false },
  { key: 'enable_ai_summarization', label: 'Sumarização por IA', description: 'Habilita sumarização automática de leads por IA.', isPublic: true, defaultEnabled: false },
] as const;

export function isRegisteredFlagKey(key: string): boolean {
  return FEATURE_FLAG_REGISTRY.some(r => r.key === key);
}
```

> **Sincronização SQL:** `get_registered_feature_flag_keys()` deve listar exatamente as mesmas keys. Drift é detectado por integration test que cruza ambos.

#### `src/lib/featureFlags/getPublicFlags.ts`
```typescript
import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { FEATURE_FLAG_REGISTRY } from './registry';

export const getPublicFlags = cache(async (): Promise<Record<string, boolean>> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_active_feature_flags');
  const persisted = new Map<string, boolean>((data ?? []).map(r => [r.key, r.enabled]));
  const result: Record<string, boolean> = {};
  for (const spec of FEATURE_FLAG_REGISTRY) {
    if (!spec.isPublic) continue;
    result[spec.key] = persisted.get(spec.key) ?? spec.defaultEnabled;
  }
  return result;
});
```

---

## 4. External API Integration

**Não aplicável.** Sprint 09 é puramente interno.

---

## 5. Componentes de UI

Todos os componentes seguem [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md): wrappers finos sobre primitives, tokens semânticos, variantes via `cva`. Ícones Lucide.

### Component Tree

```
Page: /admin/dashboard
├── DashboardKpis (Server Component)
│   ├── KpiCard × 3 (orgs ativas / usuários ativos / leads totais)
│   └── RefreshNowButton (Client Component, debounce 5s)

Page: /admin/settings/feature-flags
├── FeatureFlagsList (Client wrapper sobre tabela SSR)
│   ├── Switch (per row)
│   └── ConfirmFlagDialog (lightweight)

Page: /admin/settings/trial
├── TrialSettingsForm (Client, react-hook-form + zodResolver)
│   ├── Input (number) × 2
│   └── Button (primary)

Page: /admin/settings/legal
├── LegalPoliciesView (Server Component)
│   ├── LegalPolicyKindCard × 4
│   │   ├── Badge (versão vigente / programada / nunca configurada)
│   │   ├── Button "Ver versões" → LegalPolicyVersionsDialog
│   │   └── Button "Nova versão" → LegalPolicyCreateDialog
│   ├── LegalPolicyVersionsDialog (lista read-only)
│   └── LegalPolicyCreateDialog (form com confirmação)

Sidebar: AdminSidebar (modificado)
└── (novo grupo) "Configurações"
    ├── Feature flags
    ├── Trial & billing
    └── Políticas legais
```

### `KpiCard`
**File:** `src/components/admin/dashboard/KpiCard.tsx`

**Props:**
```typescript
interface KpiCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  description?: string;  // tooltip ("exclui Axon AI", etc.)
  loading?: boolean;
}
```

**Design system components used:**
- `Card`, `CardHeader`, `CardTitle`, `CardContent` from `src/components/ui/card`.
- `Tooltip` from `src/components/ui/tooltip` (se `description` presente).

**Semantic tokens used:**
- Background: `bg-surface-raised`.
- Text: `text-text-primary` (valor), `text-text-secondary` (label), `text-text-muted` (description).
- Border: `border-border`.

**State:** none (pure presentational). `loading` renderiza skeleton.

---

### `RefreshNowButton`
**File:** `src/components/admin/dashboard/RefreshNowButton.tsx`

**Props:**
```typescript
interface Props {
  refreshedAt: string;
  canRefresh: boolean;  // owner+support → true; billing → false (esconde botão)
}
```

**Design system components:** `Button` (variant `secondary`, size `sm`), ícone `RefreshCw`.

**Behavior:**
- Mostra "atualizado há Xmin" via `formatDistanceToNow(refreshedAt, { locale: pt-BR })`.
- Click dispara `refreshDashboardMetricsAction()` via `useTransition`. Debounce client-side de 5s (estado local `lastClickAt`).
- Sucesso: toast "Atualizado." + revalida server.
- Falha: toast com `error`.
- Acessibilidade: `aria-live="polite"` no wrapper do timestamp.

---

### `FeatureFlagsList`
**File:** `src/components/admin/settings/FeatureFlagsList.tsx`

**Props:** `{ flags: FeatureFlagView[]; canMutate: boolean }`.

**Design system:** `Table`, `Switch`, `Badge`, `Dialog` (confirm).

**Semantic tokens:** `bg-surface-raised`, `text-text-primary`, `bg-feedback-info-bg` (badge "Não configurada").

**Behavior:**
- Toggle dispara `setFeatureFlagAction({ key, enabled: !current, config: {} })` via `useTransition`.
- Antes de mutate: dialog leve "Ativar `<label>`?" (RNF-UX-2; flags são reversíveis, não exige digitação).
- `canMutate=false`: switch desabilitado, sem dialog.

---

### `TrialSettingsForm`
**File:** `src/components/admin/settings/TrialSettingsForm.tsx`

**Props:** `{ trialDefaultDays: number; pastDueGraceDays: number; canMutate: boolean }`.

**Design system:** `Input` (type=number), `Button`, `react-hook-form`+`zodResolver`.

**Behavior:**
- Form com 2 fields. Submit dispara 1 ou 2 `updatePlatformSettingAction` (apenas os que mudaram, comparando com prop).
- Validações Zod: `trialDefaultDays`: int 1-365; `pastDueGraceDays`: int 0-90.
- `canMutate=false`: campos read-only.
- Sucesso: toast.

---

### `LegalPolicyCreateDialog`
**File:** `src/components/admin/settings/LegalPolicyCreateDialog.tsx`

**Props:** `{ kind: 'terms' | 'privacy' | 'dpa' | 'cookies'; onCreated?: () => void }`.

**Design system:** `Dialog`, `Input`, `Textarea`, `Select`, `Button`, `react-hook-form`.

**Form fields:**
- `kind` (Select com 4 opções; pre-selected se prop passada).
- `effectiveAt` (Input type=datetime-local; default `now()`).
- `summary` (Input, 10-500 chars).
- `contentMd` (Textarea, 50-200_000 chars; rows=20).
- Confirmação: digitar `kind` em campo de confirmação antes de habilitar "Criar nova versão" (RNF-UX-2 — política legal é alta criticidade).

**Behavior:**
- Submit dispara `createLegalPolicyAction(...)`.
- Sucesso: fecha dialog + toast + `revalidate`.
- Erro: mostra inline.

---

### `LegalPoliciesView`
**File:** `src/components/admin/settings/LegalPoliciesView.tsx`

**Props:** `{ active: { kind: string; activeVersion: LegalPolicyVersion | null }[]; canMutate: boolean }`.

**Design system:** `Card` × 4 (grid 2x2 desktop, stacked mobile), `Badge`, `Button`, `Dialog`.

**Behavior:**
- Cada `LegalPolicyKindCard`:
  - Header: kind label (Termos / Privacidade / DPA / Cookies).
  - Body: se `activeVersion`: "Vigente desde [data], v[N]" + summary + botão "Ver versões". Se `null`: badge "Nunca configurada" + botão "Criar primeira versão".
  - Footer: botão "Nova versão" (`canMutate=true` apenas).

---

### `AdminSidebar` (modificação)
**File:** `src/components/admin/AdminSidebar.tsx`

**Mudança:** adicionar grupo collapsible "Configurações" abaixo dos grupos existentes, com 3 subitens:
- "Feature flags" → `/admin/settings/feature-flags`
- "Trial & billing" → `/admin/settings/trial`
- "Políticas legais" → `/admin/settings/legal`

> Item "Dashboard" (já existente) permanece como primeira entrada.

---

## 6. Edge Cases (CRITICAL — mínimo 10 para PRD_COMPLETE)

### Empty / initial states
1. **Snapshot nunca refrescado** (`refreshed_at = '1970-01-01'`): primeira chamada a `getDashboardMetricsAction()` dispara lazy refresh, salva timestamp atual; UI mostra valores reais com "atualizado agora".
2. **`legal_policies` vazia para um kind:** `get_active_legal_policy('terms')` retorna NULL; `LegalPolicyKindCard` mostra "Nunca configurada" com CTA "Criar primeira versão".
3. **Feature flag não inicializada:** `getFeatureFlagsAction` retorna `isInitialized=false, enabled=defaultEnabled`. UI mostra badge "Não configurada" e toggle no estado do default.
4. **Dashboard com counts iguais a 0** (instalação fresca após exclusão de orgs cliente): cards renderizam "0" sem placeholder. Estado válido.

### Concurrent / race
5. **Criação concorrente de v2 do mesmo kind:** `pg_advisory_xact_lock` no trigger serializa; ambos os INSERTs sucedem com versions distintas (v2 e v3).
6. **Cliente clica refresh 5x em <5s:** debounce client bloqueia 4 cliques; só 1 RPC chamada. Caso UI debounce falhe (defesa em profundidade), debounce de audit no banco (60s) bloqueia logs duplicados.

### Validation / authorization
7. **Setting com `valueType` divergente da coluna preenchida** (ex: bug em Zod): CHECK constraint do banco rejeita INSERT/UPDATE.
8. **Feature flag com key não-registrada via Server Action:** Zod bloqueia client-side antes da RPC.
9. **Feature flag com key não-registrada via RPC direta** (ataque/cli):  RPC raise `feature_flag_key_not_registered` (P0001).
10. **Admin billing tenta `refreshDashboardMetricsAction`:** `requirePlatformAdminRole(['owner','support'])` rejeita; UI esconde botão. Defesa: RPC valida no banco também.
11. **Admin support tenta `setFeatureFlagAction`:** Server Action rejeita (`['owner']`); RPC rejeita por defesa.
12. **Customer (`authenticated`) chama `get_active_feature_flags()`:** policy permite SELECT, mas o filtro de visibilidade pública acontece em `getPublicFlags.ts`. Customer nunca vê flag interna mesmo que a RPC retorne todas.
13. **Customer chama `get_active_legal_policy('unknown')`:** RPC retorna NULL.

### Data lifecycle
14. **Política legal — `effective_at` no futuro:** linha persiste; `get_active_legal_policy` ignora até `now()` cruzar. UI mostra "Programada para [data]"; versão vigente atual continua sendo a anterior.
15. **Política legal — `effective_at` no passado** (admin retroativo): permitido. Audit registra normalmente.
16. **Tentativa UPDATE/DELETE em `legal_policies` via SQL direto:** trigger bloqueia (mesmo padrão de `audit_log`). Mensagem: "legal_policies is append-only".
17. **`pg_class` reporta `relforcerowsecurity=false` em uma das 4 tabelas:** GATE 1 falha. Migration deve garantir FORCE RLS em todas.

### Integration / regression
18. **Setting `trial_default_days` ausente** (anomalia — seed falhou): `createOrganizationAction` cai no fallback hardcoded de 14 + `console.warn`. Não-fatal.
19. **Sprint 05 — testes existentes** (`tests/integration/admin-organizations.test.ts`): após alterar `createOrganizationAction` para ler setting, todos os testes devem passar. Mock de `platform_settings` adicionado em `tests/setup.ts.__mockSupabase`.
20. **Snapshot stale + admin billing carrega dashboard:** `getDashboardMetricsAction` tenta lazy refresh, mas billing **não tem permissão** para `refresh_platform_metrics`. Action captura erro de auth, retorna snapshot stale com `isStaleAfterFetch=true`. UI mostra "Última atualização há Xh" sem refresh forçado.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration runs successfully without errors (`supabase db push --dry-run` passa).
- [ ] Migration is idempotent (re-aplicação não causa erro).
- [ ] 4 tabelas criadas com `relrowsecurity=t AND relforcerowsecurity=t`. Validação via:
  ```sql
  SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
   WHERE relname IN ('platform_settings','feature_flags','legal_policies','platform_metrics_snapshot');
  ```
- [ ] RPCs com `anon` revogado:
  ```sql
  SELECT has_function_privilege('anon', 'public.admin_set_setting(text,text,text,int,bool,jsonb)', 'execute');         -- false
  SELECT has_function_privilege('anon', 'public.admin_set_feature_flag(text,bool,jsonb)', 'execute');                   -- false
  SELECT has_function_privilege('anon', 'public.admin_create_legal_policy(text,timestamptz,text,text)', 'execute');     -- false
  SELECT has_function_privilege('anon', 'public.refresh_platform_metrics()', 'execute');                                 -- false
  SELECT has_function_privilege('authenticated', 'public.get_active_legal_policy(text)', 'execute');                     -- true
  SELECT has_function_privilege('authenticated', 'public.get_active_feature_flags()', 'execute');                        -- true
  ```
- [ ] Trigger `legal_policies_deny_mutation` ativo: tentativa de UPDATE/DELETE retorna SQLSTATE 42501.
- [ ] Trigger `legal_policies_set_version` calcula version sequencial por kind.
- [ ] Seeds persistidos: `platform_settings` com 3 entries (`trial_default_days=14`, `past_due_grace_days=7`, `signup_link_offline_fallback_enabled=true`); `feature_flags` com 2 entries.

### Backend
- [ ] All Server Actions validate input com Zod.
- [ ] All Server Actions check authentication via `requirePlatformAdmin`/`requirePlatformAdminRole`.
- [ ] All Server Actions return `ActionResponse<T>`.
- [ ] All errors are logged to console.
- [ ] All errors show user-friendly messages em pt-BR.
- [ ] `revalidatePath()` chamado após mutações.
- [ ] `getTrialDefaultDays()` helper consome `platform_settings.trial_default_days`. Alterar seed para 30 → próxima org criada via `createOrganizationAction` (sem `trialDays` no input) tem `period_end - period_start = 30 days`.
- [ ] `getPublicFlags()` filtra por `isPublic=true` no registry; flag interna nunca vaza para customer.

### Frontend (design system compliance)
- [ ] O código passa em todas as checagens do [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a + § 1b.
- [ ] Componente verificado com `data-theme="dark"` togglado no `<html>`.
- [ ] Todos os formulários têm estado de loading.
- [ ] Todos os formulários têm estado de erro.
- [ ] Todos os formulários têm feedback de sucesso (toast).
- [ ] `node scripts/verify-design.mjs --changed` retorna 0 violações.

### Performance
- [ ] **G-18:** `getDashboardMetricsAction` com snapshot fresco responde em <1s. Validação: `EXPLAIN ANALYZE SELECT * FROM platform_metrics_snapshot WHERE id=1` retorna <50ms; lazy refresh roda em background, não bloqueia primeira visualização.
- [ ] `refresh_platform_metrics` em ambiente com 10M leads completa em <30s (aceitável — refresh é assíncrono do ponto de vista do usuário).

### Audit / Compliance
- [ ] Toda mutation admin grava em `audit_log` com `target_organization_id=NULL`, `actor_profile_id` correto, `metadata` com key/kind/version. Validação:
  ```sql
  SELECT action, target_type, metadata FROM audit_log
   WHERE action IN ('setting.update','feature_flag.set','legal_policy.create','metrics.refresh')
   ORDER BY occurred_at DESC LIMIT 10;
  ```
- [ ] Debounce de audit em `refresh_platform_metrics`: 2 refreshes em <60s pelo mesmo admin → apenas 1 linha em `audit_log` com `action='metrics.refresh'`.

### Tests (GATE 4.5)
- [ ] `tests/integration/admin-platform-settings.test.ts` — mín 8 testes, 0 falhas, 0 skips.
- [ ] `tests/integration/admin-feature-flags.test.ts` — mín 8 testes.
- [ ] `tests/integration/admin-legal-policies.test.ts` — mín 10 testes.
- [ ] `tests/integration/admin-platform-metrics.test.ts` — mín 6 testes.
- [ ] `tests/integration/admin-organizations.test.ts` (existente) — todos os testes do Sprint 05 continuam passando após mudança em `createOrganizationAction`.

### Documentation
- [ ] `docs/conventions/audit.md` appended com 4 ações novas.
- [ ] `docs/PROJECT_CONTEXT.md` §5c criada com schema novo + decisões.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)

1. Criar migration idempotente em `supabase/migrations/<timestamp>_admin_09_dashboard_platform_settings.sql`.
2. 4 `CREATE TABLE IF NOT EXISTS` com FORCE RLS, CHECK constraints, FKs, índices.
3. 7 RPCs (`admin_set_setting`, `admin_set_feature_flag`, `get_registered_feature_flag_keys`, `get_active_feature_flags`, `admin_create_legal_policy`, `get_active_legal_policy`, `refresh_platform_metrics`).
4. 2 triggers em `legal_policies` (`set_version`, `deny_mutation`).
5. Seeds (idempotentes via `ON CONFLICT DO NOTHING`).
6. Header documentando: 4 tabelas, 7 RPCs, 2 triggers, seeds.
7. Rollback script reverso testado em staging.
8. GATE 1: dry-run + RLS check.

**Estimated Time:** 35 minutes (4 tabelas + 7 RPCs + 2 triggers é volume).

### Phase 2: Backend (`@backend`)

1. `src/lib/featureFlags/registry.ts` + `getPublicFlags.ts`.
2. `src/lib/actions/admin/platform-settings.ts` + `.schemas.ts` (2 actions).
3. `src/lib/actions/admin/feature-flags.ts` + `.schemas.ts` (2 actions).
4. `src/lib/actions/admin/legal-policies.ts` + `.schemas.ts` (3 actions).
5. `src/lib/actions/admin/platform-metrics.ts` + `.schemas.ts` (2 actions).
6. Helper `getTrialDefaultDays` em `src/lib/actions/admin/organizations.ts` + alteração no Zod schema.
7. GATE 2: build + lint + admin-isolation.

**Estimated Time:** 40 minutes.

### Phase 3: Integration tests (`@qa-integration`)

1. `tests/integration/admin-platform-settings.test.ts` (8 testes).
2. `tests/integration/admin-feature-flags.test.ts` (8 testes).
3. `tests/integration/admin-legal-policies.test.ts` (10 testes).
4. `tests/integration/admin-platform-metrics.test.ts` (6 testes).
5. Atualizar `tests/integration/admin-organizations.test.ts` para mockar `platform_settings.trial_default_days` (1 teste novo: setting=30 → period_end +30).
6. Atualizar `tests/setup.ts.__mockSupabase` para suportar mock de `platform_settings` SELECT por key.
7. Rodar `npm test -- --run tests/integration/` — 0 falhas, 0 skips.

**Estimated Time:** 35 minutes.

### Phase 4: Frontend (`@frontend+`)

1. Substituir placeholder em `src/app/admin/dashboard/page.tsx` por dashboard real.
2. Criar `src/components/admin/dashboard/{KpiCard,RefreshNowButton}.tsx`.
3. Criar `src/app/admin/settings/{feature-flags,trial,legal}/page.tsx`.
4. Criar `src/components/admin/settings/{FeatureFlagsList,TrialSettingsForm,LegalPoliciesView,LegalPolicyCreateDialog,LegalPolicyVersionsDialog,LegalPolicyKindCard}.tsx`.
5. Atualizar `src/components/admin/AdminSidebar.tsx` com grupo "Configurações".
6. GATE 5 estático: `node scripts/verify-design.mjs --changed`.

**Estimated Time:** 50 minutes (4 telas + 8 componentes).

### Phase 5: Review (`@guardian`)

1. § 1a: regras automáticas (sem hex, sem arbitrários, sem `any`).
2. § 1b: correção semântica (composição com primitives, `cva` em variantes, focus-visible, dark mode).
3. Verificações específicas desta sprint:
   - `legal_policies` não tem nenhum caminho de UPDATE/DELETE em código (grep `.update(`, `.delete(` em `legal-policies.ts`).
   - `getPublicFlags` filtra por registry `isPublic`.
   - `createOrganizationAction` consome `trial_default_days` da setting.
   - Server Actions mantêm o contrato `ActionResponse<T>`.
4. Aprova ou rejeita.

**Estimated Time:** 10 minutes.

### Phase 6: Validation gates (Tech Lead)

1. GATE 1 ✅ (Phase 1).
2. GATE 2 ✅ (Phase 2 + Phase 4).
3. GATE 4 ✅ (Phase 5).
4. GATE 4.5: re-rodar `npm test -- --run tests/integration/`.
5. GATE 5 estático ✅ (Phase 4).

**Total Estimated Time:** ~170 minutes (~3h).

---

## 9. Risks & Mitigations

### Risk 1: Trigger de auto-version em `legal_policies` falha sob concorrência
**Impact:** Médio (criação rara — admin posta termos manualmente; risco baixo de simultâneo).
**Probability:** Baixa.
**Mitigation:** `pg_advisory_xact_lock(hashtext('legal_policies:' || kind))` serializa por kind. UNIQUE `(kind, version)` é o cinto-suspensório — falha em INSERT concorrente retorna erro tipado, frontend faz retry.

### Risk 2: Drift entre `FEATURE_FLAG_REGISTRY` (TS) e `get_registered_feature_flag_keys()` (SQL)
**Impact:** Médio (admin tenta toggle key que existe em um lado mas não no outro → erro confuso).
**Probability:** Média (sprints futuras adicionam flags em um lado e esquecem o outro).
**Mitigation:** Integration test `admin-feature-flags.test.ts` cruza ambos: chama RPC + lê `FEATURE_FLAG_REGISTRY` + asserta arrays iguais. Falha do teste sinaliza drift no PR. Documentar em `src/lib/featureFlags/registry.ts` o requisito de atualizar a RPC SQL ao adicionar flag.

### Risk 3: `refresh_platform_metrics` em produção com 10M leads bloqueia conexão
**Impact:** Médio (UX — botão demora 5-30s para responder).
**Probability:** Média (primeira refresh manual em prod).
**Mitigation:** Função usa COUNT puro sem JOINs desnecessários. Considerar índice em `leads.organization_id` (provavelmente já existe, validar via MCP). Lazy refresh acontece em background (não bloqueia primeiro render). Sprint 13 introduz cron que mantém o snapshot fresco.

### Risk 4: Quebra de regressão no Sprint 05 ao alterar `createOrganizationAction`
**Impact:** Alto (Sprint 05 é o caminho golden de criação de org via UI).
**Probability:** Baixa-média.
**Mitigation:** (1) testes existentes em `admin-organizations.test.ts` continuam passando — o setting é novo seed e o fallback hardcoded 14 cobre o "anomaly path"; (2) integration test novo verifica setting=30 → +30 days; (3) revisão dedicada do Guardian sobre o helper `getTrialDefaultDays`.

### Risk 5: Política legal com `content_md` muito grande estoura limite de payload
**Impact:** Médio (admin não consegue criar versão).
**Probability:** Baixa (limite de 200k chars cobre Termos verbosos).
**Mitigation:** Limite explícito CHECK no banco (`length(content_md) BETWEEN 50 AND 200000`); Zod valida client-side antes do round-trip. UI mostra contador de chars no textarea.

### Risk 6: Snapshot singleton fica corrompido (id ≠ 1 ou múltiplas linhas)
**Impact:** Alto (KPIs incorretos para todos os admins).
**Probability:** Muito baixa (CHECK `id=1` + UPSERT `ON CONFLICT (id) DO UPDATE`).
**Mitigation:** CHECK constraint impede id ≠ 1; PK em `id` impede duplicação. Migration de seed usa `ON CONFLICT (id) DO NOTHING`. Sanity SQL no GATE 1: `SELECT COUNT(*) FROM platform_metrics_snapshot WHERE id=1` deve retornar 1 sempre.

---

## 10. Dependencies

### Internal
- [x] Sprint 01: `organizations.is_internal`, `subscriptions` (entregue).
- [x] Sprint 02: `requirePlatformAdmin`, `requirePlatformAdminRole`, `is_platform_admin` RPC (entregue).
- [x] Sprint 03: `audit_write` RPC + convenção (entregue).
- [x] Sprint 04: `AdminShell`, `AdminSidebar`, route group `/admin/*` (entregue).
- [x] Sprint 05: `admin_create_organization` RPC (entregue — assinatura aceita `p_trial_days`).
- [x] Sprint 07: padrão de Server Action admin com erros tipados + audit transacional (entregue).

### External
- Nenhuma dependência externa. Sprint 100% interno.

---

## 11. Rollback Plan

Se issues forem encontrados após deploy:

1. **Imediato:** `git revert <commit-hash>` — reverte código.
2. **Database:** rodar migration de rollback inversa:
   ```sql
   -- supabase/migrations/<timestamp+1>_rollback_admin_09.sql
   DROP FUNCTION IF EXISTS public.refresh_platform_metrics();
   DROP FUNCTION IF EXISTS public.get_active_legal_policy(text);
   DROP FUNCTION IF EXISTS public.admin_create_legal_policy(text, timestamptz, text, text);
   DROP FUNCTION IF EXISTS public.get_active_feature_flags();
   DROP FUNCTION IF EXISTS public.get_registered_feature_flag_keys();
   DROP FUNCTION IF EXISTS public.admin_set_feature_flag(text, bool, jsonb);
   DROP FUNCTION IF EXISTS public.admin_set_setting(text, text, text, int, bool, jsonb);
   DROP TABLE IF EXISTS public.platform_metrics_snapshot;
   DROP TABLE IF EXISTS public.legal_policies;
   DROP TABLE IF EXISTS public.feature_flags;
   DROP TABLE IF EXISTS public.platform_settings;
   ```
3. **Cache:** `revalidatePath('/admin/dashboard')`, `revalidatePath('/admin/settings/*')`.
4. **Sprint 05 dependency:** se `createOrganizationAction` foi alterado para consumir setting, revert restaura `default(14)` no Zod.
5. **Monitoring:** verificar logs de erro pós-revert; rodar `tests/integration/admin-organizations.test.ts` para garantir que Sprint 05 voltou ao estado pré-09.

**Rollback Command:**
```bash
git revert <commit-hash-do-sprint-09>
# Aplicar migration de rollback no banco via supabase db push
```

---

## Approval

**Created by:** `@spec-writer` (adopted by Tech Lead, single-thread harness)
**Reviewed by:** `@sanity-checker` (próximo passo)
**Approved by:** Edson (após Sanity Check passar — STOP & WAIT)
**Date:** 2026-04-27

---

> **Próximo passo no workflow:** Tech Lead invoca `@sanity-checker` com este PRD + sprint file. Se APROVADO, apresenta ao usuário com STOP & WAIT. Só após "Aprovado" do usuário, execução começa (`@db-admin`).
