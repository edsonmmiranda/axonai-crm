-- =====================================================================
-- Phase 10 — Fix: drop redundant single-column FKs on junction tables
-- =====================================================================
-- Phase 10 (20260423140000) added composite FKs
-- (parent_id, organization_id) -> parent(id, organization_id)
-- to enforce cross-tenant integrity, but intentionally kept the
-- pre-existing single-column FKs (parent_id) -> parent(id).
--
-- Consequence: PostgREST sees two relationships between the same
-- pair of tables and refuses to auto-embed them:
--   PGRST201 "Could not embed because more than one relationship
--             was found for 'funnels' and 'funnel_stages'"
--
-- The composite FK is a strict superset of the single-column FK:
--   - Same ON DELETE CASCADE semantics
--   - Same (parent_id) referential integrity
--   - Adds extra invariant: child.organization_id must match parent's
--
-- Dropping the single-column FK removes the ambiguity without losing
-- any integrity guarantees, and restores PostgREST embedding.
-- =====================================================================

BEGIN;

ALTER TABLE public.funnel_stages
  DROP CONSTRAINT IF EXISTS funnel_stages_funnel_id_fkey;

ALTER TABLE public.lead_tags
  DROP CONSTRAINT IF EXISTS lead_tags_lead_id_fkey;

ALTER TABLE public.lead_tags
  DROP CONSTRAINT IF EXISTS lead_tags_tag_id_fkey;

ALTER TABLE public.product_documents
  DROP CONSTRAINT IF EXISTS product_documents_product_id_fkey;

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_product_id_fkey;

-- Nudge PostgREST to reload its schema cache so the relationship map
-- is immediately consistent with the drops above.
NOTIFY pgrst, 'reload schema';

COMMIT;
