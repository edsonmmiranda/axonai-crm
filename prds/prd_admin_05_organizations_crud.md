# PRD: CRUD Organizations — Admin Area

**Template:** PRD_COMPLETE
**Complexity Score:** 15 pontos
**Sprint:** admin_05
**Created:** 2026-04-25
**Status:** Draft
**Banco consultado:** direto via Supabase MCP em 2026-04-25 (não usar `schema_snapshot.json`)

---

## 1. Overview

### Business Goal

Primeiro CRUD operacional da área admin. Elimina a necessidade de SQL manual para onboarding, suspensão e reativação de organizations-clientes. Fecha o gap §2 do PRD admin: "ausência dessa área força a equipe a executar tarefas críticas manualmente no banco".

### User Stories

- Como **platform admin owner**, quero criar, listar, detalhar, suspender e reativar organizations via UI, para que toda operação comercial aconteça sem acesso ao banco de produção.
- Como **platform admin support/billing**, quero ler a listagem e o detalhe de qualquer org (incluindo plano, subscription, users), para que eu dê suporte e diagnóstico sem poder executar ações destrutivas.
- Como **customer user de org suspensa**, quero ver tela explicativa "conta suspensa" ao acessar o app, em vez de erro 401/403 genérico.

### Success Metrics

- Onboarding end-to-end (criar org → gerar link de convite) sem SQL manual: ≤ 2 minutos.
- Suspender org → customer users bloqueados imediatamente em 100% das queries de domínio (RLS + middleware).
- Listagem de 1.000 orgs: < 500ms (RNF-PERF-2).
- Tentativa de suspender org interna AxonAI (`is_internal=true`): rejeitada com erro tipado em qualquer caminho (G-07, INV-4).

---

## 2. Database Requirements

### Estado real do banco (consultado via MCP em 2026-04-25)

**Tabelas relevantes existentes:**
- `organizations`: `id, name, slug (unique), is_active, is_internal, settings, created_at` + coluna deprecated `plan` (a remover nesta sprint)
- `subscriptions` (FORCE RLS): `id, organization_id, plan_id, status CHECK('trial','ativa','past_due','trial_expired','cancelada','suspensa'), period_start, period_end, metadata, created_at, updated_at`
- `plans` (FORCE RLS): `id, name (unique), is_public, is_archived, max_users, max_leads, max_products, max_pipelines, max_active_integrations, max_storage_mb, allow_ai_features, features_jsonb, price_monthly_cents, price_yearly_cents, created_at, updated_at`
- `profiles` (RLS, não forçado): `id, organization_id, full_name, email, role, is_active, created_at, updated_at`
- `platform_admins` (FORCE RLS): `id, profile_id, role, is_active, created_at, deactivated_at`
- `audit_log` (FORCE RLS): `id, occurred_at, actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id, diff_before, diff_after, ip_address, user_agent, metadata`
- `invitations`: `id, organization_id, email, role, invited_by, token (unique), expires_at, accepted_at, created_at`
- `signup_intents`: PK `email`, `organization_id, role CHECK('owner','admin','member'), source, expires_at`

**Planos em produção:** `free` (max 3 users, 100 leads, 50 products), `basic` (5, 1000, 500), `premium` (ilimitado), `internal` (não público, ilimitado).

**Organizations em produção:** `axon` (is_internal=true, sub ativa no plano internal) + `pessoal` (sub ativa no plano free).

**Índices relevantes em `organizations`:** `organizations_slug_key` (unique), `idx_organizations_is_active`, `idx_organizations_slug`. Faltam: `created_at DESC`, GIN trigram para busca por nome.

**`pg_trgm`:** disponível como extensão mas NÃO instalada (`installed_version=null`). A migration deve instalar via `CREATE EXTENSION IF NOT EXISTS pg_trgm`.

**RPCs existentes:** `audit_write` (SECURITY DEFINER), `get_current_subscription`, `is_platform_admin`. Nenhuma RPC admin de mutation existe — esta sprint cria as 3 primeiras.

**Policies em `organizations` (RLS não-forçado):** `Users can view own organization` (SELECT por JWT claim), `Only owners can update organization` (UPDATE por JWT claim + role owner), `Allow organization creation during signup` (INSERT). **Nenhuma policy permite platform admins lerem TODAS as orgs** — bloqueador para a listagem admin.

**Policies em `subscriptions` (FORCE RLS):** apenas `subscriptions_select_own_org` (por JWT claim). Platform admins não conseguem ler subscriptions de outras orgs.

**Policies em `plans` (FORCE RLS):** apenas `plans_select_public` — admin precisa ver todos os planos incluindo não-públicos e arquivados.

**Policies em `profiles`:** somente da própria org via JWT claim.

### Novas Tabelas

Nenhuma — esta sprint usa apenas tabelas existentes.

### Tabelas Modificadas

#### Table: `organizations`
**Mudanças:**
- **REMOVER** coluna `plan text CHECK(...)` — deprecated desde Sprint 01. Idempotente: `ALTER TABLE public.organizations DROP COLUMN IF EXISTS plan;`
- **NÃO ALTERAR** demais colunas.

### Novas Policies RLS (leitura admin)

Policies a adicionar para que platform admins acessem dados globais via cliente autenticado normal:

```sql
-- organizations: platform admins leem todas as orgs
CREATE POLICY "platform_admins_select_all_orgs"
  ON public.organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = auth.uid() AND is_active = true
  ));

-- subscriptions: platform admins leem todas as subscriptions
CREATE POLICY "platform_admins_select_all_subscriptions"
  ON public.subscriptions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = auth.uid() AND is_active = true
  ));

-- plans: platform admins leem todos os planos (inclusive não-públicos e arquivados)
CREATE POLICY "platform_admins_select_all_plans"
  ON public.plans FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = auth.uid() AND is_active = true
  ));

-- profiles: platform admins fazem COUNT de users por org (somente count/id — não nome/email)
CREATE POLICY "platform_admins_select_profiles_count"
  ON public.profiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = auth.uid() AND is_active = true
  ));
```

