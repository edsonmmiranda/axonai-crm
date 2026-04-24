-- Sprint admin 01 — Planos, Assinaturas e Org Interna AxonAI (Foundation DB)
-- PRD: prds/prd_admin_01_plans_subscriptions_internal_org.md
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Adiciona organizations.is_internal (boolean NOT NULL DEFAULT false)
--   2. Cria public.plans (catálogo comercial, 4 seeds: free/basic/premium/internal)
--   3. Cria public.subscriptions (vínculo org↔plano, partial unique prova INV-1)
--   4. Trigger function set_updated_at() (idempotente via CREATE OR REPLACE)
--   5. RPC SECURITY DEFINER get_current_subscription(uuid)
--   6. Pre-backfill guard (aborta se alguma org tem plan fora do enum)
--   7. Seed plans + org interna axon + subscription interna
--   8. Backfill geral de orgs existentes → subscription 'ativa'
--   9. Pós-checks provam INV-1 (toda org tem exatamente 1 vigente)
--  10. COMMENT deprecating organizations.plan
--
-- IDEMPOTÊNCIA: toda a migration é re-executável. Blocos críticos usam
--   CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING, WHERE NOT EXISTS,
--   CREATE OR REPLACE FUNCTION, DROP TRIGGER/POLICY IF EXISTS antes de CREATE.
--
-- ROLLBACK (executar manualmente em staging; produção requer backup antes):
--   DROP FUNCTION IF EXISTS public.get_current_subscription(uuid);
--   DROP TABLE IF EXISTS public.subscriptions;
--   DROP TABLE IF EXISTS public.plans;
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS is_internal;
--   COMMENT ON COLUMN public.organizations.plan IS NULL;
--   -- NÃO dropar set_updated_at() — outras migrations podem depender.
--
-- ATENÇÃO ROLLBACK: a org 'axon' (organizations.slug='axon') criada pelo seed
--   permanece no banco após rollback (DROP TABLE não cascata para organizations).
--   Remoção manual: DELETE FROM organizations WHERE slug='axon'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. organizations.is_internal
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. public.plans
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plans (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text        NOT NULL UNIQUE,
  description             text        NULL,
  price_monthly_cents     int         NOT NULL DEFAULT 0 CHECK (price_monthly_cents >= 0),
  price_yearly_cents      int         NOT NULL DEFAULT 0 CHECK (price_yearly_cents  >= 0),
  features_jsonb          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_public               boolean     NOT NULL DEFAULT true,
  is_archived             boolean     NOT NULL DEFAULT false,
  max_users               int         NULL CHECK (max_users               IS NULL OR max_users               >= 0),
  max_leads               int         NULL CHECK (max_leads               IS NULL OR max_leads               >= 0),
  max_products            int         NULL CHECK (max_products            IS NULL OR max_products            >= 0),
  max_pipelines           int         NULL CHECK (max_pipelines           IS NULL OR max_pipelines           >= 0),
  max_active_integrations int         NULL CHECK (max_active_integrations IS NULL OR max_active_integrations >= 0),
  max_storage_mb          int         NULL CHECK (max_storage_mb          IS NULL OR max_storage_mb          >= 0),
  allow_ai_features       boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_is_public_active
  ON public.plans (is_public)
  WHERE is_archived = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. public.subscriptions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id         uuid        NOT NULL REFERENCES public.plans(id)         ON DELETE RESTRICT,
  status          text        NOT NULL CHECK (status IN ('trial','ativa','past_due','trial_expired','cancelada','suspensa')),
  period_start    timestamptz NOT NULL DEFAULT now(),
  period_end      timestamptz NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status
  ON public.subscriptions (organization_id, status);

-- G-12 / INV-1: no máximo 1 subscription "vigente" por org
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_vigente_per_org
  ON public.subscriptions (organization_id)
  WHERE status IN ('trial','ativa','past_due');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Shared trigger function: set_updated_at()
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON public.plans;
CREATE TRIGGER trg_plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security (FORCE em ambas)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE  ROW LEVEL SECURITY;

-- plans: authenticated lê apenas planos públicos e não arquivados.
-- Mutações: nenhuma policy (negado por default; Sprint 06 adiciona via RPCs SECURITY DEFINER).
DROP POLICY IF EXISTS plans_select_public ON public.plans;
CREATE POLICY plans_select_public
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (is_public = true AND is_archived = false);

-- subscriptions: customer lê apenas a própria org.
-- Mutações: nenhuma policy; só via service_role / RPC SECURITY DEFINER (Sprints 05/06).
DROP POLICY IF EXISTS subscriptions_select_own_org ON public.subscriptions;
CREATE POLICY subscriptions_select_own_org
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: get_current_subscription(org_id)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER necessário para ler plans.internal (is_public=false,
-- bloqueado pelo RLS de SELECT). Auth check reproduz multi-tenancy server-side.

CREATE OR REPLACE FUNCTION public.get_current_subscription(p_org_id uuid)
RETURNS TABLE (
  subscription_id         uuid,
  organization_id         uuid,
  plan_id                 uuid,
  plan_name               text,
  status                  text,
  period_start            timestamptz,
  period_end              timestamptz,
  metadata                jsonb,
  max_users               int,
  max_leads               int,
  max_products            int,
  max_pipelines           int,
  max_active_integrations int,
  max_storage_mb          int,
  allow_ai_features       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_org  text;
  caller_role text;
BEGIN
  caller_org  := auth.jwt() ->> 'organization_id';
  caller_role := auth.jwt() ->> 'role';

  IF caller_role IS NULL OR caller_role <> 'service_role' THEN
    IF caller_org IS NULL OR caller_org::uuid <> p_org_id THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.organization_id, s.plan_id, p.name, s.status,
    s.period_start, s.period_end, s.metadata,
    p.max_users, p.max_leads, p.max_products, p.max_pipelines,
    p.max_active_integrations, p.max_storage_mb, p.allow_ai_features
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
    AND s.status IN ('trial','ativa','past_due')
  ORDER BY s.period_start DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_vigente_subscription' USING ERRCODE = 'P0002', DETAIL = 'org_id=' || p_org_id::text;
  END IF;
END $$;

REVOKE ALL    ON FUNCTION public.get_current_subscription(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_current_subscription(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pre-backfill guard (aborta se plan fora do enum conhecido)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE unknown_count int;
BEGIN
  SELECT count(*) INTO unknown_count
  FROM public.organizations
  WHERE plan NOT IN ('free','basic','premium','internal');
  IF unknown_count > 0 THEN
    RAISE EXCEPTION 'Backfill abortado: % org(s) com valor de plan fora do enum conhecido. Inspecione manualmente antes de rodar a migration.', unknown_count;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Seed plans (idempotente via ON CONFLICT DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.plans (
  name, is_public, is_archived, price_monthly_cents,
  max_users, max_leads, max_products, max_pipelines,
  max_active_integrations, max_storage_mb, allow_ai_features
) VALUES
  ('free',     true,  false, 0, 3,    100,  50,   1,    0, 100,   false),
  ('basic',    true,  false, 0, 5,    1000, 500,  3,    2, 1000,  false),
  ('premium',  true,  false, 0, NULL, NULL, NULL, NULL, NULL, 10000, true),
  ('internal', false, false, 0, NULL, NULL, NULL, NULL, NULL, NULL,  true)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Seed org interna axon (idempotente via ON CONFLICT DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.organizations (name, slug, plan, max_users, is_internal)
VALUES ('Axon AI', 'axon', 'free', 3, true)
ON CONFLICT (slug) DO NOTHING;

-- Garante is_internal=true mesmo se a row 'axon' já existia antes desta migration
UPDATE public.organizations
   SET is_internal = true
 WHERE slug = 'axon' AND is_internal = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Seed subscription ativa para org axon (idempotente via WHERE NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.subscriptions (organization_id, plan_id, status, period_start, period_end)
SELECT o.id, p.id, 'ativa', o.created_at, NULL
  FROM public.organizations o
  JOIN public.plans p ON p.name = 'internal'
 WHERE o.slug = 'axon'
   AND NOT EXISTS (
     SELECT 1 FROM public.subscriptions s
      WHERE s.organization_id = o.id
        AND s.status IN ('trial','ativa','past_due')
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Backfill geral — toda org sem vigente ganha subscription 'ativa'
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.subscriptions (organization_id, plan_id, status, period_start, period_end)
SELECT o.id, p.id, 'ativa', o.created_at, NULL
  FROM public.organizations o
  JOIN public.plans         p ON p.name = o.plan
 WHERE NOT EXISTS (
   SELECT 1 FROM public.subscriptions s
    WHERE s.organization_id = o.id
      AND s.status IN ('trial','ativa','past_due')
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Pós-checks — prova INV-1 (toda org tem EXATAMENTE 1 vigente)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  violators int;
BEGIN
  -- Nenhuma org pode ter >1 vigente (partial unique já garante, mas double-check)
  SELECT count(*) INTO violators
    FROM (
      SELECT organization_id
        FROM public.subscriptions
       WHERE status IN ('trial','ativa','past_due')
       GROUP BY organization_id
       HAVING count(*) > 1
    ) v;
  IF violators > 0 THEN
    RAISE EXCEPTION 'INV-1 violada: % org(s) com >1 subscription vigente após backfill.', violators;
  END IF;

  -- Toda org deve ter EXATAMENTE 1 vigente
  SELECT count(*) INTO violators
    FROM public.organizations o
   WHERE NOT EXISTS (
     SELECT 1 FROM public.subscriptions s
      WHERE s.organization_id = o.id
        AND s.status IN ('trial','ativa','past_due')
   );
  IF violators > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % org(s) sem subscription vigente.', violators;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Deprecation comment em organizations.plan
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.organizations.plan IS
  'DEPRECATED — use subscriptions.plan_id via getOrgPlan(). Will be dropped in Sprint 05 once all callers migrate. Do NOT write to this column.';
