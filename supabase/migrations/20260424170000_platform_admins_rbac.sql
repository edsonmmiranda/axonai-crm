-- Migration: Platform admins + RBAC + role normalization (Sprint admin_02)
-- Created: 2026-04-24
-- Sprint: admin_02
-- Schema Source: REAL DATABASE (live introspection via MCP, 2026-04-24)
-- PRD: prds/prd_admin_02_platform_admins_rbac.md
--
-- Scope:
--   1. Create public.platform_admins (global platform operator catalog, FORCE RLS)
--   2. Trigger platform_admins_enforce_internal_org (INV-5 defense)
--   3. Trigger prevent_last_owner_deactivation (INV-3 / T-14 / G-08) on UPDATE + DELETE
--   4. RPC is_platform_admin(uuid) — STABLE SECURITY DEFINER (read helper)
--   5. RPC seed_initial_platform_admin_owner(uuid) — idempotent bootstrap
--   6. Fix invitations.role DEFAULT 'member' → 'user' (preexisting bug: default violated CHECK)
--
-- Rollback (staging only — apaga registro do Edson como platform admin):
--   DROP FUNCTION IF EXISTS public.seed_initial_platform_admin_owner(uuid);
--   DROP FUNCTION IF EXISTS public.is_platform_admin(uuid);
--   DROP TABLE IF EXISTS public.platform_admins CASCADE;
--   DROP FUNCTION IF EXISTS public.prevent_last_owner_deactivation();
--   DROP FUNCTION IF EXISTS public.platform_admins_enforce_internal_org();
--   ALTER TABLE public.invitations ALTER COLUMN role SET DEFAULT 'member'::text;
--
-- Idempotency: entire migration can be re-run without diff in final state.

