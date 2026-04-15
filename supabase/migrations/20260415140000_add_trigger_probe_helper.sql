-- Migration: Add get_table_triggers helper RPC
-- Created: 2026-04-15
-- Sprint: 03
-- Schema Source: REAL DATABASE
--
-- Purpose: Framework helper for @db-admin to probe triggers on any schema/table
--          (including auth.*) before writing migrations that would otherwise
--          silently overwrite pre-existing triggers. Canonical definition lives
--          in supabase/migrations/00000000000000_framework_bootstrap.sql — this
--          catch-up migration syncs the remote with that canonical source.
--
-- Idempotent: CREATE OR REPLACE FUNCTION — safe to re-run.

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

GRANT EXECUTE ON FUNCTION public.get_table_triggers(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_table_triggers(text, text) FROM anon, PUBLIC;