> **Nota de segurança:** as 4 policies acima não expõem dados sensíveis além do que o platform admin já teria via SQL manual; são equivalentes ao acesso já existente via `service_role` que a equipe usa hoje. A granularidade de papel (owner vs support vs billing) é enforçada no código TypeScript (`requirePlatformAdminRole`), não em RLS — consistente com o padrão já estabelecido em `platform_admins_select_own` e `platform_admins_can_read_audit_log`.

### Nova Função Helper

#### `is_calling_org_active() RETURNS boolean STABLE SECURITY INVOKER`

```sql
CREATE OR REPLACE FUNCTION public.is_calling_org_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(
    (SELECT is_active
     FROM public.organizations
     WHERE id = ((auth.jwt() ->> 'organization_id')::uuid)),
    false
  );
$$;
```

- Retorna `true` se a org do JWT está ativa; `false` em qualquer outro caso (org inexistente, suspensa, claim ausente).
- `STABLE`: Postgres pode cachear dentro de uma query — aceitável; middleware é a camada de detecção primária.
- `SECURITY INVOKER`: roda como o caller (authenticated); a policy `Users can view own organization` em `organizations` permite SELECT da própria org via JWT claim.
- **Uso:** adicionada em `AND public.is_calling_org_active()` em todas as 41 policies de 14 tabelas customer (ver seção de policies cross-cutting abaixo).

### Update Cross-Cutting de Policies Customer (41 policies, 14 tabelas)

Adicionar `AND public.is_calling_org_active()` em cada policy de cada tabela abaixo. Padrão idempotente: `DROP POLICY IF EXISTS "<nome>" ON <tabela>; CREATE POLICY "<nome>" ON <tabela> FOR <cmd> ... USING (<original_qual> AND public.is_calling_org_active())`.

> **Verificação de dead-code obrigatória (APRENDIZADOS 2026-04-22):** confirmar via `Grep` em `src/lib/actions/` que cada tabela abaixo tem call-site ativo antes de reescrever policies. Todas têm — são tabelas do customer app operacional.

| Tabela | Cmd | Nome da policy original |
|---|---|---|
| `categories` | SELECT | `categories_select_org` (ou equivalente — confirmar nome real) |
| `categories` | INSERT | `categories_insert_org` |
| `categories` | UPDATE | `categories_update_org` |
| `funnels` | SELECT | (idem — confirmar) |
| `funnels` | INSERT/UPDATE | (idem) |
| `funnel_stages` | SELECT | (idem) |
| `funnel_stages` | INSERT/UPDATE | (idem) |
| `invitations` | SELECT | `Enable select for organization admins` |
| `invitations` | INSERT | `Admins can create invitations` |
| `invitations` | UPDATE | `Enable update for organization admins` |
| `invitations` | DELETE | `Enable delete for organization admins` |
| `lead_origins` | SELECT/INSERT/UPDATE | (confirmar) |
| `lead_tags` | SELECT/INSERT/UPDATE | (confirmar) |
| `leads` | SELECT/INSERT/UPDATE | (confirmar) |
| `loss_reasons` | SELECT/INSERT/UPDATE | (confirmar) |
| `product_documents` | SELECT/INSERT/UPDATE | (confirmar) |
| `product_images` | SELECT/INSERT/UPDATE | (confirmar) |
| `products` | SELECT/INSERT/UPDATE | (confirmar) |
| `profiles` | SELECT | `Users can view org profiles` |
| `profiles` | INSERT | `Profiles INSERT is trigger-only` (WITH CHECK — não alterar a semântica `false`) |
| `profiles` | UPDATE | `Admins can update organization profiles` + `Users can update own profile` |
| `profiles` | DELETE | `Admins can delete profiles` |
| `tags` | SELECT/INSERT/UPDATE | (confirmar) |
| `whatsapp_groups` | SELECT/INSERT/UPDATE | (confirmar) |

**Nota sobre `profiles INSERT`:** policy `Profiles INSERT is trigger-only` tem `WITH CHECK (false)` — não adicionar `is_calling_org_active()` aqui (já nega tudo). Confirmar via `pg_policies` antes de reescrever.

**`@db-admin` deve confirmar os nomes exatos via:**
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('categories','funnels','funnel_stages','invitations','lead_origins','lead_tags','leads','loss_reasons','product_documents','product_images','products','profiles','tags','whatsapp_groups')
ORDER BY tablename, policyname;
```

### Novos Índices em `organizations`

```sql
-- Listagem default por data
CREATE INDEX IF NOT EXISTS idx_organizations_created_at
  ON public.organizations (created_at DESC);

-- Busca por nome via trigram (requer pg_trgm instalado acima)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm
  ON public.organizations USING gin (name gin_trgm_ops);
