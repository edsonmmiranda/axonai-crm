-- Migration: Fix invitations SELECT — restrict to admins only
-- Created:  2026-04-23
--
-- Problem:
--   Two permissive SELECT policies existed on public.invitations:
--     1. "Users can view org invitations"       — org match only (any member)
--     2. "Enable select for organization admins" — org match + admin/owner role
--
--   PostgreSQL combines permissive policies with OR, so policy #1 made #2
--   irrelevant — any org member could read all invitations regardless of role.
--
-- Fix:
--   Drop the wide-open policy. The admin-only policy already uses the canonical
--   JWT claim pattern and covers owner + admin roles correctly.

DROP POLICY IF EXISTS "Users can view org invitations" ON public.invitations;
