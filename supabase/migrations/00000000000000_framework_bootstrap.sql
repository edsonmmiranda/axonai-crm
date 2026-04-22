-- ============================================================================
-- SAAS FACTORY FRAMEWORK — BOOTSTRAP MIGRATION
-- ============================================================================
-- Purpose: Install the RPC helper functions that @db-admin uses for real-schema
--          introspection. Must be the FIRST migration applied to any project
--          that uses this framework.
--
-- Idempotent: Uses CREATE OR REPLACE so it can be re-run safely.
-- Security:   All helpers are SECURITY DEFINER and read-only (information_schema
--             and pg_catalog). They return metadata only, never user data.
--
-- Usage (from @db-admin):
--   const { data: tables }   = await supabase.rpc('get_schema_tables');
--   const { data: columns }  = await supabase.rpc('get_table_columns',  { p_table_name: 'leads' });
--   const { data: indexes }  = await supabase.rpc('get_table_indexes',  { p_table_name: 'leads' });
--   const { data: policies } = await supabase.rpc('get_table_policies', { p_table_name: 'leads' });
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_schema_tables()
--    Returns every BASE TABLE in the public schema.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_schema_tables()
RETURNS TABLE (
  table_name text,
  table_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.table_name::text,
    t.table_type::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_table_columns(p_table_name text)
--    Returns the column metadata for a given public-schema table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_columns(p_table_name text)
RETURNS TABLE (
  column_name text,
  data_type text,
  is_nullable text,
  column_default text,
  character_maximum_length integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text,
    c.character_maximum_length
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table_name
  ORDER BY c.ordinal_position;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_table_indexes(p_table_name text)
--    Returns indexes defined on a given public-schema table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_indexes(p_table_name text)
RETURNS TABLE (
  index_name text,
  index_definition text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.indexname::text,
    i.indexdef::text
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
    AND i.tablename = p_table_name
  ORDER BY i.indexname;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_table_policies(p_table_name text)
--    Returns the RLS policies defined on a given public-schema table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_policies(p_table_name text)
RETURNS TABLE (
  policy_name text,
  policy_definition text,
  policy_command "char"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.polname::text                          AS policy_name,
    pg_get_expr(p.polqual, p.polrelid)::text AS policy_definition,
    p.polcmd                                 AS policy_command
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
  ORDER BY p.polname;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_table_triggers(p_schema text, p_table_name text)
--    Returns triggers defined on a given table in any schema (including auth.*).
--    Read-only. Used by @db-admin to probe pre-existing triggers before writing
--    migrations that would otherwise silently overwrite them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_triggers(p_schema text, p_table_name text)
RETURNS TABLE (
  trigger_name text,
  event_manipulation text,
  action_timing text,
  action_statement text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.trigger_name::text,
    t.event_manipulation::text,
    t.action_timing::text,
    t.action_statement::text
  FROM information_schema.triggers t
  WHERE t.event_object_schema = p_schema
    AND t.event_object_table = p_table_name
  ORDER BY t.trigger_name, t.event_manipulation;
$$;

-- ---------------------------------------------------------------------------
-- 6. get_table_foreign_keys(p_table_name text)
--    Returns foreign-key constraints defined on a given public-schema table,
--    including ON DELETE / ON UPDATE actions. Consumed by @db-auditor to
--    validate that `organization_id` FKs point to the organizations table with
--    an appropriate cascade rule.
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
-- 7. get_rls_status(p_table_name text)
--    Returns whether Row Level Security is enabled and/or forced on a given
--    public-schema table. Consumed by @db-auditor to detect the silent failure
--    mode where policies exist but RLS is disabled (policies become inert).
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
-- 8. get_table_policy_checks(p_table_name text)
--    Returns the WITH CHECK expression of every RLS policy on a given table.
--    Complements get_table_policies (which exposes USING only). Required by
--    @db-auditor because INSERT policies store their expression in WITH CHECK,
--    not USING, and UPDATE policies require both.
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
-- Grants — allow authenticated + service_role to call these helpers.
-- Anonymous callers should NOT be able to introspect the schema.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_schema_tables()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_columns(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_indexes(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_policies(text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_triggers(text, text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_foreign_keys(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rls_status(text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_policy_checks(text)    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_schema_tables()              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_columns(text)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_indexes(text)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_policies(text)         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_triggers(text, text)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_foreign_keys(text)     FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_rls_status(text)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_table_policy_checks(text)    FROM anon, PUBLIC;

-- ============================================================================
-- END OF BOOTSTRAP — @db-admin can now introspect the schema.
-- ============================================================================
