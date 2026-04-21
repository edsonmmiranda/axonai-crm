-- Migration: Pipeline Kanban — index + atomic move RPC
-- Created: 2026-04-21
-- Sprint: 13
-- Schema Source: REAL DATABASE (snapshot regenerated 2026-04-21T14:30Z)
--
-- Adds:
--   1. Composite index (organization_id, stage_id, card_order) to speed up
--      getPipelineDataAction queries (per-column ordering under RLS filter).
--   2. move_lead_atomic() — SECURITY INVOKER RPC that performs stage change
--      + card_order shift on source and destination columns in a single
--      statement, with explicit cross-org guard and role-specific auto-status
--      (won/lost) + loss-reason requirement.

CREATE INDEX IF NOT EXISTS idx_leads_stage_order
  ON public.leads (organization_id, stage_id, card_order);

CREATE OR REPLACE FUNCTION public.move_lead_atomic(
  p_lead_id uuid,
  p_to_stage_id uuid,
  p_to_index integer,
  p_loss_reason_id uuid DEFAULT NULL,
  p_loss_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from_stage_id uuid;
  v_old_order integer;
  v_lead_org uuid;
  v_stage_funnel uuid;
  v_to_stage_role text;
  v_funnel_org uuid;
BEGIN
  -- 1. Load moving lead (RLS applies — cross-org leads return 0 rows).
  SELECT stage_id, card_order, organization_id
    INTO v_from_stage_id, v_old_order, v_lead_org
    FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND';
  END IF;

  -- 2. Load target stage + verify its funnel belongs to the same org.
  SELECT fs.funnel_id, fs.stage_role, f.organization_id
    INTO v_stage_funnel, v_to_stage_role, v_funnel_org
    FROM funnel_stages fs
    JOIN funnels f ON f.id = fs.funnel_id
    WHERE fs.id = p_to_stage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAGE_NOT_FOUND';
  END IF;
  IF v_funnel_org <> v_lead_org THEN
    RAISE EXCEPTION 'CROSS_ORG_BLOCKED';
  END IF;

  -- 3. Role-specific validation: lost requires a reason.
  IF v_to_stage_role = 'lost' AND p_loss_reason_id IS NULL THEN
    RAISE EXCEPTION 'LOSS_REASON_REQUIRED';
  END IF;

  -- 4. Shift logic.
  IF v_from_stage_id IS DISTINCT FROM p_to_stage_id THEN
    -- Cross-column: close the gap in the source column.
    IF v_from_stage_id IS NOT NULL THEN
      UPDATE leads
        SET card_order = card_order - 1
        WHERE stage_id = v_from_stage_id
          AND card_order > v_old_order
          AND id <> p_lead_id;
    END IF;
    -- Open space at the target index.
    UPDATE leads
      SET card_order = card_order + 1
      WHERE stage_id = p_to_stage_id
        AND card_order >= p_to_index
        AND id <> p_lead_id;
  ELSE
    -- Same-column reorder.
    IF v_old_order = p_to_index THEN
      RETURN jsonb_build_object(
        'leadId', p_lead_id,
        'newStageId', p_to_stage_id,
        'newOrder', p_to_index
      );
    ELSIF v_old_order < p_to_index THEN
      UPDATE leads
        SET card_order = card_order - 1
        WHERE stage_id = p_to_stage_id
          AND card_order > v_old_order
          AND card_order <= p_to_index
          AND id <> p_lead_id;
    ELSE
      UPDATE leads
        SET card_order = card_order + 1
        WHERE stage_id = p_to_stage_id
          AND card_order >= p_to_index
          AND card_order < v_old_order
          AND id <> p_lead_id;
    END IF;
  END IF;

  -- 5. Update the moved lead (+ role-specific auto-status for won/lost).
  UPDATE leads SET
    stage_id = p_to_stage_id,
    card_order = p_to_index,
    status = CASE
      WHEN v_to_stage_role = 'won' THEN 'won'
      WHEN v_to_stage_role = 'lost' THEN 'lost'
      ELSE status
    END,
    loss_reason_id = CASE
      WHEN v_to_stage_role = 'lost' THEN p_loss_reason_id
      ELSE loss_reason_id
    END,
    loss_notes = CASE
      WHEN v_to_stage_role = 'lost' THEN p_loss_notes
      ELSE loss_notes
    END,
    updated_at = now()
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'leadId', p_lead_id,
    'newStageId', p_to_stage_id,
    'newOrder', p_to_index
  );
END;
$$;

COMMENT ON FUNCTION public.move_lead_atomic(uuid, uuid, integer, uuid, text) IS
  'Atomic lead move between funnel stages with card_order shift. SECURITY INVOKER preserves caller RLS. Raises LEAD_NOT_FOUND / STAGE_NOT_FOUND / CROSS_ORG_BLOCKED / LOSS_REASON_REQUIRED.';
