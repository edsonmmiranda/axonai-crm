# PRD: Hard-enforcement de limites + `plan_grants`

**Template:** PRD_COMPLETE
**Complexity Score:** 17 points
**Sprint:** admin_07
**Created:** 2026-04-26
**Status:** Draft

> **Score breakdown** (rubrica do `@spec-writer`):
> - DB: nova tabela `plan_grants` (+3) + múltiplas tabelas afetadas via consumo cross-cutting (+2) = **5**
> - API: novas Server Actions admin (`createGrantAction`/`revokeGrantAction`/`getGrantsAction`) (+2) + múltiplos endpoints (cross-cutting em 7 actions customer) (+2) = **4**
> - UI: novos componentes (lista de grants + dialogs + cards de resumo) (+2) = **2**
> - Lógica: nova regra de enforcement com grants override (+3) + validação complexa de coexistência grant+plano + mapping `limit_key` → consumo (+2) = **5**
> - Dependências: internas (`audit_write`, `requirePlatformAdminRole`, `plans`, `subscriptions`) (+1) = **1**
> - **Total: 17 → PRD_COMPLETE**

---

## 1. Overview

### Business Goal

Toda criação de recurso contável (user, lead, produto, pipeline, integração, storage) no customer app é **rejeitada na mesma transação** quando faz a organização exceder o limite do plano vigente — fechando o gap descrito em RF-LIMIT-1 e T-21 do PRD admin ("hoje só `check_user_limit` existe; demais limites são frouxos").

Adicionalmente, a sprint introduz `plan_grants` — overrides de limite por organização, criados pelo admin Axon com razão e expiração opcional, para casos de exceção comercial (cliente piloto, upsell em negociação, courtesy bump). O frontend customer recebe erro tipado e exibe mensagem padronizada em pt-BR.

### User Story

- **Como** platform admin owner, **quero** conceder e revogar grants de limite para uma org com razão obrigatória, **para que** eu libere capacidade fora do plano vigente sem precisar trocá-lo, com trilha auditável.
- **Como** customer user, **quero** receber mensagem clara em pt-BR ao tentar criar um lead/produto/pipeline acima do limite, **para que** eu saiba o que fazer (upgrade ou suporte).
- **Como** customer owner, **quero** que o sistema nunca consuma além do limite efetivo (plano + grants ativos), **para que** minha conta não estoure inadvertidamente.

### Success Metrics

- **Cobertura de enforcement:** **6 limit_keys** × **7 Server Actions de criação** mapeados; cada combinação coberta por teste de integração.
- **Latência:** chamada `enforce_limit` adiciona ≤ 50ms ao path de criação no caminho quente (medido localmente — RPC com 1 SELECT + 1 COUNT + raise quando aplicável).
- **Audit:** 100% das mutations admin (`grant.create`, `grant.revoke`) gravam `audit_log` na mesma transação do RPC, com `target_organization_id` correto.
- **Regressão zero:** `npm run build` + `npm run lint` + 25+ testes existentes (sprint 05/06) continuam verdes.

---

## 2. Database Requirements

### New Tables

#### Table: `plan_grants`

**Purpose:** registro append-only de overrides de limite concedidos pelo admin Axon a uma organização específica. Substitui o limite do plano vigente para o `limit_key` enquanto ativo.

**Fields:**
- `id` — `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id` — `uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
- `limit_key` — `text NOT NULL CHECK (limit_key IN ('users','leads','products','pipelines','active_integrations','storage_mb'))`
- `value_override` — `int NULL CHECK (value_override IS NULL OR value_override >= 0)` — **`NULL` significa ilimitado**
- `reason` — `text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500)`
- `expires_at` — `timestamptz NULL` — `NULL` = sem expiração
- `created_by` — `uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
- `revoked_at` — `timestamptz NULL`
- `revoked_by` — `uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`
- `created_at` — `timestamptz NOT NULL DEFAULT now()`

**Indexes:**
- Parcial **ativos por (org, limit_key)** para o caminho quente do `enforce_limit`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_plan_grants_active
    ON public.plan_grants (organization_id, limit_key, created_at DESC)
    WHERE revoked_at IS NULL;
  ```
- **Listagem na UI admin** (todos os estados, ordenados):
  ```sql
  CREATE INDEX IF NOT EXISTS idx_plan_grants_org_created
    ON public.plan_grants (organization_id, created_at DESC);
  ```

**Security (RLS):**
- `ALTER TABLE public.plan_grants ENABLE ROW LEVEL SECURITY;`
- `ALTER TABLE public.plan_grants FORCE ROW LEVEL SECURITY;`
- `REVOKE INSERT, UPDATE, DELETE ON public.plan_grants FROM authenticated, anon;` — writes apenas via RPCs `SECURITY DEFINER`.
- Policy SELECT (platform admins ativos):
  ```sql
  CREATE POLICY "platform_admins_can_read_plan_grants"
    ON public.plan_grants FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid() AND is_active = true
    ));
  ```
- **Customer não lê `plan_grants` direto** — `enforce_limit` (SECURITY DEFINER) bypassa RLS e consulta internamente.

**Constraints (resumo):**
- `value_override` é `NULL` (ilimitado) **ou** `>= 0`.
- `reason` length 5..500.
- Único grant ativo por `(organization_id, limit_key)` **não é forçado por unique** — múltiplos podem coexistir; `enforce_limit` usa o mais recente. Justificativa: histórico auditável; UI revoga manualmente o anterior se desejar.

### Modified Tables

Nenhuma — sprint adiciona `plan_grants`, RPCs e cross-cutting em código de Server Actions. Tabelas customer (`leads`, `products`, etc.) **não** ganham coluna nem trigger.

### Existing Tables Used

| Tabela | Uso | Campos lidos por `enforce_limit` |
|---|---|---|
| `plans` | catálogo de limites | `max_users`, `max_leads`, `max_products`, `max_pipelines`, `max_active_integrations`, `max_storage_mb` |
| `subscriptions` | descobrir plano vigente da org | `organization_id`, `plan_id`, `status` (filtra `IN ('trial','ativa','past_due')`) |
| `profiles` | contagem de users de uma org | `organization_id` |
| `leads` | contagem de leads | `organization_id` |
| `products` | contagem de produtos + JOIN para storage | `id`, `organization_id` |
| `funnels` | contagem de pipelines | `organization_id` |
| `whatsapp_groups` | contagem de integrações ativas | `organization_id`, `is_active` |
| `product_images` | soma de `file_size` (coluna `organization_id` direta — confirmado via MCP) | `organization_id`, `file_size` |
| `product_documents` | soma de `file_size` (coluna `organization_id` direta — confirmado via MCP) | `organization_id`, `file_size` |
| `audit_log` | inserção via `audit_write` nas RPCs `admin_grant_limit`/`admin_revoke_grant` | (via RPC) |
| `platform_admins` | autorização nas RPCs admin | `profile_id`, `role`, `is_active` |

> **Confirmado via MCP (introspeção do banco vivo):** `product_images.organization_id` e `product_documents.organization_id` existem como colunas diretas (denormalizadas, **não** estavam nas migrations versionadas mas existem em produção). Ambas têm índice (`idx_product_images_organization_id`, `idx_product_documents_organization_id`). A query de `storage_mb` faz SUM direto, **sem JOIN** — mais rápido.

---

## 3. API Contract

### Server Actions admin (3 novas)

**Arquivo:** `src/lib/actions/admin/grants.ts`
**Schemas:** `src/lib/actions/admin/grants.schemas.ts`

#### 3.1 `getGrantsAction`

**Purpose:** lista grants de uma org (com filtros opcionais de incluir revogados/expirados). Disponível para qualquer role admin (R/R/R).

**Input Schema (Zod):**
```typescript
export const ListGrantsFiltersSchema = z.object({
  organizationId: z.string().uuid('Organização inválida'),
  includeRevoked: z.boolean().default(false),
  includeExpired: z.boolean().default(false),
});
export type ListGrantsFiltersInput = z.infer<typeof ListGrantsFiltersSchema>;
```

**Output:**
```typescript
export interface GrantListItem {
  id: string;
  organizationId: string;
  limitKey: 'users' | 'leads' | 'products' | 'pipelines' | 'active_integrations' | 'storage_mb';
  valueOverride: number | null;       // null = ilimitado
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  status: 'active' | 'expired' | 'revoked';   // computado server-side
}

