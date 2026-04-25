-- Migration: Admin 05 — Organizations CRUD
-- Created: 2026-04-25
-- Sprint: admin_05
-- Schema Source: REAL DATABASE (consulted via Supabase MCP, not schema_snapshot.json)
--
-- Changes:
--   1. DROP coluna deprecated organizations.plan (finaliza Sprint 01)
--   2. CREATE EXTENSION pg_trgm (para índice GIN de busca por nome)
--   3. Índices de performance em organizations
--   4. Função helper is_calling_org_active() para bloqueio de orgs suspensas
--   5. 4 políticas SELECT para platform admins (orgs, subscriptions, plans, profiles)
--   6. 55 políticas customer atualizadas com AND public.is_calling_org_active()
--      (Profiles INSERT is trigger-only mantida intacta — WITH CHECK false já nega tudo)
--   7. 3 RPCs SECURITY DEFINER: admin_create_organization, admin_suspend_organization, admin_reactivate_organization
--
-- ROLLBACK (executar em ordem inversa se necessário):
--   DROP FUNCTION IF EXISTS public.admin_reactivate_organization(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_suspend_organization(uuid,text,text,text);
--   DROP FUNCTION IF EXISTS public.admin_create_organization(text,text,uuid,text,int,text,text);
--   DROP POLICY IF EXISTS "platform_admins_select_all_orgs" ON public.organizations;
--   DROP POLICY IF EXISTS "platform_admins_select_all_subscriptions" ON public.subscriptions;
--   DROP POLICY IF EXISTS "platform_admins_select_all_plans" ON public.plans;
--   DROP POLICY IF EXISTS "platform_admins_select_profiles_count" ON public.profiles;
--   DROP FUNCTION IF EXISTS public.is_calling_org_active();
--   DROP INDEX IF EXISTS public.idx_organizations_created_at;
--   DROP INDEX IF EXISTS public.idx_organizations_name_trgm;
--   -- Restaurar 55 políticas originais (ver texto original no topo de cada DROP abaixo)
--   ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
--     CHECK (plan = ANY (ARRAY['free'::text, 'basic'::text, 'premium'::text]));

-- =============================================================================
-- 1. DROP coluna deprecated organizations.plan
-- =============================================================================

ALTER TABLE public.organizations DROP COLUMN IF EXISTS plan;

-- =============================================================================
-- 2. Extensão pg_trgm (para busca por nome com GIN index)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- 3. Índices de performance em organizations
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_organizations_created_at
  ON public.organizations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm
  ON public.organizations USING gin (name gin_trgm_ops);

-- =============================================================================
-- 4. Função helper is_calling_org_active()
--    Retorna true se a org do JWT está ativa; false em qualquer outro caso.
--    STABLE: Postgres pode cachear dentro de uma query.
--    SECURITY INVOKER: roda como o caller (authenticated) — policy SELECT da
--    própria org via JWT claim já permite a leitura de organizations.is_active.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_calling_org_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    (SELECT is_active
     FROM public.organizations
     WHERE id = ((auth.jwt() ->> 'organization_id')::uuid)),
    false
  );
$$;

-- =============================================================================
-- 5. Políticas SELECT para platform admins (acesso global de leitura)
-- =============================================================================

-- organizations: platform admins leem todas as orgs (não apenas a própria)
DROP POLICY IF EXISTS "platform_admins_select_all_orgs" ON public.organizations;
CREATE POLICY "platform_admins_select_all_orgs"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- subscriptions: platform admins leem todas as subscriptions
DROP POLICY IF EXISTS "platform_admins_select_all_subscriptions" ON public.subscriptions;
CREATE POLICY "platform_admins_select_all_subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- plans: platform admins leem todos os planos (incluindo não-públicos e arquivados)
DROP POLICY IF EXISTS "platform_admins_select_all_plans" ON public.plans;
CREATE POLICY "platform_admins_select_all_plans"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- profiles: platform admins podem fazer COUNT/SELECT de profiles de qualquer org
DROP POLICY IF EXISTS "platform_admins_select_profiles_count" ON public.profiles;
CREATE POLICY "platform_admins_select_profiles_count"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- =============================================================================
-- 6. Atualização cross-cutting das políticas customer
--    Adiciona AND public.is_calling_org_active() a cada política.
--    Padrão: DROP IF EXISTS + CREATE (idempotente).
--    Nota: "Profiles INSERT is trigger-only" (WITH CHECK false) NÃO é alterada.
-- =============================================================================

