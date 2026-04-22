-- Migration: Phase 3 — Pointwise fixes (FK cascade, close wide-open policies, missing UPDATE)
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 3 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Scope (5 fixes):
--   1. loss_reasons.organization_id FK: ON DELETE NO ACTION → CASCADE
--      Every other domain table cascades when the parent org is deleted;
--      loss_reasons was the lone exception. Deleting an org today would
--      error with a FK violation.
--
--   2. lead_tags: add missing UPDATE policy.
--      The table had SELECT/INSERT/DELETE but no UPDATE, so updating tag
--      metadata would silently fail under RLS.
--
--   3. profiles "Allow profile creation": `WITH CHECK (true)` → `id = auth.uid()`.
--      The wide-open INSERT let any authenticated user create a profile row
--      for any other user_id. Now restricted to one's own row.
--
--   4. invitations "Allow invitation acceptance": `USING (true)` → invitee
--      must match their authenticated email. The wide-open UPDATE let any
--      user accept any invitation, collapsing the whole invitation model.
--
--   5. organizations "Allow organization creation during signup": `WITH CHECK (true)`
--      → restricted to users who do not already belong to an organization
--      (no profile row with organization_id IS NOT NULL). Prevents a logged-in
--      user from spawning unlimited orgs after signup is complete. First-org
--      creation during signup still works (profile is absent or NULL at that
--      point).

BEGIN;

-- ============================================================================
-- 1. loss_reasons FK → CASCADE
-- ============================================================================
ALTER TABLE public.loss_reasons
  DROP CONSTRAINT IF EXISTS loss_reasons_organization_id_fkey;

ALTER TABLE public.loss_reasons
  ADD CONSTRAINT loss_reasons_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE CASCADE;

-- ============================================================================
-- 2. lead_tags — add UPDATE policy
-- ============================================================================
DROP POLICY IF EXISTS "Users can update lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can update lead tags from their organization" ON public.lead_tags
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- 3. profiles — restrict self-INSERT to own user_id
-- ============================================================================
DROP POLICY IF EXISTS "Allow profile creation" ON public.profiles;
CREATE POLICY "Allow profile creation" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ============================================================================
-- 4. invitations — restrict acceptance to the invited email
-- ============================================================================
DROP POLICY IF EXISTS "Allow invitation acceptance" ON public.invitations;
CREATE POLICY "Allow invitation acceptance" ON public.invitations
  FOR UPDATE TO authenticated
  USING (email = (auth.jwt() ->> 'email'))
  WITH CHECK (email = (auth.jwt() ->> 'email'));

-- ============================================================================
-- 5. organizations — restrict creation to users without an org yet
-- ============================================================================
DROP POLICY IF EXISTS "Allow organization creation during signup" ON public.organizations;
CREATE POLICY "Allow organization creation during signup" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id IS NOT NULL
    )
  );

COMMIT;
