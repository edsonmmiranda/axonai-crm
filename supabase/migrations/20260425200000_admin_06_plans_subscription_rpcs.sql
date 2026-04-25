-- Migration: Admin 06 — RPCs para CRUD de plans e ciclo de vida de subscription
-- Created: 2026-04-25
-- Sprint: admin_06
-- Schema Source: REAL DATABASE
-- PRD: prds/prd_admin_06_plans_subscription_lifecycle.md
--
-- Novas funções (todas SECURITY DEFINER, REVOKE de anon/authenticated):
--   admin_create_plan          — cria plano (owner only)
--   admin_update_plan          — atualiza plano (owner only)
--   admin_archive_plan         — arquiva plano (owner only)
--   admin_delete_plan          — deleta plano se sem subs ativas (owner only, INV-2)
--   admin_change_plan          — troca plano de subscription (owner/billing, SELECT FOR UPDATE)
--   admin_extend_trial         — estende trial (owner/billing, INV-8)
--   admin_cancel_subscription  — cancela subscription (owner/billing)
--   admin_reactivate_subscription — reativa subscription (owner/billing, INV-1)
--   check_and_update_expired_trials — lazy expiry check (service-side)

-- ============================================================
-- 1. admin_create_plan
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_create_plan(
  p_name                  text,
  p_description           text         DEFAULT NULL,
  p_price_monthly_cents   integer      DEFAULT 0,
  p_price_yearly_cents    integer      DEFAULT 0,
  p_features_jsonb        jsonb        DEFAULT '[]',
  p_is_public             boolean      DEFAULT true,
  p_max_users             integer      DEFAULT NULL,
  p_max_leads             integer      DEFAULT NULL,
  p_max_products          integer      DEFAULT NULL,
  p_max_pipelines         integer      DEFAULT NULL,
  p_max_active_integrations integer    DEFAULT NULL,
  p_max_storage_mb        integer      DEFAULT NULL,
  p_allow_ai_features     boolean      DEFAULT false,
  p_ip_address            text         DEFAULT NULL,
  p_user_agent            text         DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_plan_id  uuid;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validação básica de nome
  IF length(trim(p_name)) < 2 OR length(trim(p_name)) > 100 THEN
    RAISE EXCEPTION 'invalid_plan_name' USING ERRCODE = 'P0001';
  END IF;

  -- Inserir plano (unique_violation em name → relança como plan_name_taken)
  BEGIN
    INSERT INTO public.plans (
      name, description, price_monthly_cents, price_yearly_cents,
      features_jsonb, is_public, is_archived,
      max_users, max_leads, max_products, max_pipelines,
      max_active_integrations, max_storage_mb, allow_ai_features
    ) VALUES (
      trim(p_name), p_description, p_price_monthly_cents, p_price_yearly_cents,
      COALESCE(p_features_jsonb, '[]'::jsonb), p_is_public, false,
      p_max_users, p_max_leads, p_max_products, p_max_pipelines,
      p_max_active_integrations, p_max_storage_mb, p_allow_ai_features
    )
    RETURNING id INTO v_plan_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'plan_name_taken' USING ERRCODE = 'P0001';
  END;

  SELECT to_jsonb(p) INTO v_after FROM public.plans p WHERE id = v_plan_id;

  PERFORM public.audit_write(
    'plan.create', 'plan', v_plan_id, NULL,
    NULL, v_after, NULL,
    p_ip_address::inet, p_user_agent
  );

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_plan FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_plan FROM anon, authenticated;

-- ============================================================
-- 2. admin_update_plan
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_plan_id               uuid,
  p_name                  text,
  p_description           text         DEFAULT NULL,
  p_price_monthly_cents   integer      DEFAULT 0,
  p_price_yearly_cents    integer      DEFAULT 0,
  p_features_jsonb        jsonb        DEFAULT '[]',
  p_is_public             boolean      DEFAULT true,
  p_max_users             integer      DEFAULT NULL,
  p_max_leads             integer      DEFAULT NULL,
  p_max_products          integer      DEFAULT NULL,
  p_max_pipelines         integer      DEFAULT NULL,
  p_max_active_integrations integer    DEFAULT NULL,
  p_max_storage_mb        integer      DEFAULT NULL,
  p_allow_ai_features     boolean      DEFAULT false,
  p_ip_address            text         DEFAULT NULL,
  p_user_agent            text         DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_before   jsonb;
  v_after    jsonb;
  v_plan     public.plans;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Buscar plano (lock para update)
  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_plan.is_archived THEN
    RAISE EXCEPTION 'plan_archived' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(v_plan) INTO v_before;

  -- Atualizar (unique_violation em name → plan_name_taken)
  BEGIN
    UPDATE public.plans SET
      name                    = trim(p_name),
      description             = p_description,
      price_monthly_cents     = p_price_monthly_cents,
      price_yearly_cents      = p_price_yearly_cents,
      features_jsonb          = COALESCE(p_features_jsonb, '[]'::jsonb),
      is_public               = p_is_public,
      max_users               = p_max_users,
      max_leads               = p_max_leads,
      max_products            = p_max_products,
      max_pipelines           = p_max_pipelines,
      max_active_integrations = p_max_active_integrations,
      max_storage_mb          = p_max_storage_mb,
      allow_ai_features       = p_allow_ai_features,
      updated_at              = now()
    WHERE id = p_plan_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'plan_name_taken' USING ERRCODE = 'P0001';
  END;

  SELECT to_jsonb(p) INTO v_after FROM public.plans p WHERE id = p_plan_id;

  PERFORM public.audit_write(
    'plan.update', 'plan', p_plan_id, NULL,
    v_before, v_after, NULL,
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_plan FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_plan FROM anon, authenticated;

-- ============================================================
-- 3. admin_archive_plan
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_archive_plan(
  p_plan_id    uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) INTO v_before FROM public.plans p WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF (v_before->>'is_archived')::boolean THEN
    RAISE EXCEPTION 'plan_archived' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.plans
  SET is_archived = true, is_public = false, updated_at = now()
  WHERE id = p_plan_id;

  SELECT to_jsonb(p) INTO v_after FROM public.plans p WHERE id = p_plan_id;

  PERFORM public.audit_write(
    'plan.archive', 'plan', p_plan_id, NULL,
    v_before, v_after, NULL,
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_plan FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_archive_plan FROM anon, authenticated;

-- ============================================================
-- 4. admin_delete_plan  (INV-2: falha se há subs ativas)
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_delete_plan(
  p_plan_id    uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_before   jsonb;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) INTO v_before FROM public.plans p WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- INV-2: plano em uso não pode ser deletado
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE plan_id = p_plan_id
      AND status IN ('trial', 'ativa', 'past_due')
  ) THEN
    RAISE EXCEPTION 'plan_in_use' USING ERRCODE = 'P0001';
  END IF;

  -- Audit antes do delete (target deixa de existir)
  PERFORM public.audit_write(
    'plan.delete', 'plan', p_plan_id, NULL,
    v_before, NULL, NULL,
    p_ip_address::inet, p_user_agent
  );

  DELETE FROM public.plans WHERE id = p_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_plan FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_plan FROM anon, authenticated;

-- ============================================================
-- 5. admin_change_plan  (SELECT FOR UPDATE, validação downgrade)
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_change_plan(
  p_subscription_id uuid,
  p_new_plan_id     uuid,
  p_effective_at    timestamptz  DEFAULT now(),
  p_ip_address      text         DEFAULT NULL,
  p_user_agent      text         DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id      uuid := auth.uid();
  v_sub           public.subscriptions;
  v_new_plan      public.plans;
  v_users_count   integer;
  v_leads_count   integer;
  v_products_count integer;
  v_pipelines_count integer;
  v_before        jsonb;
  v_after         jsonb;
BEGIN
  -- Autorização: owner ou billing
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role IN ('owner', 'billing')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Lock da subscription para evitar race condition
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status NOT IN ('trial', 'ativa', 'past_due') THEN
    RAISE EXCEPTION 'subscription_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- Buscar novo plano
  SELECT * INTO v_new_plan FROM public.plans WHERE id = p_new_plan_id;
  IF NOT FOUND OR v_new_plan.is_archived THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Validação de downgrade: verificar apenas os limites que vão diminuir
  IF v_new_plan.max_users IS NOT NULL THEN
    SELECT COUNT(*) INTO v_users_count
    FROM public.profiles
    WHERE organization_id = v_sub.organization_id AND is_active = true;
    IF v_users_count > v_new_plan.max_users THEN
      RAISE EXCEPTION 'downgrade_users_exceed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_new_plan.max_leads IS NOT NULL THEN
    SELECT COUNT(*) INTO v_leads_count
    FROM public.leads
    WHERE organization_id = v_sub.organization_id;
    IF v_leads_count > v_new_plan.max_leads THEN
      RAISE EXCEPTION 'downgrade_leads_exceed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_new_plan.max_products IS NOT NULL THEN
    SELECT COUNT(*) INTO v_products_count
    FROM public.products
    WHERE organization_id = v_sub.organization_id;
    IF v_products_count > v_new_plan.max_products THEN
      RAISE EXCEPTION 'downgrade_products_exceed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_new_plan.max_pipelines IS NOT NULL THEN
    SELECT COUNT(*) INTO v_pipelines_count
    FROM public.funnels
    WHERE organization_id = v_sub.organization_id;
    IF v_pipelines_count > v_new_plan.max_pipelines THEN
      RAISE EXCEPTION 'downgrade_pipelines_exceed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_before := to_jsonb(v_sub);

  -- Atualizar subscription
  UPDATE public.subscriptions
  SET
    plan_id      = p_new_plan_id,
    period_start = COALESCE(p_effective_at, now()),
    updated_at   = now()
  WHERE id = p_subscription_id;

  SELECT to_jsonb(s) INTO v_after FROM public.subscriptions s WHERE id = p_subscription_id;

  PERFORM public.audit_write(
    'subscription.change_plan', 'subscription',
    p_subscription_id, v_sub.organization_id,
    jsonb_build_object(
      'plan_id', v_sub.plan_id,
      'max_users', (SELECT max_users FROM public.plans WHERE id = v_sub.plan_id),
      'max_leads', (SELECT max_leads FROM public.plans WHERE id = v_sub.plan_id)
    ),
    jsonb_build_object(
      'plan_id', p_new_plan_id,
      'max_users', v_new_plan.max_users,
      'max_leads', v_new_plan.max_leads
    ),
    jsonb_build_object('effective_at', p_effective_at),
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_plan FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_change_plan FROM anon, authenticated;

-- ============================================================
-- 6. admin_extend_trial  (INV-8: só se status = 'trial')
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_extend_trial(
  p_subscription_id uuid,
  p_days            integer,
  p_ip_address      text    DEFAULT NULL,
  p_user_agent      text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sub      public.subscriptions;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: owner ou billing
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role IN ('owner', 'billing')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'invalid_trial_days' USING ERRCODE = 'P0001';
  END IF;

  -- Lock da subscription
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- INV-8: extensão só é possível enquanto ainda em trial
  IF v_sub.status <> 'trial' THEN
    RAISE EXCEPTION 'not_in_trial' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_sub);

  -- Acumular dias no metadata + estender period_end
  UPDATE public.subscriptions
  SET
    period_end = COALESCE(period_end, now()) + (p_days || ' days')::interval,
    metadata   = jsonb_set(
                   metadata,
                   '{trial_days_override}',
                   to_jsonb(
                     COALESCE((metadata->>'trial_days_override')::integer, 0) + p_days
                   )
                 ),
    updated_at = now()
  WHERE id = p_subscription_id;

  SELECT to_jsonb(s) INTO v_after FROM public.subscriptions s WHERE id = p_subscription_id;

  PERFORM public.audit_write(
    'subscription.extend_trial', 'subscription',
    p_subscription_id, v_sub.organization_id,
    v_before, v_after,
    jsonb_build_object('days_added', p_days),
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_extend_trial FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_extend_trial FROM anon, authenticated;

-- ============================================================
-- 7. admin_cancel_subscription
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_effective_at    timestamptz DEFAULT now(),
  p_ip_address      text        DEFAULT NULL,
  p_user_agent      text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sub      public.subscriptions;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: owner ou billing
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role IN ('owner', 'billing')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Lock da subscription
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status = 'cancelada' THEN
    RAISE EXCEPTION 'already_cancelled' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_sub);

  UPDATE public.subscriptions
  SET
    status     = 'cancelada',
    period_end = COALESCE(p_effective_at, now()),
    updated_at = now()
  WHERE id = p_subscription_id;

  SELECT to_jsonb(s) INTO v_after FROM public.subscriptions s WHERE id = p_subscription_id;

  PERFORM public.audit_write(
    'subscription.cancel', 'subscription',
    p_subscription_id, v_sub.organization_id,
    v_before, v_after,
    jsonb_build_object('effective_at', p_effective_at),
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_subscription FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_subscription FROM anon, authenticated;

-- ============================================================
-- 8. admin_reactivate_subscription  (INV-1: checa unicidade)
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_reactivate_subscription(
  p_subscription_id uuid,
  p_new_plan_id     uuid,
  p_ip_address      text DEFAULT NULL,
  p_user_agent      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sub      public.subscriptions;
  v_plan_ok  boolean;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: owner ou billing
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role IN ('owner', 'billing')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Lock da subscription
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Só reativa cancelada ou trial_expired
  IF v_sub.status NOT IN ('cancelada', 'trial_expired') THEN
    RAISE EXCEPTION 'not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  -- INV-1: verificar que org não tem outra subscription ativa
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE organization_id = v_sub.organization_id
      AND status IN ('trial', 'ativa', 'past_due')
      AND id <> p_subscription_id
  ) THEN
    RAISE EXCEPTION 'org_already_has_active_subscription' USING ERRCODE = 'P0001';
  END IF;

  -- Validar novo plano
  SELECT EXISTS(
    SELECT 1 FROM public.plans WHERE id = p_new_plan_id AND is_archived = false
  ) INTO v_plan_ok;
  IF NOT v_plan_ok THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_sub);

  UPDATE public.subscriptions
  SET
    status       = 'ativa',
    plan_id      = p_new_plan_id,
    period_start = now(),
    period_end   = NULL,
    updated_at   = now()
  WHERE id = p_subscription_id;

  SELECT to_jsonb(s) INTO v_after FROM public.subscriptions s WHERE id = p_subscription_id;

  PERFORM public.audit_write(
    'subscription.reactivate', 'subscription',
    p_subscription_id, v_sub.organization_id,
    v_before, v_after,
    jsonb_build_object('new_plan_id', p_new_plan_id),
    p_ip_address::inet, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reactivate_subscription FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reactivate_subscription FROM anon, authenticated;

-- ============================================================
-- 9. check_and_update_expired_trials
--    Chamada pelo middleware admin (server-side, service client).
--    Recebe lista de org_ids para checagem lazy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_and_update_expired_trials(
  p_org_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Flip trial → trial_expired para subscriptions vencidas
  -- Se p_org_ids for NULL, verifica todas (uso pelo cron no Sprint 13)
  UPDATE public.subscriptions
  SET
    status     = 'trial_expired',
    updated_at = now()
  WHERE status = 'trial'
    AND period_end IS NOT NULL
    AND period_end < now()
    AND (p_org_ids IS NULL OR organization_id = ANY(p_org_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_update_expired_trials FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_update_expired_trials FROM anon, authenticated;
-- Nota: service_role mantém acesso via SECURITY DEFINER

-- ============================================================
-- Verificação final: confirmar que anon não tem EXECUTE
-- Rodar após aplicar:
--   SELECT has_function_privilege('anon', 'admin_create_plan(text,...)', 'execute');
--   -- Deve retornar false para todas as 9 funções
-- ============================================================