-- ── categories (4 políticas) ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view categories from their organization" ON public.categories;
CREATE POLICY "Users can view categories from their organization"
  ON public.categories FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can insert categories for their organization" ON public.categories;
CREATE POLICY "Users can insert categories for their organization"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update categories from their organization" ON public.categories;
CREATE POLICY "Users can update categories from their organization"
  ON public.categories FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete categories from their organization" ON public.categories;
CREATE POLICY "Users can delete categories from their organization"
  ON public.categories FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── funnels (2 políticas) ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view funnels of their organization" ON public.funnels;
CREATE POLICY "Users can view funnels of their organization"
  ON public.funnels FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can manage funnels" ON public.funnels;
CREATE POLICY "Admins can manage funnels"
  ON public.funnels FOR ALL TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- ── funnel_stages (2 políticas) ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view stages of their organization funnels" ON public.funnel_stages;
CREATE POLICY "Users can view stages of their organization funnels"
  ON public.funnel_stages FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can manage stages" ON public.funnel_stages;
CREATE POLICY "Admins can manage stages"
  ON public.funnel_stages FOR ALL TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- ── invitations (4 políticas) ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "Enable select for organization admins" ON public.invitations;
CREATE POLICY "Enable select for organization admins"
  ON public.invitations FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can create invitations" ON public.invitations;
CREATE POLICY "Admins can create invitations"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Enable update for organization admins" ON public.invitations;
CREATE POLICY "Enable update for organization admins"
  ON public.invitations FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Enable delete for organization admins" ON public.invitations;
CREATE POLICY "Enable delete for organization admins"
  ON public.invitations FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- ── lead_origins (4 políticas) ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view origins from their organization" ON public.lead_origins;
CREATE POLICY "Users can view origins from their organization"
  ON public.lead_origins FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can insert origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can insert origins for their organization"
  ON public.lead_origins FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can update origins for their organization"
  ON public.lead_origins FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete origins for their organization" ON public.lead_origins;
CREATE POLICY "Users can delete origins for their organization"
  ON public.lead_origins FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── lead_tags (4 políticas) ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can view lead tags from their organization"
  ON public.lead_tags FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can create lead tags for their organization" ON public.lead_tags;
CREATE POLICY "Users can create lead tags for their organization"
  ON public.lead_tags FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can update lead tags from their organization"
  ON public.lead_tags FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete lead tags from their organization" ON public.lead_tags;
CREATE POLICY "Users can delete lead tags from their organization"
  ON public.lead_tags FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── leads (4 políticas) ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view leads of their organization" ON public.leads;
CREATE POLICY "Users can view leads of their organization"
  ON public.leads FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can create leads in their organization" ON public.leads;
CREATE POLICY "Users can create leads in their organization"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update leads in their organization" ON public.leads;
CREATE POLICY "Users can update leads in their organization"
  ON public.leads FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can delete leads" ON public.leads;
CREATE POLICY "Admins can delete leads"
  ON public.leads FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- ── loss_reasons (4 políticas) ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view loss_reasons from their organization" ON public.loss_reasons;
CREATE POLICY "Users can view loss_reasons from their organization"
  ON public.loss_reasons FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can create loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can create loss_reasons in their organization"
  ON public.loss_reasons FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can update loss_reasons in their organization"
  ON public.loss_reasons FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete loss_reasons in their organization" ON public.loss_reasons;
CREATE POLICY "Users can delete loss_reasons in their organization"
  ON public.loss_reasons FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── product_documents (4 políticas) ──────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view product documents from their organization" ON public.product_documents;
CREATE POLICY "Users can view product documents from their organization"
  ON public.product_documents FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can insert product documents" ON public.product_documents;
CREATE POLICY "Users can insert product documents"
  ON public.product_documents FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND uploaded_by = auth.uid()
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update product documents" ON public.product_documents;
CREATE POLICY "Users can update product documents"
  ON public.product_documents FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete product documents" ON public.product_documents;
CREATE POLICY "Users can delete product documents"
  ON public.product_documents FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── product_images (4 políticas) ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view product images from their organization" ON public.product_images;
CREATE POLICY "Users can view product images from their organization"
  ON public.product_images FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can insert product images" ON public.product_images;
