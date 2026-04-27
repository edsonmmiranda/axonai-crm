-- =============================================================================
-- Migration: Admin 09 — Dashboard home + platform settings base
--            (feature flags + trial settings + legal policies + metrics snapshot)
-- Created:   2026-04-27
-- Sprint:    admin_09
-- Schema Source: REAL DATABASE (introspectado via MCP em 2026-04-27)
-- PRD:       prds/prd_admin_09_dashboard_platform_settings.md
-- =============================================================================
--
-- O QUE ESTA MIGRATION FAZ:
--   1. public.platform_settings   — key/value tipado para parâmetros globais da plataforma.
--                                    Seeds: trial_default_days=14, past_due_grace_days=7,
--                                    signup_link_offline_fallback_enabled=true.
--   2. public.feature_flags        — toggles globais validados por registry em código.
--                                    Seeds: enable_public_signup=false,
--                                    enable_ai_summarization=false.
--   3. public.legal_policies       — append-only versionado (kind+version). Triggers:
--                                    set_version (BEFORE INSERT) + deny_mutation
--                                    (BEFORE UPDATE/DELETE/TRUNCATE).
--   4. public.platform_metrics_snapshot — singleton (id=1) para KPIs do dashboard.
--                                    Seed: counts=0, refreshed_at='1970-01-01'.
--   5. RPCs (todas SECURITY DEFINER, anon revogado):
--      - get_registered_feature_flag_keys() → text[]
--      - admin_set_setting(...)             → void
--      - admin_set_feature_flag(...)        → void
--      - admin_create_legal_policy(...)     → uuid
--      - get_active_legal_policy(text)      → legal_policies (authenticated callable)
--      - get_active_feature_flags()         → TABLE (authenticated callable)
--      - refresh_platform_metrics(...)      → platform_metrics_snapshot
--
-- NOTA MULTI-TENANCY:
--   Nenhuma das 4 tabelas tem organization_id — são catálogos globais da plataforma.
--   Exceção documentada em docs/PROJECT_CONTEXT.md §2 (mesmo padrão de plans,
--   platform_admins, audit_log). Proteção compensatória: FORCE RLS + todas as
--   mutações apenas via RPCs SECURITY DEFINER + anon/authenticated sem INSERT/UPDATE/
--   DELETE direto.
--
-- INVARIANTES MANTIDAS:
--   INV-6 (audit transacional) — admin_set_setting, admin_set_feature_flag,
--                                admin_create_legal_policy e refresh_platform_metrics
--                                gravam audit_log no mesmo bloco PL/pgSQL.
--
-- IDEMPOTÊNCIA:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION,
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER,
--   INSERT ... ON CONFLICT (key) DO NOTHING.
--   Re-execução segura.
--
-- ROLLBACK (executar em staging primeiro, depois prod):
--   DROP FUNCTION IF EXISTS public.refresh_platform_metrics(text, text);
--   DROP FUNCTION IF EXISTS public.get_active_feature_flags();
--   DROP FUNCTION IF EXISTS public.get_active_legal_policy(text);
--   DROP FUNCTION IF EXISTS public.admin_create_legal_policy(text, timestamptz, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.admin_set_feature_flag(text, bool, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.admin_set_setting(text, text, text, int, bool, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.get_registered_feature_flag_keys();
--   DROP TABLE IF EXISTS public.platform_metrics_snapshot;
--   DROP TABLE IF EXISTS public.legal_policies;
--   DROP TABLE IF EXISTS public.feature_flags;
--   DROP TABLE IF EXISTS public.platform_settings;
-- =============================================================================

-- =============================================================================
-- 1. public.platform_settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key          text        PRIMARY KEY
                           CHECK (length(key) BETWEEN 3 AND 64
                                  AND key ~ '^[a-z][a-z0-9_]*$'),
  value_type   text        NOT NULL
                           CHECK (value_type IN ('text','int','bool','jsonb')),
  value_text   text        NULL,
  value_int    int         NULL,
  value_bool   bool        NULL,
  value_jsonb  jsonb       NULL,
  description  text        NOT NULL
                           CHECK (length(description) BETWEEN 1 AND 500),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Exatamente uma coluna value_* deve ser não-nula, batendo com value_type.
  CONSTRAINT platform_settings_exactly_one_value CHECK (
    (value_type = 'text'  AND value_text  IS NOT NULL
                          AND value_int   IS NULL
                          AND value_bool  IS NULL
                          AND value_jsonb IS NULL)
    OR
    (value_type = 'int'   AND value_int   IS NOT NULL
                          AND value_text  IS NULL
                          AND value_bool  IS NULL
                          AND value_jsonb IS NULL)
    OR
    (value_type = 'bool'  AND value_bool  IS NOT NULL
                          AND value_text  IS NULL
                          AND value_int   IS NULL
                          AND value_jsonb IS NULL)
    OR
    (value_type = 'jsonb' AND value_jsonb IS NOT NULL
                          AND value_text  IS NULL
                          AND value_int   IS NULL
                          AND value_bool  IS NULL)
  )
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPC admin_set_setting (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_settings FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_platform_settings_updated_at
  ON public.platform_settings (updated_at DESC);

DROP POLICY IF EXISTS "platform_admins_can_read_platform_settings"
  ON public.platform_settings;
CREATE POLICY "platform_admins_can_read_platform_settings"
  ON public.platform_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- Seeds iniciais (idempotentes)
INSERT INTO public.platform_settings
  (key, value_type, value_int, description)
VALUES
  ('trial_default_days', 'int', 14,
   'Dias default de trial para novas orgs. Consumido por createOrganizationAction.'),
  ('past_due_grace_days', 'int', 7,
   'Grace period em dias para subscriptions past_due antes do bloqueio (Sprint 13).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings
  (key, value_type, value_bool, description)
VALUES
  ('signup_link_offline_fallback_enabled', 'bool', true,
   'Habilita geração de link copiável quando email não configurado (Sprint 10).')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS
  'Parâmetros globais tipados da plataforma. Sem organization_id (catálogo global). '
  'Writes somente via RPC admin_set_setting. Exceção multi-tenancy documentada em '
  'docs/PROJECT_CONTEXT.md §2.';

-- =============================================================================
-- 2. public.feature_flags
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key          text        PRIMARY KEY
                           CHECK (length(key) BETWEEN 3 AND 64
                                  AND key ~ '^[a-z][a-z0-9_]*$'),
  enabled      bool        NOT NULL DEFAULT false,
  config       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPC admin_set_feature_flag (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.feature_flags FROM authenticated, anon;

-- Policy SELECT admin: qualquer platform admin ativo.
DROP POLICY IF EXISTS "platform_admins_can_read_feature_flags" ON public.feature_flags;
CREATE POLICY "platform_admins_can_read_feature_flags"
  ON public.feature_flags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- Policy SELECT customer (authenticated): leitura permissiva para todas as flags.
-- O filtro de visibilidade pública (isPublic=true) é aplicado em código TypeScript
-- via src/lib/featureFlags/getPublicFlags.ts contra FEATURE_FLAG_REGISTRY.
-- A RPC get_active_feature_flags() retorna todas as linhas; o helper TS filtra.
DROP POLICY IF EXISTS "authenticated_can_read_feature_flags" ON public.feature_flags;
CREATE POLICY "authenticated_can_read_feature_flags"
  ON public.feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

-- Seeds iniciais (formalizam as flags D-1 e enable_ai_summarization)
INSERT INTO public.feature_flags (key, enabled, config)
VALUES
  ('enable_public_signup',    false, '{}'::jsonb),
  ('enable_ai_summarization', false, '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.feature_flags IS
  'Toggles globais da plataforma validados contra registry em src/lib/featureFlags/registry.ts. '
  'Sem organization_id (catálogo global). Writes somente via RPC admin_set_feature_flag. '
  'Exceção multi-tenancy documentada em docs/PROJECT_CONTEXT.md §2.';

-- =============================================================================
-- 3. public.legal_policies
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.legal_policies (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text        NOT NULL
                           CHECK (kind IN ('terms','privacy','dpa','cookies')),
  version      int         NOT NULL,
  effective_at timestamptz NOT NULL,
  content_md   text        NOT NULL
                           CHECK (length(content_md) BETWEEN 50 AND 200000),
  summary      text        NOT NULL
                           CHECK (length(summary) BETWEEN 10 AND 500),
  created_by   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legal_policies_kind_version_unique UNIQUE (kind, version)
);

ALTER TABLE public.legal_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_policies FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPC admin_create_legal_policy (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legal_policies FROM authenticated, anon;

-- Índice principal: "versão vigente mais recente para o kind"
CREATE INDEX IF NOT EXISTS idx_legal_policies_kind_effective
  ON public.legal_policies (kind, effective_at DESC);

-- Índice para listagem admin: todas as versões por kind, mais recente primeiro
CREATE INDEX IF NOT EXISTS idx_legal_policies_kind_version
  ON public.legal_policies (kind, version DESC);

-- Policy SELECT admin: qualquer platform admin ativo.
DROP POLICY IF EXISTS "platform_admins_can_read_legal_policies" ON public.legal_policies;
CREATE POLICY "platform_admins_can_read_legal_policies"
  ON public.legal_policies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- Policy SELECT customer: leitura permissiva (a interface canônica é
-- get_active_legal_policy(kind) que filtra por effective_at <= now()).
DROP POLICY IF EXISTS "authenticated_can_read_legal_policies" ON public.legal_policies;
CREATE POLICY "authenticated_can_read_legal_policies"
  ON public.legal_policies
  FOR SELECT
  TO authenticated
  USING (true);

-- Sem seeds — primeira versão criada pelo admin via UI.

COMMENT ON TABLE public.legal_policies IS
  'Políticas legais versionadas (append-only). Sem organization_id (catálogo global). '
  'Writes somente via RPC admin_create_legal_policy. '
  'Exceção multi-tenancy documentada em docs/PROJECT_CONTEXT.md §2.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3a. Trigger: auto-versioning BEFORE INSERT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.legal_policies_set_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next_version int;
BEGIN
  -- pg_advisory_xact_lock garante serialização de INSERTs concorrentes do mesmo kind.
  -- Fallback: UNIQUE(kind, version) rejeita duplicata se o lock falhar.
  PERFORM pg_advisory_xact_lock(hashtext('legal_policies:' || NEW.kind));

  SELECT COALESCE(MAX(version), 0) + 1
    INTO v_next_version
    FROM public.legal_policies
   WHERE kind = NEW.kind;

  NEW.version := v_next_version;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_policies_before_insert ON public.legal_policies;
CREATE TRIGGER legal_policies_before_insert
  BEFORE INSERT ON public.legal_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.legal_policies_set_version();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Trigger: deny UPDATE/DELETE/TRUNCATE (append-only enforcement)
--     Bloqueia qualquer role, inclusive service_role — mesmo padrão do
--     audit_log (Sprint 03).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.legal_policies_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'legal_policies is append-only (op=%)', TG_OP
    USING ERRCODE = '42501',
          HINT    = 'Crie nova versão via RPC admin_create_legal_policy.';
END;
$$;

DROP TRIGGER IF EXISTS legal_policies_deny_update_delete ON public.legal_policies;
CREATE TRIGGER legal_policies_deny_update_delete
  BEFORE UPDATE OR DELETE ON public.legal_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.legal_policies_deny_mutation();

DROP TRIGGER IF EXISTS legal_policies_deny_truncate ON public.legal_policies;
CREATE TRIGGER legal_policies_deny_truncate
  BEFORE TRUNCATE ON public.legal_policies
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.legal_policies_deny_mutation();

-- =============================================================================
-- 4. public.platform_metrics_snapshot
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_metrics_snapshot (
  id                   int         PRIMARY KEY
                                   CHECK (id = 1),  -- singleton
  active_orgs_count    int         NOT NULL DEFAULT 0,
  active_users_count   int         NOT NULL DEFAULT 0,
  leads_total          int         NOT NULL DEFAULT 0,
  refreshed_at         timestamptz NOT NULL
                                   DEFAULT '1970-01-01T00:00:00Z'::timestamptz,
  refreshed_by         uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_metrics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_metrics_snapshot FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPC refresh_platform_metrics (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_metrics_snapshot
  FROM authenticated, anon;

DROP POLICY IF EXISTS "platform_admins_can_read_metrics_snapshot"
  ON public.platform_metrics_snapshot;
CREATE POLICY "platform_admins_can_read_metrics_snapshot"
  ON public.platform_metrics_snapshot
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

-- Seed singleton: refreshed_at='1970-01-01' força lazy refresh no 1º carregamento.
INSERT INTO public.platform_metrics_snapshot
  (id, active_orgs_count, active_users_count, leads_total, refreshed_at)
VALUES (1, 0, 0, 0, '1970-01-01T00:00:00Z'::timestamptz)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.platform_metrics_snapshot IS
  'Singleton (id=1) com cache de KPIs do dashboard admin. '
  'Sem organization_id (catálogo global). '
  'Writes somente via RPC refresh_platform_metrics. '
  'Exceção multi-tenancy documentada em docs/PROJECT_CONTEXT.md §2.';

-- =============================================================================
-- 5. RPC: get_registered_feature_flag_keys
--    Helper interno chamado por admin_set_feature_flag para validar keys.
--    NOTA: manter sincronizado com src/lib/featureFlags/registry.ts.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_registered_feature_flag_keys()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY[
    'enable_public_signup',
    'enable_ai_summarization'
    -- SINCRONIZAR COM src/lib/featureFlags/registry.ts ao adicionar novas flags.
  ]::text[];
$$;

REVOKE ALL     ON FUNCTION public.get_registered_feature_flag_keys() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_registered_feature_flag_keys() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_registered_feature_flag_keys()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_registered_feature_flag_keys() IS
  'Retorna lista canônica de feature flag keys válidas. '
  'MANTER SINCRONIZADO com src/lib/featureFlags/registry.ts. '
  'Atualizar esta função é parte do checklist de qualquer sprint que adicionar nova flag.';

-- =============================================================================
-- 6. RPC: admin_set_setting
--    Owner-only. UPSERT em platform_settings + audit_write transacional.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_setting(
  p_key          text,
  p_value_type   text,
  p_value_text   text        DEFAULT NULL,
  p_value_int    int         DEFAULT NULL,
  p_value_bool   bool        DEFAULT NULL,
  p_value_jsonb  jsonb       DEFAULT NULL,
  p_ip_address   text        DEFAULT NULL,
  p_user_agent   text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    uuid := auth.uid();
  v_diff_before jsonb;
  v_diff_after  jsonb;
BEGIN
  -- Autorização: apenas platform admin owner ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode alterar platform_settings.';
  END IF;

  -- Validação: coerência entre value_type e valor fornecido
  IF p_value_type = 'text'  AND p_value_text  IS NULL THEN
    RAISE EXCEPTION 'value_type_mismatch'
      USING ERRCODE = 'P0001', HINT = 'value_type=text requer p_value_text não-nulo.';
  END IF;
  IF p_value_type = 'int'   AND p_value_int   IS NULL THEN
    RAISE EXCEPTION 'value_type_mismatch'
      USING ERRCODE = 'P0001', HINT = 'value_type=int requer p_value_int não-nulo.';
  END IF;
  IF p_value_type = 'bool'  AND p_value_bool  IS NULL THEN
    RAISE EXCEPTION 'value_type_mismatch'
      USING ERRCODE = 'P0001', HINT = 'value_type=bool requer p_value_bool não-nulo.';
  END IF;
  IF p_value_type = 'jsonb' AND p_value_jsonb IS NULL THEN
    RAISE EXCEPTION 'value_type_mismatch'
      USING ERRCODE = 'P0001', HINT = 'value_type=jsonb requer p_value_jsonb não-nulo.';
  END IF;

  -- Snapshot diff_before
  SELECT jsonb_build_object(
    'key',         key,
    'value_type',  value_type,
    'value_text',  value_text,
    'value_int',   value_int,
    'value_bool',  value_bool,
    'value_jsonb', value_jsonb
  )
  INTO v_diff_before
  FROM public.platform_settings
  WHERE key = p_key;

  -- UPSERT
  INSERT INTO public.platform_settings
    (key, value_type, value_text, value_int, value_bool, value_jsonb,
     description, updated_at, updated_by)
  VALUES
    (p_key, p_value_type, p_value_text, p_value_int, p_value_bool, p_value_jsonb,
     COALESCE(
       (SELECT description FROM public.platform_settings WHERE key = p_key),
       p_key  -- fallback se nova key (sem descrição pré-existente)
     ),
     now(), v_actor_id)
  ON CONFLICT (key) DO UPDATE
    SET value_type   = EXCLUDED.value_type,
        value_text   = EXCLUDED.value_text,
        value_int    = EXCLUDED.value_int,
        value_bool   = EXCLUDED.value_bool,
        value_jsonb  = EXCLUDED.value_jsonb,
        updated_at   = now(),
        updated_by   = v_actor_id;

  -- Snapshot diff_after
  SELECT jsonb_build_object(
    'key',         key,
    'value_type',  value_type,
    'value_text',  value_text,
    'value_int',   value_int,
    'value_bool',  value_bool,
    'value_jsonb', value_jsonb
  )
  INTO v_diff_after
  FROM public.platform_settings
  WHERE key = p_key;

  -- Audit transacional (target_id=NULL: PK é text, não uuid; key está em metadata)
  PERFORM public.audit_write(
    'setting.update',
    'platform_setting',
    NULL,
    NULL,
    v_diff_before,
    v_diff_after,
    jsonb_build_object('key', p_key, 'value_type', p_value_type),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_set_setting(text,text,text,int,bool,jsonb,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_set_setting(text,text,text,int,bool,jsonb,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_setting(text,text,text,int,bool,jsonb,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_setting(text,text,text,int,bool,jsonb,text,text) IS
  'Owner-only. UPSERT em platform_settings + audit transacional. '
  'Raises: unauthorized (P0001), value_type_mismatch (P0001).';

-- =============================================================================
-- 7. RPC: admin_set_feature_flag
--    Owner-only. Valida key contra registry + UPSERT + audit_write transacional.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_feature_flag(
  p_key          text,
  p_enabled      bool,
  p_config       jsonb       DEFAULT '{}'::jsonb,
  p_ip_address   text        DEFAULT NULL,
  p_user_agent   text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    uuid := auth.uid();
  v_diff_before jsonb;
  v_diff_after  jsonb;
BEGIN
  -- Autorização: apenas platform admin owner ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode alterar feature flags.';
  END IF;

  -- Validação: key deve estar no registry canônico
  IF NOT (p_key = ANY (public.get_registered_feature_flag_keys())) THEN
    RAISE EXCEPTION 'feature_flag_key_not_registered'
      USING ERRCODE = 'P0001',
            HINT    = p_key,
            DETAIL  = 'Key não consta em get_registered_feature_flag_keys(). '
                      'Adicionar ao registry em src/lib/featureFlags/registry.ts '
                      'e atualizar get_registered_feature_flag_keys().';
  END IF;

  -- Snapshot diff_before
  SELECT jsonb_build_object('key', key, 'enabled', enabled, 'config', config)
  INTO v_diff_before
  FROM public.feature_flags
  WHERE key = p_key;

  -- UPSERT
  INSERT INTO public.feature_flags (key, enabled, config, updated_at, updated_by)
  VALUES (p_key, p_enabled, p_config, now(), v_actor_id)
  ON CONFLICT (key) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        config     = EXCLUDED.config,
        updated_at = now(),
        updated_by = v_actor_id;

  -- Snapshot diff_after
  SELECT jsonb_build_object('key', key, 'enabled', enabled, 'config', config)
  INTO v_diff_after
  FROM public.feature_flags
  WHERE key = p_key;

  -- Audit transacional (target_id=NULL: PK é text)
  PERFORM public.audit_write(
    'feature_flag.set',
    'feature_flag',
    NULL,
    NULL,
    v_diff_before,
    v_diff_after,
    jsonb_build_object('key', p_key, 'enabled', p_enabled),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_set_feature_flag(text,bool,jsonb,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_set_feature_flag(text,bool,jsonb,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_feature_flag(text,bool,jsonb,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_feature_flag(text,bool,jsonb,text,text) IS
  'Owner-only. Valida key contra get_registered_feature_flag_keys() + UPSERT + audit. '
  'Raises: unauthorized (P0001), feature_flag_key_not_registered (P0001).';

-- =============================================================================
-- 8. RPC: admin_create_legal_policy
--    Owner-only. INSERT em legal_policies (trigger calcula version) + audit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_legal_policy(
  p_kind          text,
  p_effective_at  timestamptz,
  p_content_md    text,
  p_summary       text,
  p_ip_address    text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_new_id     uuid;
  v_new_version int;
BEGIN
  -- Autorização: apenas platform admin owner ativo
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode criar políticas legais.';
  END IF;

  -- INSERT: trigger legal_policies_before_insert calcula version automaticamente.
  -- content_md excluído do audit (recuperável via target_id).
  INSERT INTO public.legal_policies
    (kind, effective_at, content_md, summary, created_by)
  VALUES
    (p_kind, p_effective_at, p_content_md, p_summary, v_actor_id)
  RETURNING id, version INTO v_new_id, v_new_version;

  -- Audit transacional
  PERFORM public.audit_write(
    'legal_policy.create',
    'legal_policy',
    v_new_id,
    NULL,
    NULL,
    jsonb_build_object(
      'kind',         p_kind,
      'version',      v_new_version,
      'effective_at', p_effective_at,
      'summary',      p_summary
    ),
    jsonb_build_object('kind', p_kind, 'version', v_new_version),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_new_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_create_legal_policy(text,timestamptz,text,text,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_create_legal_policy(text,timestamptz,text,text,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_legal_policy(text,timestamptz,text,text,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_create_legal_policy(text,timestamptz,text,text,text,text) IS
  'Owner-only. INSERT em legal_policies (trigger calcula version) + audit transacional. '
  'content_md não incluído no audit_log (recuperável via id). '
  'Raises: unauthorized (P0001). CHECK constraints da tabela validam kind/length.';

-- =============================================================================
-- 9. RPC: get_active_legal_policy
--    authenticated callable. Retorna versão com effective_at <= now() mais
--    recente para o kind, ou NULL se não houver.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_active_legal_policy(p_kind text)
RETURNS SETOF public.legal_policies
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.legal_policies
   WHERE kind = p_kind
     AND effective_at <= now()
   ORDER BY effective_at DESC, version DESC
   LIMIT 1;
$$;

REVOKE ALL     ON FUNCTION public.get_active_legal_policy(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_active_legal_policy(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_active_legal_policy(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_active_legal_policy(text) IS
  'Retorna a versão mais recente vigente (effective_at <= now()) para o kind. '
  'Retorna 0 linhas se não houver versão vigente. Callable por authenticated (customer app).';

-- =============================================================================
-- 10. RPC: get_active_feature_flags
--     authenticated callable. Retorna todas as flags persistidas.
--     Filtro de visibilidade pública (isPublic=true) é aplicado no helper TS
--     src/lib/featureFlags/getPublicFlags.ts.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_active_feature_flags()
RETURNS TABLE (key text, enabled bool, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT key, enabled, config FROM public.feature_flags;
$$;

REVOKE ALL     ON FUNCTION public.get_active_feature_flags() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_active_feature_flags() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_active_feature_flags()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_active_feature_flags() IS
  'Retorna todas as flags persistidas em feature_flags. '
  'Filtro de visibilidade (isPublic=true do registry TS) aplicado no helper '
  'src/lib/featureFlags/getPublicFlags.ts — não filtra aqui. '
  'Callable por authenticated (customer app + admin).';

-- =============================================================================
-- 11. RPC: refresh_platform_metrics
--     owner+support callable. Recalcula KPIs e atualiza platform_metrics_snapshot.
--     Exclui orgs com is_internal=true (RF-DASH-2).
--     Debounce de audit: se < 60s desde último refresh pelo mesmo ator, pula audit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_platform_metrics(
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS SETOF public.platform_metrics_snapshot
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id          uuid := auth.uid();
  v_active_orgs       int;
  v_active_users      int;
  v_leads_total       int;
  v_old_refreshed_at  timestamptz;
  v_old_refreshed_by  uuid;
  v_diff_before       jsonb;
  v_diff_after        jsonb;
BEGIN
  -- Autorização: owner ou support
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role IN ('owner', 'support')
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner ou support pode atualizar métricas.';
  END IF;

  -- Snapshot antigo (para debounce de audit e diff)
  SELECT refreshed_at, refreshed_by,
         jsonb_build_object(
           'active_orgs_count',  active_orgs_count,
           'active_users_count', active_users_count,
           'leads_total',        leads_total,
           'refreshed_at',       refreshed_at
         )
  INTO v_old_refreshed_at, v_old_refreshed_by, v_diff_before
  FROM public.platform_metrics_snapshot
  WHERE id = 1;

  -- Computar KPIs (exclui orgs internas — RF-DASH-2)
  SELECT COUNT(*)::int INTO v_active_orgs
  FROM public.organizations
  WHERE is_active = true AND is_internal = false;

  SELECT COUNT(DISTINCT p.id)::int INTO v_active_users
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE o.is_active = true AND o.is_internal = false;

  SELECT COUNT(*)::int INTO v_leads_total
  FROM public.leads l
  JOIN public.organizations o ON o.id = l.organization_id
  WHERE o.is_active = true AND o.is_internal = false;

  -- UPSERT singleton (id=1)
  INSERT INTO public.platform_metrics_snapshot
    (id, active_orgs_count, active_users_count, leads_total,
     refreshed_at, refreshed_by)
  VALUES
    (1, v_active_orgs, v_active_users, v_leads_total, now(), v_actor_id)
  ON CONFLICT (id) DO UPDATE
    SET active_orgs_count  = EXCLUDED.active_orgs_count,
        active_users_count = EXCLUDED.active_users_count,
        leads_total        = EXCLUDED.leads_total,
        refreshed_at       = now(),
        refreshed_by       = v_actor_id;

  -- Debounce de audit: pula se mesmo ator refrescou < 60s atrás
  IF v_old_refreshed_at IS NULL
     OR (now() - v_old_refreshed_at) > interval '60 seconds'
     OR v_old_refreshed_by IS DISTINCT FROM v_actor_id
  THEN
    SELECT jsonb_build_object(
      'active_orgs_count',  active_orgs_count,
      'active_users_count', active_users_count,
      'leads_total',        leads_total,
      'refreshed_at',       refreshed_at
    )
    INTO v_diff_after
    FROM public.platform_metrics_snapshot WHERE id = 1;

    PERFORM public.audit_write(
      'metrics.refresh',
      'platform_metrics_snapshot',
      NULL,
      NULL,
      v_diff_before,
      v_diff_after,
      jsonb_build_object(
        'active_orgs_count',  v_active_orgs,
        'active_users_count', v_active_users,
        'leads_total',        v_leads_total
      ),
      p_ip_address::inet,
      p_user_agent
    );
  END IF;

  RETURN QUERY SELECT * FROM public.platform_metrics_snapshot WHERE id = 1;
END;
$$;

REVOKE ALL     ON FUNCTION public.refresh_platform_metrics(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.refresh_platform_metrics(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.refresh_platform_metrics(text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.refresh_platform_metrics(text, text) IS
  'Owner+support. Recalcula active_orgs_count (exclui is_internal), active_users_count, '
  'leads_total e atualiza singleton platform_metrics_snapshot (id=1). '
  'Debounce de audit: pula se mesmo ator refrescou < 60s atrás. '
  'Raises: unauthorized (P0001).';

-- =============================================================================
-- Sanity check final — confirmar que as 4 tabelas existem e têm FORCE RLS.
-- Executar após apply para validar:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class
--    WHERE relname IN ('platform_settings','feature_flags',
--                      'legal_policies','platform_metrics_snapshot');
--   -- Esperado: todas com relrowsecurity=t AND relforcerowsecurity=t
-- =============================================================================
