-- The lead_origins.type column is free-text by design (sprint 07).
-- The check constraint was created unintentionally and blocks valid values.
ALTER TABLE public.lead_origins
  DROP CONSTRAINT IF EXISTS lead_origins_type_check;