```

> Slug já tem `idx_organizations_slug` (unique). `is_active` tem `idx_organizations_is_active`. Nenhum índice novo necessário neles.

### Novas RPCs (SECURITY DEFINER)

#### `admin_create_organization`

```sql
CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_name         text,
  p_slug         text,
  p_plan_id      uuid,
  p_first_admin_email text,
  p_trial_days   int  DEFAULT 14,
  p_ip_address   text DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE
  v_actor_id      uuid := auth.uid();
  v_new_org_id    uuid;
  v_new_sub_id    uuid;
  v_inv_token     uuid;
  v_plan_exists   boolean;
  v_org_before    jsonb := NULL;
  v_org_after     jsonb;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validação: slug formato
  IF p_slug !~ '^[a-z0-9][a-z0-9\-]{2,49}$' THEN
    RAISE EXCEPTION 'invalid_slug_format' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: name length
  IF length(trim(p_name)) < 2 OR length(trim(p_name)) > 200 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: email formato básico
  IF p_first_admin_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: plano existe e não está arquivado
  SELECT EXISTS(
    SELECT 1 FROM plans WHERE id = p_plan_id AND is_archived = false
  ) INTO v_plan_exists;
  IF NOT v_plan_exists THEN
    RAISE EXCEPTION 'invalid_plan' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: trial_days range
  IF p_trial_days < 1 OR p_trial_days > 365 THEN
    RAISE EXCEPTION 'invalid_trial_days' USING ERRCODE = 'P0001';
  END IF;

  -- Inserir organization (unique_violation em slug é relançado como slug_taken)
  BEGIN
    INSERT INTO organizations (name, slug, is_active, is_internal, settings)
    VALUES (trim(p_name), p_slug, true, false, '{}')
    RETURNING id INTO v_new_org_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  -- Inserir subscription trial (INV-1 via partial unique subscriptions_one_vigente_per_org)
  INSERT INTO subscriptions (organization_id, plan_id, status, period_start, period_end, metadata)
  VALUES (
    v_new_org_id, p_plan_id, 'trial', now(),
    now() + (p_trial_days || ' days')::interval,
    jsonb_build_object('trial_days_override', p_trial_days)
  )
  RETURNING id INTO v_new_sub_id;

  -- Inserir invitation (para obter token e gerar signup_link na UI)
  INSERT INTO invitations (organization_id, email, role, invited_by, expires_at)
  VALUES (v_new_org_id, p_first_admin_email, 'admin', v_actor_id, now() + interval '7 days')
  RETURNING token INTO v_inv_token;

  -- Inserir signup_intent (permite o first admin completar signup)
  INSERT INTO signup_intents (email, organization_id, role, full_name, source, expires_at)
  VALUES (p_first_admin_email, v_new_org_id, 'owner', '', 'org_creation', now() + interval '7 days')
  ON CONFLICT (email) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        source = EXCLUDED.source,
        expires_at = EXCLUDED.expires_at;

  -- Capturar after para audit
  SELECT to_jsonb(o) INTO v_org_after
  FROM organizations o WHERE id = v_new_org_id;

  -- Audit transacional
  PERFORM public.audit_write(
    'org.create',
    'organization',
    v_new_org_id,
    v_new_org_id,
    v_org_before,
    v_org_after,
    jsonb_build_object(
      'plan_id', p_plan_id,
      'first_admin_email', p_first_admin_email,
      'trial_days', p_trial_days,
      'invitation_token', v_inv_token
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_new_org_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_organization(text,text,uuid,text,int,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_organization(text,text,uuid,text,int,text,text) TO authenticated;
```

#### `admin_suspend_organization`

```sql
CREATE OR REPLACE FUNCTION public.admin_suspend_organization(
  p_org_id     uuid,
  p_reason     text,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org      organizations%ROWTYPE;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas owner
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validação: reason obrigatória e útil
  IF length(trim(coalesce(p_reason,''))) < 5 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;

  -- Buscar org com lock para serialização
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- G-07 / INV-4: proteção da org interna
  IF v_org.is_internal = true THEN
    RAISE EXCEPTION 'internal_org_protected' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotência com erro tipado
  IF v_org.is_active = false THEN
    RAISE EXCEPTION 'org_not_active' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_org);

  UPDATE organizations SET is_active = false WHERE id = p_org_id;

  SELECT to_jsonb(o) INTO v_after FROM organizations o WHERE id = p_org_id;

  PERFORM public.audit_write(
    'org.suspend',
    'organization',
    p_org_id,
    p_org_id,
    v_before,
    v_after,
    jsonb_build_object('reason', trim(p_reason)),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_suspend_organization(uuid,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_organization(uuid,text,text,text) TO authenticated;
```

#### `admin_reactivate_organization`

```sql
CREATE OR REPLACE FUNCTION public.admin_reactivate_organization(
  p_org_id     uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org      organizations%ROWTYPE;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_org.is_active = true THEN
    RAISE EXCEPTION 'org_not_suspended' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_org);

  UPDATE organizations SET is_active = true WHERE id = p_org_id;

  SELECT to_jsonb(o) INTO v_after FROM organizations o WHERE id = p_org_id;

  PERFORM public.audit_write(
    'org.reactivate',
    'organization',
    p_org_id,
    p_org_id,
    v_before,
    v_after,
    NULL,
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reactivate_organization(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_organization(uuid,text,text) TO authenticated;
```

### Migration Summary

Arquivo: `supabase/migrations/<timestamp>_admin_05_organizations_crud.sql`

Ordem de execução:
1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
2. `ALTER TABLE public.organizations DROP COLUMN IF EXISTS plan;`
3. `CREATE OR REPLACE FUNCTION public.is_calling_org_active() ...`
4. Índices: `idx_organizations_created_at`, `idx_organizations_name_trgm`
5. 4 novas policies SELECT de plataforma (`platform_admins_select_all_orgs`, etc.)
6. 41 policies customer reescritas com `AND public.is_calling_org_active()` (textualmente, sem geração dinâmica)
7. 3 RPCs: `admin_create_organization`, `admin_suspend_organization`, `admin_reactivate_organization`
8. `REVOKE` / `GRANT` em todas as 3 RPCs

**Rollback (comentado no header da migration):**
```sql
-- ROLLBACK:
-- DROP FUNCTION IF EXISTS admin_create_organization(...);
-- DROP FUNCTION IF EXISTS admin_suspend_organization(...);
-- DROP FUNCTION IF EXISTS admin_reactivate_organization(...);
-- DROP FUNCTION IF EXISTS is_calling_org_active();
-- DROP INDEX IF EXISTS idx_organizations_created_at;
-- DROP INDEX IF EXISTS idx_organizations_name_trgm;
-- DROP POLICY IF EXISTS "platform_admins_select_all_orgs" ON organizations;
-- DROP POLICY IF EXISTS "platform_admins_select_all_subscriptions" ON subscriptions;
-- DROP POLICY IF EXISTS "platform_admins_select_all_plans" ON plans;
-- DROP POLICY IF EXISTS "platform_admins_select_profiles_count" ON profiles;
-- -- Restaurar 41 policies customer originais (ver políticas em pg_policies pré-migration)
-- ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free' CHECK (plan = ANY(ARRAY['free','basic','premium']));
```

---

## 3. API Contract

### Server Actions — `src/lib/actions/admin/organizations.ts`

**Padrão de autenticação admin (diferente do customer):**
- Customer usa `getSessionContext()` → JWT claim → `organization_id`
- Admin usa `requirePlatformAdmin()` / `requirePlatformAdminRole(['owner'])` → consulta `platform_admins` via RPC `is_platform_admin`

**Mapeamento de erros tipados da RPC → mensagem pt-BR:**

```typescript
const RPC_ERROR_MESSAGES: Record<string, string> = {
  internal_org_protected: 'A organização interna Axon não pode ser suspensa.',
  invalid_slug_format:   'Slug inválido. Use apenas letras minúsculas, números e hífens (3-50 chars).',
  slug_taken:            'Este slug já está em uso. Escolha outro.',
  invalid_plan:          'Plano não encontrado ou inativo. Selecione outro.',
  invalid_name:          'Nome deve ter entre 2 e 200 caracteres.',
  invalid_email:         'E-mail inválido.',
  invalid_trial_days:    'Dias de trial deve ser entre 1 e 365.',
  invalid_reason:        'Motivo deve ter entre 5 e 500 caracteres.',
  org_not_found:         'Organização não encontrada.',
  org_not_active:        'Organização já está suspensa.',
  org_not_suspended:     'Organização não está suspensa.',
  insufficient_privilege:'Permissão insuficiente para esta ação.',
};
```

#### Schemas Zod — `src/lib/actions/admin/organizations.schemas.ts`

```typescript
import { z } from 'zod';

export const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{2,49}$/, 'Slug inválido');

// Converte nome em slug sugerido
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export const ListOrgsSchema = z.object({
  search:   z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),           // true=ativas, false=suspensas, undefined=todas
  planId:   z.string().uuid().optional(),
  subStatus: z.enum(['trial','ativa','past_due','trial_expired','cancelada','suspensa']).optional(),
  page:     z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sortBy:   z.enum(['name','created_at','is_active']).default('created_at'),
  sortOrder: z.enum(['asc','desc']).default('desc'),
});

export const CreateOrgSchema = z.object({
  name:            z.string().trim().min(2).max(200),
  slug:            slugSchema,
  planId:          z.string().uuid('Plano obrigatório'),
  firstAdminEmail: z.string().email('E-mail inválido'),
  trialDays:       z.number().int().min(1).max(365).default(14),
});

export const SuspendOrgSchema = z.object({
  id:               z.string().uuid(),
  slugConfirmation: z.string().min(1, 'Digite o slug para confirmar'),
  reason:           z.string().trim().min(5, 'Motivo muito curto').max(500),
});

export const ReactivateOrgSchema = z.object({
  id:               z.string().uuid(),
  slugConfirmation: z.string().min(1, 'Digite o slug para confirmar'),
});

export type ListOrgsInput  = z.input<typeof ListOrgsSchema>;
export type CreateOrgInput = z.input<typeof CreateOrgSchema>;
export type SuspendOrgInput    = z.input<typeof SuspendOrgSchema>;
export type ReactivateOrgInput = z.input<typeof ReactivateOrgSchema>;
```

#### `getOrganizationsAction`

**Input:** `ListOrgsInput`
**Output:** `ActionResponse<{ items: OrgListItem[]; metadata: PaginationMeta }>`

```typescript
export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  isInternal: boolean;
  createdAt: string;
  usersCount: number;       // COUNT(profiles) onde org_id = id
  subscription: {
    id: string;
    status: string;
    planName: string;
    planId: string;
    periodStart: string;
    periodEnd: string | null;
  } | null;
}
```

**Query strategy:**
1. Zod parse → `requirePlatformAdmin()` (qualquer role)
2. Supabase client → `organizations` com policy `platform_admins_select_all_orgs`
3. Filtros: `is_active` (eq), `name ILIKE %search%` ou slug exact, ordenar por `sortBy`
4. Paginação: `.range(from, to)` com `{ count: 'exact' }`
5. Para cada org no resultado: JOIN com `subscriptions` (status IN vigente + expired) + `plans` (nome) — uma query com `.in('organization_id', orgIds)` para buscar todas subscriptions + plans em paralelo, depois mapear no TypeScript
6. COUNT de users: subquery separada `profiles.select('organization_id', { count: 'exact' }).in('organization_id', orgIds)` agrupado no TypeScript
7. Montar `OrgListItem[]` e retornar com metadata

> **Performance:** para 1.000 orgs, a paginação limita a 25 items por página; os JOINs são em 25 org_ids via `.in()`, não N+1. Índice `created_at DESC` garante sort. `name ILIKE` usa o GIN trigram index.

#### `getOrganizationDetailAction`

**Input:** `id: string` (uuid)
**Output:** `ActionResponse<OrgDetail>`

```typescript
export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  isInternal: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  usersCount: number;
  lastActivityAt: string | null;  // best-effort: MAX(updated_at) de leads+profiles
  subscription: {
    id: string;
    status: string;
    planId: string;
    planName: string;
    periodStart: string;
    periodEnd: string | null;
    metadata: Record<string, unknown>;
    maxUsers: number | null;
    maxLeads: number | null;
    maxProducts: number | null;
    maxPipelines: number | null;
    maxActiveIntegrations: number | null;
    maxStorageMb: number | null;
    allowAiFeatures: boolean;
  } | null;
  recentAuditLog: AuditLogEntry[];  // últimas 10 entradas filtradas por target_organization_id
}

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
}
```

**Business Logic:**
1. Zod UUID parse → `requirePlatformAdmin()` (qualquer role)
2. SELECT org → se não encontrado: `success: false, error: 'Organização não encontrada.'`
3. `get_current_subscription(p_org_id)` via RPC existente → subscription + plano
4. COUNT profiles por org_id
5. MAX `updated_at` de `leads` + `profiles` como `last_activity_at` (two separate queries, pick max)
6. SELECT `audit_log` WHERE `target_organization_id = id` ORDER BY `occurred_at DESC` LIMIT 10
7. Montar `OrgDetail` e retornar

#### `createOrganizationAction`

**Input:** `CreateOrgInput`
**Output:** `ActionResponse<{ id: string; signupLink: string }>`

**Business Logic:**
1. Zod parse → `requirePlatformAdminRole(['owner'])`
2. Chamar `supabase.rpc('admin_create_organization', { p_name, p_slug, p_plan_id, p_first_admin_email, p_trial_days, p_ip_address, p_user_agent })`
3. Em caso de erro: mapear via `RPC_ERROR_MESSAGES`
4. Buscar `invitations.token` da org recém-criada (via SELECT WHERE `organization_id = result` AND `email = firstAdminEmail`)
5. Montar `signupLink = \`${process.env.NEXT_PUBLIC_APP_URL}/aceitar-convite?token=${token}\`` 
6. `revalidatePath('/admin/organizations')`
7. Retornar `{ success: true, data: { id, signupLink } }`

#### `suspendOrganizationAction`

**Input:** `SuspendOrgInput`
**Output:** `ActionResponse<{ ok: true }>`

**Business Logic:**
1. Zod parse → `requirePlatformAdminRole(['owner'])`
2. Buscar org para verificar `slug === slugConfirmation` (defesa de UX antes de chamar RPC):
   ```typescript
   const org = await supabase.from('organizations').select('slug').eq('id', id).single();
   if (org.data?.slug !== slugConfirmation) {
     return { success: false, error: 'Slug de confirmação não confere.' };
   }
   ```
3. Chamar `supabase.rpc('admin_suspend_organization', { p_org_id: id, p_reason: reason, p_ip_address, p_user_agent })`
4. Mapear erros via `RPC_ERROR_MESSAGES`
5. `revalidatePath('/admin/organizations')` + `revalidatePath(\`/admin/organizations/${id}\`)`
6. `return { success: true, data: { ok: true } }`

#### `reactivateOrganizationAction`

**Input:** `ReactivateOrgInput`
**Output:** `ActionResponse<{ ok: true }>`

**Business Logic:** idêntica a suspend, mas chama `admin_reactivate_organization`.

---

## 4. External API Integration

Não aplicável — sem integração com API externa nesta sprint.

---

## 5. Componentes de UI

Todos os componentes usam tokens semânticos do design system. Referência normativa em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). **Antes de criar qualquer botão inline com classes, verificar se `Button` com variante existente cobre o caso** (APRENDIZADOS 2026-04-21 [AGENT-DRIFT]).

### Component Tree

```
src/app/admin/
├── organizations/
│   ├── page.tsx                          ← Server Component (SSR)
│   │   └── AdminShell (existente)
│   │       └── OrganizationsToolbar.tsx  ← Client (busca/filtros)
│   │           └── OrganizationsList.tsx ← Client (tabela + paginação)
│   │               └── OrganizationsRowActions.tsx ← kebab menu
│   │                   ├── OrgSuspendDialog.tsx
│   │                   └── OrgReactivateDialog.tsx
│   ├── new/
│   │   └── page.tsx                      ← Server Component
│   │       └── OrganizationCreateForm.tsx ← Client
│   └── [id]/
│       └── page.tsx                      ← Server Component
│           └── AdminShell
│               └── OrgDetailView.tsx     ← Client (cards + ações)
│                   ├── OrgSuspendDialog.tsx (reusado)
│                   └── OrgReactivateDialog.tsx (reusado)
src/app/(app)/
└── conta-suspensa/
    └── page.tsx                          ← Server Component (sem AppShell)
src/components/admin/
└── organizations/
    ├── OrganizationsList.tsx
    ├── OrganizationsToolbar.tsx
    ├── OrganizationsRowActions.tsx
    ├── OrganizationCreateForm.tsx
    ├── OrgSuspendDialog.tsx
    ├── OrgReactivateDialog.tsx
    ├── OrganizationStatusBadge.tsx
    └── OrgDetailView.tsx
```

### OrganizationsToolbar

**File:** `src/components/admin/organizations/OrganizationsToolbar.tsx`

```typescript
interface Props {
  canCreate: boolean;  // true apenas se adminRole === 'owner'
  plans: { id: string; name: string }[];
}
```

**Elementos:** `Input` (busca — debounced 300ms via `useTransition` + `router.replace`), `Select` (plano), `Select` (status subscription), botão toggle "ativas/suspensas/todas", `Button` "Nova organization" (visível se `canCreate`).

### OrganizationsList

**File:** `src/components/admin/organizations/OrganizationsList.tsx`

```typescript
interface Props {
  items: OrgListItem[];
  metadata: PaginationMeta;
  adminRole: PlatformAdminRole;
}
```

**Tabela:** colunas: Nome (link para `/admin/organizations/[id]`), Slug, Plano, Status sub (badge), Ativa/Suspensa (badge), Criada em, Usuários, Ações (kebab).
**Linha da org interna:** badge `Shield` + "Interna"; sem ações destrutivas no menu.
**Empty state:** "Nenhuma organização encontrada. Ajuste os filtros ou crie uma nova."
**Paginação:** padrão de `LeadsList.tsx` (chevrons + páginas numeradas).

**Tokens semânticos:**
- Tabela: `bg-surface-sunken` (header), `divide-y divide-border-subtle` (rows), `hover:bg-surface-sunken/80`
- Badge ativa: `bg-feedback-success-bg text-feedback-success-fg`
- Badge suspensa: `bg-feedback-error-bg text-feedback-error-fg`
- Badge trial: `bg-feedback-warning-bg text-feedback-warning-fg`

### OrganizationStatusBadge

Mapeia `subscriptions.status` → variante semântica:

| status | tokens |
|---|---|
| `trial` | `bg-feedback-warning-bg text-feedback-warning-fg` |
| `ativa` | `bg-feedback-success-bg text-feedback-success-fg` |
| `past_due` | `bg-feedback-error-bg text-feedback-error-fg` |
| `trial_expired` | `bg-surface-sunken text-text-muted` |
| `cancelada` | `bg-surface-sunken text-text-muted` |
| `suspensa` | `bg-feedback-error-bg text-feedback-error-fg` (border vermelho) |

### OrgSuspendDialog

```typescript
interface Props {
  orgId: string;
  orgSlug: string;
  orgName: string;
  onSuccess: () => void;
}
```

**Fluxo:** Dialog → `<p>Para confirmar, digite o slug da organização:</p>` → `Input` (slugConfirmation) → `Textarea` (reason, min 5 chars) → `Button variant="danger"` "Suspender" (desabilitado até `slugConfirmation === orgSlug`). Submit chama `suspendOrganizationAction`. Toast de sucesso ou erro inline.

### OrgReactivateDialog

Idêntica a OrgSuspendDialog mas sem campo `reason` e com `Button variant="primary"` "Reativar".

### OrganizationCreateForm

```typescript
interface Props {
  plans: { id: string; name: string; isPublic: boolean }[];
}
```

**Campos:** nome, slug (auto-preenchido via `slugifyName(name)` no `onChange`, editável), plano (Select — somente planos `is_archived=false`, incluindo não-públicos para admin), e-mail do primeiro admin, dias de trial (default 14, input numérico). Validação: `react-hook-form` + `zodResolver(CreateOrgSchema)`. Submit → `createOrganizationAction`. Após sucesso: `router.push(\`/admin/organizations/${id}\`)` + `toast` com `signupLink` copiável.

### conta-suspensa page (customer app)

**File:** `src/app/(app)/conta-suspensa/page.tsx`

```typescript
// Server Component, sem AppShell
export default async function ContaSuspensaPage() {
  // Não chama getSessionContext — usuário pode não ter sessão válida
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 text-center">
      {/* ícone ShieldOff (Lucide) */}
      <h1>Sua conta foi suspensa</h1>
      <p>Para mais informações, entre em contato com o suporte Axon.</p>
      {/* Botão "Sair" → action de signOut */}
    </div>
  );
}
```

Layout: fundo `bg-surface-base`, sem sidebar, sem topbar.

### Customer Middleware Update

**File:** `src/middleware.ts` — branch adicional após autenticação do usuário customer:

```typescript
// Após getUser() bem-sucedido, para rotas customer (não admin):
const orgId = session?.user?.app_metadata?.organization_id
  ?? user?.user_metadata?.organization_id;

if (orgId && !request.nextUrl.pathname.startsWith('/admin')
  && !request.nextUrl.pathname.startsWith('/conta-suspensa')
  && !request.nextUrl.pathname.startsWith('/login')) {

  const { data: org } = await supabase
    .from('organizations')
    .select('is_active')
    .eq('id', orgId)
    .maybeSingle();

  if (org && org.is_active === false) {
    return NextResponse.redirect(new URL('/conta-suspensa', request.url));
  }
}
```

> **Custo:** 1 query extra por request customer. Aceitável no MVP (orgs suspensos são exceção, não regra). Se escalar, substituir por claim JWT `org_is_active` via Custom Access Token Hook (Sprint futuro).

### AdminSidebar update

Adicionar em `src/components/admin/AdminSidebar.tsx`:
```typescript
{ href: '/admin/organizations', icon: Building2, label: 'Organizations' }
```

---

## 6. Edge Cases

- [ ] **Listagem vazia** (0 orgs ou filtro sem resultado): empty state "Nenhuma organização encontrada".
- [ ] **Org interna na listagem**: visível mas com badge "Interna" + sem ações destrutivas no menu (verificado por `isInternal` prop).
- [ ] **Slug duplicado no form**: validação Zod client-side + RPC retorna `slug_taken` → inline error no campo slug.
- [ ] **Plano arquivado entre abrir form e submit**: RPC retorna `invalid_plan` → mensagem "esse plano não está mais disponível".
- [ ] **SlugConfirmation errada no dialog de suspensão**: botão permanece desabilitado; Server Action também valida antes de chamar RPC.
- [ ] **Reason vazia/curta no dialog de suspensão**: `zodResolver` bloqueia submit client-side; RPC bloqueia server-side como segunda camada.
- [ ] **G-07 — suspender org interna via Server Action direta** (sem UI): `requirePlatformAdminRole(['owner'])` passa (owner válido), mas `slugConfirmation` diverge do slug `'axon'`... ou o admin digita `'axon'` → Server Action envia para RPC → RPC bloqueia com `internal_org_protected`. Nenhum caminho permite suspender.
- [ ] **Org já suspensa — suspender novamente**: RPC retorna `org_not_active` → mensagem "Organização já está suspensa".
- [ ] **Org ativa — reativar**: RPC retorna `org_not_suspended` → mensagem "Organização não está suspensa".
- [ ] **Customer user de org suspensa — acesso direto à URL**: middleware detecta `is_active=false` → redirect para `/conta-suspensa`.
- [ ] **Customer user de org suspensa — query à API**: RLS `is_calling_org_active()` retorna false → empty result ou error de policy.
- [ ] **Org interna AxonAI (`is_internal=true`) — não suspensa**: `is_calling_org_active()` retorna `true` → acesso normal ao customer app. Edson continua usando o dogfood.
- [ ] **Suspender e reativar em rápida sucessão (race)**: `SELECT … FOR UPDATE` serializa; audit registra ambas as ações com timestamps.
- [ ] **Role `support` tenta criar org via form**: `requirePlatformAdminRole(['owner'])` retorna `notFound()` — guard server-side antes de renderizar `/admin/organizations/new`.
- [ ] **Role `billing` tenta suspender via kebab menu**: botão "Suspender" é `hidden` quando `adminRole !== 'owner'` — verificado via prop.
- [ ] **`signupLink` expirado** (mais de 7 dias): `invitations.expires_at` passa; customer vê erro ao acessar o link. Fora do escopo desta sprint — Sprint 11 trata CRUD de convites.
- [ ] **`pg_trgm` não instalada** (edge case de rollback): busca por nome falha com error de índice. Migration inclui `CREATE EXTENSION IF NOT EXISTS pg_trgm` antes de criar o índice GIN.
- [ ] **Paginação além do total**: `page > totalPages` → retornar última página (ou empty com `total=0`).
- [ ] **NEXT_PUBLIC_APP_URL não configurada**: `signupLink` não pega a URL correta. Documentar como variável obrigatória no `.env.example`.

---

## 7. Acceptance Criteria (BINARY)

### Database

- [ ] `ALTER TABLE organizations DROP COLUMN IF EXISTS plan` executado sem erro; `SELECT column_name FROM information_schema.columns WHERE table_name='organizations' AND column_name='plan'` retorna 0 linhas.
- [ ] `SELECT * FROM pg_extension WHERE extname = 'pg_trgm'` retorna 1 linha (extensão instalada).
- [ ] Índice `idx_organizations_created_at` e `idx_organizations_name_trgm` existem em `pg_indexes`.
- [ ] `is_calling_org_active()` retorna `true` para org ativa e `false` para `is_active=false`; verificar com:
  ```sql
  -- Com JWT da org 'pessoal' (is_active=true) → deve retornar true
  -- Com JWT de org suspensa artificialmente → deve retornar false
  ```
- [ ] 4 policies de leitura admin criadas (verificar via `pg_policies`).
- [ ] 41 policies customer contêm `is_calling_org_active` em `qual` ou `with_check`:
  ```sql
  SELECT count(*) FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN ('categories','funnels','funnel_stages','invitations','lead_origins','lead_tags','leads','loss_reasons','product_documents','product_images','products','profiles','tags','whatsapp_groups')
    AND (qual LIKE '%is_calling_org_active%' OR with_check LIKE '%is_calling_org_active%');
  -- Deve retornar ≥ 40 (a policy INSERT de profiles tem WITH CHECK (false) — não alterada)
  ```
- [ ] `has_function_privilege('anon', 'admin_create_organization(text,text,uuid,text,integer,text,text)', 'execute')` = `false`.
- [ ] `has_function_privilege('anon', 'admin_suspend_organization(uuid,text,text,text)', 'execute')` = `false`.
- [ ] `has_function_privilege('anon', 'admin_reactivate_organization(uuid,text,text)', 'execute')` = `false`.
- [ ] G-07: `SELECT admin_suspend_organization('c6d506ca-08f0-4714-b330-6eb1a11f679b', 'teste', NULL, NULL)` falha com mensagem `internal_org_protected`.
- [ ] INV-1: tentar inserir segunda subscription `ativa` para a org `pessoal` viola `subscriptions_one_vigente_per_org`.
- [ ] Dry-run `supabase db push --dry-run` passa sem erro (GATE 1).

### Backend

- [ ] Todas as 5 Server Actions em `src/lib/actions/admin/organizations.ts` validam input com Zod antes de tocar Supabase.
- [ ] Todas as 5 Server Actions chamam `requirePlatformAdmin()` ou `requirePlatformAdminRole()`.
- [ ] Mutations retornam `revalidatePath` após sucesso.
- [ ] Mapeamento de `RPC_ERROR_MESSAGES` cobre os 10 códigos de erro das 3 RPCs.
- [ ] `slugifyName` exportada e determinística (dado o mesmo input, sempre produz o mesmo output).
- [ ] `suspendOrganizationAction` verifica `slugConfirmation === org.slug` antes de chamar a RPC.
- [ ] `createOrganizationAction` retorna `signupLink` construído com `invitations.token`.
- [ ] Middleware customer redireciona para `/conta-suspensa` quando `is_active=false`.
- [ ] `npm run build` passa sem erros (GATE 2).
- [ ] `npm run lint` passa sem novos warnings (GATE 2).
- [ ] `npm run build:check` (import isolation) continua passando — admin actions não importados em `(app)/`.

### Integration Tests (GATE 4.5)

- [ ] `tests/integration/admin-organizations.test.ts` existe e cobre todas as 5 Server Actions exportadas.
- [ ] Testes de happy path, auth fail, Zod fail passam (0 failed, 0 skipped).
- [ ] Teste G-07 explícito: `suspendOrganizationAction({ id: 'c6d506ca-...', slugConfirmation: 'axon', reason: 'teste de proteção interna' })` → `success: false` com mensagem de proteção.
- [ ] `npm test -- --run tests/integration/` sai com exit 0.

### Frontend (design system compliance)

- [ ] **Guardian aprova** (GATE 4): código passa em todas as checagens de `agents/quality/guardian.md` § 1a + § 1b.
- [ ] Nenhum literal de cor hex, `bg-blue-500`, valor arbitrário Tailwind em nenhum componente novo.
- [ ] Todos os botões usam `<Button>` com variante existente (sem `<button className="...bg-action-danger...">` inline).
- [ ] Dark mode funcional em todas as telas novas (verificado com `data-theme="dark"` togglado).
- [ ] Formulários têm estados de loading (disabled + spinner no submit button).
- [ ] Formulários têm estados de erro (mensagens inline por campo).
- [ ] Dialogs de confirmação: botão submit desabilitado até preenchimento correto do slug.
- [ ] `/conta-suspensa` renderiza sem AppShell; tem botão "Sair" funcional.
- [ ] Sidebar admin tem item "Organizations" com ícone `Building2`.

### GATE 5 (design estático)

- [ ] `node scripts/verify-design.mjs --changed` sai com `✅ 0 violações`.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)

