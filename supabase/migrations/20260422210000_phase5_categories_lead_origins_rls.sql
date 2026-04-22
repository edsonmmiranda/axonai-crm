-- Migration: Phase 5 — Canonicalize RLS for categories and lead_origins
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 5 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Why:
--   These two tables were omitted from Phase 2 (20260422180000). Their policies
--   still use the legacy scalar subquery pattern:
--
--     organization_id = (SELECT profiles.organization_id FROM profiles
--                        WHERE profiles.id = auth.uid())
--
--   Replaced with the canonical JWT claim form:
--
--     organization_id = (auth.jwt() ->> 'organization_id')::uuid
--
--   Additionally, the UPDATE policy on both tables lacked a WITH CHECK clause,
--   which allowed a row to be re-assigned to a different organization_id on
--   UPDATE. Both issues are fixed here.
--
-- Tables rewritten:
--   categories  (4 policies: SELECT, INSERT, UPDATE, DELETE)
--   lead_origins (4 policies: SELECT, INSERT, UPDATE, DELETE)
--
-- Not touched (intentional exceptions documented in Phase 2/3):
--   invitations "Allow invitation acceptance"  — email-based, needed pre-org-JWT
--   profiles    "Allow profile creation"       — id-based, needed during onboarding
--   profiles    "Users can update own profile" — id-based, intentional self-edit

BEGIN;

-- ============================================================================
-- categories
-- ============================================================================
DROP POLICY IF EXISTS "Users can view categories from their organization" ON public.categories;
CREATE POLICY "Users can view categories from their organization" ON public.categories
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can insert categories for their organization" ON public.categories;
CREATE POLICY "Users can insert categories for their organization" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update categories from their organization" ON public.categories;
CREATE POLICY "Users can update categories from their organization" ON public.categories
  FOR UPDATE TO authenticated
  USING  (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete categories from their organization" ON public.categories;
CREATE POLICY "Users can delete categories from their organization" ON public.categories
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- lead_origins
-- ============================================================================
DROP POLICY IF EXISTS "Users can view origins from their organization" ON public.lead_origins;
CREATE POLICY "Users can view origins from their organization" ON public.lead_origins
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can insert origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can insert origins for their organization" ON public.lead_origins
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can update origins for their organization" ON public.lead_origins
  FOR UPDATE TO authenticated
  USING  (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can delete origins for their organization" ON public.lead_origins
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

COMMIT;