ActionResponse<{ items: GrantListItem[] }>
```

**Business Logic:**
1. `requirePlatformAdmin()` — qualquer role.
2. Validar input com Zod.
3. Query `plan_grants` JOIN `profiles` (`created_by`, `revoked_by`) filtrado por `organization_id`. Aplicar filtros `includeRevoked`/`includeExpired` no WHERE.
4. Computar `status`: `revoked` se `revoked_at IS NOT NULL`; senão `expired` se `expires_at < now()`; senão `active`.
5. Retornar ordenado `created_at DESC`.

#### 3.2 `createGrantAction`

**Purpose:** cria grant para uma org. Apenas role `owner`.

**Input Schema (Zod):**
```typescript
export const CreateGrantSchema = z.object({
  organizationId: z.string().uuid('Organização inválida'),
  limitKey: z.enum(['users','leads','products','pipelines','active_integrations','storage_mb'], {
    errorMap: () => ({ message: 'Tipo de limite inválido' }),
  }),
  valueOverride: z.number().int().nonnegative('Valor não pode ser negativo').nullable(),
  reason: z.string().trim().min(5, 'Razão precisa ter no mínimo 5 caracteres').max(500, 'Razão excede 500 caracteres'),
  expiresAt: z.coerce.date().optional().nullable().refine(
    (d) => !d || d > new Date(),
    { message: 'Expiração deve ser futura' }
  ),
});
export type CreateGrantInput = z.infer<typeof CreateGrantSchema>;
```

**Output:** `ActionResponse<{ id: string }>`

**Business Logic:**
1. `requirePlatformAdminRole(['owner'])`.
2. Validar input com Zod.
3. Chamar RPC `admin_grant_limit(p_org_id, p_limit_key, p_value_override, p_reason, p_expires_at, p_ip_address, p_user_agent)`.
4. Mapear erros tipados (`org_not_found`, `invalid_limit_key`, `invalid_value_override`, `invalid_reason`, `invalid_expires_at`) para mensagens pt-BR.
5. `revalidatePath('/admin/organizations/[id]/grants')` (path dinâmico).
6. Retornar `{ success: true, data: { id } }`.

#### 3.3 `revokeGrantAction`

**Purpose:** revoga grant ativo. Apenas role `owner`. Confirmação por digitar `limit_key` (RNF-UX-2).

**Input Schema (Zod):**
```typescript
export const RevokeGrantSchema = z.object({
  grantId: z.string().uuid('Grant inválido'),
  limitKeyConfirmation: z.enum(['users','leads','products','pipelines','active_integrations','storage_mb']),
});
```

**Output:** `ActionResponse<void>`

**Business Logic:**
1. `requirePlatformAdminRole(['owner'])`.
2. Validar input com Zod.
3. **Antes** de chamar a RPC: SELECT do grant para confirmar `limit_key === limitKeyConfirmation`. Se diverge → `success: false, error: 'A confirmação não corresponde ao tipo do grant.'`. Defesa contra clique acidental antes do round-trip da RPC.
4. Chamar RPC `admin_revoke_grant(p_grant_id, p_ip_address, p_user_agent)`.
5. Mapear erros (`grant_not_found`, `grant_already_revoked`) para mensagens pt-BR.
6. `revalidatePath('/admin/organizations/[id]/grants')`.

### RPCs (3 novas)

#### 3.4 `public.enforce_limit(p_org_id uuid, p_limit_key text, p_delta int DEFAULT 1) RETURNS void`

**Schema:** `SECURITY DEFINER VOLATILE LANGUAGE plpgsql SET search_path = public`

**Sem autorização do caller** — chamado de Server Actions customer authenticated. RLS das tabelas customer já garante que o caller pertence à `p_org_id` antes da mutation principal; o RPC é defesa contra estouro, não contra IDOR.

**Pseudocódigo:**
```plpgsql
DECLARE
  v_plan_limit  int;
  v_grant_value int;
  v_grant_unlimited boolean := false;
  v_effective_limit int;
  v_current_usage int;
  v_plan_column text;
