-- Migration: Phase 1 — Add organization_id to the 4 remaining tables
-- Created:  2026-04-22
-- Sprint:   n/a (Phase 1 of multi-tenancy canonicalization — auditor-driven)
-- Schema Source: REAL DATABASE
--
-- Purpose:
--   Complete the invariant from docs/conventions/standards.md §Multi-tenancy —
--   "every public.* table has organization_id uuid not null, FK to organizations,
--   ON DELETE CASCADE, indexed" — for the 4 tables still missing the column:
--
--     - funnel_stages     (backfill via funnels.organization_id   on funnel_id)
--     - lead_tags         (backfill via leads.organization_id     on lead_id)
--     - product_documents (backfill via products.organization_id  on product_id)
--     - product_images    (backfill via products.organization_id  on product_id)
--
-- Scope boundary:
--   This migration ONLY adds the column + FK + index. It does NOT rewrite RLS
--   policies — Phase 2 does that. Existing policies on these 4 tables keep
--   working because they do not currently reference organization_id.
--
-- Rollback safety:
--   Backfill runs BEFORE SET NOT NULL. If any row is orphaned (no matching
--   parent), a fallback assigns it to the sole active organization — but
--   ONLY when exactly one organization exists. In multi-org environments the
--   fallback raises and the whole transaction rolls back, preventing silent
--   mis-assignment. Each table block is idempotent (IF NOT EXISTS /
--   conditional constraint).

BEGIN;

-- ===========================================================================
-- funnel_stages
-- ===========================================================================
ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.funnel_stages fs
   SET organization_id = f.organization_id
  FROM public.funnels f
 WHERE fs.funnel_id = f.id
   AND fs.organization_id IS NULL;

DO $$
DECLARE sole_org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.funnel_stages WHERE organization_id IS NULL) THEN
    IF (SELECT COUNT(*) FROM public.organizations) <> 1 THEN
      RAISE EXCEPTION 'funnel_stages has orphans and there is not exactly one organization; refusing to auto-assign';
    END IF;
    SELECT id INTO sole_org FROM public.organizations;
    UPDATE public.funnel_stages SET organization_id = sole_org WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.funnel_stages
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'funnel_stages'
       AND constraint_name = 'funnel_stages_organization_id_fkey'
  ) THEN
    ALTER TABLE public.funnel_stages
      ADD CONSTRAINT funnel_stages_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_funnel_stages_organization_id
  ON public.funnel_stages(organization_id);

-- ===========================================================================
-- lead_tags
-- ===========================================================================
ALTER TABLE public.lead_tags
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.lead_tags lt
   SET organization_id = l.organization_id
  FROM public.leads l
 WHERE lt.lead_id = l.id
   AND lt.organization_id IS NULL;

DO $$
DECLARE sole_org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_tags WHERE organization_id IS NULL) THEN
    IF (SELECT COUNT(*) FROM public.organizations) <> 1 THEN
      RAISE EXCEPTION 'lead_tags has orphans and there is not exactly one organization; refusing to auto-assign';
    END IF;
    SELECT id INTO sole_org FROM public.organizations;
    UPDATE public.lead_tags SET organization_id = sole_org WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.lead_tags
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'lead_tags'
       AND constraint_name = 'lead_tags_organization_id_fkey'
  ) THEN
    ALTER TABLE public.lead_tags
      ADD CONSTRAINT lead_tags_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_tags_organization_id
  ON public.lead_tags(organization_id);

-- ===========================================================================
-- product_documents
-- ===========================================================================
ALTER TABLE public.product_documents
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.product_documents pd
   SET organization_id = p.organization_id
  FROM public.products p
 WHERE pd.product_id = p.id
   AND pd.organization_id IS NULL;

DO $$
DECLARE sole_org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_documents WHERE organization_id IS NULL) THEN
    IF (SELECT COUNT(*) FROM public.organizations) <> 1 THEN
      RAISE EXCEPTION 'product_documents has orphans and there is not exactly one organization; refusing to auto-assign';
    END IF;
    SELECT id INTO sole_org FROM public.organizations;
    UPDATE public.product_documents SET organization_id = sole_org WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.product_documents
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'product_documents'
       AND constraint_name = 'product_documents_organization_id_fkey'
  ) THEN
    ALTER TABLE public.product_documents
      ADD CONSTRAINT product_documents_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_documents_organization_id
  ON public.product_documents(organization_id);

-- ===========================================================================
-- product_images
-- ===========================================================================
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.product_images pi
   SET organization_id = p.organization_id
  FROM public.products p
 WHERE pi.product_id = p.id
   AND pi.organization_id IS NULL;

DO $$
DECLARE sole_org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_images WHERE organization_id IS NULL) THEN
    IF (SELECT COUNT(*) FROM public.organizations) <> 1 THEN
      RAISE EXCEPTION 'product_images has orphans and there is not exactly one organization; refusing to auto-assign';
    END IF;
    SELECT id INTO sole_org FROM public.organizations;
    UPDATE public.product_images SET organization_id = sole_org WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.product_images
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'product_images'
       AND constraint_name = 'product_images_organization_id_fkey'
  ) THEN
    ALTER TABLE public.product_images
      ADD CONSTRAINT product_images_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_images_organization_id
  ON public.product_images(organization_id);

COMMIT;
