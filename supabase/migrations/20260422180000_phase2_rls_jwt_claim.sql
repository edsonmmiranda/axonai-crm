-- Migration: Phase 2 — Canonicalize RLS policies to use JWT organization_id claim
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 2 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Purpose:
--   Replace three legacy patterns with the canonical one from
--   docs/conventions/standards.md §Multi-tenancy:
--
--     Legacy A (helper):
--       organization_id = get_user_organization_id()
--
--     Legacy B (IN subquery on profiles):
--       organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
--
--     Legacy C (scalar subquery on profiles):
--       organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
--
--     Canonical:
--       organization_id = (auth.jwt() ->> 'organization_id')::uuid
--
-- Why:
--   The canonical form is a constant-folded JWT lookup — no profile table
--   access, no subquery, O(1) per row. The legacy patterns hit `profiles`
--   once per row unless the planner inlines them.
--
-- Tables rewritten (45 policies):
--   organizations, profiles, invitations, leads, lead_tags, tags,
--   funnels, funnel_stages, products, product_images, product_documents,
--   loss_reasons, whatsapp_groups
--
-- Kept untouched (3 policies — Phase 3 handles them):
--   organizations "Allow organization creation during signup" (INSERT true)
--   invitations   "Allow invitation acceptance"               (UPDATE true)
--   profiles      "Allow profile creation"                    (INSERT true)
--
-- Kept untouched (1 policy — already correct):
--   profiles "Users can update own profile" (id = auth.uid())
--
-- Side fix:
--   whatsapp_groups DELETE was using `auth.jwt() ->> 'role'` which returns
--   the Postgres role ("authenticated"), not the app role — so admins could
--   never delete. Rewritten to use the profile subquery pattern matching
--   other admin-only policies in this migration.
--
-- Transition note (operational):
--   After applying, users with tokens issued before the hook was activated
--   will temporarily lose access. Token refresh (default ~1h) picks up the
--   new claim. Force logout/login for faster remediation if needed.

BEGIN;

-- ============================================================================
-- organizations
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own organization" ON public.organizations;
CREATE POLICY "Users can view own organization" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Only owners can update organization" ON public.organizations;
CREATE POLICY "Only owners can update organization" ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'::text
    )
  )
  WITH CHECK (
    id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'::text
    )
  );

-- ============================================================================
-- profiles  (self-table admin checks use a subquery — intentional, matches
-- original. Inner query is bound by auth.uid(), so RLS recursion resolves.)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view org profiles" ON public.profiles;
CREATE POLICY "Users can view org profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can update organization profiles" ON public.profiles;
CREATE POLICY "Admins can update organization profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- "Users can update own profile" (id = auth.uid()) — NOT rewritten, correct.
-- "Allow profile creation" (INSERT true) — NOT rewritten, Phase 3 handles it.

-- ============================================================================
-- invitations
-- ============================================================================
DROP POLICY IF EXISTS "Users can view org invitations" ON public.invitations;
CREATE POLICY "Users can view org invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Enable select for organization admins" ON public.invitations;
CREATE POLICY "Enable select for organization admins" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "Admins can create invitations" ON public.invitations;
CREATE POLICY "Admins can create invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "Enable update for organization admins" ON public.invitations;
CREATE POLICY "Enable update for organization admins" ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "Enable delete for organization admins" ON public.invitations;
CREATE POLICY "Enable delete for organization admins" ON public.invitations
  FOR DELETE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- "Allow invitation acceptance" (UPDATE true) — NOT rewritten, Phase 3.

-- ============================================================================
-- leads
-- ============================================================================
DROP POLICY IF EXISTS "Users can view leads of their organization" ON public.leads;
CREATE POLICY "Users can view leads of their organization" ON public.leads
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can create leads in their organization" ON public.leads;
CREATE POLICY "Users can create leads in their organization" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update leads in their organization" ON public.leads;
CREATE POLICY "Users can update leads in their organization" ON public.leads
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can delete leads" ON public.leads;
CREATE POLICY "Admins can delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ============================================================================
-- lead_tags  (now has its own organization_id column — no parent JOIN needed)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can view lead tags from their organization" ON public.lead_tags
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can create lead tags for their organization" ON public.lead_tags;
CREATE POLICY "Users can create lead tags for their organization" ON public.lead_tags
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can delete lead tags from their organization" ON public.lead_tags
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- No UPDATE policy exists — Phase 3 adds it.

