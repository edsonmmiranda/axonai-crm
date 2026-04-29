-- Migration: Sprint admin_12 — Audit log UI + rate limit login admin + break-glass CLI
-- Created: 2026-04-28
-- Sprint: admin_12
-- Schema Source: REAL DATABASE (introspected via MCP 2026-04-28)
--
-- Entrega:
--   1. Tabela `login_attempts_admin` (FORCE RLS) — registro append de tentativas de login admin
--   2. Coluna reservada `audit_log.retention_expires_at` (NULL no MVP; D-7 fixado em §3 PROJECT_CONTEXT.md)
--   3. 5 RPCs SECURITY DEFINER, todas com REVOKE explícito de public/anon/authenticated (APRENDIZADO 2026-04-24):
--        - record_admin_login_attempt
--        - count_admin_login_failures
--        - audit_login_admin_event
--        - get_break_glass_secret_hash
--        - break_glass_recover_owner
--
-- NÃO toca:
--   - audit_log triggers existentes (deny_truncate, deny_update_delete) — preservados (G-10)
--   - audit_log policies/indexes (Sprint 03 já cobre 4 índices que cobrem todos os filtros do PRD)
--   - platform_admins schema (apenas leitura/UPSERT por break_glass_recover_owner)
--   - profiles schema (apenas UPDATE de mfa_reset_required já criada em Sprint 11)

------------------------------------------------------------
-- 1. EXTENSION (idempotente — pgcrypto v1.3 já instalado)
------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

------------------------------------------------------------
-- 2. login_attempts_admin — registro append-only de tentativas
------------------------------------------------------------
-- Sem organization_id: evento pré-autenticação (PROJECT_CONTEXT.md §2 documenta exceção).
-- Sem trigger de deny UPDATE/DELETE: tabela operacional permite purge eventual (diferente de audit_log).

CREATE TABLE IF NOT EXISTS public.login_attempts_admin (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  email_hash  bytea NOT NULL,
  ip_address  inet NOT NULL,
  user_agent  text,
  success     boolean NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb DEFAULT '{}'::jsonb,

  CONSTRAINT laa_email_format       CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email)),
  CONSTRAINT laa_user_agent_length  CHECK (user_agent IS NULL OR length(user_agent) <= 500)
);

COMMENT ON TABLE public.login_attempts_admin IS
  'Sprint admin_12 — Append-only de tentativas de login na rota /admin/login. Sem organization_id (evento pré-auth). Writes via RPC SECURITY DEFINER record_admin_login_attempt.';

CREATE INDEX IF NOT EXISTS laa_email_occurred_idx ON public.login_attempts_admin (email, occurred_at DESC);
CREATE INDEX IF NOT EXISTS laa_ip_occurred_idx    ON public.login_attempts_admin (ip_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS laa_occurred_idx       ON public.login_attempts_admin (occurred_at DESC);

ALTER TABLE public.login_attempts_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts_admin FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.login_attempts_admin'::regclass
       AND polname  = 'laa_select_owner_support'
  ) THEN
    CREATE POLICY "laa_select_owner_support"
      ON public.login_attempts_admin
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.platform_admins pa
           WHERE pa.profile_id = auth.uid()
             AND pa.is_active  = true
             AND pa.role IN ('owner','support')
        )
      );
  END IF;
END $$;

-- Sem policies de mutação — writes via RPC record_admin_login_attempt (service-role only).
-- billing NÃO lê (rbac_matrix.md linha 83 — fora-de-escopo billing).

------------------------------------------------------------
-- 3. audit_log.retention_expires_at — coluna reservada (D-7)
------------------------------------------------------------
-- MVP retém indefinidamente (NULL = retenção infinita).
-- Defaults sugeridos para fase 2 (documentados em PROJECT_CONTEXT.md §3 D-7):
--   compliance (~maioria dos slugs): 7 anos
--   inspect.*: 90 dias
--   auth.*: 1 ano
--   break_glass.*: indefinido
-- Purge job é fase 2 (exige bypass dos triggers audit_log_deny_* via função SECURITY DEFINER dedicada).

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz;

COMMENT ON COLUMN public.audit_log.retention_expires_at IS
  'Sprint admin_12 — Coluna reservada para D-7. NULL = retenção indefinida (default MVP). Purge job é fase 2.';

