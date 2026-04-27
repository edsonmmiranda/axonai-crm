-- Migration: Admin 07 — Hard-enforcement de limites + plan_grants
-- Created: 2026-04-26
-- Sprint: admin_07
-- Schema Source: REAL DATABASE (introspectado via MCP em 2026-04-26)
-- PRD: prds/prd_admin_07_limits_enforcement_grants.md
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Cria public.plan_grants (FORCE RLS, append-only via RPCs SECURITY DEFINER)
--   2. RPC enforce_limit(org_id, limit_key, delta) — chamada por Server Actions customer
--      antes de cada criação de recurso contável. Lê plano vigente + grants ativos
--      e raise plan_limit_exceeded (P0001) se ultrapassaria. Sem audit (leitura+raise).
--   3. RPC admin_grant_limit — owner Axon cria override. Audit transacional.
--   4. RPC admin_revoke_grant — owner Axon revoga override. Audit transacional.
--
-- INVARIANTES MANTIDAS:
--   INV-1 (subscription única vigente)  — não tocada (não modifica subscriptions)
--   INV-6 (audit transacional)          — admin_grant_limit / admin_revoke_grant gravam
--                                          audit_log no mesmo bloco PL/pgSQL
--   T-21 (hard-enforcement)             — entregue
--
-- DECISÕES FIXADAS:
--   - Grant ativo SUBSTITUI o plano (não soma). Quando há múltiplos grants ativos
--     para (org, limit_key), o mais recente (created_at DESC) ganha.
--   - Race condition: aceito overshoot máximo de 1. enforce_limit lê snapshot
--     consistente dentro de uma query mas não serializa entre queries concorrentes.
--     Próxima tentativa pós-overshoot é rejeitada (auto-corrige).
--   - storage_mb: SUM direto em product_images/product_documents (organization_id
--     existe como coluna direta — introspectado via MCP, NÃO via migrations).
--   - enforce_limit é GRANT EXECUTE TO authenticated (não SECURITY DEFINER do
--     ponto de vista de auth — é DEFINER apenas para BYPASS RLS de plan_grants).
--
-- IDEMPOTÊNCIA:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS,
--   CREATE OR REPLACE FUNCTION. Re-execução é segura.
--
-- ROLLBACK (executar manualmente em staging primeiro):
--   DROP FUNCTION IF EXISTS public.admin_revoke_grant(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.admin_grant_limit(uuid, text, int, text, timestamptz, text, text);
--   DROP FUNCTION IF EXISTS public.enforce_limit(uuid, text, int);
--   DROP TABLE IF EXISTS public.plan_grants CASCADE;
--   -- ATENÇÃO: histórico de grants é perdido. audit_log permanece (target_id aponta para
--   -- registros que já não existem, mas histórico é preservado por design).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela: public.plan_grants
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_grants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  limit_key       text        NOT NULL CHECK (limit_key IN (
                                'users','leads','products','pipelines','active_integrations','storage_mb'
                              )),
  value_override  int         NULL CHECK (value_override IS NULL OR value_override >= 0),
  reason          text        NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  expires_at      timestamptz NULL,
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revoked_at      timestamptz NULL,
  revoked_by      uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_grants FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPCs SECURITY DEFINER (mesmo padrão de audit_log do Sprint 03).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.plan_grants FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices
-- ─────────────────────────────────────────────────────────────────────────────

-- Caminho quente do enforce_limit: grant ativo mais recente por (org, limit_key).
CREATE INDEX IF NOT EXISTS idx_plan_grants_active
  ON public.plan_grants (organization_id, limit_key, created_at DESC)
  WHERE revoked_at IS NULL;

-- Listagem na UI admin: todos os estados, ordenados.
CREATE INDEX IF NOT EXISTS idx_plan_grants_org_created
  ON public.plan_grants (organization_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Policy SELECT — platform admins ativos
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "platform_admins_can_read_plan_grants" ON public.plan_grants;
CREATE POLICY "platform_admins_can_read_plan_grants"
  ON public.plan_grants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC enforce_limit — chamada de Server Actions customer authenticated.
--    SECURITY DEFINER é necessário para bypassar RLS em plan_grants
--    (customer não tem SELECT direto). Não há autorização de role: caller precisa
--    pertencer à p_org_id (RLS das tabelas customer já garante isso antes da
--    mutation principal). RPC é defesa contra estouro, não contra IDOR.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_limit(
  p_org_id     uuid,
  p_limit_key  text,
  p_delta      int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_limit       int;
  v_grant_value      int;
  v_grant_found      boolean := false;
  v_grant_unlimited  boolean := false;
  v_effective_limit  int;
  v_current_usage    int;
BEGIN
  -- Validação básica do delta (defensivo — Server Action passa sempre >= 1)
  IF p_delta < 0 THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Plano vigente (status IN trial/ativa/past_due — INV-1 garante 1 vigente)
  SELECT
    CASE p_limit_key
      WHEN 'users'                THEN p.max_users
      WHEN 'leads'                THEN p.max_leads
      WHEN 'products'             THEN p.max_products
      WHEN 'pipelines'            THEN p.max_pipelines
      WHEN 'active_integrations'  THEN p.max_active_integrations
      WHEN 'storage_mb'           THEN p.max_storage_mb
      ELSE NULL
    END
  INTO v_plan_limit
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
    AND s.status IN ('trial','ativa','past_due')
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_active_subscription'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('limit_key', p_limit_key)::text;
  END IF;

  -- Validação tardia do limit_key (após termos estabelecido subscription)
  IF p_limit_key NOT IN ('users','leads','products','pipelines','active_integrations','storage_mb') THEN
    RAISE EXCEPTION 'invalid_limit_key' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Grant mais recente ativo (substitui o plano, se existir)
  SELECT value_override, true, value_override IS NULL
  INTO v_grant_value, v_grant_found, v_grant_unlimited
  FROM public.plan_grants
  WHERE organization_id = p_org_id
    AND limit_key = p_limit_key
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  -- 3. Limite efetivo
  IF v_grant_found THEN
    IF v_grant_unlimited THEN
      RETURN;  -- grant sem teto
    END IF;
    v_effective_limit := v_grant_value;
  ELSIF v_plan_limit IS NULL THEN
    RETURN;  -- plano sem teto (ex: plano interno)
  ELSE
    v_effective_limit := v_plan_limit;
  END IF;

  -- 4. Consumo atual
  v_current_usage := CASE p_limit_key
    WHEN 'users' THEN
      (SELECT count(*)::int FROM public.profiles WHERE organization_id = p_org_id)
    WHEN 'leads' THEN
      (SELECT count(*)::int FROM public.leads WHERE organization_id = p_org_id)
    WHEN 'products' THEN
      (SELECT count(*)::int FROM public.products WHERE organization_id = p_org_id)
    WHEN 'pipelines' THEN
      (SELECT count(*)::int FROM public.funnels WHERE organization_id = p_org_id)
    WHEN 'active_integrations' THEN
      (SELECT count(*)::int FROM public.whatsapp_groups
        WHERE organization_id = p_org_id AND is_active = true)
    WHEN 'storage_mb' THEN
      ceil(
        (
          COALESCE((SELECT SUM(file_size)::bigint FROM public.product_images
                     WHERE organization_id = p_org_id), 0)
        + COALESCE((SELECT SUM(file_size)::bigint FROM public.product_documents
                     WHERE organization_id = p_org_id), 0)
        )::numeric / 1048576
      )::int
  END;

  -- 5. Decisão
  IF v_current_usage + p_delta > v_effective_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object(
              'limit_key', p_limit_key,
              'limit',     v_effective_limit,
              'current',   v_current_usage,
              'delta',     p_delta
            )::text;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL    ON FUNCTION public.enforce_limit(uuid, text, int) FROM public;
REVOKE EXECUTE ON FUNCTION public.enforce_limit(uuid, text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.enforce_limit(uuid, text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.enforce_limit(uuid, text, int) IS
  'Chamada por Server Actions customer antes de criação de recurso contável. Raise plan_limit_exceeded (P0001) com DETAIL JSON {limit_key, limit, current, delta} se p_delta levaria org acima do limite efetivo (plano vigente, opcionalmente substituído pelo grant ativo mais recente). Sem audit (leitura+raise). Race accepts overshoot of 1.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC admin_grant_limit — owner Axon cria override. Audit transacional.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_grant_limit(
  p_org_id          uuid,
  p_limit_key       text,
  p_value_override  int,
  p_reason          text,
  p_expires_at      timestamptz DEFAULT NULL,
  p_ip_address      text        DEFAULT NULL,
  p_user_agent      text        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_grant_id uuid;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas platform admin owner ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validações inline (Server Action também valida via Zod — defesa em profundidade)
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_limit_key NOT IN ('users','leads','products','pipelines','active_integrations','storage_mb') THEN
    RAISE EXCEPTION 'invalid_limit_key' USING ERRCODE = 'P0001';
  END IF;

  IF p_value_override IS NOT NULL AND p_value_override < 0 THEN
    RAISE EXCEPTION 'invalid_value_override' USING ERRCODE = 'P0001';
  END IF;

  IF length(coalesce(p_reason, '')) < 5 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_expires_at' USING ERRCODE = 'P0001';
  END IF;

  -- Inserir grant
  INSERT INTO public.plan_grants (
    organization_id, limit_key, value_override, reason, expires_at, created_by
  ) VALUES (
    p_org_id, p_limit_key, p_value_override, p_reason, p_expires_at, v_actor_id
  )
  RETURNING id INTO v_grant_id;

  -- Snapshot pós-INSERT para o diff_after do audit
  SELECT to_jsonb(g) INTO v_after FROM public.plan_grants g WHERE id = v_grant_id;

  -- Audit transacional (mesma transação)
  PERFORM public.audit_write(
    'grant.create',
    'plan_grant',
    v_grant_id,
    p_org_id,
    NULL,        -- diff_before
    v_after,     -- diff_after
    jsonb_build_object(
      'limit_key',      p_limit_key,
      'value_override', p_value_override,
      'reason',         p_reason,
      'expires_at',     p_expires_at
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_grant_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_grant_limit(uuid, text, int, text, timestamptz, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_grant_limit(uuid, text, int, text, timestamptz, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_limit(uuid, text, int, text, timestamptz, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_grant_limit(uuid, text, int, text, timestamptz, text, text) IS
  'Cria override de limite para org. Owner-only. Grava audit grant.create na mesma transação. value_override NULL = ilimitado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC admin_revoke_grant — owner Axon revoga override. Audit transacional.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_revoke_grant(
  p_grant_id    uuid,
  p_ip_address  text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_before   jsonb;
  v_after    jsonb;
  v_org_id   uuid;
  v_limit_key text;
BEGIN
  -- Autorização: apenas owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- SELECT FOR UPDATE serializa contra revoke concorrente
  SELECT to_jsonb(g), g.organization_id, g.limit_key
  INTO v_before, v_org_id, v_limit_key
  FROM public.plan_grants g
  WHERE g.id = p_grant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF (v_before ->> 'revoked_at') IS NOT NULL THEN
    RAISE EXCEPTION 'grant_already_revoked' USING ERRCODE = 'P0001';
  END IF;

  -- Marcar como revogado
  UPDATE public.plan_grants
     SET revoked_at = now(),
         revoked_by = v_actor_id
   WHERE id = p_grant_id;

  SELECT to_jsonb(g) INTO v_after FROM public.plan_grants g WHERE id = p_grant_id;

  -- Audit transacional
  PERFORM public.audit_write(
    'grant.revoke',
    'plan_grant',
    p_grant_id,
    v_org_id,
    v_before,
    v_after,
    jsonb_build_object('limit_key', v_limit_key),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_revoke_grant(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_grant(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_grant(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_revoke_grant(uuid, text, text) IS
  'Revoga override de limite. Owner-only. SELECT FOR UPDATE serializa concorrência. Grava audit grant.revoke na mesma transação.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pós-checks (DO blocks — falham loud se algo essencial não foi criado)
-- ─────────────────────────────────────────────────────────────────────────────

DO $check$
BEGIN
  -- plan_grants existe + RLS forçado
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.plan_grants'::regclass
      AND relrowsecurity = true
      AND relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: plan_grants sem FORCE RLS';
  END IF;

  -- 3 RPCs criadas
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('enforce_limit','admin_grant_limit','admin_revoke_grant')) <> 3 THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: nem todas as 3 RPCs foram criadas';
  END IF;

  -- anon não pode executar nenhuma das 3 RPCs
  IF has_function_privilege('anon', 'public.enforce_limit(uuid,text,int)', 'execute') THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: anon tem EXECUTE em enforce_limit';
  END IF;
  IF has_function_privilege('anon', 'public.admin_grant_limit(uuid,text,int,text,timestamptz,text,text)', 'execute') THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: anon tem EXECUTE em admin_grant_limit';
  END IF;
  IF has_function_privilege('anon', 'public.admin_revoke_grant(uuid,text,text)', 'execute') THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: anon tem EXECUTE em admin_revoke_grant';
  END IF;

  -- authenticated pode executar enforce_limit (path quente)
  IF NOT has_function_privilege('authenticated', 'public.enforce_limit(uuid,text,int)', 'execute') THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: authenticated não tem EXECUTE em enforce_limit';
  END IF;

  -- Policy SELECT existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'plan_grants'
      AND policyname = 'platform_admins_can_read_plan_grants'
  ) THEN
    RAISE EXCEPTION 'POST-CHECK FAIL: policy platform_admins_can_read_plan_grants ausente';
  END IF;

  RAISE NOTICE 'admin_07 migration: pós-checks OK';
END
$check$;
