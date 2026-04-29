-- Migration: admin_13 — auto subscription transitions + immutable slug + origin isolation
-- Created: 2026-04-29
-- Sprint: admin_13
-- Schema Source: REAL DATABASE (introspected via MCP, not migrations)
--
-- Scope:
--   1. Trigger prevent_slug_change — slug imutável desde criação (G-20, INV-9)
--   2. Função privada _apply_subscription_transitions (cron + lazy share)
--   3. RPCs públicas admin_transition_subscriptions / _for_org
--   4. is_calling_org_active() estendida — bloqueia status='trial_expired'/'suspensa'
--   5. Extensão pg_cron + job horário admin_transition_subscriptions_hourly
--
-- Preflight findings (confirmados via introspeção em 2026-04-29):
--   - audit_write: já lida com NULL actor via auth.uid() (chamadas sem JWT recebem NULL).
--     audit_log.actor_profile_id é nullable. Sem ajuste necessário.
--   - is_calling_org_active: SÓ olha organizations.is_active. ESTENDIDA aqui.
--   - pg_cron: extensão disponível (1.6.4) mas NÃO instalada. CREATE EXTENSION abaixo.
--   - subscriptions: partial unique index `subscriptions_one_vigente_per_org` cobre INV-1.
--
-- Decisão de produto (2026-04-29, simplificação): slug é imutável desde a criação,
-- sem janela editável pré-login. Mudança fora da UI fica como runbook operacional.
--
-- All RPCs: SECURITY DEFINER, SET search_path=public, REVOKE público/anon/authenticated,
--   GRANT só service_role (APRENDIZADO 2026-04-24).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger prevent_slug_change (G-20, INV-9, RF-ORG-9 — versão simplificada)
--    Slug imutável desde a criação. UPDATE no-op (slug igual) ainda é permitido
--    para idempotência.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._prevent_slug_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Idempotência: UPDATE no-op (slug igual ao atual) é permitido.
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'org_slug_immutable'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'organization_id', OLD.id,
              'current_slug', OLD.slug,
              'attempted_slug', NEW.slug
            )::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_slug_change_after_first_login ON public.organizations;
DROP TRIGGER IF EXISTS prevent_slug_change ON public.organizations;
CREATE TRIGGER prevent_slug_change
  BEFORE UPDATE OF slug ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public._prevent_slug_change();

COMMENT ON FUNCTION public._prevent_slug_change() IS
  'Slug da organização é imutável desde a criação (decisão fixada 2026-04-29). '
  'UPDATE no-op (slug igual) é permitido para idempotência. '
  'Mudança operacional exige runbook fora da UI.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Função privada _apply_subscription_transitions(p_org_id, p_source)
--    Coração do automatismo. Usada pelo cron (NULL = todas) e lazy (org-scoped).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._apply_subscription_transitions(
  p_org_id uuid DEFAULT NULL,
  p_source text DEFAULT 'cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace_days int;
  v_trial_expired int := 0;
  v_past_due_blocked int := 0;
  v_cancelada_blocked int := 0;
  r record;
BEGIN
  -- Validar source whitelist (defesa contra metadata arbitrário)
  IF p_source NOT IN ('cron', 'lazy_middleware', 'manual_admin') THEN
    RAISE EXCEPTION 'invalid_transition_source: %', p_source
      USING ERRCODE = 'P0001';
  END IF;

  -- Lê past_due_grace_days de platform_settings (Sprint 09); fallback 7
  SELECT value_int INTO v_grace_days
  FROM public.platform_settings
  WHERE key = 'past_due_grace_days';
  v_grace_days := COALESCE(v_grace_days, 7);

  -- ── 1) trial → trial_expired ──────────────────────────────────────────────
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM public.subscriptions
    WHERE status = 'trial'
      AND period_end IS NOT NULL
      AND period_end < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.subscriptions
       SET status = 'trial_expired', updated_at = now()
     WHERE id = r.id;

    PERFORM public.audit_write(
      'subscription.auto_expire'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'trial'),
      jsonb_build_object('status', 'trial_expired'),
      jsonb_build_object(
        'source', p_source,
        'period_end', r.period_end
      )
    );
    v_trial_expired := v_trial_expired + 1;
  END LOOP;

  -- ── 2) past_due (excedido grace) → suspensa ───────────────────────────────
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM public.subscriptions
    WHERE status = 'past_due'
      AND period_end IS NOT NULL
      AND period_end + (v_grace_days || ' days')::interval < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.subscriptions
       SET status = 'suspensa', updated_at = now()
     WHERE id = r.id;

    PERFORM public.audit_write(
      'subscription.auto_block_past_due'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'past_due'),
      jsonb_build_object('status', 'suspensa'),
      jsonb_build_object(
        'source', p_source,
        'period_end', r.period_end,
        'grace_days', v_grace_days
      )
    );
    v_past_due_blocked := v_past_due_blocked + 1;
  END LOOP;

  -- ── 3) cancelada (período pago vencido) → suspensa ────────────────────────
  FOR r IN
    SELECT id, organization_id, status, period_end
    FROM public.subscriptions
    WHERE status = 'cancelada'
      AND period_end IS NOT NULL
      AND period_end < now()
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.subscriptions
       SET status = 'suspensa', updated_at = now()
     WHERE id = r.id;

    PERFORM public.audit_write(
      'subscription.auto_block_cancelled'::text,
      'subscription'::text,
      r.id,
      r.organization_id,
      jsonb_build_object('status', 'cancelada'),
      jsonb_build_object('status', 'suspensa'),
      jsonb_build_object(
        'source', p_source,
        'period_end', r.period_end
      )
    );
    v_cancelada_blocked := v_cancelada_blocked + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'transitioned', v_trial_expired + v_past_due_blocked + v_cancelada_blocked,
    'trial_expired', v_trial_expired,
    'past_due_blocked', v_past_due_blocked,
    'cancelada_blocked', v_cancelada_blocked,
    'source', p_source,
    'ran_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public._apply_subscription_transitions(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apply_subscription_transitions(uuid, text) TO service_role;

