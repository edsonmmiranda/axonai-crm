-- Sprint 12-1: Funnel Stage Roles (Entrada, Ganho, Perdido)
-- Adds stage_role column and unique partial index to funnel_stages

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'funnel_stages'
      AND column_name  = 'stage_role'
  ) THEN
    ALTER TABLE public.funnel_stages
      ADD COLUMN stage_role text DEFAULT NULL
        CHECK (stage_role IN ('entry', 'won', 'lost'));
  END IF;
END $$;

-- Unique partial index: each funnel may have at most one stage per role
CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_stages_role
  ON public.funnel_stages (funnel_id, stage_role)
  WHERE stage_role IS NOT NULL;
