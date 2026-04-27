-- =============================================================================
-- Migration: Admin 10 — Credenciais cifradas + bootstrap email com fallback
-- Created:   2026-04-27
-- Sprint:    admin_10
-- Schema Source: REAL DATABASE (introspectado via MCP em 2026-04-27)
-- PRD:       prds/prd_admin_10_credentials_email_bootstrap.md
-- =============================================================================
--
-- O QUE ESTA MIGRATION FAZ:
--   1. public.platform_integration_credentials — metadata da credencial; secret real
--      vive em vault.secrets (cifrado em repouso). FK lógica para vault.secrets.id;
--      sem FK física por ser cross-schema. UNIQUE parcial (kind) WHERE revoked_at IS NULL
--      garante ≤1 ativa por kind.
--   2. public.email_delivery_log — rastreio de envios e fallback offline. CHECK
--      composto garante combinações válidas de (source, status).
--   3. RPCs (todas SECURITY DEFINER, REVOKE EXECUTE FROM public/anon/authenticated;
--      GRANT EXECUTE TO service_role apenas):
--      - admin_create_integration_credential(kind, label, metadata, secret_plaintext)
--          → row metadata (sem plaintext). Cria secret no Vault, INSERT, audit.
--      - admin_rotate_integration_credential(id, new_secret_plaintext, new_metadata)
--          → row metadata. Rotação IN-PLACE via vault.update_secret (mesmo UUID).
--      - admin_revoke_integration_credential(id) → void. Soft-revoke + DELETE no Vault
--          (best-effort; falha em Vault não aborta).
--      - admin_list_integration_credentials() → setof row. Projeção sem vault_secret_id.
--      - get_integration_credential_plaintext(kind) → (plaintext, metadata, credential_id)
--          ⛔ ÚNICO caminho ao plaintext fora do Vault.
--      - mark_credential_used(credential_id) → void. UPDATE last_used_at; permitido em
--          soft-revoked (envio em flight).
--      - log_email_delivery(...) → row id do log. Audit somente para offline_fallback.
--
-- NOTA MULTI-TENANCY:
--   As 2 tabelas não têm organization_id — catálogos globais da plataforma.
--   Exceção a documentar em docs/PROJECT_CONTEXT.md §2 (mesmo padrão de plans,
--   platform_admins, audit_log, platform_settings, feature_flags, legal_policies,
--   platform_metrics_snapshot). Proteção compensatória: FORCE RLS + writes só via
--   RPCs SECURITY DEFINER + GRANT EXECUTE restrito a service_role.
--
-- PRIVILEGE MODEL (CRÍTICO — APRENDIZADO 2026-04-24):
--   REVOKE EXECUTE FROM public NÃO cobre anon. Por isso REVOKE explícito de cada
--   role nominalmente (public, anon, authenticated) antes do GRANT a service_role.
--
-- INVARIANTES MANTIDAS:
--   INV-6 (audit transacional) — admin_create_*, admin_rotate_*, admin_revoke_*
--     gravam audit_log no mesmo bloco PL/pgSQL. log_email_delivery audita apenas
--     o evento de baixa frequência (offline_fallback) para não inflar audit.
--   G-14 (plaintext nunca em response) — RPCs admin_* nunca retornam plaintext
--     nem vault_secret_id na projeção; audit payloads omitem plaintext (apenas
--     hint mascarado vai em metadata).
--
-- IDEMPOTÊNCIA:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION.
--   Re-execução segura.
--
-- ROLLBACK (executar em staging primeiro):
--   DROP FUNCTION IF EXISTS public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid);
--   DROP FUNCTION IF EXISTS public.mark_credential_used(uuid);
--   DROP FUNCTION IF EXISTS public.get_integration_credential_plaintext(text);
--   DROP FUNCTION IF EXISTS public.admin_list_integration_credentials();
--   DROP FUNCTION IF EXISTS public.admin_revoke_integration_credential(uuid);
--   DROP FUNCTION IF EXISTS public.admin_rotate_integration_credential(uuid,text,jsonb);
--   DROP FUNCTION IF EXISTS public.admin_create_integration_credential(text,text,jsonb,text);
--   DROP TABLE IF EXISTS public.email_delivery_log;
--   DROP TABLE IF EXISTS public.platform_integration_credentials;
-- =============================================================================

