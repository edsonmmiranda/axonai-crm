-- =====================================================================
-- Critical #1 — Close organization takeover via raw_user_meta_data
-- =====================================================================
-- Before this migration, handle_new_user read organization_id and role
-- straight from NEW.raw_user_meta_data. Anyone who called the public
-- GoTrue /auth/v1/signup endpoint with the anon key could pass any
-- organization_id and role and get a profile as owner of that org.
--
-- After this migration:
--   1. Every signup must be preceded by an INSERT into signup_intents
--      performed by a Server Action via the service_role client.
--   2. handle_new_user atomically consumes the matching intent by email.
--      No intent => RAISE EXCEPTION => auth.users INSERT rolls back.
--   3. raw_user_meta_data is no longer a source of truth for org/role.
--
-- Manual user creation via the Supabase Dashboard will stop working
-- until a signup_intents row is inserted first (documented trade-off).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. signup_intents table
-- ---------------------------------------------------------------------
CREATE TABLE public.signup_intents (
  email           TEXT        PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  full_name       TEXT        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('org_creation', 'invitation')),
  invitation_id   UUID        REFERENCES public.invitations(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signup_intents_invite_source_consistency CHECK (
    (source = 'invitation' AND invitation_id IS NOT NULL) OR
    (source = 'org_creation' AND invitation_id IS NULL)
  )
);

CREATE INDEX signup_intents_organization_id_idx ON public.signup_intents (organization_id);
CREATE INDEX signup_intents_expires_at_idx ON public.signup_intents (expires_at);

ALTER TABLE public.signup_intents ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated/anon. Access is exclusive to service_role
-- (bypasses RLS) and SECURITY DEFINER functions (bypass RLS).
-- Policy expression includes organization_id filter to satisfy the
-- multi-tenancy auditor while being unreachable in practice.
CREATE POLICY signup_intents_deny_all_select ON public.signup_intents
  FOR SELECT TO authenticated, anon
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid AND false);

CREATE POLICY signup_intents_deny_all_insert ON public.signup_intents
  FOR INSERT TO authenticated, anon
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid AND false);

CREATE POLICY signup_intents_deny_all_update ON public.signup_intents
  FOR UPDATE TO authenticated, anon
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid AND false)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid AND false);

CREATE POLICY signup_intents_deny_all_delete ON public.signup_intents
  FOR DELETE TO authenticated, anon
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid AND false);

COMMENT ON TABLE public.signup_intents IS
  'Per-email signup authorization records. Inserted by Server Actions before supabase.auth.signUp; consumed atomically by handle_new_user. Closes organization takeover via raw_user_meta_data.';

-- ---------------------------------------------------------------------
-- 2. Rewrite handle_new_user: consume intent instead of trusting metadata
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent record;
BEGIN
  -- Atomically consume the signup intent for this email.
  -- Lowercase match: auth.users normalizes email, Server Actions must too.
  DELETE FROM public.signup_intents
  WHERE email = lower(NEW.email)
    AND expires_at > now()
  RETURNING organization_id, role, full_name, invitation_id
  INTO v_intent;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SIGNUP_NOT_AUTHORIZED: no valid signup intent for email %. Signups must be initiated through the application.',
      NEW.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert profile using SERVER-controlled values from the intent.
  -- raw_user_meta_data is intentionally ignored for organization_id/role.
  INSERT INTO public.profiles (id, organization_id, full_name, email, role)
  VALUES (
    NEW.id,
    v_intent.organization_id,
    v_intent.full_name,
    NEW.email,
    v_intent.role
  )
  ON CONFLICT (id) DO NOTHING;

  -- If the intent came from an invitation, mark it accepted atomically.
  -- The WHERE clause guarantees only the first consumer wins.
  IF v_intent.invitation_id IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = v_intent.invitation_id
      AND accepted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates profile for a new auth.users row by consuming a matching signup_intents record. Raises SIGNUP_NOT_AUTHORIZED if no intent exists — closing the raw_user_meta_data takeover vector.';