BEGIN
  -- 1. Plano vigente
  SELECT
    CASE p_limit_key
      WHEN 'users'                THEN p.max_users
      WHEN 'leads'                THEN p.max_leads
      WHEN 'products'             THEN p.max_products
      WHEN 'pipelines'            THEN p.max_pipelines
      WHEN 'active_integrations'  THEN p.max_active_integrations
      WHEN 'storage_mb'           THEN p.max_storage_mb
    END
  INTO v_plan_limit
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
    AND s.status IN ('trial','ativa','past_due')
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_active_subscription' USING ERRCODE='P0001';
  END IF;

  -- 2. Grant mais recente ativo (substitui o plano)
  SELECT value_override, value_override IS NULL
  INTO v_grant_value, v_grant_unlimited
  FROM public.plan_grants
  WHERE organization_id = p_org_id
    AND limit_key = p_limit_key
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_grant_unlimited THEN RETURN; END IF;
    v_effective_limit := v_grant_value;
  ELSIF v_plan_limit IS NULL THEN
    RETURN;  -- plano com limite NULL = ilimitado
  ELSE
    v_effective_limit := v_plan_limit;
  END IF;

  -- 3. Consumo atual
  v_current_usage := CASE p_limit_key
    WHEN 'users'                THEN (SELECT count(*) FROM public.profiles       WHERE organization_id = p_org_id)
    WHEN 'leads'                THEN (SELECT count(*) FROM public.leads          WHERE organization_id = p_org_id)
    WHEN 'products'             THEN (SELECT count(*) FROM public.products       WHERE organization_id = p_org_id)
    WHEN 'pipelines'            THEN (SELECT count(*) FROM public.funnels        WHERE organization_id = p_org_id)
    WHEN 'active_integrations'  THEN (SELECT count(*) FROM public.whatsapp_groups WHERE organization_id = p_org_id AND is_active = true)
    WHEN 'storage_mb'           THEN ceil(
        (
          COALESCE((SELECT SUM(file_size)::bigint FROM public.product_images    WHERE organization_id = p_org_id), 0)
        + COALESCE((SELECT SUM(file_size)::bigint FROM public.product_documents WHERE organization_id = p_org_id), 0)
        )::numeric / 1048576
      )::int
  END;

  -- 4. Decisão
  IF v_current_usage + p_delta > v_effective_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded'
      USING ERRCODE='P0001',
            DETAIL=jsonb_build_object(
              'limit_key', p_limit_key,
              'limit',     v_effective_limit,
              'current',   v_current_usage,
              'delta',     p_delta
            )::text;
  END IF;

  RETURN;
