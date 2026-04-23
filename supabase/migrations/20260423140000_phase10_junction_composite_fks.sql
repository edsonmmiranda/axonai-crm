-- Migration: Phase 10 — Composite FKs to enforce organization_id consistency
-- Created:  2026-04-23
--
-- Problem:
--   Phase 1 added `organization_id` (NOT NULL, FK to organizations) to four
--   junction/child tables: lead_tags, funnel_stages, product_images,
--   product_documents. The denormalization is intentional — it lets RLS use
--   the canonical JWT-claim pattern without joining the parent.
--
--   But there is NO database-enforced invariant tying the child's
--   organization_id to the parent's. A buggy INSERT that sends the wrong
--   organization_id is accepted by the database, and RLS then sees the row
--   as belonging to the wrong tenant. The protection today is purely
--   behavioral (application puts the right value), not structural.
--
-- Fix:
--   For every (child, parent) pair, add a COMPOSITE foreign key
--     (child.parent_id, child.organization_id)
--     REFERENCES parent(id, organization_id)
--     ON DELETE CASCADE
--
--   This requires the parent to expose a UNIQUE constraint on (id, organization_id).
--   Postgres allows this even when `id` is already the PK — the composite UNIQUE
--   creates a separate index that becomes the FK target.
--
--   With this in place, any INSERT into a child whose organization_id differs
--   from the parent's organization_id raises a foreign-key violation.
--
-- Pre-flight:
--   Each block validates current data is consistent before mutating constraints.
--   If any inconsistent row exists, the migration aborts cleanly — preventing
--   silent data loss / lockouts.
--
-- Existing single-column FKs are kept untouched. Two FK paths now exist
-- (single + composite) but they enforce overlapping invariants and the
-- CASCADE rules converge on the same rows.

BEGIN;

-- ============================================================================
-- Pre-flight: data consistency checks across all 4 junctions
-- ============================================================================

DO $$
DECLARE
  bad_lead_tags         int;
  bad_funnel_stages     int;
  bad_product_images    int;
  bad_product_documents int;
  bad_lead_tags_tag     int;
BEGIN
  SELECT count(*) INTO bad_lead_tags
  FROM public.lead_tags lt
  JOIN public.leads l ON l.id = lt.lead_id
  WHERE l.organization_id <> lt.organization_id;

  SELECT count(*) INTO bad_lead_tags_tag
  FROM public.lead_tags lt
  JOIN public.tags t ON t.id = lt.tag_id
  WHERE t.organization_id <> lt.organization_id;

  SELECT count(*) INTO bad_funnel_stages
  FROM public.funnel_stages fs
  JOIN public.funnels f ON f.id = fs.funnel_id
  WHERE f.organization_id <> fs.organization_id;

  SELECT count(*) INTO bad_product_images
  FROM public.product_images pi
  JOIN public.products p ON p.id = pi.product_id
  WHERE p.organization_id <> pi.organization_id;

  SELECT count(*) INTO bad_product_documents
  FROM public.product_documents pd
  JOIN public.products p ON p.id = pd.product_id
  WHERE p.organization_id <> pd.organization_id;

  IF bad_lead_tags + bad_lead_tags_tag + bad_funnel_stages
     + bad_product_images + bad_product_documents > 0 THEN
    RAISE EXCEPTION
      'Data inconsistency detected before composite FK migration: '
      'lead_tags(lead_id mismatch=%, tag_id mismatch=%), '
      'funnel_stages=%, product_images=%, product_documents=%. '
      'Fix the data before re-running this migration.',
      bad_lead_tags, bad_lead_tags_tag, bad_funnel_stages,
      bad_product_images, bad_product_documents;
  END IF;
END $$;

-- ============================================================================
-- Step 1 — UNIQUE(id, organization_id) on parent tables
-- (Required as the target of composite FKs.)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.leads'::regclass
       AND conname  = 'leads_id_organization_id_key'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_id_organization_id_key UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tags'::regclass
       AND conname  = 'tags_id_organization_id_key'
  ) THEN
    ALTER TABLE public.tags
      ADD CONSTRAINT tags_id_organization_id_key UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.funnels'::regclass
       AND conname  = 'funnels_id_organization_id_key'
  ) THEN
    ALTER TABLE public.funnels
      ADD CONSTRAINT funnels_id_organization_id_key UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname  = 'products_id_organization_id_key'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;

-- ============================================================================
-- Step 2 — Composite FKs on each junction/child table
-- ============================================================================

-- lead_tags → leads (composite)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lead_tags'::regclass
       AND conname  = 'lead_tags_lead_id_organization_id_fkey'
  ) THEN
    ALTER TABLE public.lead_tags
      ADD CONSTRAINT lead_tags_lead_id_organization_id_fkey
      FOREIGN KEY (lead_id, organization_id)
      REFERENCES public.leads (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- lead_tags → tags (composite)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lead_tags'::regclass
       AND conname  = 'lead_tags_tag_id_organization_id_fkey'
  ) THEN
    ALTER TABLE public.lead_tags
      ADD CONSTRAINT lead_tags_tag_id_organization_id_fkey
      FOREIGN KEY (tag_id, organization_id)
      REFERENCES public.tags (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- funnel_stages → funnels (composite)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.funnel_stages'::regclass
       AND conname  = 'funnel_stages_funnel_id_organization_id_fkey'
  ) THEN
    ALTER TABLE public.funnel_stages
      ADD CONSTRAINT funnel_stages_funnel_id_organization_id_fkey
      FOREIGN KEY (funnel_id, organization_id)
      REFERENCES public.funnels (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- product_images → products (composite)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_images'::regclass
       AND conname  = 'product_images_product_id_organization_id_fkey'
  ) THEN
    ALTER TABLE public.product_images
      ADD CONSTRAINT product_images_product_id_organization_id_fkey
      FOREIGN KEY (product_id, organization_id)
      REFERENCES public.products (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- product_documents → products (composite)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_documents'::regclass
       AND conname  = 'product_documents_product_id_organization_id_fkey'
  ) THEN
    ALTER TABLE public.product_documents
      ADD CONSTRAINT product_documents_product_id_organization_id_fkey
      FOREIGN KEY (product_id, organization_id)
      REFERENCES public.products (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
