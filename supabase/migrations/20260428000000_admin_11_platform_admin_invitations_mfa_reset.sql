-- =============================================================================
-- Migration: Admin 11 — CRUD platform admins + convite single-use + MFA reset step-up
-- Created:   2026-04-28
-- Sprint:    admin_11
-- Schema Source: REAL DATABASE (introspectado via MCP em 2026-04-28)
-- PRD:       prds/prd_admin_11_admins_invite_mfa_reset.md
-- =============================================================================
--
-- O QUE ESTA MIGRATION FAZ:
--   1. profiles.mfa_reset_required boolean NOT NULL DEFAULT false — flag lida pelo
--      requireAdminSession (Sprint 04, modificado no Sprint 11) para forçar re-enroll
--      de MFA pós password reset OU pós aprovação de step-up.
--   2. public.platform_admin_invitations — convite single-use com token UUID,
--      72h de TTL, UNIQUE parcial impedindo dois convites pendentes para o mesmo email,
--      8 CHECK constraints garantindo coerência dos 4 estados (pending/consumed/revoked/expired).
--   3. public.platform_admin_mfa_reset_requests — step-up duplo (request por owner A,
--      aprovação por owner C ≠ A ≠ target B), 7 CHECK constraints anti-bypass de service_role
--      (auto-request, auto-approve, target-approve), TTL 24h, UNIQUE parcial 1 pendente por target.
--   4. 15 RPCs (todas SECURITY DEFINER, set search_path=public, REVOKE explícito de
--      public/anon/authenticated; GRANT seletivo a service_role — APRENDIZADO 2026-04-24):
--
--      Mutações de invitations (owner-only via re-validação interna):
--        - admin_create_platform_admin_invitation(p_email, p_role, p_actor_profile_id, p_ip, p_ua)
--        - admin_revoke_platform_admin_invitation(p_id, p_actor_profile_id, p_ip, p_ua)
--
--      Consume de invitation (chamado pelo Server Action após criar/identificar profile):
--        - admin_consume_platform_admin_invitation(p_token, p_consumer_profile_id, p_ip, p_ua)
--
--      Mutações de admin (owner-only):
--        - admin_change_platform_admin_role(p_target_id, p_new_role, p_actor_profile_id, p_ip, p_ua)
--        - admin_deactivate_platform_admin(p_target_id, p_actor_profile_id, p_ip, p_ua)
--
--      Step-up MFA reset (owner-only):
--        - admin_request_mfa_reset(p_target_admin_id, p_reason, p_actor_profile_id, p_ip, p_ua)
--        - admin_approve_mfa_reset(p_request_id, p_actor_profile_id, p_ip, p_ua)
--        - admin_revoke_mfa_reset_request(p_request_id, p_actor_profile_id, p_ip, p_ua)
--        - consume_admin_mfa_reset(p_request_id, p_target_profile_id, p_ip, p_ua)
--
--      Auth flow (chamado por Server Actions admin-auth pós Supabase Auth):
--        - mark_admin_password_reset(p_profile_id, p_ip, p_ua)
--        - complete_admin_mfa_reenroll(p_profile_id, p_ip, p_ua)
--
--      Reads (qualquer platform admin via Server Action que valida is_platform_admin):
--        - admin_list_platform_admins()
--        - admin_list_platform_admin_invitations(p_filter text DEFAULT 'pending')
--        - admin_list_mfa_reset_requests(p_filter text DEFAULT 'pending')
--        - get_invitation_by_token(p_token uuid)
--
-- DECISÃO TÉCNICA — actor injection via set_config:
--   createServiceClient() (src/lib/supabase/service.ts) usa apenas SUPABASE_SERVICE_ROLE_KEY
--   sem JWT do user, então auth.uid() retorna NULL dentro de RPCs chamadas via Server Action.
--   Para registrar o actor no audit_log corretamente E para manter os CHECKs de step-up
--   (auth.uid() <> requested_by, etc.), cada RPC mutation aceita p_actor_profile_id explícito
--   e injeta no JWT context da transação:
--     PERFORM set_config('request.jwt.claims',
--       jsonb_build_object('sub', p_actor_profile_id::text)::text, true);
--   Após isso, auth.uid() retorna p_actor_profile_id e audit_write captura o actor.
--   Defesa em profundidade: RPC valida que p_actor_profile_id de fato é platform admin
--   ativo (e owner quando a ação exige) — bypass via service_role direto sem actor falha.
--
-- NOTA MULTI-TENANCY:
--   As 2 tabelas novas não têm organization_id — catálogos da plataforma admin
--   (mesmo padrão de plans, platform_admins, audit_log, platform_settings, feature_flags,
--   legal_policies, platform_metrics_snapshot, platform_integration_credentials,
--   email_delivery_log). Exceções a documentar em docs/conventions/standards.md
--   §"Exceções em public.*" e em docs/PROJECT_CONTEXT.md §2.
--   Proteção compensatória: FORCE RLS + sem policies de mutação + writes via RPC
--   SECURITY DEFINER + GRANT EXECUTE restrito.
--
-- INVARIANTES MANTIDAS:
--   G-08 (last-owner protection) — trigger Sprint 02 prevent_last_owner_deactivation
--     já cobre UPDATE (downgrade do owner) e DELETE; Sprint 11 não toca a trigger.
--   G-15 (single-use atômico) — UPDATE ... WHERE consumed_at IS NULL ... RETURNING *
--     em READ COMMITTED (default Postgres) garante que apenas 1 transação muda a linha.
--   G-22 (re-enroll pós password reset) — mark_admin_password_reset seta a flag,
--     requireAdminSession lê e redireciona, complete_admin_mfa_reenroll zera.
--   Step-up duplo — 3 invariantes anti-bypass:
--     - pamr_no_self_request CHECK (requested_by <> target_profile_id)
--     - pamr_approver_distinct CHECK (approved_by NULL OR approved_by NOT IN (requested_by, target_profile_id))
--     - RPC re-valida com SELECT FOR UPDATE para race-free check
--
-- IDEMPOTÊNCIA:
--   ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
--   CREATE OR REPLACE FUNCTION. Re-execução segura.
--
-- ROLLBACK (executar em staging primeiro):
--   DROP FUNCTION IF EXISTS public.get_invitation_by_token(uuid);
--   DROP FUNCTION IF EXISTS public.admin_list_mfa_reset_requests(text);
--   DROP FUNCTION IF EXISTS public.admin_list_platform_admin_invitations(text);
--   DROP FUNCTION IF EXISTS public.admin_list_platform_admins();
--   DROP FUNCTION IF EXISTS public.complete_admin_mfa_reenroll(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.mark_admin_password_reset(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.consume_admin_mfa_reset(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_revoke_mfa_reset_request(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_approve_mfa_reset(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_request_mfa_reset(uuid,text,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_deactivate_platform_admin(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_change_platform_admin_role(uuid,text,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_consume_platform_admin_invitation(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_revoke_platform_admin_invitation(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_create_platform_admin_invitation(text,text,uuid,text,text);
--   DROP TABLE IF EXISTS public.platform_admin_mfa_reset_requests;
--   DROP TABLE IF EXISTS public.platform_admin_invitations;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS mfa_reset_required;
-- =============================================================================


-- =============================================================================
-- 1. profiles.mfa_reset_required
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_reset_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.mfa_reset_required IS
  'Flag setada por mark_admin_password_reset (após password reset Supabase) ou '
  'por admin_approve_mfa_reset (step-up). Lida pelo middleware requireAdminSession '
  '(Sprint 04+11) para redirecionar /admin/* → /admin/mfa-enroll?reenroll=true. '
  'Resetada por complete_admin_mfa_reenroll (sem step-up) ou consume_admin_mfa_reset '
  '(com step-up). State machine pura — sem audit dedicado nessa coluna.';


-- =============================================================================
-- 2. public.platform_admin_invitations
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_admin_invitations (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    text        NOT NULL,
  role                     text        NOT NULL,
  token                    uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at               timestamptz NOT NULL,
  consumed_at              timestamptz NULL,
  consumed_by_profile_id   uuid        NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revoked_at               timestamptz NULL,
  revoked_by               uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  email_delivery_log_id    uuid        NULL,
  created_by               uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pai_email_format
    CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email)),

  CONSTRAINT pai_role_enum
    CHECK (role IN ('owner','support','billing')),

  CONSTRAINT pai_expires_after_created
    CHECK (expires_at > created_at),

  CONSTRAINT pai_consume_coherence CHECK (
    (consumed_at IS NULL AND consumed_by_profile_id IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_by_profile_id IS NOT NULL)
  ),

  CONSTRAINT pai_revoke_coherence CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  ),

  CONSTRAINT pai_terminal_state_xor
    CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

ALTER TABLE public.platform_admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_invitations FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.platform_admin_invitations
  FROM authenticated, anon;

-- UNIQUE parcial: ≤1 invitation pendente (não-consumida, não-revogada) por email.
-- Postgres exige predicate IMMUTABLE — `expires_at > now()` é STABLE, então não cabe aqui.
-- Trade-off: invitations expiradas mas não-revogadas bloqueiam o slot. A RPC
-- admin_create_platform_admin_invitation auto-revoga expiradas para o mesmo email
-- antes do INSERT (cleanup-on-write), liberando o slot.
CREATE UNIQUE INDEX IF NOT EXISTS pai_one_pending_per_email_idx
  ON public.platform_admin_invitations (lower(email))
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS pai_email_idx
  ON public.platform_admin_invitations (email);

CREATE INDEX IF NOT EXISTS pai_expires_at_idx
  ON public.platform_admin_invitations (expires_at);

CREATE INDEX IF NOT EXISTS pai_creator_recent_idx
  ON public.platform_admin_invitations (created_by, created_at DESC);

DROP POLICY IF EXISTS "platform_admins_can_read_invitations"
  ON public.platform_admin_invitations;

CREATE POLICY "platform_admins_can_read_invitations"
  ON public.platform_admin_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

COMMENT ON TABLE public.platform_admin_invitations IS
  'Convites single-use para novos platform admins. Token opaco (UUID), TTL 72h, '
  'consumo atômico via UPDATE ... WHERE consumed_at IS NULL ... RETURNING * '
  '(garante G-15). Sem organization_id (catálogo global da plataforma admin). '
  'Writes via RPCs admin_create/revoke/consume_platform_admin_invitation. '
  'Exceção multi-tenancy a documentar em docs/conventions/standards.md.';


-- =============================================================================
-- 3. public.platform_admin_mfa_reset_requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_admin_mfa_reset_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_platform_admin_id    uuid        NOT NULL REFERENCES public.platform_admins(id) ON DELETE RESTRICT,
  target_profile_id           uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_by                uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason                      text        NOT NULL,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  approved_by                 uuid        NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at                 timestamptz NULL,
  consumed_at                 timestamptz NULL,
  revoked_at                  timestamptz NULL,
  revoked_by                  uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT pamr_reason_length
    CHECK (length(reason) BETWEEN 5 AND 500),

  CONSTRAINT pamr_expires_after_request
    CHECK (expires_at > requested_at),

  CONSTRAINT pamr_no_self_request
    CHECK (requested_by <> target_profile_id),

  CONSTRAINT pamr_approver_distinct CHECK (
    approved_by IS NULL
    OR (approved_by <> requested_by AND approved_by <> target_profile_id)
  ),

  CONSTRAINT pamr_approve_coherence CHECK (
    (approved_at IS NULL AND approved_by IS NULL)
    OR
    (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),

  CONSTRAINT pamr_consume_after_approve CHECK (
    consumed_at IS NULL
    OR
    (consumed_at IS NOT NULL AND approved_at IS NOT NULL)
  ),

  CONSTRAINT pamr_revoke_coherence CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  ),

  CONSTRAINT pamr_terminal_state_xor
    CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

ALTER TABLE public.platform_admin_mfa_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_mfa_reset_requests FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.platform_admin_mfa_reset_requests
  FROM authenticated, anon;

-- UNIQUE parcial: ≤1 pedido pendente (não-consumido, não-revogado) por target.
-- Mesmo trade-off do índice acima — `expires_at > now()` não cabe em predicate.
-- A RPC admin_request_mfa_reset auto-revoga pedidos expirados para o mesmo target
-- antes do INSERT (cleanup-on-write).
CREATE UNIQUE INDEX IF NOT EXISTS pamr_one_pending_per_target_idx
  ON public.platform_admin_mfa_reset_requests (target_platform_admin_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS pamr_target_idx
  ON public.platform_admin_mfa_reset_requests (target_platform_admin_id);

CREATE INDEX IF NOT EXISTS pamr_requester_idx
  ON public.platform_admin_mfa_reset_requests (requested_by, requested_at DESC);

CREATE INDEX IF NOT EXISTS pamr_approver_idx
  ON public.platform_admin_mfa_reset_requests (approved_by)
  WHERE approved_at IS NOT NULL;

DROP POLICY IF EXISTS "platform_admins_can_read_mfa_reset_requests"
  ON public.platform_admin_mfa_reset_requests;

CREATE POLICY "platform_admins_can_read_mfa_reset_requests"
  ON public.platform_admin_mfa_reset_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

COMMENT ON TABLE public.platform_admin_mfa_reset_requests IS
  'Step-up duplo para reset de MFA: owner A solicita reset para target B (≠ A); '
  'owner C (≠ A ≠ B) aprova; target B completa re-enroll para consumir. '
  'CHECKs constraints (pamr_no_self_request, pamr_approver_distinct) impedem '
  'bypass mesmo via service_role direto. TTL 24h sem aprovação. '
  'Sem organization_id. Writes via RPCs admin_request/approve/revoke/consume.';


-- =============================================================================
-- 4. RPC: admin_create_platform_admin_invitation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_platform_admin_invitation(
  p_email             text,
  p_role              text,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admin_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_norm text := lower(trim(p_email));
  v_row        public.platform_admin_invitations;
BEGIN
  -- Inject actor into JWT claims so auth.uid() returns p_actor_profile_id
  -- inside this transaction (works around service_role auth.uid() = NULL).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  -- Defense in depth: validate actor is platform admin owner.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner ativo pode criar convites.';
  END IF;

  -- Format check (CHECK constraint also enforces).
  IF v_email_norm !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'invalid_email_format'
      USING ERRCODE = 'P0001',
            HINT    = 'Email com formato inválido.';
  END IF;

  IF p_role NOT IN ('owner','support','billing') THEN
    RAISE EXCEPTION 'invalid_role'
      USING ERRCODE = 'P0001',
            HINT    = 'role deve ser owner, support ou billing.';
  END IF;

  -- Email já é admin ativo?
  IF EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    JOIN public.profiles p ON p.id = pa.profile_id
    WHERE lower(p.email) = v_email_norm
      AND pa.is_active = true
  ) THEN
    RAISE EXCEPTION 'email_already_active_admin'
      USING ERRCODE = 'P0001',
            HINT    = 'Este email já é admin ativo da plataforma.';
  END IF;

  -- Convite pendente NÃO-expirado? (RPC traduz para código tipado; UNIQUE parcial
  -- abaixo cobre apenas pendentes-não-revogados, sem checar expiração — daí a
  -- checagem dupla aqui.)
  IF EXISTS (
    SELECT 1 FROM public.platform_admin_invitations
    WHERE lower(email) = v_email_norm
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invitation_already_pending'
      USING ERRCODE = 'P0001',
            HINT    = 'Já existe convite pendente ativo para este email.';
  END IF;

  -- Auto-revoke de invitations expiradas (não-revogadas) para o mesmo email.
  -- Libera o slot do UNIQUE parcial pai_one_pending_per_email_idx.
  UPDATE public.platform_admin_invitations
     SET revoked_at = now(),
         revoked_by = p_actor_profile_id
   WHERE lower(email) = v_email_norm
     AND consumed_at IS NULL
     AND revoked_at IS NULL
     AND expires_at <= now();

  INSERT INTO public.platform_admin_invitations (email, role, expires_at, created_by)
  VALUES (v_email_norm, p_role, now() + interval '72 hours', p_actor_profile_id)
  RETURNING * INTO v_row;

  PERFORM public.audit_write(
    'platform_admin.invite_create',
    'platform_admin_invitation',
    v_row.id,
    NULL,
    NULL,
    jsonb_build_object('email', v_row.email, 'role', v_row.role, 'expires_at', v_row.expires_at),
    jsonb_build_object('email', v_row.email, 'role', v_row.role, 'expires_at', v_row.expires_at),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_platform_admin_invitation(text,text,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_create_platform_admin_invitation(text,text,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_platform_admin_invitation(text,text,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_create_platform_admin_invitation(text,text,uuid,text,text) TO   service_role;


-- =============================================================================
-- 5. RPC: admin_revoke_platform_admin_invitation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_platform_admin_invitation(
  p_id                uuid,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admin_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_invitations;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.platform_admin_invitations
     SET revoked_at = now(),
         revoked_by = p_actor_profile_id
   WHERE id = p_id
     AND consumed_at IS NULL
     AND revoked_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found_or_terminal'
      USING ERRCODE = 'P0001',
            HINT    = 'Convite não encontrado ou já consumido/revogado.';
  END IF;

  PERFORM public.audit_write(
    'platform_admin.invite_revoke',
    'platform_admin_invitation',
    v_row.id,
    NULL,
    NULL,
    jsonb_build_object('email', v_row.email),
    jsonb_build_object('email', v_row.email, 'revoked_at', v_row.revoked_at),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_platform_admin_invitation(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_platform_admin_invitation(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_platform_admin_invitation(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_platform_admin_invitation(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 6. RPC: admin_consume_platform_admin_invitation
-- =============================================================================
-- Atomicidade single-use (G-15): UPDATE ... WHERE consumed_at IS NULL ... RETURNING *
-- garante que apenas a primeira transação concorrente bem-sucedida muda a linha.
-- Outras chamadas concorrentes recebem 0 rows e classificam o motivo via SELECT auxiliar.

CREATE OR REPLACE FUNCTION public.admin_consume_platform_admin_invitation(
  p_token                  uuid,
  p_consumer_profile_id    uuid,
  p_ip_address             text DEFAULT NULL,
  p_user_agent             text DEFAULT NULL
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation        public.platform_admin_invitations;
  v_existing_state    record;
  v_new_admin         public.platform_admins;
  v_consumer_email    text;
BEGIN
  -- Inject the consumer as actor in JWT context — audit_write captures this.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_consumer_profile_id::text)::text, true);

  -- Atomic consume.
  UPDATE public.platform_admin_invitations
     SET consumed_at = now(),
         consumed_by_profile_id = p_consumer_profile_id
   WHERE token = p_token
     AND consumed_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING * INTO v_invitation;

  IF NOT FOUND THEN
    -- Classify failure reason.
    SELECT consumed_at, revoked_at, expires_at
      INTO v_existing_state
      FROM public.platform_admin_invitations
     WHERE token = p_token;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation_not_found'
        USING ERRCODE = 'P0001';
    ELSIF v_existing_state.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation_already_consumed'
        USING ERRCODE = 'P0001';
    ELSIF v_existing_state.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation_revoked'
        USING ERRCODE = 'P0001';
    ELSIF v_existing_state.expires_at <= now() THEN
      RAISE EXCEPTION 'invitation_expired'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'invitation_consume_failed'
        USING ERRCODE = 'P0001',
              HINT    = 'Estado inesperado.';
    END IF;
  END IF;

  -- Server Action garantiu que p_consumer_profile_id está em org axon
  -- (is_internal=true). Trigger trg_platform_admins_enforce_internal_org valida
  -- ainda assim e raise 'profile_not_in_internal_org' se quebrado.
  INSERT INTO public.platform_admins (profile_id, role, is_active, created_by)
  VALUES (p_consumer_profile_id, v_invitation.role, true, v_invitation.created_by)
  RETURNING * INTO v_new_admin;

  -- Snapshot do email para audit metadata.
  SELECT email INTO v_consumer_email FROM public.profiles WHERE id = p_consumer_profile_id;

  PERFORM public.audit_write(
    'platform_admin.invite_consume',
    'platform_admin',
    v_new_admin.id,
    NULL,
    NULL,
    jsonb_build_object(
      'invitation_id',  v_invitation.id,
      'role',           v_invitation.role,
      'consumer_email', v_consumer_email
    ),
    jsonb_build_object(
      'invitation_id',  v_invitation.id,
      'role',           v_invitation.role,
      'consumer_email', v_consumer_email,
      'admin_id',       v_new_admin.id
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_new_admin;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_consume_platform_admin_invitation(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_consume_platform_admin_invitation(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_consume_platform_admin_invitation(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_consume_platform_admin_invitation(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 7. RPC: admin_change_platform_admin_role
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_change_platform_admin_role(
  p_target_id         uuid,
  p_new_role          text,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_role text;
  v_row      public.platform_admins;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_new_role NOT IN ('owner','support','billing') THEN
    RAISE EXCEPTION 'invalid_role'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_old_role
    FROM public.platform_admins
   WHERE id = p_target_id
     AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_not_found_or_inactive'
      USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE — trigger Sprint 02 prevent_last_owner_deactivation BEFORE UPDATE
  -- detecta downgrade do último owner e raise 'last_owner_protected'.
  UPDATE public.platform_admins
     SET role = p_new_role
   WHERE id = p_target_id
  RETURNING * INTO v_row;

  PERFORM public.audit_write(
    'platform_admin.role_change',
    'platform_admin',
    v_row.id,
    NULL,
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_new_role),
    NULL,
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_change_platform_admin_role(uuid,text,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_change_platform_admin_role(uuid,text,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_change_platform_admin_role(uuid,text,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_change_platform_admin_role(uuid,text,uuid,text,text) TO   service_role;


-- =============================================================================
-- 8. RPC: admin_deactivate_platform_admin
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_deactivate_platform_admin(
  p_target_id         uuid,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             public.platform_admins;
  v_target_email    text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  -- Existência + estado ativo (UPDATE WHERE is_active=true preserva idempotência).
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE id = p_target_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'admin_not_found_or_inactive'
      USING ERRCODE = 'P0001';
  END IF;

  -- Trigger Sprint 02 BEFORE UPDATE dispara 'last_owner_protected' se aplicável.
  UPDATE public.platform_admins
     SET is_active     = false,
         deactivated_at = now()
   WHERE id = p_target_id
     AND is_active = true
  RETURNING * INTO v_row;

  SELECT p.email INTO v_target_email
    FROM public.profiles p
   WHERE p.id = v_row.profile_id;

  PERFORM public.audit_write(
    'platform_admin.deactivate',
    'platform_admin',
    v_row.id,
    NULL,
    jsonb_build_object('is_active', true,  'role', v_row.role),
    jsonb_build_object('is_active', false, 'role', v_row.role),
    jsonb_build_object('email', v_target_email),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_deactivate_platform_admin(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_deactivate_platform_admin(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_deactivate_platform_admin(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_deactivate_platform_admin(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 9. RPC: admin_request_mfa_reset
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_request_mfa_reset(
  p_target_admin_id   uuid,
  p_reason            text,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admin_mfa_reset_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_profile_id uuid;
  v_row               public.platform_admin_mfa_reset_requests;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(coalesce(p_reason, '')) < 5 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason_length'
      USING ERRCODE = 'P0001',
            HINT    = 'Motivo deve ter entre 5 e 500 caracteres.';
  END IF;

  SELECT profile_id INTO v_target_profile_id
    FROM public.platform_admins
   WHERE id = p_target_admin_id
     AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_admin_not_found_or_inactive'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target_profile_id = p_actor_profile_id THEN
    RAISE EXCEPTION 'self_request_forbidden'
      USING ERRCODE = 'P0001',
            HINT    = 'Você não pode solicitar reset de MFA para si mesmo.';
  END IF;

  -- Pendente NÃO-expirado por target? (Checagem dupla — UNIQUE parcial não inclui
  -- expires_at no predicate por limitação Postgres.)
  IF EXISTS (
    SELECT 1 FROM public.platform_admin_mfa_reset_requests
    WHERE target_platform_admin_id = p_target_admin_id
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'mfa_reset_already_pending'
      USING ERRCODE = 'P0001';
  END IF;

  -- Auto-revoke de pedidos expirados (não-revogados) para o mesmo target.
  -- Libera o slot do UNIQUE parcial pamr_one_pending_per_target_idx.
  UPDATE public.platform_admin_mfa_reset_requests
     SET revoked_at = now(),
         revoked_by = p_actor_profile_id
   WHERE target_platform_admin_id = p_target_admin_id
     AND consumed_at IS NULL
     AND revoked_at IS NULL
     AND expires_at <= now();

  INSERT INTO public.platform_admin_mfa_reset_requests (
    target_platform_admin_id, target_profile_id, requested_by, reason, expires_at
  )
  VALUES (
    p_target_admin_id, v_target_profile_id, p_actor_profile_id,
    p_reason, now() + interval '24 hours'
  )
  RETURNING * INTO v_row;

  PERFORM public.audit_write(
    'platform_admin.mfa_reset_request',
    'platform_admin_mfa_reset_request',
    v_row.id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'target_admin_id',   p_target_admin_id,
      'target_profile_id', v_target_profile_id,
      'reason',            p_reason
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_request_mfa_reset(uuid,text,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_request_mfa_reset(uuid,text,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_request_mfa_reset(uuid,text,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_request_mfa_reset(uuid,text,uuid,text,text) TO   service_role;


-- =============================================================================
-- 10. RPC: admin_approve_mfa_reset
-- =============================================================================
-- SELECT FOR UPDATE garante que duas aprovações concorrentes não passam.
-- Na mesma TX, chama mark_admin_password_reset (set mfa_reset_required=true).

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
AS $$
DECLARE
  v_existing public.platform_admin_mfa_reset_requests;
  v_row      public.platform_admin_mfa_reset_requests;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
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

  IF p_actor_profile_id = v_existing.requested_by THEN
    RAISE EXCEPTION 'self_approve_forbidden'
      USING ERRCODE = 'P0001',
            HINT    = 'Você não pode aprovar um pedido que você mesmo abriu.';
  END IF;

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

  -- Same TX: set mfa_reset_required=true on target.
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
$$;

REVOKE EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_approve_mfa_reset(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 11. RPC: admin_revoke_mfa_reset_request
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_mfa_reset_request(
  p_request_id        uuid,
  p_actor_profile_id  uuid,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS public.platform_admin_mfa_reset_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_admin_mfa_reset_requests;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_actor_profile_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.platform_admin_mfa_reset_requests
     SET revoked_at = now(),
         revoked_by = p_actor_profile_id
   WHERE id = p_request_id
     AND consumed_at IS NULL
     AND revoked_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mfa_reset_request_not_pending'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.audit_write(
    'platform_admin.mfa_reset_revoke',
    'platform_admin_mfa_reset_request',
    v_row.id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_admin_id', v_row.target_platform_admin_id),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_mfa_reset_request(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_mfa_reset_request(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_mfa_reset_request(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_mfa_reset_request(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 12. RPC: consume_admin_mfa_reset
-- =============================================================================
-- Chamado pelo completeAdminMfaReenrollAction quando há request aprovada pendente.
-- Marca a request como consumida E zera mfa_reset_required do target na mesma TX.

CREATE OR REPLACE FUNCTION public.consume_admin_mfa_reset(
  p_request_id          uuid,
  p_target_profile_id   uuid,
  p_ip_address          text DEFAULT NULL,
  p_user_agent          text DEFAULT NULL
)
RETURNS public.platform_admin_mfa_reset_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.platform_admin_mfa_reset_requests;
  v_row      public.platform_admin_mfa_reset_requests;
BEGIN
  -- Actor é o próprio target (consumindo seu reset).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_target_profile_id::text)::text, true);

  SELECT * INTO v_existing
    FROM public.platform_admin_mfa_reset_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mfa_reset_request_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.target_profile_id <> p_target_profile_id THEN
    RAISE EXCEPTION 'target_mismatch'
      USING ERRCODE = 'P0001',
            HINT    = 'Profile do consumer não bate com target da request.';
  END IF;

  IF v_existing.consumed_at IS NOT NULL OR v_existing.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'mfa_reset_request_not_pending'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.approved_at IS NULL THEN
    RAISE EXCEPTION 'mfa_reset_not_approved'
      USING ERRCODE = 'P0001',
            HINT    = 'Request precisa estar aprovada antes de consumir.';
  END IF;

  IF v_existing.expires_at <= now() THEN
    RAISE EXCEPTION 'mfa_reset_request_expired'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.platform_admin_mfa_reset_requests
     SET consumed_at = now()
   WHERE id = p_request_id
  RETURNING * INTO v_row;

  -- Mesma TX: zera flag do target.
  UPDATE public.profiles
     SET mfa_reset_required = false
   WHERE id = p_target_profile_id;

  PERFORM public.audit_write(
    'platform_admin.mfa_reset_consume',
    'platform_admin_mfa_reset_request',
    v_row.id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_profile_id', p_target_profile_id),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_admin_mfa_reset(uuid,uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.consume_admin_mfa_reset(uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_admin_mfa_reset(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_admin_mfa_reset(uuid,uuid,text,text) TO   service_role;


-- =============================================================================
-- 13. RPC: mark_admin_password_reset
-- =============================================================================
-- Chamado pelo completeAdminPasswordResetAction após auth.updateUser({password}).
-- No-op silencioso para customer (não-admin); audit gravado apenas para admin.

CREATE OR REPLACE FUNCTION public.mark_admin_password_reset(
  p_profile_id    uuid,
  p_ip_address    text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_profile_id::text)::text, true);

  -- is_platform_admin retorna 0 rows para non-admin.
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_profile_id
      AND is_active = true
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN false;  -- no-op silencioso para customer
  END IF;

  UPDATE public.profiles
     SET mfa_reset_required = true
   WHERE id = p_profile_id;

  PERFORM public.audit_write(
    'password_reset.complete_admin',
    'profile',
    p_profile_id,
    NULL,
    jsonb_build_object('mfa_reset_required', false),
    jsonb_build_object('mfa_reset_required', true),
    NULL,
    p_ip_address::inet,
    p_user_agent
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_admin_password_reset(uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.mark_admin_password_reset(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_admin_password_reset(uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_admin_password_reset(uuid,text,text) TO   service_role;


-- =============================================================================
-- 14. RPC: complete_admin_mfa_reenroll
-- =============================================================================
-- Self-service path quando admin completa re-enroll após password reset
-- (sem ter passado por step-up de outro admin).

CREATE OR REPLACE FUNCTION public.complete_admin_mfa_reenroll(
  p_profile_id    uuid,
  p_ip_address    text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_profile_id::text)::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = p_profile_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_a_platform_admin'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
     SET mfa_reset_required = false
   WHERE id = p_profile_id;

  PERFORM public.audit_write(
    'password_reset.mfa_reenroll_complete',
    'profile',
    p_profile_id,
    NULL,
    jsonb_build_object('mfa_reset_required', true),
    jsonb_build_object('mfa_reset_required', false),
    NULL,
    p_ip_address::inet,
    p_user_agent
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_admin_mfa_reenroll(uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.complete_admin_mfa_reenroll(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_admin_mfa_reenroll(uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_admin_mfa_reenroll(uuid,text,text) TO   service_role;


-- =============================================================================
-- 15. RPC: admin_list_platform_admins
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_platform_admins()
RETURNS TABLE (
  id                  uuid,
  profile_id          uuid,
  role                text,
  is_active           boolean,
  created_at          timestamptz,
  deactivated_at      timestamptz,
  created_by          uuid,
  email               text,
  full_name           text,
  avatar_url          text,
  last_sign_in_at     timestamptz,
  mfa_configured      boolean,
  mfa_reset_required  boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    pa.id,
    pa.profile_id,
    pa.role,
    pa.is_active,
    pa.created_at,
    pa.deactivated_at,
    pa.created_by,
    p.email,
    p.full_name,
    p.avatar_url,
    u.last_sign_in_at,
    EXISTS (
      SELECT 1 FROM auth.mfa_factors mf
      WHERE mf.user_id = pa.profile_id
        AND mf.factor_type = 'totp'
        AND mf.status = 'verified'
    ) AS mfa_configured,
    p.mfa_reset_required
  FROM public.platform_admins pa
  JOIN public.profiles  p ON p.id = pa.profile_id
  LEFT JOIN auth.users  u ON u.id = pa.profile_id
  ORDER BY pa.is_active DESC, pa.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admins() FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admins() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admins() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_platform_admins() TO   service_role;


-- =============================================================================
-- 16. RPC: admin_list_platform_admin_invitations
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_platform_admin_invitations(
  p_filter text DEFAULT 'pending'
)
RETURNS SETOF public.platform_admin_invitations
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_filter NOT IN ('pending','consumed','revoked','expired','all') THEN
    RAISE EXCEPTION 'invalid_filter'
      USING ERRCODE = 'P0001',
            HINT    = 'filter ∈ {pending,consumed,revoked,expired,all}.';
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.platform_admin_invitations
   WHERE
     CASE p_filter
       WHEN 'pending'  THEN consumed_at IS NULL AND revoked_at IS NULL AND expires_at >  now()
       WHEN 'consumed' THEN consumed_at IS NOT NULL
       WHEN 'revoked'  THEN revoked_at  IS NOT NULL
       WHEN 'expired'  THEN consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= now()
       ELSE true
     END
   ORDER BY created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admin_invitations(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admin_invitations(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_platform_admin_invitations(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_platform_admin_invitations(text) TO   service_role;


-- =============================================================================
-- 17. RPC: admin_list_mfa_reset_requests
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_mfa_reset_requests(
  p_filter text DEFAULT 'pending'
)
RETURNS SETOF public.platform_admin_mfa_reset_requests
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_filter NOT IN ('pending','approved','consumed','revoked','expired','all') THEN
    RAISE EXCEPTION 'invalid_filter'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.platform_admin_mfa_reset_requests
   WHERE
     CASE p_filter
       WHEN 'pending'  THEN approved_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at >  now()
       WHEN 'approved' THEN approved_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL
       WHEN 'consumed' THEN consumed_at IS NOT NULL
       WHEN 'revoked'  THEN revoked_at  IS NOT NULL
       WHEN 'expired'  THEN consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= now()
       ELSE true
     END
   ORDER BY requested_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_mfa_reset_requests(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_list_mfa_reset_requests(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_mfa_reset_requests(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_mfa_reset_requests(text) TO   service_role;


-- =============================================================================
-- 18. RPC: get_invitation_by_token
-- =============================================================================
-- Read minimal pelo Server Action getInvitationByTokenAction (pré-aceite).
-- Retorna apenas (email, role, expires_at, consumed_at, revoked_at) — NÃO expõe
-- id nem created_by nem token (caller já tem o token).

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(
  p_token uuid
)
RETURNS TABLE (
  email        text,
  role         text,
  expires_at   timestamptz,
  consumed_at  timestamptz,
  revoked_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT email, role, expires_at, consumed_at, revoked_at
    FROM public.platform_admin_invitations
   WHERE token = p_token
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_invitation_by_token(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_invitation_by_token(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_invitation_by_token(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_invitation_by_token(uuid) TO   service_role;


-- =============================================================================
-- FIM da migration admin_11
-- =============================================================================
