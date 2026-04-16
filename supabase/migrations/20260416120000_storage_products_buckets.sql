-- Migration: Storage buckets and RLS for products module (Sprint 06)
-- Created: 2026-04-16
-- Sprint: 06 — Products + Storage
-- Schema Source: REAL DATABASE (probed 2026-04-16)
--
-- Purpose:
--   1. Create two PRIVATE Supabase Storage buckets to back the products module:
--        - 'products'           -> product images  (5MB max, image/jpeg|png|webp)
--        - 'product-documents'  -> product docs    (20MB max, pdf/doc/docx/jpeg/png)
--   2. Create 8 RLS policies on storage.objects (4 per bucket, covering
--      SELECT / INSERT / UPDATE / DELETE) that isolate access by organization.
--      This is defense-in-depth alongside the existing RLS on
--      public.products / public.product_images / public.product_documents.
--
-- Path convention (enforced by policies below):
--   <organization_id>/<product_id>/<uuid>-<sanitized-filename>
-- The first folder segment is the caller's organization UUID. The policies
-- extract it via storage.foldername(name)[1] and compare against the caller's
-- organization_id looked up from public.profiles.
--
-- Role enforcement (owner/admin-only mutations) is handled at the application
-- layer in the Server Actions via assertRole — the Storage policies here
-- enforce only org isolation, mirroring the pattern used on the products
-- table itself.
--
-- Idempotent: buckets use ON CONFLICT DO UPDATE so re-running keeps limits in
-- sync with this SQL; policies use DROP IF EXISTS + CREATE. Safe to re-run.

-- ============================================================================
-- 1. Buckets
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'products',
  'products',
  false,
  5242880, -- 5 * 1024 * 1024 bytes
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-documents',
  'product-documents',
  false,
  20971520, -- 20 * 1024 * 1024 bytes
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. RLS policies — bucket 'products' (images)
-- ============================================================================
-- The shared org-isolation check inlined in every policy is:
--   (storage.foldername(name))[1]::uuid
--     = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())

DROP POLICY IF EXISTS "products_select_org" ON storage.objects;
CREATE POLICY "products_select_org" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "products_insert_org" ON storage.objects;
CREATE POLICY "products_insert_org" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "products_update_org" ON storage.objects;
CREATE POLICY "products_update_org" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "products_delete_org" ON storage.objects;
CREATE POLICY "products_delete_org" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

-- ============================================================================
-- 3. RLS policies — bucket 'product-documents'
-- ============================================================================

DROP POLICY IF EXISTS "product_documents_select_org" ON storage.objects;
CREATE POLICY "product_documents_select_org" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "product_documents_insert_org" ON storage.objects;
CREATE POLICY "product_documents_insert_org" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "product_documents_update_org" ON storage.objects;
CREATE POLICY "product_documents_update_org" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "product_documents_delete_org" ON storage.objects;
CREATE POLICY "product_documents_delete_org" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'product-documents'
    AND (storage.foldername(name))[1]::uuid
      = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );
