-- Migration: Auth user provisioning (Sprint 03)
-- Created: 2026-04-15
-- Sprint: 03 — Auth & Tenancy
-- Schema Source: REAL DATABASE (probed 2026-04-15)
--
-- Purpose:
--   1. Install metadata-driven trigger on auth.users so that inserting a new
--      authenticated user automatically provisions a row in public.profiles
--      using organization_id + full_name + role read from raw_user_meta_data.
--      This resolves the profiles.organization_id NOT NULL constraint without
--      requiring a second round-trip after signUp().
--   2. Constrain role enum to the domain values used by the application layer
--      ('owner' | 'admin' | 'member') on profiles and invitations. The live
--      database was probed and contains no rows with role='user' (the old
--      default) — so no data backfill is required, only the default change
--      and the CHECK constraint.
--
-- Idempotent: uses CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and DO blocks
-- guarded by information_schema lookups. Safe to re-run.
--
-- Non-destructive: does not remove or modify any pre-existing trigger. The
-- only trigger on auth.users is `on_auth_user_email_change` (AFTER UPDATE)
-- which is left untouched.

-- ============================================================================
-- 1. Role enum constraint — profiles
-- ============================================================================

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

-- ============================================================================
-- 2. Role enum constraint — invitations
-- ============================================================================

ALTER TABLE public.invitations
  ALTER COLUMN role SET DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'invitations_role_check'
  ) THEN
    ALTER TABLE public.invitations
      ADD CONSTRAINT invitations_role_check
      CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

-- ============================================================================
-- 3. handle_new_user() — provisions public.profiles from auth.users metadata
-- ============================================================================
-- Reads three fields from auth.users.raw_user_meta_data:
--   - organization_id (UUID, REQUIRED) — set by server action before signUp()
--   - full_name        (text,  optional — falls back to email local part)
--   - role             (text,  optional — falls back to 'member')
--
-- If organization_id is missing, raises an exception so that Supabase auth.signUp
-- returns an error instead of silently creating an orphan auth.users row.
-- SECURITY DEFINER is required because the trigger executes in the auth schema
-- context and needs to INSERT into public.profiles bypassing RLS.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    UUID;
  v_full_name TEXT;
  v_role      TEXT;
BEGIN
  v_org_id    := (NEW.raw_user_meta_data ->> 'organization_id')::UUID;
  v_full_name := COALESCE(
                   NEW.raw_user_meta_data ->> 'full_name',
                   split_part(NEW.email, '@', 1)
                 );
  v_role      := COALESCE(NEW.raw_user_meta_data ->> 'role', 'member');

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION
      'handle_new_user: organization_id missing from raw_user_meta_data for user %',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION
      'handle_new_user: invalid role "%" in raw_user_meta_data for user %',
      v_role, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.profiles (id, organization_id, full_name, email, role)
  VALUES (NEW.id, v_org_id, v_full_name, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Trigger on_auth_user_created — fires after INSERT on auth.users
-- ============================================================================
-- Confirmed via pg_information_schema probe (2026-04-15): no pre-existing
-- trigger of this name exists on auth.users. DROP IF EXISTS is for idempotency
-- only — it does not remove production behavior.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