CREATE POLICY "Users can insert product images"
  ON public.product_images FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND uploaded_by = auth.uid()
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update product images" ON public.product_images;
CREATE POLICY "Users can update product images"
  ON public.product_images FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete product images" ON public.product_images;
CREATE POLICY "Users can delete product images"
  ON public.product_images FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── products (4 políticas) ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view products from their organization" ON public.products;
CREATE POLICY "Users can view products from their organization"
  ON public.products FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can insert products in their organization" ON public.products;
CREATE POLICY "Users can insert products in their organization"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND created_by = auth.uid()
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update products in their organization" ON public.products;
CREATE POLICY "Users can update products in their organization"
  ON public.products FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can delete products in their organization" ON public.products;
CREATE POLICY "Users can delete products in their organization"
  ON public.products FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- ── profiles (4 políticas — "Profiles INSERT is trigger-only" NÃO alterada) ──

-- SELECT: usuários da própria org
DROP POLICY IF EXISTS "Users can view org profiles" ON public.profiles;
CREATE POLICY "Users can view org profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- UPDATE self
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    AND organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    id = auth.uid()
    AND organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

-- UPDATE por admins da org
DROP POLICY IF EXISTS "Admins can update organization profiles" ON public.profiles;
CREATE POLICY "Admins can update organization profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- DELETE por admins da org
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- "Profiles INSERT is trigger-only" NÃO alterada (WITH CHECK = false já nega tudo).

-- ── tags (4 políticas) ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view tags from their organization" ON public.tags;
CREATE POLICY "Users can view tags from their organization"
  ON public.tags FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can create tags for their organization" ON public.tags;
CREATE POLICY "Users can create tags for their organization"
  ON public.tags FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update tags from their organization" ON public.tags;
CREATE POLICY "Users can update tags from their organization"
  ON public.tags FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can delete tags" ON public.tags;
CREATE POLICY "Admins can delete tags"
  ON public.tags FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- ── whatsapp_groups (4 políticas) ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view whatsapp groups of their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can view whatsapp groups of their organization"
  ON public.whatsapp_groups FOR SELECT TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can create whatsapp groups in their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can create whatsapp groups in their organization"
  ON public.whatsapp_groups FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Users can update whatsapp groups in their organization" ON public.whatsapp_groups;
CREATE POLICY "Users can update whatsapp groups in their organization"
  ON public.whatsapp_groups FOR UPDATE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  )
  WITH CHECK (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND public.is_calling_org_active()
  );

DROP POLICY IF EXISTS "Admins can delete whatsapp groups" ON public.whatsapp_groups;
CREATE POLICY "Admins can delete whatsapp groups"
  ON public.whatsapp_groups FOR DELETE TO authenticated
  USING (
    organization_id = ((auth.jwt() ->> 'organization_id'::text))::uuid
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
    AND public.is_calling_org_active()
  );

-- =============================================================================
-- 7. RPCs admin: admin_create_organization, admin_suspend_organization,
--    admin_reactivate_organization
-- =============================================================================

-- ─── admin_create_organization ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_name              text,
  p_slug              text,
  p_plan_id           uuid,
  p_first_admin_email text,
  p_trial_days        int  DEFAULT 14,
  p_ip_address        text DEFAULT NULL,
  p_user_agent        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
AS $$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_new_org_id uuid;
  v_inv_token  uuid;
  v_plan_ok    boolean;
  v_org_after  jsonb;
