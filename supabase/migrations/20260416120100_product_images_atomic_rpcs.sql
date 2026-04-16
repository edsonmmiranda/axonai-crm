-- Migration: Atomic RPCs for product image primary/reorder (Sprint 06)
-- Created: 2026-04-16
-- Sprint: 06 — Products + Storage
-- Schema Source: REAL DATABASE (probed 2026-04-16)
--
-- Purpose:
--   Provide two SECURITY DEFINER helper functions that implement atomic
--   mutations the application cannot express in a single PostgREST call:
--
--     1. set_product_image_primary(p_image_id uuid)
--        -> For the owning product, set is_primary = true on p_image_id and
--           false on all other images of the same product, in a SINGLE UPDATE
--           statement. Guarantees exactly-one primary even under concurrent
--           clicks from two admins.
--
--     2. reorder_product_images(p_product_id uuid, p_ordered_ids uuid[])
--        -> Rewrite 'position' on all listed images in order (0, 1, 2, ...),
--           in a SINGLE UPDATE using unnest WITH ORDINALITY. Validates that
--           every id belongs to the target product before updating.
--
-- Both functions enforce org isolation by joining against public.profiles
-- (auth.uid()) and verifying the caller's organization_id matches the
-- product's. They raise exceptions on auth / not-found / cross-org — which
-- the caller translates into friendly ActionResponse errors.
--
-- Idempotent: uses CREATE OR REPLACE. Safe to re-run.

-- ============================================================================
-- 1. set_product_image_primary
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_product_image_primary(p_image_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_org_id    uuid;
  v_product_id     uuid;
  v_product_org_id uuid;
BEGIN
  SELECT organization_id INTO v_user_org_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_user_org_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT pi.product_id, p.organization_id
  INTO v_product_id, v_product_org_id
  FROM public.product_images pi
  JOIN public.products p ON p.id = pi.product_id
  WHERE pi.id = p_image_id;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'IMAGE_NOT_FOUND';
  END IF;

  IF v_product_org_id <> v_user_org_id THEN
    RAISE EXCEPTION 'CROSS_ORG_DENIED';
  END IF;

  UPDATE public.product_images
  SET is_primary = (id = p_image_id)
  WHERE product_id = v_product_id;
END;
$$;

COMMENT ON FUNCTION public.set_product_image_primary(uuid) IS
  'Atomically sets one image as primary (is_primary = true) and flips all other images of the same product to false. Enforces org isolation via profiles.organization_id.';

-- ============================================================================
-- 2. reorder_product_images
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reorder_product_images(
  p_product_id   uuid,
  p_ordered_ids  uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_org_id    uuid;
  v_product_org_id uuid;
  v_input_count    int;
  v_match_count    int;
BEGIN
  SELECT organization_id INTO v_user_org_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_user_org_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT organization_id INTO v_product_org_id
  FROM public.products
  WHERE id = p_product_id;

  IF v_product_org_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_product_org_id <> v_user_org_id THEN
    RAISE EXCEPTION 'CROSS_ORG_DENIED';
  END IF;

  v_input_count := COALESCE(array_length(p_ordered_ids, 1), 0);

  IF v_input_count = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.product_images
  WHERE product_id = p_product_id
    AND id = ANY (p_ordered_ids);

  IF v_match_count <> v_input_count THEN
    RAISE EXCEPTION 'INVALID_IMAGE_IDS';
  END IF;

  UPDATE public.product_images pi
  SET position = (o.ord - 1)::int
  FROM unnest(p_ordered_ids) WITH ORDINALITY AS o(img_id, ord)
  WHERE pi.id = o.img_id
    AND pi.product_id = p_product_id;
END;
$$;

COMMENT ON FUNCTION public.reorder_product_images(uuid, uuid[]) IS
  'Atomically rewrites positions of product images from an ordered id array. Validates every id belongs to the product before updating. Enforces org isolation.';

-- ============================================================================
-- 3. Grants
-- ============================================================================
-- Allow authenticated users to invoke the RPCs. Org isolation is enforced
-- inside each function via auth.uid() + profiles.organization_id.

GRANT EXECUTE ON FUNCTION public.set_product_image_primary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_product_images(uuid, uuid[]) TO authenticated;
