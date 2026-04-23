-- Migration: Phase 9 — Canonicalize atomic product-image RPCs to JWT claim
-- Created:  2026-04-23
--
-- Problem:
--   set_product_image_primary() and reorder_product_images() (defined in
--   20260416120100_product_images_atomic_rpcs.sql) read the caller's
--   organization_id by querying public.profiles:
--
--     SELECT organization_id INTO v_user_org_id
--     FROM public.profiles
--     WHERE id = auth.uid();
--
--   The functions are SECURITY DEFINER, so this works correctly — but it
--   diverges from the canonical JWT-claim pattern enforced by Phases 2/5/6 on
--   every RLS policy in the codebase, and adds an unnecessary `profiles` hit
--   per call.
--
-- Fix:
--   Replace the profile lookup with `(auth.jwt() ->> 'organization_id')::uuid`.
--   `auth.jwt()` reads from the request-bound JWT and works inside
--   SECURITY DEFINER bodies (the request context is preserved across the
--   privilege escalation; only RLS bypass changes).
--
-- Behavior preserved:
--   - NOT_AUTHENTICATED still raises when no claim is present (unauthenticated
--     callers, or pre-hook tokens that lack the claim).
--   - CROSS_ORG_DENIED still raises on tenant mismatch.
--   - The single UPDATE statement(s) at the end are unchanged.

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
  v_user_org_id := (auth.jwt() ->> 'organization_id')::uuid;

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
  v_user_org_id := (auth.jwt() ->> 'organization_id')::uuid;

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
