-- Migration: Framework audit helpers (FK / RLS status / WITH CHECK introspection)
-- Created:  2026-04-22
-- Sprint:   n/a (framework upgrade triggered by @db-auditor preflight)
-- Schema Source: REAL DATABASE (pg_proc probe — 3 helpers missing)
--
-- Why this exists:
--   The framework update of 2026-04-22 added the @db-auditor agent, which
--   requires 7 introspection helpers. The canonical definitions live in
--   00000000000000_framework_bootstrap.sql, but that file is already marked
--   as applied on the remote — `supabase db push` would skip it. This
--   incremental migration propagates the 3 new helpers to the remote DB.
--
--   Definitions are identical to the ones now present in the bootstrap.
--   CREATE OR REPLACE keeps this idempotent: if the bootstrap ever replays
--   (fresh environment), re-running this migration is a no-op.

-- ---------------------------------------------------------------------------
-- get_table_foreign_keys(p_table_name text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_foreign_keys(p_table_name text)
RETURNS TABLE (
  constraint_name text,
  column_name text,
  referenced_table text,
  referenced_column text,
  on_delete text,
  on_update text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tc.constraint_name::text,
    kcu.column_name::text,
    ccu.table_name::text  AS referenced_table,
    ccu.column_name::text AS referenced_column,
    rc.delete_rule::text  AS on_delete,
    rc.update_rule::text  AS on_update
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name   = rc.constraint_name
   AND tc.constraint_schema = rc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON rc.unique_constraint_name   = ccu.constraint_name
   AND rc.unique_constraint_schema = ccu.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema    = 'public'
    AND tc.table_name      = p_table_name
  ORDER BY tc.constraint_name, kcu.ordinal_position;
$$;

-- ---------------------------------------------------------------------------
-- get_rls_status(p_table_name text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rls_status(p_table_name text)
RETURNS TABLE (
  rls_enabled boolean,
  rls_forced  boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND c.relkind = 'r';
$$;

-- ---------------------------------------------------------------------------
-- get_table_policy_checks(p_table_name text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_policy_checks(p_table_name text)
RETURNS TABLE (
  policy_name           text,
  with_check_definition text,
  policy_command        "char"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.polname::text                               AS policy_name,
    pg_get_expr(p.polwithcheck, p.polrelid)::text AS with_check_definition,
    p.polcmd                                      AS policy_command
  FROM pg_policy p
  JOIN pg_class c     ON p.polrelid    = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
  ORDER BY p.polname;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_table_foreign_keys(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rls_status(text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_policy_checks(text)  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_table_foreign_keys(text)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_rls_status(text)           FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_policy_checks(text)  FROM anon, PUBLIC;
