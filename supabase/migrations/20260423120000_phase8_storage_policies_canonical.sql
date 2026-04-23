-- Migration: Phase 8 — Canonicalize storage policies (JWT claim) + admin role check
-- Created:  2026-04-23
--
-- Two problems addressed in one migration (both touch the same 8 policies):
--
-- Problem A — Legacy pattern leftover from before Phase 2:
--   Storage policies on the `products` and `product-documents` buckets still
--   use the scalar subquery on profiles:
--     (storage.foldername(name))[1]::uuid =
--       (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
--   Phase 2 migrated all public.* policies to the JWT claim pattern but
--   storage.objects was not in scope. This migration finishes the job.
--
-- Problem B — Asymmetric role enforcement:
--   The original storage policies enforce only org isolation, leaving role
--   checks (owner/admin for mutations) to the application-layer assertRole.
--   Meanwhile RLS on public.products / product_images / product_documents
--   restricts INSERT/UPDATE/DELETE to admins via the profile subquery. A
--   `member` user calling the Storage API directly with their own token can
--   upload or delete files, bypassing the app-layer guard. We close that gap
--   here by adding the same admin-or-owner check to mutation policies.
--
-- Pattern after this migration:
--   SELECT  → org isolation only (any member can read images/docs of org)
--   INSERT  → org isolation + admin/owner role
--   UPDATE  → org isolation + admin/owner role
--   DELETE  → org isolation + admin/owner role
--
-- This mirrors the public.products policy distribution exactly.

BEGIN;

-- ============================================================================
-- Bucket: products
-- ============================================================================

DROP POLICY IF EXISTS "products_select_org" ON storage.objects;
CREATE POLICY "products_select_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
  );

DROP POLICY IF EXISTS "products_insert_org" ON storage.objects;
CREATE POLICY "products_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "products_update_org" ON storage.objects;
CREATE POLICY "products_update_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "products_delete_org" ON storage.objects;
CREATE POLICY "products_delete_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

-- ============================================================================
-- Bucket: product-documents
-- ============================================================================

DROP POLICY IF EXISTS "product_documents_select_org" ON storage.objects;
CREATE POLICY "product_documents_select_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
  );

DROP POLICY IF EXISTS "product_documents_insert_org" ON storage.objects;
CREATE POLICY "product_documents_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "product_documents_update_org" ON storage.objects;
CREATE POLICY "product_documents_update_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS "product_documents_delete_org" ON storage.objects;
CREATE POLICY "product_documents_delete_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
        = (auth.jwt() ->> 'organization_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

COMMIT;