1. Confirmar nomes exatos de todas as 41 policies via `pg_policies` antes de reescrever.
2. Criar migration com header de rollback.
3. Instalar `pg_trgm`, dropar coluna `plan`, criar `is_calling_org_active()`.
4. Criar índices.
5. Adicionar 4 policies de leitura admin.
6. Reescrever 41 policies customer com `AND public.is_calling_org_active()` (textualmente, não via DO block).
7. Criar as 3 RPCs com REVOKE/GRANT.
8. Rodar `supabase db push --dry-run` (GATE 1).
9. Atualizar `docs/conventions/audit.md` com 3 novas ações.
10. Atualizar `docs/PROJECT_CONTEXT.md`.

### Phase 2: Server Actions (`@backend`)

1. Criar `src/lib/actions/admin/organizations.schemas.ts` com todos os schemas Zod + `slugifyName`.
2. Criar `src/lib/actions/admin/organizations.ts` com as 5 actions.
3. Atualizar `src/middleware.ts` com branch de org suspensa.
4. Verificar que `NEXT_PUBLIC_APP_URL` está em `.env.example`.

### Phase 3: Integration Tests (`@qa-integration`)

1. Criar `tests/integration/admin-organizations.test.ts`.
2. Cobrir 5 actions × (happy + auth fail + Zod fail + regra de negócio específica).
3. Rodar `npm test -- --run tests/integration/` → exit 0, 0 skips.

