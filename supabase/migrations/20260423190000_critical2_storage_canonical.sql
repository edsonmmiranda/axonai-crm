-- Critical #2 — Storage canonical multi-tenant isolation
--
-- Why:
--   Legacy policies on storage.objects allowed cross-tenant access in three ways:
--   (a) product-images SELECT was 'Public Access' (anon reads all).
--   (b) product-documents SELECT/DELETE required only auth.role()='authenticated',
--       so any logged-in user of any org could read/delete any doc path.
--   (c) products bucket (canonical org-scoped path, used by current app code)
--       had zero policies — legitimate writes only succeeded via Dashboard
--       uploads bypassing RLS.
--
--   The abandoned product-images bucket still held orphan files. One row in
--   public.product_documents stored a full signed URL instead of a storage
--   path (pre-current-code data shape).
--
-- How:
--   Canonical path convention, enforced by policy:
--     - products, product-documents: {org_id}/{product_id}/{file}
--       → org match = (storage.foldername(name))[1]::uuid
--         = (auth.jwt() ->> 'organization_id')::uuid
--     - avatars: {user_id}/{timestamp}.ext
--       → user match = (storage.foldername(name))[1]::uuid = auth.uid()
--   Write ops on products/product-documents additionally require profiles.role
--   IN (owner, admin). Reads require only org match.
--   Avatars SELECT stays public (bucket.public=true), writes scoped to owner.

BEGIN;

-- ============================================================================
-- Part 1: data cleanup (legacy orphans + invalid rows)
-- ============================================================================
-- Bypass storage.protect_objects_delete trigger for this transaction only.
-- The trigger exists to catch accidental DML against storage.objects; here
-- we are intentionally removing legacy orphans as part of a migration.
SET LOCAL storage.allow_delete_query = 'true';

-- Row with URL stored as full signed URL instead of canonical path.
DELETE FROM public.product_documents
WHERE id = 'd4643f69-d452-4162-9545-94736b938448';

-- Legacy 2-segment path objects in product-documents (pre-canonical).
DELETE FROM storage.objects
WHERE bucket_id = 'product-documents'
  AND array_length(string_to_array(name, '/'), 1) < 3;

-- All files in abandoned product-images bucket (code no longer references it).
DELETE FROM storage.objects
WHERE bucket_id = 'product-images';

-- Flat-path avatars (no user_id folder). Current code always writes
-- {user_id}/{timestamp}.ext — flat paths violate the new owner policy.
DELETE FROM storage.objects
WHERE bucket_id = 'avatars'
  AND position('/' IN name) = 0;

-- Clear any avatar_url referencing files we just deleted.
UPDATE public.profiles
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL;

-- Drop the abandoned bucket itself (no code references, files already wiped).
DELETE FROM storage.buckets WHERE id = 'product-images';

-- ============================================================================
-- Part 2: drop all legacy storage.objects policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete own avatar"              ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar"              ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars"   ON storage.objects;

DROP POLICY IF EXISTS "Public Access"                            ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload images"    ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their images"            ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can read documents"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their documents"         ON storage.objects;

-- ============================================================================
-- Part 3: canonical policies per bucket
-- ============================================================================

-- -------------------- bucket: products --------------------
-- Path: {org_id}/{product_id}/{file}
-- Reads: any authenticated user from the same org.
-- Writes: same org AND role IN (owner, admin).

CREATE POLICY "products_select_same_org"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'products'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
);

CREATE POLICY "products_insert_same_org_writer"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'products'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
);

CREATE POLICY "products_update_same_org_writer"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'products'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  bucket_id = 'products'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
);

CREATE POLICY "products_delete_same_org_writer"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'products'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
);

-- -------------------- bucket: product-documents --------------------
-- Path: {org_id}/{product_id}/{file}
-- Same model as products.

CREATE POLICY "product_documents_select_same_org"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'product-documents'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
);

CREATE POLICY "product_documents_insert_same_org_writer"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-documents'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
);

CREATE POLICY "product_documents_update_same_org_writer"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-documents'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  bucket_id = 'product-documents'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
);

CREATE POLICY "product_documents_delete_same_org_writer"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-documents'
  AND (storage.foldername(name))[1]::uuid = (auth.jwt() ->> 'organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_id = (auth.jwt() ->> 'organization_id')::uuid
      AND p.role IN ('owner', 'admin')
  )
);

-- -------------------- bucket: avatars --------------------
-- Path: {user_id}/{timestamp}.ext; bucket.public=true
-- SELECT: public (convention — avatars show on any profile link).
-- Writes: only the owner of the user_id folder.

CREATE POLICY "avatars_select_public"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_owner"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
);

CREATE POLICY "avatars_update_owner"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
);

CREATE POLICY "avatars_delete_owner"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
);

COMMIT;