-- ============================================================================
-- tags
-- ============================================================================
DROP POLICY IF EXISTS "Users can view tags from their organization" ON public.tags;
CREATE POLICY "Users can view tags from their organization" ON public.tags
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can create tags for their organization" ON public.tags;
CREATE POLICY "Users can create tags for their organization" ON public.tags
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update tags from their organization" ON public.tags;
CREATE POLICY "Users can update tags from their organization" ON public.tags
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can delete tags" ON public.tags;
CREATE POLICY "Admins can delete tags" ON public.tags
  FOR DELETE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ============================================================================
-- funnels
-- ============================================================================
DROP POLICY IF EXISTS "Users can view funnels of their organization" ON public.funnels;
CREATE POLICY "Users can view funnels of their organization" ON public.funnels
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can manage funnels" ON public.funnels;
CREATE POLICY "Admins can manage funnels" ON public.funnels
  FOR ALL TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ============================================================================
-- funnel_stages  (now has its own organization_id column)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view stages of their organization funnels" ON public.funnel_stages;
CREATE POLICY "Users can view stages of their organization funnels" ON public.funnel_stages
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can manage stages" ON public.funnel_stages;
CREATE POLICY "Admins can manage stages" ON public.funnel_stages
  FOR ALL TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ============================================================================
-- products
-- ============================================================================
DROP POLICY IF EXISTS "Users can view products from their organization" ON public.products;
CREATE POLICY "Users can view products from their organization" ON public.products
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can insert products in their organization" ON public.products;
CREATE POLICY "Users can insert products in their organization" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Users can update products in their organization" ON public.products;
CREATE POLICY "Users can update products in their organization" ON public.products
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete products in their organization" ON public.products;
CREATE POLICY "Users can delete products in their organization" ON public.products
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- product_images  (now has its own organization_id column)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view product images from their organization" ON public.product_images;
CREATE POLICY "Users can view product images from their organization" ON public.product_images
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can insert product images" ON public.product_images;
CREATE POLICY "Users can insert product images" ON public.product_images
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND uploaded_by  = auth.uid()
  );

DROP POLICY IF EXISTS "Users can update product images" ON public.product_images;
CREATE POLICY "Users can update product images" ON public.product_images
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete product images" ON public.product_images;
CREATE POLICY "Users can delete product images" ON public.product_images
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- product_documents  (now has its own organization_id column)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view product documents from their organization" ON public.product_documents;
CREATE POLICY "Users can view product documents from their organization" ON public.product_documents
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can insert product documents" ON public.product_documents;
CREATE POLICY "Users can insert product documents" ON public.product_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND uploaded_by  = auth.uid()
  );

DROP POLICY IF EXISTS "Users can update product documents" ON public.product_documents;
CREATE POLICY "Users can update product documents" ON public.product_documents
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete product documents" ON public.product_documents;
CREATE POLICY "Users can delete product documents" ON public.product_documents
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- loss_reasons
-- ============================================================================
DROP POLICY IF EXISTS "Users can view loss_reasons from their organization" ON public.loss_reasons;
CREATE POLICY "Users can view loss_reasons from their organization" ON public.loss_reasons
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can create loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can create loss_reasons in their organization" ON public.loss_reasons
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can update loss_reasons in their organization" ON public.loss_reasons
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can delete loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can delete loss_reasons in their organization" ON public.loss_reasons
  FOR DELETE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ============================================================================
-- whatsapp_groups
-- (DELETE was broken — `auth.jwt() ->> 'role'` returns the Postgres role, not
--  the app-level role. Rewriting to use profile subquery like other tables.)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view whatsapp groups of their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can view whatsapp groups of their organization" ON public.whatsapp_groups
  FOR SELECT TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can create whatsapp groups in their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can create whatsapp groups in their organization" ON public.whatsapp_groups
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Users can update whatsapp groups in their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can update whatsapp groups in their organization" ON public.whatsapp_groups
  FOR UPDATE TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

DROP POLICY IF EXISTS "Admins can delete whatsapp groups" ON public.whatsapp_groups;
CREATE POLICY "Admins can delete whatsapp groups" ON public.whatsapp_groups
  FOR DELETE TO authenticated
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

COMMIT;
