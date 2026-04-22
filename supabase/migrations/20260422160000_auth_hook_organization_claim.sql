-- Migration: Custom Access Token Hook — inject organization_id claim into JWT
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 0 of multi-tenancy canonicalization — auditor-driven, no sprint file)
-- Schema Source: REAL DATABASE
--
-- Purpose:
--   Populate a custom claim `organization_id` into the JWT issued by Supabase Auth.
--   Prerequisite for RLS policies to migrate from the current `auth.uid() → profiles`
--   subquery pattern to the canonical `auth.jwt() ->> 'organization_id'` pattern
--   mandated by docs/conventions/standards.md §Multi-tenancy.
--
-- Post-apply step (MANUAL, in the dashboard):
--   Supabase Dashboard → Authentication → Hooks → Custom Access Token →
--   select `public.custom_access_token_hook` → Save.
--   The migration alone does NOT activate the hook — the dashboard flag does.
--
-- Behavior:
--   - Looks up the user's organization_id from public.profiles.
--   - If found: injects claim "organization_id": "<uuid-as-string>".
--   - If NULL (profile not created yet, e.g. mid-signup): leaves claims untouched,
--     so the hook never blocks token issuance for partially-provisioned users.
--
-- Why SECURITY DEFINER:
--   Supabase Auth invokes this hook as role `supabase_auth_admin`. That role
--   does NOT have BYPASSRLS, so with SECURITY INVOKER the SELECT on profiles is
--   subject to RLS — and inside the hook `auth.uid()` is NULL (no session yet,
--   we're *issuing* the token). The existing profiles SELECT policy returns
--   zero rows, and the claim never gets populated.
--   SECURITY DEFINER makes the function run with the owner's privileges
--   (postgres), which bypasses RLS for the profile lookup only.
--   `SET search_path = public` hardens the function against schema injection.

-- ---------------------------------------------------------------------------
-- Function: public.custom_access_token_hook(event jsonb)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims      jsonb;
  user_org_id uuid;
BEGIN
  SELECT organization_id INTO user_org_id
  FROM public.profiles
  WHERE id = (event->>'user_id')::uuid;

  claims := COALESCE(event->'claims', '{}'::jsonb);

  IF user_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(user_org_id::text));
  END IF;

  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants — only supabase_auth_admin may execute the hook.
-- This role is used by GoTrue (Supabase Auth) when issuing / refreshing tokens.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, PUBLIC;

-- supabase_auth_admin needs SELECT on profiles to read the organization_id.
-- The role has BYPASSRLS, so RLS on profiles does not need to be relaxed.
GRANT SELECT ON public.profiles TO supabase_auth_admin;