END;
```

**Race condition (T-13):** duas inserções concorrentes podem ambas passar pelo `enforce_limit` na borda do limite. Postgres não serializa COUNT por default. **Decisão:** aceitar overshoot máximo de **1 por race** (PRD T-21 não exige hard-cap atômico). Documentar no header da RPC. `LOCK TABLE` é caro demais para hot path — rejeitado.

**Privileges:**
```sql
REVOKE ALL ON FUNCTION public.enforce_limit(uuid,text,int) FROM public;
REVOKE EXECUTE ON FUNCTION public.enforce_limit(uuid,text,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.enforce_limit(uuid,text,int) TO authenticated, service_role;
```

#### 3.5 `public.admin_grant_limit(...)`

**Assinatura:**
```sql
public.admin_grant_limit(
  p_org_id          uuid,
  p_limit_key       text,
  p_value_override  int,
  p_reason          text,
  p_expires_at      timestamptz DEFAULT NULL,
  p_ip_address      text        DEFAULT NULL,
  p_user_agent      text        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
```

**Lógica:**
1. **Autorização:** `IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE profile_id = auth.uid() AND role = 'owner' AND is_active = true) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='insufficient_privilege'; END IF;`
2. **Validações inline:**
   - `EXISTS` em `organizations` → senão `RAISE EXCEPTION 'org_not_found' USING ERRCODE='P0001'`.
   - `p_limit_key IN (...)` → senão `'invalid_limit_key'`.
   - `p_value_override IS NULL OR p_value_override >= 0` → senão `'invalid_value_override'`.
   - `length(p_reason) BETWEEN 5 AND 500` → senão `'invalid_reason'`.
   - `p_expires_at IS NULL OR p_expires_at > now()` → senão `'invalid_expires_at'`.
3. **Transação:**
   - `INSERT INTO plan_grants (organization_id, limit_key, value_override, reason, expires_at, created_by) VALUES (..., auth.uid()) RETURNING *` → variável `v_grant`.
   - `PERFORM public.audit_write('grant.create', 'plan_grant', v_grant.id, p_org_id, NULL, to_jsonb(v_grant), jsonb_build_object('limit_key', p_limit_key, 'value_override', p_value_override, 'reason', p_reason, 'expires_at', p_expires_at), p_ip_address::inet, p_user_agent);`
4. `RETURN v_grant.id`.
5. `REVOKE EXECUTE FROM anon`; `GRANT EXECUTE TO authenticated`.

#### 3.6 `public.admin_revoke_grant(...)`

**Assinatura:**
```sql
public.admin_revoke_grant(
  p_grant_id    uuid,
  p_ip_address  text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
```

**Lógica:**
1. **Autorização:** owner only (mesma checagem que `admin_grant_limit`).
2. `SELECT ... FOR UPDATE` em `plan_grants` por `p_grant_id`. Se não encontra → `'grant_not_found'`. Se `revoked_at IS NOT NULL` → `'grant_already_revoked'`.
3. UPDATE `revoked_at = now(), revoked_by = auth.uid()`.
4. `audit_write('grant.revoke', 'plan_grant', p_grant_id, v_grant.organization_id, to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('limit_key', v_grant.limit_key), p_ip_address::inet, p_user_agent)`.
5. `REVOKE EXECUTE FROM anon`; `GRANT EXECUTE TO authenticated`.

### Cross-cutting nas Server Actions customer (7 paths)

**Snippet canônico** (a ser replicado idêntico em cada action de criação):

```typescript
// SEMPRE imediatamente antes do INSERT/upload, depois de auth/Zod/RBAC locais:
import { enforceLimit } from '@/lib/limits/enforceLimit';

const enforced = await enforceLimit({
  organizationId: ctx.organizationId,
  limitKey: 'leads',  // troque por o limit_key apropriado
  delta: 1,           // ou tamanho do batch / MB calculado
});
if (!enforced.ok) {
  return { success: false, error: enforced.error };
}
// continua com INSERT…
```

**Helper novo: `src/lib/limits/enforceLimit.ts`**
```typescript
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { mapEnforceLimitError } from './enforceLimitError';

type LimitKey = 'users'|'leads'|'products'|'pipelines'|'active_integrations'|'storage_mb';

export async function enforceLimit(input: {
  organizationId: string;
  limitKey: LimitKey;
  delta: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('enforce_limit', {
    p_org_id: input.organizationId,
    p_limit_key: input.limitKey,
    p_delta: input.delta,
  });
  if (!error) return { ok: true };
  return { ok: false, error: mapEnforceLimitError(error, input.limitKey) };
}
```

**Helper novo: `src/lib/limits/enforceLimitError.ts`** — função pura que recebe `PostgrestError` e `limitKey`, retorna mensagem padronizada pt-BR. Tabela:

| limitKey | mensagem |
|---|---|
| `users` | "Seu plano permite até {limit} usuários. Para convidar mais, faça upgrade ou contate o suporte." |
| `leads` | "Seu plano permite até {limit} leads. Para criar mais, faça upgrade ou contate o suporte." |
| `products` | "Seu plano permite até {limit} produtos. Para criar mais, faça upgrade ou contate o suporte." |
| `pipelines` | "Seu plano permite até {limit} pipelines. Para criar mais, faça upgrade ou contate o suporte." |
| `active_integrations` | "Seu plano permite até {limit} integrações ativas. Para ativar mais, faça upgrade ou contate o suporte." |
| `storage_mb` | "Seu plano permite até {limit} MB de armazenamento. Para enviar mais arquivos, faça upgrade ou contate o suporte." |

`limit` extraído do `error.details` (JSON com `limit_key`, `limit`, `current`, `delta`). Quando o erro é `no_active_subscription`: "Sua organização não tem subscription vigente. Contate o suporte." Quando o erro é qualquer outro Postgres error inesperado (ex: rede): "Não foi possível validar limites. Tente novamente." + `console.error('[enforce_limit]', error)`.

**Mapeamento exaustivo das 7 Server Actions customer:**

| Arquivo | Função | `limit_key` | `delta` | Posição da chamada |
|---|---|---|---|---|
| `src/lib/actions/leads.ts` | `createLeadAction` | `'leads'` | `1` | depois de Zod + RBAC `assertRole(['owner','admin','user'])`, antes do `INSERT INTO leads` |
| `src/lib/actions/products.ts` | `createProductAction` | `'products'` | `1` | depois de Zod + RBAC, antes do `INSERT INTO products` |
| `src/lib/actions/funnels.ts` | `createFunnelAction` | `'pipelines'` | `1` | depois de Zod + RBAC, antes do `INSERT INTO funnels` (subitens `funnel_stages` **não** consomem) |
| `src/lib/actions/invitations.ts` | `createInvitationAction` | `'users'` | `1` | depois de Zod + RBAC, antes do `INSERT INTO invitations`. **Decisão fixada:** convite **reserva** o slot na criação (não na aceitação) — RF-PLAN-6. Justificativa: previne over-invite; se convite expira sem aceitação, slot retorna automaticamente porque `invitations` não conta para `enforce_limit('users')` (a query é `count(*) FROM profiles`). Trade-off aceito: nas janelas de convite pendente, a contagem baseada em `profiles` pode permitir que invites adicionais sejam criados acima do limite — mitigação é cap explicitamente checado contra `count(profiles) + count(invitations pending)` se a regra "limite reservado" precisar ser estrita; **não nesta sprint** (mantém simples e auditável). |
| `src/lib/actions/whatsapp-groups.ts` | `createWhatsappGroupAction` | `'active_integrations'` | `1` | depois de Zod + RBAC, antes do `INSERT INTO whatsapp_groups` |
| `src/lib/actions/product-images.ts` | `uploadProductImageAction` | `'storage_mb'` | `Math.ceil(file.size / 1048576)` | **depois** das validações locais (`MAX_IMAGE_BYTES`, `MAX_IMAGES_PER_PRODUCT`), **antes** do `storage.upload()`. Limites locais permanecem como guardião. |
| `src/lib/actions/product-documents.ts` | `uploadProductDocumentAction` | `'storage_mb'` | `Math.ceil(file.size / 1048576)` | idem |

**Convenção de marcação para Guardian (gate de futuras sprints):**
Cada chamada de criação que **não** chama `enforce_limit` deve ter o comentário:
```typescript
// enforce_limit: not-applicable — <razão>
```
Toda nova Server Action de criação que **não** tenha o snippet ou o comentário `not-applicable` é violação Guardian. Documentado em `docs/PROJECT_CONTEXT.md` como convenção do projeto.

---

## 4. External API Integration (if applicable)

**N/A.** Sprint não toca API externa. Email real continua sendo Sprint 10.

### 4.1 Reference Module Compliance

**Disclaimer:** Sprint 07 **não é** uma cópia mecânica de módulo CRUD — é uma feature com cross-cutting próprio. O protocolo `agents/skills/reference-module-copy/SKILL.md` (cópia mecânica) **não se aplica**. As referências abaixo são **padrões a replicar**, não cópia de arquivos.

**Padrões de referência:**

| Tópico | Fonte autoritativa | O que copiar | O que NÃO copiar |
|---|---|---|---|
| RPC com audit transacional (`SECURITY DEFINER` + `audit_write` no mesmo bloco) | `supabase/migrations/20260425100000_admin_05_organizations_crud.sql` (`admin_suspend_organization`) e `20260425200000_admin_06_plans_subscription_rpcs.sql` (`admin_change_plan`) | Header doc-comment, padrão de autorização inline (`IF NOT EXISTS ... platform_admins ... role='owner'`), `RAISE EXCEPTION ... USING ERRCODE=...`, chamada `PERFORM public.audit_write(...)`, `REVOKE EXECUTE FROM anon` no final | Lógica de domínio (suspend/change_plan); slugs de audit (`org.suspend` etc.); nomes de parâmetros |
| Server Action admin com `requirePlatformAdminRole` + Zod + mapping de erro tipado | `src/lib/actions/admin/organizations.ts` (`suspendOrganizationAction`) | Estrutura: `requirePlatformAdminRole(['owner'])` → Zod parse → `try { rpc(...) } catch` → mapping de codes → `revalidatePath` → `ActionResponse<T>` | Lógica específica de organizations (slug confirmation, etc.) |
| UI sub-rota da org com banner contextual e ações role-aware | `src/app/admin/organizations/[id]/subscription/page.tsx` (Sprint 06) | Estrutura de página com card de resumo + tabela de ações + dialogs de confirmação; padrão de `canMutate: boolean` propagado server-side | Lógica de subscription (trocar plano, estender trial); componentes específicos do domínio subscription |
| Mock central de Supabase em testes | `tests/setup.ts` `__mockSupabase` | Padrão de mock com `mockResolvedValue` e `mockResolvedValueOnce` para `rpc()` retornar `{ data, error }`; uso de `PostgrestError`-shaped objects para simular errors P0001 | Cenários específicos de orgs/subscriptions |

**Substituições mecânicas a aplicar nos templates:**

| Antigo (Sprints 05/06) | Novo (Sprint 07) |
|---|---|
| `admin_suspend_organization` | `admin_grant_limit` / `admin_revoke_grant` |
| `'org.suspend'` (audit slug) | `'grant.create'` / `'grant.revoke'` |
| `target_type='organization'` | `target_type='plan_grant'` |
| `suspendOrganizationAction` | `createGrantAction` / `revokeGrantAction` |
| `OrganizationsList` | `GrantsList` |
| `OrganizationSuspendDialog` | `GrantRevokeDialog` |
| `slugConfirmation` (RNF-UX-2) | `limitKeyConfirmation` (RNF-UX-2) |

**Padrões a preservar (não modificar):**
- Toda RPC `SECURITY DEFINER` chama `audit_write` na mesma transação para mutations (INV-6).
- Server Actions retornam sempre `ActionResponse<T>` (`{ success, data?, error?, metadata? }`).
- Confirmação destrutiva via input que precisa "match" um campo do recurso (slug do org, limit_key do grant).
- `REVOKE EXECUTE FROM anon` em **toda** RPC criada.

---

## 5. Componentes de UI

Todos os componentes seguem [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md): wrappers finos sobre Radix Primitives, tokens semânticos, variantes via `cva`, ícones Lucide.

### Component Tree

```
Page: /admin/organizations/[id]/grants
├── GrantsPageHeader (org name + breadcrumb)
├── GrantsSummaryCards
│   └── 6× SummaryCard (uma por limit_key, mostra consumido/efetivo)
├── GrantsList (Client)
│   ├── GrantsListToolbar (toggles includeRevoked / includeExpired + botão "Conceder grant")
│   ├── Table
│   │   └── Row (limit_key + valor + razão + expiração + status badge + ações)
│   │       └── GrantRowActions (revogar — só owner, só ativos)
│   └── Empty / Skeleton / Error states
├── GrantCreateDialog (Client) — montado quando aberto
│   └── Form: Select(limitKey) + Input(valueOverride) + Toggle("Ilimitado") + Textarea(reason) + DatePicker(expiresAt)
└── GrantRevokeDialog (Client) — montado quando aberto
    └── Form: Input(limitKeyConfirmation) + texto explicativo
```

### Componentes do design system reusados

| Wrapper | Path | Uso |
|---|---|---|
| `Button` | `src/components/ui/button` | variantes `primary`/`secondary`/`danger`/`ghost` |
| `Input` | `src/components/ui/input` | número, texto |
| `Select` | `src/components/ui/select` | enum `limitKey` |
| `Dialog` | `src/components/ui/dialog` | Create + Revoke |
| `Table` | `src/components/ui/table` | listagem |
| `Badge` | `src/components/ui/badge` | status badge |
| `Card` | `src/components/ui/card` | summary cards |

**Tokens semânticos esperados:** `bg-surface-raised` (cards), `text-text-primary`/`text-text-secondary` (heading/desc), `bg-action-primary`/`bg-action-danger` (botões), `bg-feedback-warning-bg`/`bg-feedback-error-bg` (badges status). Sem hex, sem `bg-blue-500`, sem `bg-background`.

### Componentes novos

#### `GrantsSummaryCards.tsx`
**Props:** `{ organizationId: string; activeGrantsByKey: Record<LimitKey, GrantListItem | null>; planLimitsByKey: Record<LimitKey, number | null>; usageByKey: Record<LimitKey, number>; }`
**Estado:** stateless (recebe SSR data).
**Comportamento:** renderiza 6 cards (um por limit_key); cada card mostra "consumido / efetivo (override = X)" com cor de feedback se >= 80%.

#### `GrantsList.tsx`
**Props:** `{ items: GrantListItem[]; canMutate: boolean; }`
**Estado:** filtros `includeRevoked`/`includeExpired` via `useTransition` + `router.replace` com query params.
**Comportamento:** lista, abre dialog de revogar via `GrantRowActions`.

#### `GrantCreateDialog.tsx`
**Props:** `{ organizationId: string; open: boolean; onOpenChange: (o: boolean) => void; }`
**Estado:** form via `react-hook-form` + `zodResolver(CreateGrantSchema)`.
**Comportamento:**
- Toggle "Ilimitado" zera `valueOverride` e desabilita o input numérico.
- Submit: `await createGrantAction(...)` → toast sucesso/erro → fecha dialog → `router.refresh()` (revalidate manual já no server action).

#### `GrantRevokeDialog.tsx`
**Props:** `{ grant: GrantListItem | null; open: boolean; onOpenChange: (o: boolean) => void; }`
**Estado:** input controlado para `limitKeyConfirmation`.
**Comportamento:** botão "Revogar" só habilita quando `confirmation === grant.limitKey`.

#### `GrantStatusBadge.tsx`
**Props:** `{ status: 'active' | 'expired' | 'revoked' }`
**Variantes:** `active` → verde (`bg-feedback-success-bg`), `expired` → cinza, `revoked` → vermelho (`bg-feedback-error-bg`).

### Integração com detalhe da org (Sprint 05)

- Adicionar link "Grants" no menu lateral de `/admin/organizations/[id]/page.tsx` (mesma estrutura de "Subscription" do Sprint 06).
- Badge contagem de grants ativos ao lado do link, computado server-side.
- **Sidebar admin global:** **não** adicionar item dedicado — grants são contextuais à org.

### Customer app — UI das mensagens de erro

**Sem tela nova.** Cada Server Action customer alterada retorna `{ success: false, error: '...mensagem pt-BR' }`. A UI customer já renderiza `error` via Toast/Alert (padrão existente). **Verificação manual:** após implementação, abrir `/dashboard/leads/new`, simular erro (criar grant com `value_override=0` para a org de teste e tentar criar lead) → garantir que o Toast/Alert mostra a mensagem completa sem truncar.

---

## 6. Edge Cases (CRITICAL)

### Estados vazios e degenerados
- [ ] **Org sem subscription vigente** (INV-1 quebrada): `enforce_limit` lança `'no_active_subscription'`; UI customer mostra "Sua organização não tem subscription vigente. Contate o suporte." Admin alertado via log de aplicação (não audit — é leitura/raise).
- [ ] **Plano com `max_<key> = NULL`** (ilimitado): `enforce_limit` retorna sem checar consumo. Comportamento documentado (linha em `plans` seed `internal` tipicamente tem NULL).
- [ ] **Plano com `max_<key> = 0`** (defensivo): primeira criação rejeitada. `current=0, delta=1, limit=0 → 1 > 0`.
- [ ] **Listagem de grants com 0 itens**: empty state "Nenhum grant para esta organização" + CTA "Conceder primeiro grant".

### Grants — semântica de coexistência
- [ ] **Múltiplos grants ativos para mesma `(org, limit_key)`**: `enforce_limit` usa o **mais recente** (`ORDER BY created_at DESC LIMIT 1`). Documentado no header da RPC.
- [ ] **Grant `value_override = NULL` (ilimitado)**: `enforce_limit` retorna sucesso sem checar consumo, mesmo com plano restritivo.
- [ ] **Grant `value_override = 0`** (admin "trava" recurso): primeira criação rejeitada (`limit=0, current=0, delta=1`).
- [ ] **Grant expirado** (`expires_at < now()`): tratado como ausente em `enforce_limit`. UI mostra como "Expirado" (badge cinza).
- [ ] **Grant revogado e re-criado**: ambos persistem (revogado fica no histórico). Audit registra ambos.

### Validação
- [ ] **`limitKey` fora do enum** via Server Action: Zod bloqueia. Via RPC direta: CHECK constraint da tabela bloqueia.
- [ ] **`expiresAt` no passado** ao criar: Zod bloqueia no Server Action; RPC valida em redundância (`'invalid_expires_at'`).
- [ ] **`reason` curta (<5)**: Zod bloqueia → mensagem "Razão precisa ter no mínimo 5 caracteres".
- [ ] **`valueOverride` negativo**: Zod bloqueia.
- [ ] **`limitKeyConfirmation` divergente** ao revogar: Server Action retorna erro **antes** da RPC. Defesa em UX (`<Button disabled>` no dialog até match) + servidor (validação dupla).

### Concorrência
- [ ] **Race no enforce** (2 tabs criando lead na borda do limite): aceito **overshoot de 1**. Documentado no header da RPC. Próxima tentativa após overshoot é rejeitada.
- [ ] **Revogar grant já revogado** (race entre dois admins): `SELECT ... FOR UPDATE` na RPC + check `revoked_at IS NULL` → segundo retorna `'grant_already_revoked'`.

### Upload / storage
- [ ] **Upload com tamanho > `max_storage_mb`** (mas dentro do `MAX_IMAGE_BYTES` local): `enforce_limit('storage_mb', +ceil(file.size/1048576))` rejeita. UI mostra mensagem de plano.
- [ ] **Upload que estouraria mesmo com grant `value_override=NULL`** (ilimitado): passa — bypass da checagem.
- [ ] **Falha no `storage.upload` após `enforce_limit` ter passado**: COUNT é leitura, não há vazamento. Próxima tentativa recomputa.

### Autorização e RBAC
- [ ] **Customer user `viewer` tentando criar lead**: bloqueado por `assertRole` antes de chegar em `enforce_limit`.
- [ ] **Role `support` tentando criar grant**: Server Action retorna `success: false, error: 'Permissão insuficiente.'` (RBAC matrix Sprint 02).
- [ ] **Role `billing` tentando revogar grant**: idem.
- [ ] **Caller anônimo** chamando `enforce_limit` direto via RPC (anon key): `REVOKE EXECUTE FROM anon` → erro de privilégio.
- [ ] **Caller anônimo** chamando `admin_grant_limit`: idem.

### Org states
- [ ] **Org suspensa (Sprint 05)**: RLS via `is_calling_org_active()` bloqueia INSERT customer antes de `enforce_limit` rodar; ordem aceitável (Sprint 05 tem prioridade). Não há regressão.
- [ ] **Grant criado para org interna AxonAI** (`is_internal=true`): permitido — admin Axon pode liberar capacidade para si mesmo. Audit registra normalmente. Não há G-07 aqui (G-07 protege contra suspensão, não contra grants).
- [ ] **Org deletada**: `ON DELETE CASCADE` em `plan_grants.organization_id` limpa grants automaticamente. Audit fica intacto (`audit_log.target_organization_id ON DELETE SET NULL`).

### Erros de rede / RPC failure
- [ ] **`enforce_limit` retorna erro de rede** (timeout, conexão dropada, Supabase indisponível): helper `enforceLimitError.ts` cai no catch-all e retorna mensagem genérica "Não foi possível validar limites. Tente novamente." + `console.error('[enforce_limit]', error)` para diagnóstico. UI mostra Toast/Alert e não persiste o INSERT (early return `success: false`). Próxima tentativa do user reexecuta a checagem.
- [ ] **`createGrantAction` falha por erro de rede** após Zod passar mas antes da RPC retornar: Server Action captura no `try/catch`, retorna `{ success: false, error: 'Não foi possível criar o grant. Tente novamente.' }`. Nenhuma linha em `audit_log` (audit é parte da transação RPC). Estado consistente.
- [ ] **`revokeGrantAction` falha por erro de rede** após `SELECT FOR UPDATE` mas antes do UPDATE retornar: a transação da RPC rola back automaticamente; `revoked_at` permanece NULL. Próxima tentativa procede normalmente.

### Browser / ambiente
- [ ] **Toast mobile (375px de largura)**: mensagem `'storage_mb'` mais longa ("Seu plano permite até 1.000 MB de armazenamento. Para enviar mais arquivos, faça upgrade ou contate o suporte.") **quebra em 2-3 linhas** mas não trunca. Verificar com viewport 375 no devtools.
- [ ] **Mensagem pt-BR não trunca no Toast** (verificar manualmente em desktop ≥1440px): mensagem mais longa cabe em uma linha.
- [ ] **`limit` em mensagem com separador de milhar**: usar `Intl.NumberFormat('pt-BR')` no helper `enforceLimitError.ts` (`1.000` em vez de `1000`).

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration `<timestamp>_admin_07_limits_enforcement_grants.sql` aplicada com sucesso (`supabase db push --dry-run` exit 0).
- [ ] Migration idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS … CREATE POLICY …`).
- [ ] `plan_grants` com `relrowsecurity=t` e `relforcerowsecurity=t`.
- [ ] 2 índices em `plan_grants` criados.
- [ ] 3 RPCs criadas:
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN ('enforce_limit','admin_grant_limit','admin_revoke_grant') AND pronamespace = 'public'::regnamespace;
  -- esperado: 3 linhas
  SELECT has_function_privilege('anon', 'public.enforce_limit(uuid,text,int)', 'execute');         -- false
  SELECT has_function_privilege('authenticated', 'public.enforce_limit(uuid,text,int)', 'execute'); -- true
  SELECT has_function_privilege('anon', 'public.admin_grant_limit(uuid,text,int,text,timestamptz,text,text)', 'execute'); -- false
  SELECT has_function_privilege('anon', 'public.admin_revoke_grant(uuid,text,text)', 'execute');   -- false
  ```
- [ ] Header da migration documenta rollback (G-17).

### Backend
- [ ] 3 Server Actions admin em `src/lib/actions/admin/grants.ts` com Zod validation, `requirePlatformAdminRole(['owner'])` em mutations, mapping de erros tipados.
- [ ] Helper `src/lib/limits/enforceLimit.ts` exportado e utilizado em 7 Server Actions customer.
- [ ] Helper `src/lib/limits/enforceLimitError.ts` mapeia 6 `limit_key` × 2 erros (`plan_limit_exceeded`, `no_active_subscription`).
- [ ] **G-19**: `git diff --name-only HEAD` mostra mudanças em **exatamente** estes 7 arquivos customer:
  ```
  src/lib/actions/leads.ts
  src/lib/actions/products.ts
  src/lib/actions/funnels.ts
  src/lib/actions/invitations.ts
  src/lib/actions/whatsapp-groups.ts
  src/lib/actions/product-images.ts
  src/lib/actions/product-documents.ts
  ```
- [ ] Cada um dos 7 arquivos tem `import { enforceLimit } from '@/lib/limits/enforceLimit'` e o snippet canônico em sua função de criação.
- [ ] `revalidatePath` chamado em `createGrantAction` e `revokeGrantAction`.

### Frontend
- [ ] Página `src/app/admin/organizations/[id]/grants/page.tsx` carrega lista, summary cards, ações conforme RBAC.
- [ ] 5 componentes novos em `src/components/admin/grants/` (`GrantsSummaryCards`, `GrantsList`, `GrantCreateDialog`, `GrantRevokeDialog`, `GrantStatusBadge`).
- [ ] Detalhe da org (`/admin/organizations/[id]/page.tsx`) tem link "Grants" com badge de contagem.
- [ ] Sidebar admin **não** ganha item dedicado de grants.
- [ ] Customer app: mensagem pt-BR aparece completa em Toast/Alert ao falhar criação acima do limite (verificação manual).
- [ ] **O código passa em todas as checagens do `agents/quality/guardian.md` § 1a (regras automáticas) e § 1b (correção semântica).** Tokens semânticos apenas. Nenhuma das 8 regras do design system pode falhar.
- [ ] Componentes verificados com `data-theme="dark"` togglado.

### Segurança
- [ ] **G-02 (cross-tenant)**: testes confirmam que `enforce_limit('users')` para `org_A` nunca soma `profiles` de `org_B`.
- [ ] Audit: cada `grant.create` e `grant.revoke` deixa linha em `audit_log` com `target_organization_id` correto, `actor_profile_id = auth.uid()` do owner, `metadata` com `limit_key` + `value_override` + `reason` (+ `expires_at` se presente).

### Documentação
- [ ] `docs/PROJECT_CONTEXT.md` atualizado: RF-LIMIT-1 / T-21 entregues; convenção do comentário `// enforce_limit: not-applicable — <razão>` para futuras Server Actions de criação documentada como Guardian gate.
- [ ] **APRENDIZADOS** (`docs/APRENDIZADOS.md`): se algum padrão não-óbvio surgir durante execução (cross-cutting em 7 actions tem armadilhas conhecidas), registrar entrada conforme `docs/APRENDIZADOS_FORMATO.md` (≤3 linhas). Se sprint rodar sem surpresa, não registra.

### Build / Lint / Tests
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `npm run build:check` (script de isolamento de imports) continua passando — nenhum arquivo `(app)/` importou `@/lib/auth/platformAdmin`.
- [ ] **GATE 4.5**: `tests/integration/admin-grants.test.ts` (mínimo 12 testes) + `tests/integration/limits-enforcement.test.ts` (mínimo 16 testes — 2 por Server Action × 7 + 2 de cenários grant) passam com 0 falhas e 0 skips.
- [ ] **Guardian aprova** (GATE 4) com checklist explícito de "todas as Server Actions de criação chamam `enforce_limit` ou têm comentário `not-applicable`".
- [ ] **GATE 5 estático**: `node scripts/verify-design.mjs --changed` retorna 0 violações.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)

1. Criar migration `supabase/migrations/<timestamp>_admin_07_limits_enforcement_grants.sql`.
2. Header com objetivo e seção de rollback.
3. `CREATE TABLE plan_grants` + 2 índices + RLS + policy SELECT + REVOKE writes de authenticated/anon.
4. RPC `enforce_limit` (com mapping `limit_key` → query, JOIN via products para storage).
5. RPC `admin_grant_limit` + `admin_revoke_grant` (ambas chamando `audit_write`).
6. `REVOKE EXECUTE FROM anon` em todas; `GRANT EXECUTE TO authenticated, service_role` em `enforce_limit`; `GRANT EXECUTE TO authenticated` em RPCs admin.
7. Validar `supabase db push --dry-run` (GATE 1) antes de aplicar via `supabase db push`.
8. Pós-checks SQL: `relforcerowsecurity`, contagem de policies, `has_function_privilege` para anon/authenticated.

**Estimated Time:** 25 minutos

### Phase 2: Backend (`@backend`)

1. Criar `src/lib/limits/enforceLimit.ts` + `src/lib/limits/enforceLimitError.ts`.
2. Criar `src/lib/actions/admin/grants.ts` + `grants.schemas.ts` (3 Server Actions).
3. Patch nas 7 Server Actions customer — adicionar snippet canônico exatamente conforme tabela §3.
4. Garantir que `revalidatePath` correto é chamado em `createGrantAction`/`revokeGrantAction`.
5. `npm run build` (GATE 2).
6. `npm run lint`.

**Estimated Time:** 40 minutos

### Phase 3: Integration tests (`@qa-integration`)

1. `tests/integration/admin-grants.test.ts` — cobrir 3 Server Actions admin (≥12 testes).
2. `tests/integration/limits-enforcement.test.ts` — cobrir 7 Server Actions customer × 2 cenários (within/over limit) + 2 cenários grant (ativo / expirado ignorado) (≥16 testes).
3. Mock central via `tests/setup.ts` `__mockSupabase`. Sem `it.skip`/`describe.skip`.
4. `npm test -- --run tests/integration/`.

**Estimated Time:** 30 minutos

### Phase 4: Frontend (`@frontend+`)

1. Criar 5 componentes em `src/components/admin/grants/`.
2. Criar `src/app/admin/organizations/[id]/grants/page.tsx`.
3. Atualizar detalhe da org (`/admin/organizations/[id]/page.tsx`) com link "Grants" + badge.
4. `npm run build`.
5. `node scripts/verify-design.mjs --changed`.
6. Verificação manual: dark mode toggle, mensagem pt-BR no Toast (precisa criar grant `value_override=0` em org de teste e tentar criar lead).

**Estimated Time:** 35 minutos

### Phase 5: Review (`@guardian`)

1. Validar design system compliance (8 regras).
2. **Checklist explícito** de Guardian: cada Server Action de criação tem `enforce_limit` chamado **OU** comentário `// enforce_limit: not-applicable — <razão>`. Lista canônica de 7 arquivos customer; não pode ter mais nem menos.
3. Validar TypeScript quality.
4. Aprovar ou rejeitar.

**Estimated Time:** 10 minutos

### Phase 6: Gates + Encerramento (Tech Lead)

1. GATE 1 ✅ já feito.
2. GATE 2 (build/lint) ✅.
3. GATE 4 (Guardian) ✅.
4. GATE 4.5 — re-rodar `npm test -- --run tests/integration/` após Guardian.
5. GATE 5 estático ✅.
6. Verificação manual de Toast (Phase 4 step 6).
7. Atualizar `docs/PROJECT_CONTEXT.md`.
8. APRENDIZADOS se houver surpresa.
9. `git mv sprints/active/sprint_admin_07_*.md sprints/done/`.
10. Commit + push.

**Estimated Time:** 15 minutos

**Total Estimated Time:** ~155 minutos (≈ 2h35m)

---

## 9. Risks & Mitigations

### Risk 1: Server Action customer escapa do `enforce_limit` (dívida silenciosa)
**Impact:** High (furo de SLA / receita — limite do plano é compromisso comercial)
**Probability:** Medium (cross-cutting em 7 arquivos é fácil errar; futuras Server Actions de criação podem esquecer)
**Mitigation:**
- Lista exaustiva no PRD §3 (tabela de mapeamento).
- Convenção `// enforce_limit: not-applicable — <razão>` obrigatória.
- Guardian gate explícito (Phase 5 checklist).
- `docs/PROJECT_CONTEXT.md` registra a convenção como projeto-wide para próximas sprints.

### Risk 2: Race condition em criação concorrente passa por cima do limite
**Impact:** Low (overshoot de 1 é tolerável — PRD T-21 não exige hard-cap atômico)
**Probability:** Low (precisa de 2 inserções simultâneas na borda exata do limite)
**Mitigation:**
- Documentado no header da RPC `enforce_limit`.
- Próxima tentativa pós-overshoot é rejeitada (auto-corrige).
- Se vier requisito de hard-cap atômico, evoluir para `LOCK TABLE` ou advisory locks em sprint dedicado.

### Risk 3: Query de consumo de `storage_mb` é cara (SUM com JOIN em produção com muitos products)
**Impact:** Medium (path quente — chamada a cada upload)
**Probability:** Medium (depende de volume de produtos por org)
**Mitigation:**
- Sprint 09 traz cache via materialized view (registrado no plano).
- Por ora aceitar: queries com índices em `product_images.product_id`/`product_documents.product_id` (já existem) + filter por `products.organization_id` (índice em `organizations` em `products`? validar — se não, adicionar).
- Para validar: rodar `EXPLAIN ANALYZE` da query de consumo em org com 100+ produtos antes de aplicar em prod.

### Risk 4: `enforceLimitError.ts` traduz erro de rede como "limite excedido" indevidamente
**Impact:** Medium (UX confusa)
**Probability:** Low (mapping é por `error.code === 'P0001'` + `error.message === 'plan_limit_exceeded'`)
**Mitigation:**
- Helper trata 3 paths distintos: `plan_limit_exceeded` (mensagem de plano), `no_active_subscription` (mensagem específica), qualquer outro (mensagem genérica + `console.error`).
- Teste de unidade do helper cobre os 3 paths.

### Risk 5: Convite criado mas nunca aceito "trava" slot (decisão fixada)
**Impact:** Low (admin pode revogar convite via `revokeInvitationAction`)
**Probability:** Medium (ocorre em condições de uso normal)
**Mitigation:**
- Decisão documentada no PRD §3 (`createInvitationAction`): consumo é via `count(profiles)`, não `count(invitations)`. Convite pendente **não** consome slot.
- Trade-off explicitado: pode permitir invite acima do limite real durante janela de pendência. Aceitar nesta sprint.
- Se virar problema operacional, abrir sprint dedicado para "limite reservado estrito".

---

## 10. Dependencies

### Internal (todas satisfeitas)
- [x] Sprint 01 — `plans.max_*`, `subscriptions`, `get_current_subscription`
- [x] Sprint 02 — `requirePlatformAdminRole`, `platform_admins.role`
- [x] Sprint 03 — `audit_write` RPC + `writeAudit` helper
- [x] Sprint 05 — padrão de RPC com `audit_write` na mesma transação
- [x] Sprint 06 — padrão de UI sub-rota da org

### External
- N/A.

---

## 11. Rollback Plan

Caso problemas críticos sejam detectados em produção após deploy:

### Rollback de código
1. `git revert <commit-hash>` — desfaz o commit do sprint.
2. `npm run build` para confirmar que reverte limpo.
3. Re-deploy.

### Rollback de DB (apenas se necessário — preferência por hotfix em vez de rollback)
1. As 3 RPCs e a tabela podem ser dropadas via:
   ```sql
   DROP FUNCTION IF EXISTS public.admin_revoke_grant(uuid,text,text);
   DROP FUNCTION IF EXISTS public.admin_grant_limit(uuid,text,int,text,timestamptz,text,text);
   DROP FUNCTION IF EXISTS public.enforce_limit(uuid,text,int);
   DROP TABLE IF EXISTS public.plan_grants;
   ```
2. **Audit log permanece** (linhas `grant.create`/`grant.revoke` ficam — `target_id` aponta para registros que já não existem, mas histórico é preservado por design).
3. Customer app sem `enforce_limit` no path → reverte ao comportamento pré-sprint (limites frouxos). Não há corrupção de dados.

### Hotfix preferido sobre rollback
Se um único `enforce_limit` está bloqueando indevidamente: criar grant `value_override=NULL` via SQL para a org afetada como mitigação imediata enquanto investiga. Audit captura quem fez.

**Rollback Command (resumo):**
```bash
git revert <commit-hash>
# DB rollback opcional — só se RPCs estão produzindo problemas:
psql -h <supabase> -U postgres -d postgres -f rollback_admin_07.sql
```

---

## Approval

**Created by:** @spec-writer (persona Tech Lead)
**Reviewed by:** [pending — @sanity-checker]
**Approved by:** [pending — usuário]
**Date:** 2026-04-26
