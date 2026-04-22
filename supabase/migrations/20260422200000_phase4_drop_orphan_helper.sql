-- Migration: Phase 4 — Drop orphan get_user_organization_id() helper
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 4 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Purpose:
--   After Phase 2, no RLS policy references public.get_user_organization_id()
--   anymore — the canonical JWT claim replaced it. This migration drops the
--   helper to prevent it being re-adopted by future migrations.
--
-- Safety:
--   A defensive DO block aborts the migration if any policy expression still
--   references the helper. This catches accidental regressions introduced
--   between Phase 2 and now.

BEGIN;

DO $$
DECLARE
  leftover_count int;
BEGIN
  SELECT COUNT(*) INTO leftover_count
  FROM pg_policy p
  WHERE pg_get_expr(p.polqual,      p.polrelid) ILIKE '%get_user_organization_id%'
     OR pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%get_user_organization_id%';

  IF leftover_count > 0 THEN
    RAISE EXCEPTION
      'Cannot drop get_user_organization_id(): still referenced by % policy expression(s). Audit policies and rewrite them to the JWT claim pattern before re-running this migration.',
      leftover_count;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_user_organization_id();

COMMIT;