-- ---------------------------------------------------------------------------
-- 1. Table public.platform_admins
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role            text NOT NULL CHECK (role IN ('owner','support','billing')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz NULL,
  created_by      uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT platform_admins_active_state_coherence
    CHECK (
      (is_active = true  AND deactivated_at IS NULL)
      OR
      (is_active = false AND deactivated_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.platform_admins IS
  'Global platform operator catalog (Axon team). Each row points to a profile of the internal org (slug=axon, is_internal=true). Exception to public.* multi-tenancy rule — see docs/conventions/standards.md.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Partial unique: one active admin row per profile. Allows historical
-- inactive rows to coexist with a new active row (role change, re-activation).
CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_active_profile_unique
  ON public.platform_admins (profile_id)
  WHERE is_active = true;

-- Speeds up last-owner trigger count and future admin lookups.
CREATE INDEX IF NOT EXISTS platform_admins_role_active
  ON public.platform_admins (role)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 3. RLS — FORCE + SELECT-own only (mutations handled by SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------------

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE  ROW LEVEL SECURITY;

-- Drop-then-create pattern for idempotency.
DROP POLICY IF EXISTS platform_admins_select_own ON public.platform_admins;
CREATE POLICY platform_admins_select_own ON public.platform_admins
  FOR SELECT
  USING (profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: denied by default. Mutations only via
-- SECURITY DEFINER RPCs (seed_initial_platform_admin_owner here; CRUD RPCs
-- land in Sprint 11).

-- ---------------------------------------------------------------------------
-- 4. Trigger: enforce profile_id belongs to an org with is_internal=true (INV-5)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admins_enforce_internal_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  is_in_internal boolean;
BEGIN
  SELECT o.is_internal INTO is_in_internal
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = NEW.profile_id;

  IF NOT FOUND OR is_in_internal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_not_in_internal_org'
      USING ERRCODE = 'P0001',
            DETAIL  = 'profile_id=' || NEW.profile_id::text;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_platform_admins_enforce_internal_org ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_enforce_internal_org
  BEFORE INSERT OR UPDATE OF profile_id ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.platform_admins_enforce_internal_org();

-- ---------------------------------------------------------------------------
-- 5. Trigger: prevent last active owner removal (INV-3 / T-14 / G-08)
--    Covers UPDATE (deactivate, demote) and DELETE (belt + suspenders).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_last_owner_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  other_active_owners int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only engage if OLD was the protected state.
    IF OLD.role = 'owner' AND OLD.is_active = true THEN
      -- Effective removal: deactivation OR role demotion.
      IF (NEW.is_active = false) OR (NEW.role IS DISTINCT FROM 'owner') THEN
        SELECT count(*) INTO other_active_owners
        FROM public.platform_admins
        WHERE role = 'owner'
          AND is_active = true
          AND id <> OLD.id;

        IF other_active_owners = 0 THEN
          RAISE EXCEPTION 'last_owner_protected'
            USING ERRCODE = 'P0001',
                  DETAIL  = 'Cannot deactivate or demote the last active owner';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND OLD.is_active = true THEN
      SELECT count(*) INTO other_active_owners
      FROM public.platform_admins
      WHERE role = 'owner'
        AND is_active = true
        AND id <> OLD.id;

      IF other_active_owners = 0 THEN
        RAISE EXCEPTION 'last_owner_protected'
          USING ERRCODE = 'P0001',
                DETAIL  = 'Cannot delete the last active owner';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_platform_admins_prevent_last_owner_upd ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_prevent_last_owner_upd
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_deactivation();

DROP TRIGGER IF EXISTS trg_platform_admins_prevent_last_owner_del ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_prevent_last_owner_del
  BEFORE DELETE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_deactivation();

-- ---------------------------------------------------------------------------
-- 6. RPC is_platform_admin(uuid) — STABLE SECURITY DEFINER read helper.
--    Returns active admin row (if any) for the given profile.
--    Caller must be the profile itself (authenticated) or service_role.
--    Unauthorized callers receive zero rows (no existence leak, no error).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin(target_profile_id uuid)
RETURNS TABLE (
  id          uuid,
  profile_id  uuid,
  role        text,
  is_active   boolean,
  created_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_role text;
BEGIN
  caller_role := auth.jwt() ->> 'role';

  -- Only self (authenticated) or service_role may consult. Others get zero rows.
  IF caller_role IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> target_profile_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pa.id, pa.profile_id, pa.role, pa.is_active, pa.created_at
  FROM public.platform_admins pa
  WHERE pa.profile_id = target_profile_id
    AND pa.is_active = true
  LIMIT 1;
END
$fn$;

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC seed_initial_platform_admin_owner(uuid) — idempotent bootstrap.
--    Executable only while platform_admins is empty. Serialized via
--    pg_advisory_xact_lock to survive concurrent invocations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_initial_platform_admin_owner(target_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  inserted_id     uuid;
  is_in_internal  boolean;
BEGIN
  -- Serialize seed invocations: two concurrent transactions cannot both seed.
  PERFORM pg_advisory_xact_lock(hashtext('seed_initial_platform_admin_owner'));

  -- Idempotency: only seed when table is empty.
  IF EXISTS (SELECT 1 FROM public.platform_admins LIMIT 1) THEN
    RAISE EXCEPTION 'platform_admins_already_seeded'
      USING ERRCODE = 'P0001',
            DETAIL  = 'platform_admins table is not empty; use Sprint 11 RPCs for subsequent admins';
  END IF;

  -- Pre-check internal org (mirrors the trigger; gives a more specific error earlier).
  SELECT o.is_internal INTO is_in_internal
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = 'profile_id=' || target_profile_id::text;
  END IF;

  IF is_in_internal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_not_in_internal_org'
      USING ERRCODE = 'P0001',
            DETAIL  = 'profile_id=' || target_profile_id::text
                   || ' must belong to org with is_internal=true before seeding';
  END IF;

  INSERT INTO public.platform_admins (profile_id, role, is_active, created_by)
  VALUES (target_profile_id, 'owner', true, target_profile_id)
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END
$fn$;

REVOKE ALL     ON FUNCTION public.seed_initial_platform_admin_owner(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.seed_initial_platform_admin_owner(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_initial_platform_admin_owner(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Bug fix: invitations.role DEFAULT
--    Previous default 'member' violates the table's own CHECK ('admin','user','viewer').
--    Any INSERT without explicit role would fail. Zero existing rows affected
--    (2 rows with role='admin', none with 'member'). Fix is opportunistic.
-- ---------------------------------------------------------------------------

ALTER TABLE public.invitations
  ALTER COLUMN role SET DEFAULT 'user'::text;
