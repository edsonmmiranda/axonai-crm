-- Migration: Phase 6 — Multi-tenancy hardening (profiles + invitations)
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 6 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Why:
--   The Phase 5 audit (DB Auditor) flagged 3 policies that did not filter by
--   organization_id, violating standards.md → Multi-tenancy rule §2:
--
--     1. profiles."Allow profile creation" (INSERT)
--          WITH CHECK: (id = auth.uid())
--          → no organization_id filter
--
--     2. invitations."Allow invitation acceptance" (UPDATE)
--          USING / WITH CHECK: (email = (auth.jwt() ->> 'email'))
--          → no organization_id filter; allowed cross-tenant write by email match
--
--     3. profiles."Users can update own profile" (UPDATE)
--          USING: (id = auth.uid()) — no organization_id filter, no WITH CHECK
--          → allowed user to rewrite own organization_id via UPDATE
--
--   Code-path mapping confirmed two of these were dead policies:
--     - profiles INSERT is performed exclusively by the on_auth_user_created
--       trigger calling handle_new_user() (SECURITY DEFINER, bypasses RLS).
--       No application code ever inserts into profiles directly.
--     - invitations UPDATE (accept) is performed via the service_role client
--       in signupWithInviteAction (src/lib/actions/auth.ts), which also
--       bypasses RLS.
--
--   So the dead policies are dropped, the live UPDATE on profiles is hardened,
--   and a deny-explicit INSERT policy is added on profiles to document the
--   "trigger-only" architecture and keep the auditor's command-coverage check
--   green (defense in depth).
--
-- Tables touched:
--   invitations  (drop 1 dead policy)
--   profiles     (drop 1 dead policy, replace 1 live policy, add 1 deny-explicit)
--
-- Not touched: any other table — Phase 5 left them 100% conformant.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop dead policies (no application call-site exists; both bypassed by
--    SECURITY DEFINER trigger / service_role client).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow profile creation" ON public.profiles;
DROP POLICY IF EXISTS "Allow invitation acceptance" ON public.invitations;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Harden self-update of profile:
--      a. add organization_id filter to USING (cross-tenant defense in depth)
--      b. add symmetric WITH CHECK (prevent rewriting own organization_id)
--      c. tighten role from public to authenticated
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    AND organization_id = (auth.jwt() ->> 'organization_id')::uuid
  )
  WITH CHECK (
    id = auth.uid()
    AND organization_id = (auth.jwt() ->> 'organization_id')::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Deny-explicit INSERT on profiles.
--    Rationale: profiles rows are inserted exclusively by the
--    on_auth_user_created trigger (handle_new_user, SECURITY DEFINER), which
--    bypasses RLS. This policy documents that intent in SQL and ensures the
--    DB Auditor's Check 7 (4-command coverage) stays green.
--    WITH CHECK (false) blocks any direct INSERT from authenticated clients.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Profiles INSERT is trigger-only" ON public.profiles;

CREATE POLICY "Profiles INSERT is trigger-only" ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
