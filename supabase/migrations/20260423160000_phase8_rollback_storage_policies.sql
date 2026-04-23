-- Migration: Phase 8 ROLLBACK — drop the 8 storage policies added by Phase 8
-- Created:  2026-04-23
--
-- Why:
--   Phase 8 (20260423120000_phase8_storage_policies_canonical.sql) added 8 new
--   policies on storage.objects (4 per bucket, for `products` and
--   `product-documents`) intending to enforce JWT-claim org isolation + admin
--   role check on mutations.
--
--   Two problems made that migration net-negative:
--
--   1) The legacy permissive policies on `product-documents` were NOT removed:
--        - "Authenticated users can read documents" (SELECT, any authenticated)
--        - "Authenticated users can upload documents" (INSERT, any authenticated)
--        - "Users can delete their documents" (DELETE, any authenticated)
--      RLS policies are OR'd permissively, so the legacy ones still grant
--      cross-tenant access. The Phase 8 isolation on this bucket is
--      decorative — the migration's stated protection is FALSE.
--
--   2) On the `products` bucket the new admin/owner check on INSERT/UPDATE/DELETE
--      may have broken member-level upload flows in the app (Phase 8 was applied
--      without verifying that only admins are expected to mutate that bucket).
--
-- Effect of this rollback:
--   storage.objects returns to its pre-Phase-8 state. The legacy policies that
--   were already present continue as-is (untouched by this rollback). Any
--   future tightening of storage isolation must be planned together with
--   removal of the legacy permissive policies, otherwise the OR-style RLS
--   semantics will neutralize the new policies again.

BEGIN;

-- Bucket: products (4 policies added by Phase 8)
DROP POLICY IF EXISTS "products_select_org" ON storage.objects;
DROP POLICY IF EXISTS "products_insert_org" ON storage.objects;
DROP POLICY IF EXISTS "products_update_org" ON storage.objects;
DROP POLICY IF EXISTS "products_delete_org" ON storage.objects;

-- Bucket: product-documents (4 policies added by Phase 8)
DROP POLICY IF EXISTS "product_documents_select_org" ON storage.objects;
DROP POLICY IF EXISTS "product_documents_insert_org" ON storage.objects;
DROP POLICY IF EXISTS "product_documents_update_org" ON storage.objects;
DROP POLICY IF EXISTS "product_documents_delete_org" ON storage.objects;

COMMIT;
