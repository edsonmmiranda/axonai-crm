-- =============================================================================
-- Hotfix: MFA reset triple-step-up → double-step-up
-- =============================================================================
-- Contexto: a regra anterior exigia 3 admins distintos (requester ≠ approver,
-- ambos ≠ target). Com 1–2 platform admins ativos, o flow normal era
-- matematicamente impossível e todo reset caía no break-glass.
--
-- Mudança: remove a regra `requester ≠ approver`. Mantém:
--   - `target ≠ requester` (constraint pamr_no_self_request, já existia)
--   - `target ≠ approver`  (constraint nova pamr_approver_not_target)
--
-- Propriedade de segurança preservada: ninguém reseta a própria MFA sem outro
-- admin tomar uma ação. Quando active_admins ≥ 3, considerar reintroduzir
-- `requester ≠ approver` para reativar 4-eyes — decisão registrada em
-- docs/PROJECT_CONTEXT.md.
-- =============================================================================

-- 1. Substituir o CHECK constraint -------------------------------------------

ALTER TABLE public.platform_admin_mfa_reset_requests
  DROP CONSTRAINT IF EXISTS pamr_approver_distinct;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pamr_approver_not_target'
      AND conrelid = 'public.platform_admin_mfa_reset_requests'::regclass
  ) THEN
    ALTER TABLE public.platform_admin_mfa_reset_requests
      ADD CONSTRAINT pamr_approver_not_target CHECK (
        approved_by IS NULL OR approved_by <> target_profile_id
      );
  END IF;
END $$;

-- 2. Recriar admin_approve_mfa_reset sem o RAISE self_approve_forbidden ------
--    (mantém target_approve_forbidden — defesa em profundidade contra bypass
--     via service_role direto que ignore o CHECK).

CREATE OR REPLACE FUNCTION public.admin_approve_mfa_reset(
  p_request_id        uuid,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admin_mfa_reset_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing public.platform_admin_mfa_reset_requests;
  v_row      public.platform_admin_mfa_reset_requests;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active  = true
      AND role       = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
    FROM public.platform_admin_mfa_reset_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mfa_reset_request_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.consumed_at IS NOT NULL OR v_existing.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'mfa_reset_request_not_pending'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'mfa_reset_already_approved'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.expires_at <= now() THEN
    RAISE EXCEPTION 'mfa_reset_request_expired'
      USING ERRCODE = 'P0001';
  END IF;

  -- Hotfix 2026-04-29: removido RAISE 'self_approve_forbidden'.
  -- Em time pequeno (≤ 2 admins) o requester pode aprovar o próprio pedido
  -- desde que ele não seja o target. Quando active_admins ≥ 3, reintroduzir.

  IF p_actor_profile_id = v_existing.target_profile_id THEN
    RAISE EXCEPTION 'target_approve_forbidden'
      USING ERRCODE = 'P0001',
            HINT    = 'Você não pode aprovar um pedido cujo alvo é você.';
  END IF;

  UPDATE public.platform_admin_mfa_reset_requests
     SET approved_by = p_actor_profile_id,
         approved_at = now()
   WHERE id = p_request_id
  RETURNING * INTO v_row;

  UPDATE public.profiles
     SET mfa_reset_required = true
   WHERE id = v_existing.target_profile_id;

  PERFORM public.audit_write(
    'platform_admin.mfa_reset_approve',
    'platform_admin_mfa_reset_request',
    v_row.id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'target_admin_id',   v_existing.target_platform_admin_id,
      'target_profile_id', v_existing.target_profile_id
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid, uuid, text, text)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid, uuid, text, text)
  TO service_role;

COMMENT ON CONSTRAINT pamr_approver_not_target
  ON public.platform_admin_mfa_reset_requests IS
  'Hotfix 2026-04-29: substitui pamr_approver_distinct. Garante que approver '
  '≠ target. A regra requester ≠ approver foi removida — flow opera em '
  'double step-up enquanto active_admins ≤ 2; reintroduzir quando ≥ 3.';
