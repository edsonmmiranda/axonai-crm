-- =============================================================================
-- Sprint admin_03: audit_log transacional (INV-6, T-03, T-12, G-03, G-10)
-- =============================================================================
-- O que faz:
--   1. Cria tabela audit_log (append-only, FORCE RLS)
--   2. Revoga INSERT/UPDATE/DELETE/TRUNCATE direto de authenticated/anon
--   3. Policy SELECT para platform admins ativos
--   4. Trigger BEFORE UPDATE/DELETE → rejeita (qualquer role, inclusive service_role)
--   5. Trigger BEFORE TRUNCATE → rejeita
--   6. RPC audit_write (SECURITY DEFINER) — única via de inserção
--
-- ROLLBACK (staging primeiro, depois prod):
--   DROP TRIGGER IF EXISTS audit_log_deny_truncate         ON public.audit_log;
--   DROP TRIGGER IF EXISTS audit_log_deny_update_delete    ON public.audit_log;
--   DROP FUNCTION IF EXISTS public.audit_log_deny_truncate();
--   DROP FUNCTION IF EXISTS public.audit_log_deny_mutation();
--   DROP FUNCTION IF EXISTS public.audit_write(text,text,uuid,uuid,jsonb,jsonb,jsonb,inet,text);
--   DROP TABLE IF EXISTS public.audit_log CASCADE;
--   -- Aviso: remove todo o histórico de audit acumulado. Confirmar com Edson antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  actor_profile_id       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email_snapshot   text,
  action                 text        NOT NULL,
  target_type            text        NOT NULL,
  target_id              uuid,
  target_organization_id uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  diff_before            jsonb,
  diff_after             jsonb,
  ip_address             inet,
  user_agent             text,
  metadata               jsonb
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. Revogar acesso direto de authenticated e anon (B-2 do sanity-checker)
--    Writes só via RPC audit_write (SECURITY DEFINER).
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated, anon;

-- -----------------------------------------------------------------------------
-- 3. Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audit_log_actor_occurred
  ON public.audit_log (actor_profile_id, occurred_at DESC)
  WHERE actor_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_target_org_occurred
  ON public.audit_log (target_organization_id, occurred_at DESC)
  WHERE target_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_action_occurred
  ON public.audit_log (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_occurred
  ON public.audit_log (occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Policy SELECT — platform admins ativos
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "platform_admins_can_read_audit_log" ON public.audit_log;
CREATE POLICY "platform_admins_can_read_audit_log"
  ON public.audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Trigger: BEFORE UPDATE OR DELETE → append-only (cobre todos os roles)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable'
    USING ERRCODE = 'P0001',
          DETAIL  = 'audit_log rows cannot be updated or deleted';
END $$;

DROP TRIGGER IF EXISTS audit_log_deny_update_delete ON public.audit_log;
CREATE TRIGGER audit_log_deny_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_deny_mutation();

-- -----------------------------------------------------------------------------
-- 6. Trigger: BEFORE TRUNCATE — TRUNCATE não dispara DELETE triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_deny_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable'
    USING ERRCODE = 'P0001',
          DETAIL  = 'audit_log cannot be truncated';
END $$;

DROP TRIGGER IF EXISTS audit_log_deny_truncate ON public.audit_log;
CREATE TRIGGER audit_log_deny_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_log_deny_truncate();

-- -----------------------------------------------------------------------------
-- 7. RPC audit_write — única via de inserção (SECURITY DEFINER)
--    Captura actor internamente via auth.uid() / auth.email().
--    Chamada de dentro dos corpos PL/pgSQL das RPCs de ação (Sprints 05+),
--    garantindo atomicidade com a mutation (INV-6, G-03).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_write(
  action                 text,
  target_type            text,
  target_id              uuid    DEFAULT NULL,
  target_organization_id uuid    DEFAULT NULL,
  diff_before            jsonb   DEFAULT NULL,
  diff_after             jsonb   DEFAULT NULL,
  metadata               jsonb   DEFAULT NULL,
  ip_address             inet    DEFAULT NULL,
  user_agent             text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    uuid;
  v_actor_email text;
  v_id          uuid;
BEGIN
  -- Captura actor do contexto JWT da sessão.
  -- Em chain SECURITY DEFINER (ex: admin_suspend_organization → audit_write),
  -- auth.uid() / auth.email() lêem o GUC request.jwt.claims da sessão —
  -- persistem através de chamadas aninhadas (testado em GATE 1).
  v_actor_id    := auth.uid();
  v_actor_email := auth.email();

  INSERT INTO public.audit_log (
    actor_profile_id,
    actor_email_snapshot,
    action,
    target_type,
    target_id,
    target_organization_id,
    diff_before,
    diff_after,
    ip_address,
    user_agent,
    metadata
  ) VALUES (
    v_actor_id,
    v_actor_email,
    audit_write.action,
    audit_write.target_type,
    audit_write.target_id,
    audit_write.target_organization_id,
    audit_write.diff_before,
    audit_write.diff_after,
    audit_write.ip_address,
    audit_write.user_agent,
    audit_write.metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_write(text, text, uuid, uuid, jsonb, jsonb, jsonb, inet, text) TO authenticated, service_role;
