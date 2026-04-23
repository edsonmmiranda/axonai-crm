-- Migration: Phase 11 — Drop dead function + lock down PUBLIC EXECUTE + harden email sync
-- Created:  2026-04-23
--
-- Discovered during the post-Phase-10 audit pass.
--
-- 1. CRITICAL — public.initialize_tenant(text, text, text, uuid):
--    SECURITY DEFINER, granted to anon AND authenticated, takes a `p_user_id`
--    parameter, has NO authorization check (the function body comment literally
--    says "We rely on the caller to ensure p_user_id is valid"). An anonymous
--    caller could invoke it to:
--      - Create unlimited fake organizations (slug squatting / DoS / data pollution)
--      - Attempt to claim ownership of any user_id (blocked by profiles PK only
--        when the victim already has a row; the org creation still happens)
--    Code search: NOT referenced anywhere (src/, migrations, docs). Dead code
--    from an earlier signup design. Drop it.
--
-- 2. CRITICAL — public.get_table_policies_full(text, text):
--    SECURITY DEFINER framework helper exposed to anon + authenticated. Returns
--    full RLS expressions (USING + WITH CHECK + roles + permissive flag) for
--    any table in any schema. Same blueprint-leak class as Phase 7's helpers,
--    but this one was created out-of-band and missed by Phase 7's REVOKE list.
--    Used only by @db-auditor (service_role). Revoke from anon + authenticated.
--
-- 3. MEDIUM — public.handle_auth_user_email_sync():
--    SECURITY DEFINER trigger function backing the auth.users trigger
--    `on_auth_user_email_change` (AFTER UPDATE). It IS in active use — the
--    earlier audit query missed it because information_schema.triggers does
--    not expose `auth.*` triggers under the role we used. KEEP the function,
--    but harden it:
--      a) Add `SET search_path = public` (was missing — search_path injection risk)
--      b) Revoke EXECUTE from PUBLIC + anon + authenticated (the trigger
--         mechanism does not need an explicit EXECUTE grant on a SECURITY
--         DEFINER function — it runs as the function owner regardless)
--
-- 4. LOW (defense-in-depth) — PUBLIC EXECUTE on:
--      handle_new_user()                      (trigger fn — safe but bad hygiene)
--      set_product_image_primary(uuid)        (NOT_AUTHENTICATED guard protects, but anon shouldn't see it)
--      reorder_product_images(uuid, uuid[])   (same)
--    Revoke PUBLIC on all three.

BEGIN;

-- ============================================================================
-- 1. Drop public.initialize_tenant — unused, critical hole
-- ============================================================================
DROP FUNCTION IF EXISTS public.initialize_tenant(text, text, text, uuid);

-- ============================================================================
-- 2. Harden public.handle_auth_user_email_sync (do NOT drop — trigger uses it)
--    CREATE OR REPLACE preserves the existing trigger binding.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_sync() FROM anon, authenticated, PUBLIC;

-- ============================================================================
-- 3. Revoke get_table_policies_full from anon + authenticated
--    (Missed by Phase 7 because this helper was created outside the bootstrap
--    migration. Same blueprint-leak rationale.)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.get_table_policies_full(text, text) FROM anon, authenticated, PUBLIC;

-- ============================================================================
-- 4. Revoke PUBLIC EXECUTE on remaining sensitive functions
-- ============================================================================

-- Trigger function — only the auth.users trigger context should reach it.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- Atomic product-image RPCs — keep grant to authenticated (callers from app),
-- revoke from anon + PUBLIC.
REVOKE EXECUTE ON FUNCTION public.set_product_image_primary(uuid)            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reorder_product_images(uuid, uuid[])       FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_product_image_primary(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_product_images(uuid, uuid[])       TO authenticated;

COMMIT;