### Phase 4: Frontend (`@frontend+`)

1. Atualizar `AdminSidebar.tsx` com item "Organizations".
2. Criar componentes em `src/components/admin/organizations/`.
3. Criar pages: `organizations/page.tsx`, `organizations/new/page.tsx`, `organizations/[id]/page.tsx`.
4. Criar `src/app/(app)/conta-suspensa/page.tsx`.

### Phase 5: Review (`@guardian`)

1. Validar design system compliance (GATE 4).
2. Validar segurança (nenhum `any`, nenhuma exposição de dados admin no customer bundle).
3. Checar import isolation via `npm run build:check`.

### Phase 6: Validation Gates

1. GATE 1: dry-run já rodado na Phase 1.
2. GATE 2: `npm run build` + `npm run lint` após Phase 4.
3. GATE 4: Guardian aprova.
4. GATE 4.5: integration tests passam.
5. GATE 5: `verify-design.mjs --changed` = 0 violações.

---

## 9. Risks & Mitigations

### Risk 1: Política `Profiles INSERT is trigger-only` quebrada acidentalmente
**Impact:** Alto — novos usuários não conseguem fazer signup
**Probability:** Médio — reescrever 41 policies manualmente tem chance de englobar essa policy
**Mitigation:** `@db-admin` deve excluir explicitamente a policy `Profiles INSERT is trigger-only` do update de `is_calling_org_active()` (ela já nega tudo com `WITH CHECK (false)`; adicionar `AND is_calling_org_active()` é redundante e inócuo, mas melhor evitar toque desnecessário).