-- Vault já está instalado (extensão supabase_vault v0.3.1). Reasserção idempotente.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- =============================================================================
-- 1. public.platform_integration_credentials
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_integration_credentials (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL
                              CHECK (kind IN ('email_smtp')),
  label           text        NOT NULL
                              CHECK (length(label) BETWEEN 1 AND 80),
  vault_secret_id uuid        NOT NULL,
  metadata_jsonb  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  hint            text        NULL
                              CHECK (hint IS NULL
                                     OR (length(hint) = 8 AND hint LIKE '****%')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  last_used_at    timestamptz NULL,
  rotated_at      timestamptz NULL,
  revoked_at      timestamptz NULL
);

ALTER TABLE public.platform_integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_integration_credentials FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPCs admin_* (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.platform_integration_credentials
  FROM authenticated, anon;

-- UNIQUE parcial: ≤1 credencial ativa por kind. (INV-1 do Sprint 01.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_kind
  ON public.platform_integration_credentials (kind)
  WHERE revoked_at IS NULL;

-- Policy SELECT admin: qualquer platform admin ativo.
DROP POLICY IF EXISTS "platform_admins_can_read_credentials"
  ON public.platform_integration_credentials;
CREATE POLICY "platform_admins_can_read_credentials"
  ON public.platform_integration_credentials
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

COMMENT ON TABLE public.platform_integration_credentials IS
  'Metadata de credenciais de integração da plataforma (SMTP no MVP). '
  'Plaintext do secret vive em vault.secrets (FK lógica via vault_secret_id, '
  'sem FK física cross-schema). Sem organization_id (catálogo global). '
  'Writes somente via RPCs admin_create/rotate/revoke_integration_credential. '
  'Exceção multi-tenancy a documentar em docs/PROJECT_CONTEXT.md §2.';

-- =============================================================================
-- 2. public.email_delivery_log
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient           text        NOT NULL
                                  CHECK (length(recipient) BETWEEN 3 AND 320),
  subject             text        NOT NULL
                                  CHECK (length(subject) BETWEEN 1 AND 200),
  kind                text        NOT NULL
                                  CHECK (kind IN ('invitation','password_reset','admin_notification')),
  source              text        NOT NULL
                                  CHECK (source IN ('platform_setting','env_var','offline_fallback')),
  status              text        NOT NULL
                                  CHECK (status IN ('sent','fallback_offline','error')),
  offline_link        text        NULL,
  error_message       text        NULL
                                  CHECK (error_message IS NULL OR length(error_message) <= 1000),
  related_entity_type text        NULL
                                  CHECK (related_entity_type IS NULL
                                         OR related_entity_type IN ('invitation','platform_admin_invitation','password_reset')),
  related_entity_id   uuid        NULL,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  sent_by             uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Coerência (source, status):
  --   - platform_setting / env_var → status sent OU error
  --   - offline_fallback           → status fallback_offline (sempre)
  CONSTRAINT email_delivery_log_source_status_coherence CHECK (
    (source IN ('platform_setting','env_var') AND status IN ('sent','error'))
    OR
    (source = 'offline_fallback' AND status = 'fallback_offline')
  ),
  -- offline_link só preenchido quando offline_fallback.
  CONSTRAINT email_delivery_log_offline_link_coherence CHECK (
    (status = 'fallback_offline' AND offline_link IS NOT NULL)
    OR
    (status <> 'fallback_offline' AND offline_link IS NULL)
  ),
  -- error_message só preenchido em status error.
  CONSTRAINT email_delivery_log_error_message_coherence CHECK (
    (status = 'error' AND error_message IS NOT NULL)
    OR
    (status <> 'error' AND error_message IS NULL)
  )
);

ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_log FORCE ROW LEVEL SECURITY;

-- Writes apenas via RPC log_email_delivery (SECURITY DEFINER, service_role-only).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.email_delivery_log
  FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_sent_at
  ON public.email_delivery_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_recipient_sent_at
  ON public.email_delivery_log (recipient, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_related_entity
  ON public.email_delivery_log (related_entity_type, related_entity_id);

-- Policy SELECT admin: qualquer platform admin ativo.
DROP POLICY IF EXISTS "platform_admins_can_read_email_delivery_log"
  ON public.email_delivery_log;
CREATE POLICY "platform_admins_can_read_email_delivery_log"
  ON public.email_delivery_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE profile_id = auth.uid()
        AND is_active = true
    )
  );

COMMENT ON TABLE public.email_delivery_log IS
  'Rastreio de envios de email transacional admin (sender → SMTP / offline fallback). '
  'Sem organization_id (catálogo global). Writes somente via RPC log_email_delivery. '
  'Diferente de audit_log: log operacional (não imutável forensicamente) — sem '
  'trigger de deny UPDATE/DELETE. Admin pode purgar logs antigos.';

-- =============================================================================
-- 3. RPC: admin_create_integration_credential
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_integration_credential(
  p_kind            text,
  p_label           text,
  p_metadata        jsonb,
  p_secret_plaintext text,
  p_ip_address      text DEFAULT NULL,
  p_user_agent      text DEFAULT NULL
)
RETURNS public.platform_integration_credentials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id      uuid := auth.uid();
  v_vault_id      uuid;
  v_hint          text;
  v_row           public.platform_integration_credentials;
BEGIN
  -- Autorização: apenas platform admin owner ativo.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode gerenciar credenciais.';
  END IF;

  -- Re-checagem do CHECK constraint (early failure com erro tipado).
  IF EXISTS (
    SELECT 1 FROM public.platform_integration_credentials
    WHERE kind = p_kind AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'credential_kind_already_active'
      USING ERRCODE = 'P0001',
            HINT    = 'Já existe credencial ativa deste tipo. Revogue antes de criar nova.';
  END IF;

  -- Hint: '****' + últimos 4 chars do plaintext.
  v_hint := '****' || right(p_secret_plaintext, 4);

  -- Cifragem no Vault. Description usa kind:label como identificador legível
  -- (não-secreto). new_name=NULL evita colisão com unique constraint do vault.
  v_vault_id := vault.create_secret(
    p_secret_plaintext,
    NULL,
    p_kind || ':' || p_label
  );

  -- INSERT da metadata.
  INSERT INTO public.platform_integration_credentials
    (kind, label, vault_secret_id, metadata_jsonb, hint, created_by)
  VALUES
    (p_kind, p_label, v_vault_id, p_metadata, v_hint, v_actor_id)
  RETURNING * INTO v_row;

  -- Audit transacional. ⛔ metadata e diff_after NUNCA contêm plaintext nem
  -- vault_secret_id — apenas kind, label e hint mascarado.
  PERFORM public.audit_write(
    'integration_credential.create',
    'platform_integration_credential',
    v_row.id,
    NULL,
    NULL,
    jsonb_build_object('kind', v_row.kind, 'label', v_row.label, 'hint', v_row.hint),
    jsonb_build_object('kind', v_row.kind, 'label', v_row.label, 'hint', v_row.hint),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_integration_credential(text,text,jsonb,text,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_create_integration_credential(text,text,jsonb,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_integration_credential(text,text,jsonb,text,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_create_integration_credential(text,text,jsonb,text,text,text) TO   service_role;

-- =============================================================================
-- 4. RPC: admin_rotate_integration_credential
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_rotate_integration_credential(
  p_id                  uuid,
  p_new_secret_plaintext text,
  p_new_metadata        jsonb,
  p_ip_address          text DEFAULT NULL,
  p_user_agent          text DEFAULT NULL
)
RETURNS public.platform_integration_credentials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id  uuid := auth.uid();
  v_existing  public.platform_integration_credentials;
  v_hint_new  text;
  v_row       public.platform_integration_credentials;
BEGIN
  -- Autorização.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode rotacionar credenciais.';
  END IF;

  -- Lock e leitura.
  SELECT * INTO v_existing
    FROM public.platform_integration_credentials
   WHERE id = p_id AND revoked_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'credential_not_found'
      USING ERRCODE = 'P0001',
            HINT    = 'Credencial não encontrada ou já revogada.';
  END IF;

  v_hint_new := '****' || right(p_new_secret_plaintext, 4);

  -- Rotação IN-PLACE no Vault: mesmo vault_secret_id, novo plaintext.
  PERFORM vault.update_secret(
    v_existing.vault_secret_id,
    p_new_secret_plaintext,
    NULL,
    v_existing.kind || ':' || v_existing.label
  );

  UPDATE public.platform_integration_credentials
     SET metadata_jsonb = p_new_metadata,
         hint           = v_hint_new,
         rotated_at     = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  -- Audit: diff_before/after referencia apenas hint mascarado.
  PERFORM public.audit_write(
    'integration_credential.rotate',
    'platform_integration_credential',
    p_id,
    NULL,
    jsonb_build_object('hint', v_existing.hint),
    jsonb_build_object('hint', v_row.hint),
    jsonb_build_object('kind', v_row.kind, 'label', v_row.label),
    p_ip_address::inet,
    p_user_agent
  );

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_rotate_integration_credential(uuid,text,jsonb,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_rotate_integration_credential(uuid,text,jsonb,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_rotate_integration_credential(uuid,text,jsonb,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_rotate_integration_credential(uuid,text,jsonb,text,text) TO   service_role;

-- =============================================================================
-- 5. RPC: admin_revoke_integration_credential
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_integration_credential(
  p_id          uuid,
  p_ip_address  text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id  uuid := auth.uid();
  v_existing  public.platform_integration_credentials;
BEGIN
  -- Autorização.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = v_actor_id
      AND is_active = true
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admin owner pode revogar credenciais.';
  END IF;

  SELECT * INTO v_existing
    FROM public.platform_integration_credentials
   WHERE id = p_id AND revoked_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'credential_not_found'
      USING ERRCODE = 'P0001',
            HINT    = 'Credencial não encontrada ou já revogada.';
  END IF;

  UPDATE public.platform_integration_credentials
     SET revoked_at = now()
   WHERE id = p_id;

  -- DELETE no Vault em best-effort. Falha não aborta a transação — credencial
  -- fica orphan no Vault mas inacessível pela aplicação (filtro revoked_at IS NULL).
  BEGIN
    DELETE FROM vault.secrets WHERE id = v_existing.vault_secret_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'vault delete failed for credential %: %', p_id, SQLERRM;
  END;

  PERFORM public.audit_write(
    'integration_credential.revoke',
    'platform_integration_credential',
    p_id,
    NULL,
    jsonb_build_object('revoked_at', NULL),
    jsonb_build_object('revoked_at', now()),
    jsonb_build_object('kind', v_existing.kind, 'label', v_existing.label),
    p_ip_address::inet,
    p_user_agent
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_integration_credential(uuid,text,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_integration_credential(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_integration_credential(uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_integration_credential(uuid,text,text) TO   service_role;

-- =============================================================================
-- 6. RPC: admin_list_integration_credentials
-- =============================================================================
-- Projeção SEM vault_secret_id (defesa em profundidade — UUID isolado é inerte
-- sem privilégio em vault, mas nunca o expomos pela API).

CREATE OR REPLACE FUNCTION public.admin_list_integration_credentials()
RETURNS TABLE (
  id             uuid,
  kind           text,
  label          text,
  metadata_jsonb jsonb,
  hint           text,
  created_at     timestamptz,
  created_by     uuid,
  last_used_at   timestamptz,
  rotated_at     timestamptz,
  revoked_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE profile_id = auth.uid()
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = 'P0001',
            HINT    = 'Apenas platform admins ativos podem listar credenciais.';
  END IF;

  RETURN QUERY
    SELECT c.id, c.kind, c.label, c.metadata_jsonb, c.hint,
           c.created_at, c.created_by, c.last_used_at, c.rotated_at, c.revoked_at
      FROM public.platform_integration_credentials c
     ORDER BY c.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_integration_credentials() FROM public;
REVOKE EXECUTE ON FUNCTION public.admin_list_integration_credentials() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_integration_credentials() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_integration_credentials() TO   service_role;

-- =============================================================================
-- 7. RPC: get_integration_credential_plaintext
-- =============================================================================
-- ⛔ CRÍTICO: ÚNICO caminho ao plaintext fora do Vault.
-- Caller autorizado: src/lib/email/getCredential.ts via service client.
-- Nunca exposta a authenticated/anon — Guardian valida via grep que apenas
-- getCredential.ts importa ou referencia esta RPC.

CREATE OR REPLACE FUNCTION public.get_integration_credential_plaintext(
  p_kind text
)
RETURNS TABLE (
  plaintext     text,
  metadata      jsonb,
  credential_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_id uuid;
  v_metadata jsonb;
  v_id       uuid;
BEGIN
  SELECT c.vault_secret_id, c.metadata_jsonb, c.id
    INTO v_vault_id, v_metadata, v_id
    FROM public.platform_integration_credentials c
   WHERE c.kind = p_kind
     AND c.revoked_at IS NULL
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'credential_not_found'
      USING ERRCODE = 'P0001',
            HINT    = 'Sem credencial ativa para o kind solicitado.';
  END IF;

  -- Decifra via vault.decrypted_secrets. Falha se o secret foi removido
  -- fora-de-banda do Vault.
  RETURN QUERY
    SELECT ds.decrypted_secret::text, v_metadata, v_id
      FROM vault.decrypted_secrets ds
     WHERE ds.id = v_vault_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vault_secret_missing'
      USING ERRCODE = 'P0001',
            HINT    = 'Secret no Vault inconsistente; revogue e recadastre a credencial.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_integration_credential_plaintext(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_integration_credential_plaintext(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_integration_credential_plaintext(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_integration_credential_plaintext(text) TO   service_role;

-- =============================================================================
-- 8. RPC: mark_credential_used
-- =============================================================================
-- Atualiza last_used_at após sucesso de envio. Permitido em soft-revoked para
-- não falhar o envio em flight quando a revogação acontece em paralelo.

CREATE OR REPLACE FUNCTION public.mark_credential_used(
  p_credential_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.platform_integration_credentials
     SET last_used_at = now()
   WHERE id = p_credential_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_credential_used(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.mark_credential_used(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_credential_used(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_credential_used(uuid) TO   service_role;

-- =============================================================================
-- 9. RPC: log_email_delivery
-- =============================================================================
-- Audit somente quando source='offline_fallback' (evento de baixa frequência).
-- Para sent/error, fica só na própria email_delivery_log (alta frequência).

CREATE OR REPLACE FUNCTION public.log_email_delivery(
  p_recipient            text,
  p_subject              text,
  p_kind                 text,
  p_source               text,
  p_status               text,
  p_offline_link         text,
  p_error_message        text,
  p_related_entity_type  text,
  p_related_entity_id    uuid,
  p_sent_by              uuid
)
RETURNS public.email_delivery_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              public.email_delivery_log;
  v_truncated_error  text;
BEGIN
  -- Truncamento defensivo (CHECK constraint também impede, mas trunca para
  -- não rejeitar log por overflow do transport).
  v_truncated_error := CASE
    WHEN p_error_message IS NULL THEN NULL
    ELSE left(p_error_message, 1000)
  END;

  INSERT INTO public.email_delivery_log (
    recipient, subject, kind, source, status,
    offline_link, error_message,
    related_entity_type, related_entity_id, sent_by
  ) VALUES (
    p_recipient, p_subject, p_kind, p_source, p_status,
    p_offline_link, v_truncated_error,
    p_related_entity_type, p_related_entity_id, p_sent_by
  )
  RETURNING * INTO v_row;

  -- Audit somente para offline_fallback.
  IF p_source = 'offline_fallback' THEN
    PERFORM public.audit_write(
      'email.delivery_offline_fallback',
      'email_delivery',
      v_row.id,
      NULL,
      NULL,
      jsonb_build_object('source', p_source),
      jsonb_build_object(
        'kind',                p_kind,
        'recipient',           p_recipient,
        'related_entity_type', p_related_entity_type,
        'related_entity_id',   p_related_entity_id
      )
    );
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid) TO   service_role;

-- =============================================================================
-- FIM DA MIGRATION
-- =============================================================================