------------------------------------------------------------
-- 4. record_admin_login_attempt — INSERT em login_attempts_admin
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_admin_login_attempt(
  p_email      text,
  p_ip         inet,
  p_user_agent text,
  p_success    boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_ip IS NULL THEN
    RAISE EXCEPTION 'ip_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.login_attempts_admin (email, email_hash, ip_address, user_agent, success)
  VALUES (
    lower(trim(p_email)),
    digest(lower(trim(p_email)), 'sha256'),
    p_ip,
    nullif(left(coalesce(p_user_agent, ''), 500), ''),
    coalesce(p_success, false)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_admin_login_attempt(text, inet, text, boolean) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_admin_login_attempt(text, inet, text, boolean) TO   service_role;

COMMENT ON FUNCTION public.record_admin_login_attempt(text, inet, text, boolean) IS
  'Sprint admin_12 — Append em login_attempts_admin. Service-role only (chamada por src/lib/rateLimit/adminLogin.ts antes/depois do signInWithPassword).';

------------------------------------------------------------
-- 5. count_admin_login_failures — contador sliding-window por email + IP
------------------------------------------------------------
-- STABLE — query determinística dentro de uma transação.
-- Sem FOR UPDATE (decisão (a) — tolerância ~10ms é aceitável; FOR UPDATE em janela móvel não fecha o gap).

CREATE OR REPLACE FUNCTION public.count_admin_login_failures(
  p_email  text,
  p_ip     inet,
  p_window interval
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'by_email', count(*) FILTER (WHERE email = lower(p_email) AND success = false),
    'by_ip',    count(*) FILTER (WHERE ip_address = p_ip      AND success = false)
  )
  FROM public.login_attempts_admin
  WHERE occurred_at > now() - p_window;
$$;

REVOKE EXECUTE ON FUNCTION public.count_admin_login_failures(text, inet, interval) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.count_admin_login_failures(text, inet, interval) TO   service_role;

COMMENT ON FUNCTION public.count_admin_login_failures(text, inet, interval) IS
  'Sprint admin_12 — Contador sliding-window de falhas (last p_window) por email e IP. Service-role only. STABLE.';

------------------------------------------------------------
-- 6. audit_login_admin_event — emite linha em audit_log para events de login
------------------------------------------------------------
-- Decisão técnica: INSERT direto em audit_log (em vez de chamar audit_write wrapper) para retornar o id.
-- Triggers de deny audit_log_deny_update_delete continuam protegendo contra mutação subsequente (G-10).
-- Aceitável dentro de função SECURITY DEFINER controlada com whitelist de actions.

CREATE OR REPLACE FUNCTION public.audit_login_admin_event(
  p_email      text,
  p_ip         inet,
  p_user_agent text,
  p_action     text,
  p_metadata   jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_hash text;
  v_actor_id   uuid;
  v_audit_id   uuid;
BEGIN
  IF p_action NOT IN ('auth.login_admin_success', 'auth.login_rate_limited') THEN
    RAISE EXCEPTION 'invalid_action: %', p_action USING ERRCODE = 'P0001';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_required' USING ERRCODE = 'P0001';
  END IF;

  v_email_hash := encode(digest(lower(trim(p_email)), 'sha256'), 'hex');

  -- Resolução de actor_profile_id é best-effort e só ocorre em sucesso.
  -- (rate-limited não identifica actor — atacante pode ser anônimo).
  IF p_action = 'auth.login_admin_success' THEN
    SELECT id INTO v_actor_id
      FROM public.profiles
     WHERE lower(email) = lower(trim(p_email))
     LIMIT 1;
  END IF;

  INSERT INTO public.audit_log (
    actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  ) VALUES (
    v_actor_id,
    lower(trim(p_email)),
    p_action,
    'auth_session',
    NULL,
    NULL,
    NULL,
    NULL,
    p_ip,
    nullif(left(coalesce(p_user_agent, ''), 500), ''),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('email_hash', v_email_hash)
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_login_admin_event(text, inet, text, text, jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.audit_login_admin_event(text, inet, text, text, jsonb) TO   service_role;

COMMENT ON FUNCTION public.audit_login_admin_event(text, inet, text, text, jsonb) IS
  'Sprint admin_12 — Emite audit_log para auth.login_admin_success | auth.login_rate_limited. Service-role only. INSERT direto (não usa audit_write wrapper) para retornar id.';

------------------------------------------------------------
-- 7. get_break_glass_secret_hash — leitura do hash em platform_settings
------------------------------------------------------------
-- Hash é setado manualmente via runbook usando admin_set_setting('break_glass_secret_hash', ...).
-- Retorna NULL se setting não existe (CLI deve falhar nesse caso com mensagem clara).

CREATE OR REPLACE FUNCTION public.get_break_glass_secret_hash()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value_text INTO v_hash
    FROM public.platform_settings
   WHERE key        = 'break_glass_secret_hash'
     AND value_type = 'text';
  RETURN v_hash;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_break_glass_secret_hash() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_break_glass_secret_hash() TO   service_role;

COMMENT ON FUNCTION public.get_break_glass_secret_hash() IS
  'Sprint admin_12 — Read do hash do BREAK_GLASS_SECRET (key="break_glass_secret_hash" em platform_settings). Service-role only. Retorna NULL se setting não seedado (runbook documenta o setup inicial).';

------------------------------------------------------------
-- 8. break_glass_recover_owner — RPC do CLI scripts/break-glass.ts
------------------------------------------------------------
-- Operação atômica em transação:
--   1. Localiza profile pelo email
--   2. SELECT FOR UPDATE em platform_admins (impede race em break-glass paralelo, improbable mas barato)
--   3. UPSERT manual (UPDATE existente OR INSERT novo) com role=owner, is_active=true
--   4. UPDATE profiles.mfa_reset_required=true (consumido pelo middleware Sprint 11 → força re-enroll)
--   5. INSERT em audit_log na MESMA transação (INV-10)
-- Invalidação de TOTP factors NÃO acontece aqui — é responsabilidade do CLI via Auth Admin API JS.

CREATE OR REPLACE FUNCTION public.break_glass_recover_owner(
  p_email       text,
  p_operator    text,
  p_origin_host text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid;
  v_admin_id    uuid;
  v_was_active  boolean;
  v_old_role    text;
  v_audit_id    uuid;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_operator IS NULL OR length(trim(p_operator)) = 0 THEN
    RAISE EXCEPTION 'operator_required' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Localizar profile pelo email
  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock conceptual em platform_admins (FOR UPDATE) + UPSERT manual
  SELECT id, is_active, role
    INTO v_admin_id, v_was_active, v_old_role
    FROM public.platform_admins
   WHERE profile_id = v_profile_id
   FOR UPDATE;

  IF v_admin_id IS NULL THEN
    INSERT INTO public.platform_admins (profile_id, role, is_active, created_by)
    VALUES (v_profile_id, 'owner', true, v_profile_id)
    RETURNING id INTO v_admin_id;
  ELSE
    UPDATE public.platform_admins
       SET role           = 'owner',
           is_active      = true,
           deactivated_at = NULL
     WHERE id = v_admin_id;
  END IF;

  -- 3. Forçar re-enroll de MFA no próximo login (consumido pelo middleware Sprint 11)
  UPDATE public.profiles
     SET mfa_reset_required = true
   WHERE id = v_profile_id;

  -- 4. Audit row na MESMA transação (INV-10, G-21)
  INSERT INTO public.audit_log (
    actor_profile_id, actor_email_snapshot, action, target_type, target_id, target_organization_id,
    diff_before, diff_after, ip_address, user_agent, metadata
  ) VALUES (
    v_profile_id,
    lower(trim(p_email)),
    'break_glass.recover_owner',
    'profile',
    v_profile_id,
    NULL,
    CASE WHEN v_was_active IS NULL THEN NULL
         ELSE jsonb_build_object('was_active', v_was_active, 'role', v_old_role) END,
    jsonb_build_object('is_active', true, 'role', 'owner'),
    NULL,
    'cli/break-glass.ts',
    jsonb_build_object(
      'operator',          p_operator,
      'origin_host',       p_origin_host,
      'platform_admin_id', v_admin_id,
      'restored_role',     'owner'
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'profile_id',        v_profile_id,
    'platform_admin_id', v_admin_id,
    'audit_log_id',      v_audit_id,
    'was_active',        v_was_active,
    'old_role',          v_old_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.break_glass_recover_owner(text, text, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.break_glass_recover_owner(text, text, text) TO   service_role;

COMMENT ON FUNCTION public.break_glass_recover_owner(text, text, text) IS
  'Sprint admin_12 — Restaura owner ativo + força re-enroll MFA + audit. Service-role only. Chamado APENAS por scripts/break-glass.ts. INV-10 (audit obrigatório), G-21 (double-key).';

-- Fim da migration.