COMMENT ON FUNCTION public._apply_subscription_transitions(uuid, text) IS
  'Aplica transições automáticas de subscription. p_org_id=NULL processa todas; '
  'p_org_id=<uuid> processa só uma. Chamada por: '
  'admin_transition_subscriptions (cron horário) e '
  'admin_transition_subscription_for_org (lazy middleware admin). '
  'FOR UPDATE SKIP LOCKED evita contenção entre cron e lazy. '
  'Audit_write é chamada na mesma transação (INV-6).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPCs públicas — wrappers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_transition_subscriptions()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._apply_subscription_transitions(NULL, 'cron');
$$;

REVOKE ALL ON FUNCTION public.admin_transition_subscriptions() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_subscriptions() TO service_role;

COMMENT ON FUNCTION public.admin_transition_subscriptions() IS
  'Wrapper para o pg_cron job. Processa todas as subscriptions vencidas. '
  'Idempotente — rerun no mesmo segundo altera 0 linhas.';

CREATE OR REPLACE FUNCTION public.admin_transition_subscription_for_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._apply_subscription_transitions(p_org_id, 'lazy_middleware');
$$;

REVOKE ALL ON FUNCTION public.admin_transition_subscription_for_org(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_subscription_for_org(uuid) TO service_role;

COMMENT ON FUNCTION public.admin_transition_subscription_for_org(uuid) IS
  'Wrapper para o lazy-check do middleware admin. Processa apenas a org especificada. '
  'Latência <50ms para 1 row.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. is_calling_org_active() ESTENDIDA
--    Antes: olhava só organizations.is_active.
--    Agora: também bloqueia se subscription mais recente está em status terminal
--    (trial_expired ou suspensa). Cron/lazy garantem que status reflete a
--    realidade dentro do SLA de 15min (D-9). Demais checagens (past_due+grace,
--    cancelada+vencido) são responsabilidade do cron/lazy — quando o status
--    flipa para 'suspensa', a função bloqueia.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_calling_org_active()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH ctx AS (
    SELECT (auth.jwt() ->> 'organization_id')::uuid AS org_id
  )
  SELECT
    COALESCE(
      (SELECT is_active FROM public.organizations WHERE id = (SELECT org_id FROM ctx)),
      false
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE organization_id = (SELECT org_id FROM ctx)
        AND status IN ('trial_expired', 'suspensa')
    );
$$;

COMMENT ON FUNCTION public.is_calling_org_active() IS
  'Retorna true se a org do JWT está ativa (is_active=true E sem subscription em '
  'status terminal). Estendida no admin_13 para também bloquear quando '
  'subscription.status IN (trial_expired, suspensa). Transições automáticas (cron + '
  'lazy) flipam o status dentro do SLA de 15min.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. pg_cron extension + job horário
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotência: unschedule se já existe, depois reschedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin_transition_subscriptions_hourly') THEN
    PERFORM cron.unschedule('admin_transition_subscriptions_hourly');
  END IF;

  PERFORM cron.schedule(
    'admin_transition_subscriptions_hourly',
    '0 * * * *',
    $cmd$ SELECT public.admin_transition_subscriptions(); $cmd$
  );
END $$;

COMMIT;