### Risk 2: `pg_trgm` causa bloqueio de lock durante criação do índice GIN
**Impact:** Médio — índice GIN em texto demora segundos em tabelas grandes
**Probability:** Baixo — `organizations` tem apenas 2 linhas em prod hoje
**Mitigation:** Usar `CREATE INDEX CONCURRENTLY` se o banco estiver em prod e com carga real. No staging/dev, `CREATE INDEX` padrão é suficiente. Documentar no header da migration.

### Risk 3: `NEXT_PUBLIC_APP_URL` não configurada → `signupLink` incorreto
**Impact:** Médio — link de convite não funciona
**Probability:** Alto (env var nova, pode estar faltando)
**Mitigation:** `@backend` adiciona ao `.env.example` + valida no `createOrganizationAction` com fallback explícito para `process.env.NEXT_PUBLIC_APP_URL ?? ''` e log de aviso se ausente.

### Risk 4: Race condition em suspensão concorrente de dois admins
**Impact:** Baixo — no pior caso, duas linhas de audit para a mesma ação
**Probability:** Baixo — equipe admin pequena
**Mitigation:** `SELECT … FOR UPDATE` nas RPCs serializa. Audit registra ambas as tentativas.

### Risk 5: Middleware customer adiciona latência perceptível
**Impact:** Baixo — 1 query extra por request
**Probability:** Baixo — query simples com índice (`organizations.id` é PK)
**Mitigation:** Executar apenas quando há `organization_id` no JWT e rota não é `/conta-suspensa|/login|/logout`. Se futuramente escalar, substituir por JWT claim dedicado `org_is_active`.