BEGIN
  -- Autorização: apenas platform admin owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validação: slug formato (^[a-z0-9][a-z0-9\-]{2,49}$)
  IF p_slug !~ '^[a-z0-9][a-z0-9\-]{2,49}$' THEN
    RAISE EXCEPTION 'invalid_slug_format' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: name length
  IF length(trim(p_name)) < 2 OR length(trim(p_name)) > 200 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: email formato básico
  IF p_first_admin_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: plano existe e não está arquivado
  SELECT EXISTS(
    SELECT 1 FROM public.plans WHERE id = p_plan_id AND is_archived = false
  ) INTO v_plan_ok;
  IF NOT v_plan_ok THEN
    RAISE EXCEPTION 'invalid_plan' USING ERRCODE = 'P0001';
  END IF;

  -- Validação: trial_days range
  IF p_trial_days < 1 OR p_trial_days > 365 THEN
    RAISE EXCEPTION 'invalid_trial_days' USING ERRCODE = 'P0001';
  END IF;

  -- Inserir organization (unique_violation em slug → relança como slug_taken)
  BEGIN
    INSERT INTO public.organizations (name, slug, is_active, is_internal, settings)
    VALUES (trim(p_name), p_slug, true, false, '{}')
    RETURNING id INTO v_new_org_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  -- Inserir subscription trial (INV-1 via subscriptions_one_vigente_per_org)
  INSERT INTO public.subscriptions (organization_id, plan_id, status, period_start, period_end, metadata)
  VALUES (
    v_new_org_id,
    p_plan_id,
    'trial',
    now(),
    now() + (p_trial_days || ' days')::interval,
    jsonb_build_object('trial_days_override', p_trial_days)
  );

  -- Inserir invitation (token único para gerar signup_link na UI)
  INSERT INTO public.invitations (organization_id, email, role, invited_by, expires_at)
  VALUES (v_new_org_id, p_first_admin_email, 'admin', v_actor_id, now() + interval '7 days')
  RETURNING token INTO v_inv_token;

  -- Inserir signup_intent (habilita o first admin a completar signup)
  INSERT INTO public.signup_intents (email, organization_id, role, full_name, source, expires_at)
  VALUES (p_first_admin_email, v_new_org_id, 'owner', '', 'org_creation', now() + interval '7 days')
  ON CONFLICT (email) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        role            = EXCLUDED.role,
        source          = EXCLUDED.source,
        expires_at      = EXCLUDED.expires_at;

  -- Snapshot after para audit
  SELECT to_jsonb(o) INTO v_org_after
  FROM public.organizations o WHERE id = v_new_org_id;

  -- Audit transacional (dentro da mesma transação — G-03)
  PERFORM public.audit_write(
    'org.create',
    'organization',
    v_new_org_id,
    v_new_org_id,
    NULL,
    v_org_after,
    jsonb_build_object(
      'plan_id',            p_plan_id,
      'first_admin_email',  p_first_admin_email,
      'trial_days',         p_trial_days,
      'invitation_token',   v_inv_token
    ),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_new_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_organization(text,text,uuid,text,int,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_create_organization(text,text,uuid,text,int,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_create_organization(text,text,uuid,text,int,text,text) TO authenticated;

-- ─── admin_suspend_organization ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_suspend_organization(
  p_org_id     uuid,
  p_reason     text,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org      public.organizations%ROWTYPE;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Validação: reason obrigatória
  IF length(trim(coalesce(p_reason, ''))) < 5 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;

  -- Buscar org com lock para serializar contra race conditions
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- G-07 / INV-4: proteção da org interna Axon (imutável)
  IF v_org.is_internal = true THEN
    RAISE EXCEPTION 'internal_org_protected' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotência com erro tipado (suspender já-suspensa é erro, não no-op)
  IF v_org.is_active = false THEN
    RAISE EXCEPTION 'org_not_active' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_org);

  UPDATE public.organizations SET is_active = false WHERE id = p_org_id;

  SELECT to_jsonb(o) INTO v_after FROM public.organizations o WHERE id = p_org_id;

  -- Audit transacional
  PERFORM public.audit_write(
    'org.suspend',
    'organization',
    p_org_id,
    p_org_id,
    v_before,
    v_after,
    jsonb_build_object('reason', trim(p_reason)),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_organization(uuid,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_suspend_organization(uuid,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_suspend_organization(uuid,text,text,text) TO authenticated;

-- ─── admin_reactivate_organization ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reactivate_organization(
  p_org_id     uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_org      public.organizations%ROWTYPE;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  -- Autorização: apenas owner
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id AND is_active = true AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Buscar org com lock
  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotência: reativar org ativa é erro
  IF v_org.is_active = true THEN
    RAISE EXCEPTION 'org_not_suspended' USING ERRCODE = 'P0001';
  END IF;

  v_before := to_jsonb(v_org);

  UPDATE public.organizations SET is_active = true WHERE id = p_org_id;

  SELECT to_jsonb(o) INTO v_after FROM public.organizations o WHERE id = p_org_id;

  -- Audit transacional
  PERFORM public.audit_write(
    'org.reactivate',
    'organization',
    p_org_id,
    p_org_id,
    v_before,
    v_after,
    NULL,
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reactivate_organization(uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_reactivate_organization(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_organization(uuid,text,text) TO authenticated;
