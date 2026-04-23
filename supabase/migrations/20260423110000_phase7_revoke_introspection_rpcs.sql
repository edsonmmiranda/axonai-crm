-- Migration: Phase 7 — Restrict introspection RPCs to service_role only
-- Created:  2026-04-23
--
-- Problem:
--   The 8 framework helper RPCs from 00000000000000_framework_bootstrap.sql were
--   granted to BOTH `authenticated` and `service_role`. This means any logged-in
--   user could call:
--
--     SELECT * FROM public.get_table_policies('leads');
--     SELECT * FROM public.get_table_policy_checks('leads');
--     SELECT * FROM public.get_table_foreign_keys('profiles');
--
--   ...and read back the exact RLS expressions, FK relationships, indexes,
--   triggers, and column structure of every public.* table. This does not leak
--   tenant data, but it leaks the BLUEPRINT of the security model — a clear
--   information-disclosure concern.
--
-- Intent:
--   These helpers were designed for the @db-admin / @db-auditor framework
--   agents, which run with `service_role`. There is no application-layer
--   reason for `authenticated` users to introspect the schema.
--
-- Fix:
--   Revoke EXECUTE from `authenticated` on all 8 helpers. Keep `service_role`
--   so framework agents continue working.

REVOKE EXECUTE ON FUNCTION public.get_schema_tables()             FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_columns(text)         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_indexes(text)         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_policies(text)        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_triggers(text, text)  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_foreign_keys(text)    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rls_status(text)            FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_table_policy_checks(text)   FROM authenticated;