---

## 10. Dependencies

### Internas (todas satisfeitas)

- [x] `audit_write` (Sprint 03) — usada dentro das 3 RPCs
- [x] `requirePlatformAdmin()` / `requirePlatformAdminRole()` (Sprint 02) — usada nas Server Actions
- [x] `get_current_subscription` RPC (Sprint 01) — usada no detalhe de org
- [x] `is_platform_admin` RPC (Sprint 02) — base de `requirePlatformAdmin`
- [x] `AdminShell` + layout admin (Sprint 04) — envolvem as novas pages
- [x] Planos seedados (Sprint 01): `free`, `basic`, `premium`, `internal`
- [x] `invitations` e `signup_intents` tabelas existentes (pré-Sprint 01)

### Externas

- Nenhuma API externa nesta sprint.
- Variável de ambiente: `NEXT_PUBLIC_APP_URL` (nova — adicionar ao `.env.example`).

---

## 11. Rollback Plan

Se issues forem encontrados após deploy:

1. **Imediato:** `git revert <commit-hash>` — reverte código TypeScript e pages.
2. **Database:**
   - Se a migration foi aplicada: executar o script de rollback documentado no header da migration (restaura 41 policies originais, dropa RPCs, dropa `is_calling_org_active`, dropa índices, re-adiciona coluna `organizations.plan` como nullable).
   - Se a coluna `organizations.plan` foi dropada e há dependências: confirmar com `Grep` que nenhum código ainda a usa (Sprint 01 migrou todos os callers).
3. **Cache:** `revalidatePath` é automático; sem cache adicional a limpar.
4. **Verificação pós-rollback:** confirmar que customer app retorna a funcionar para org `pessoal` (leads carregam, login funciona).

---

## Approval

**Created by:** @spec-writer (Tech Lead — Opção 2, 2026-04-25)
**Reviewed by:** @sanity-checker (pendente)
**Approved by:** — (pendente usuário)
**Date:** 2026-04-25
