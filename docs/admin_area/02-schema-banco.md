# 02 — Schema de Banco

> **Observação:** Este documento é **referência canônica** das 7 tabelas novas. A migration real é gerada pelo `@db-admin` no Sprint 1, seguindo os padrões do framework (nomenclatura de arquivos, idempotência, RLS com `ENABLE ROW LEVEL SECURITY`). O SQL aqui serve como spec — o `@db-admin` pode ajustar detalhes sintáticos conforme os padrões do projeto.

## Resumo das tabelas

| # | Tabela | Tipo | Tem `organization_id`? | RLS |
|---|---|---|---|---|
| 1 | `platform_admins` | Global | ❌ Não | `DENY ALL` — acesso só via service_role |
| 2 | `plans` | Global | ❌ Não | `SELECT` público (qualquer auth.user pode ler planos ativos); demais operações só via service_role |
| 3 | `subscriptions` | Tenant-linked | ✅ Sim (FK organizations) | Customer lê a própria; platform admin escreve via service_role |
| 4 | `impersonation_sessions` | Global (audit) | ❌ Não | `DENY ALL` — escrita só via service_role, leitura pelo admin via action |
| 5 | `platform_audit_log` | Global (audit) | ❌ Não | `DENY ALL` — insert-only via service_role |
| 6 | `platform_settings` | Global (singleton) | ❌ Não | `DENY ALL` — acesso só via service_role |
| 7 | `platform_integration_credentials` | Global | ❌ Não | `DENY ALL` — cifrada, acesso só via service_role |

---

## 1. `platform_admins`

Identidade do super admin. Um user em `auth.users` só é considerado platform admin se tiver entrada ativa nesta tabela.

```sql
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'support',  -- 'owner' | 'support' | 'billing'
  full_name       text NOT NULL,
  email           text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  mfa_enrolled_at timestamptz,

  CONSTRAINT platform_admins_role_check
    CHECK (role IN ('owner', 'support', 'billing'))
);

CREATE INDEX idx_platform_admins_user_id ON public.platform_admins(user_id);
CREATE INDEX idx_platform_admins_active  ON public.platform_admins(is_active) WHERE is_active = true;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- DENY ALL — nenhuma policy. Acesso exclusivo via service_role.
```

**Seed inicial:** o primeiro platform admin (owner) é criado manualmente via SQL ou via script de bootstrap no deploy inicial. Não fica exposto na UI.

---

## 2. `plans`

Planos de assinatura do SaaS (Free, Starter, Pro, Enterprise, etc). Leitura pública (customer vê planos ao configurar conta), escrita apenas por platform admin.

```sql
CREATE TABLE IF NOT EXISTS public.plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,                 -- 'free', 'starter', 'pro'
  name           text NOT NULL,                        -- 'Free', 'Starter', 'Pro'
  description    text,
  price_monthly  numeric(10, 2) NOT NULL DEFAULT 0,    -- em reais
  price_yearly   numeric(10, 2),                       -- null = não oferece anual
  max_users      integer NOT NULL DEFAULT 3,
  max_leads      integer,                              -- null = ilimitado
  max_products   integer,                              -- null = ilimitado
  features       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { whatsapp_integration: true, funnels: true, ... }
  trial_days     integer NOT NULL DEFAULT 14,
  is_active      boolean NOT NULL DEFAULT true,
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plans_slug   ON public.plans(slug);
CREATE INDEX idx_plans_active ON public.plans(is_active, display_order) WHERE is_active = true;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (is_active = true);

-- INSERT, UPDATE, DELETE: sem policy → negado → só via service_role
```

**Seed inicial** (Sprint 1):

```sql
INSERT INTO public.plans (slug, name, description, price_monthly, max_users, max_leads, features, trial_days, display_order) VALUES
  ('free',     'Free',     'Para times começando',       0,      3,  100,  '{"funnels": true, "whatsapp_integration": false}'::jsonb,                                      14, 1),
  ('starter',  'Starter',  'Para pequenos negócios',     49.90,  10, 1000, '{"funnels": true, "whatsapp_integration": true}'::jsonb,                                       14, 2),
  ('pro',      'Pro',      'Para empresas em crescimento', 149.90, 50, null, '{"funnels": true, "whatsapp_integration": true, "advanced_reports": true}'::jsonb,            14, 3);
```

---

## 3. `subscriptions`

Vínculo ativo de uma organization a um plano.

```sql
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id               uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'trial',     -- 'trial' | 'active' | 'past_due' | 'canceled' | 'expired'
  billing_period        text NOT NULL DEFAULT 'monthly',   -- 'monthly' | 'yearly'
  current_period_start  timestamptz NOT NULL DEFAULT now(),
  current_period_end    timestamptz NOT NULL,
  trial_ends_at         timestamptz,
  canceled_at           timestamptz,
  cancel_reason         text,
  external_id           text,                              -- fase 2 — Stripe subscription id
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'expired')),
  CONSTRAINT subscriptions_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly'))
);

CREATE UNIQUE INDEX idx_subscriptions_org_active
  ON public.subscriptions(organization_id)
  WHERE status IN ('trial', 'active', 'past_due');  -- uma org só tem uma subscription ativa por vez

CREATE INDEX idx_subscriptions_status        ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_plan          ON public.subscriptions(plan_id);
CREATE INDEX idx_subscriptions_period_end    ON public.subscriptions(current_period_end);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

-- INSERT, UPDATE, DELETE: sem policy → só via service_role (admin app)
```

### Backfill (Sprint 1)

Popular `subscriptions` a partir de `organizations.plan` existente:

```sql
-- Garante que todas as orgs existentes tenham uma subscription
INSERT INTO public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
SELECT
  o.id,
  COALESCE(p_matched.id, p_free.id),
  CASE WHEN o.is_active THEN 'active' ELSE 'canceled' END,
  o.created_at,
  now() + interval '30 days'
FROM public.organizations o
LEFT JOIN public.plans p_matched ON p_matched.slug = o.plan
CROSS JOIN LATERAL (SELECT id FROM public.plans WHERE slug = 'free' LIMIT 1) p_free
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.organization_id = o.id
);
```

**Depreciação futura:** colunas `organizations.plan` e `organizations.max_users` passarão a ser **derivadas** de `subscriptions` + `plans`. Não remover agora (compat) — marcar como deprecated em comentário. Remover em sprint futuro quando toda a UI migrar.

---

## 4. `impersonation_sessions`

Audit imutável de sessões de impersonation.

```sql
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id            uuid NOT NULL REFERENCES public.platform_admins(id) ON DELETE RESTRICT,
  target_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  reason              text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  status              text NOT NULL DEFAULT 'active',  -- 'active' | 'ended' | 'expired'
  ip_address          inet,
  user_agent          text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT impersonation_sessions_status_check
    CHECK (status IN ('active', 'ended', 'expired'))
);

CREATE INDEX idx_impersonation_admin_id      ON public.impersonation_sessions(admin_id);
CREATE INDEX idx_impersonation_target_user   ON public.impersonation_sessions(target_user_id);
CREATE INDEX idx_impersonation_target_org    ON public.impersonation_sessions(target_organization_id);
CREATE INDEX idx_impersonation_status        ON public.impersonation_sessions(status) WHERE status = 'active';
CREATE INDEX idx_impersonation_started_at    ON public.impersonation_sessions(started_at DESC);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
-- DENY ALL — acesso só via service_role

-- Trigger: proíbe DELETE e UPDATE exceto em campos específicos (ended_at, status)
CREATE OR REPLACE FUNCTION prevent_impersonation_session_tampering()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'impersonation_sessions are immutable — DELETE not allowed';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.admin_id <> NEW.admin_id
       OR OLD.target_user_id <> NEW.target_user_id
       OR OLD.target_organization_id <> NEW.target_organization_id
       OR OLD.started_at <> NEW.started_at
       OR OLD.reason IS DISTINCT FROM NEW.reason
    THEN
      RAISE EXCEPTION 'impersonation_sessions fields are immutable except ended_at and status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_impersonation_sessions_immutable
  BEFORE UPDATE OR DELETE ON public.impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION prevent_impersonation_session_tampering();
```

---

## 5. `platform_audit_log`

Log imutável de todas as ações executadas por platform admins.

```sql
CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id              bigserial PRIMARY KEY,
  admin_id        uuid NOT NULL REFERENCES public.platform_admins(id) ON DELETE RESTRICT,
  action          text NOT NULL,              -- ex: 'organization.suspend', 'plan.update', 'impersonation.start'
  target_type     text,                       -- ex: 'organization', 'plan', 'subscription', 'user'
  target_id       text,                       -- uuid ou outro ID como texto
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_admin_id     ON public.platform_audit_log(admin_id);
CREATE INDEX idx_audit_action       ON public.platform_audit_log(action);
CREATE INDEX idx_audit_target       ON public.platform_audit_log(target_type, target_id);
CREATE INDEX idx_audit_created_at   ON public.platform_audit_log(created_at DESC);

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
-- DENY ALL — insert only via service_role

-- Trigger: proíbe UPDATE e DELETE
CREATE OR REPLACE FUNCTION prevent_audit_log_tampering()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_log is append-only — % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_tampering();
```

### Convenção de `action`

Formato: `<resource>.<verb>` em snake_case/dot_case.

Exemplos que a aplicação deve emitir:

| Action | Quando | target_type |
|---|---|---|
| `organization.suspend` | Suspender org | `organization` |
| `organization.activate` | Reativar org | `organization` |
| `organization.update` | Editar dados de org | `organization` |
| `plan.create` | Criar plano | `plan` |
| `plan.update` | Editar plano | `plan` |
| `plan.delete` | Excluir plano | `plan` |
| `subscription.assign` | Atribuir plano a org | `subscription` |
| `subscription.change_plan` | Trocar plano | `subscription` |
| `subscription.extend_trial` | Estender trial | `subscription` |
| `subscription.cancel` | Cancelar | `subscription` |
| `platform_admin.create` | Criar admin | `platform_admin` |
| `platform_admin.deactivate` | Desativar admin | `platform_admin` |
| `impersonation.start` | Iniciar impersonation | `user` |
| `impersonation.end` | Encerrar impersonation | `user` |
| `platform_setting.update` | Alterar configuração | `platform_setting` |
| `integration_credential.update` | Atualizar credencial | `integration_credential` |

---

## 6. `platform_settings`

Singleton (sempre 1 linha) com configurações globais do SaaS.

```sql
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton                   boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton = true),

  -- Trial defaults
  default_trial_days          integer NOT NULL DEFAULT 14,
  default_trial_max_users     integer NOT NULL DEFAULT 3,
  default_trial_max_leads     integer NOT NULL DEFAULT 100,

  -- Feature flags globais (liga/desliga módulos por plano)
  feature_flags               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- estrutura esperada:
  -- {
  --   "by_plan": {
  --     "free":    { "whatsapp_integration": false, "advanced_reports": false },
  --     "starter": { "whatsapp_integration": true,  "advanced_reports": false },
  --     "pro":     { "whatsapp_integration": true,  "advanced_reports": true }
  --   },
  --   "global": { "new_ui_beta": false }
  -- }

  -- Usage policies
  retention_days_leads        integer NOT NULL DEFAULT 730,   -- 2 anos
  retention_days_audit_log    integer NOT NULL DEFAULT 1825,  -- 5 anos
  rate_limit_api_per_minute   integer NOT NULL DEFAULT 300,
  max_upload_size_mb          integer NOT NULL DEFAULT 10,

  -- Metadata
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- DENY ALL — acesso só via service_role

-- Seed da linha única
INSERT INTO public.platform_settings (singleton) VALUES (true)
ON CONFLICT DO NOTHING;
```

---

## 7. `platform_integration_credentials`

Armazenamento cifrado de chaves de APIs externas (Stripe secret, SMTP password, WhatsApp token).

```sql
CREATE EXTENSION IF NOT EXISTS pgsodium;  -- se não existe já

CREATE TABLE IF NOT EXISTS public.platform_integration_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration      text NOT NULL UNIQUE,     -- 'stripe' | 'smtp' | 'whatsapp_api'
  credentials      jsonb NOT NULL,           -- valores cifrados — ver nota abaixo
  is_active        boolean NOT NULL DEFAULT true,
  last_rotated_at  timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_integration_credentials ENABLE ROW LEVEL SECURITY;
-- DENY ALL — acesso só via service_role
```

### Estratégia de cifragem

**Opção A — pgsodium (Supabase native):** usar `pgsodium.crypto_aead_det_encrypt` com chave master no Supabase Vault. Cada campo sensível dentro de `credentials` é cifrado separadamente.

**Opção B — aplicação cifra antes de persistir:** Sprint 8 define helper `encryptCredential(value)` / `decryptCredential(ciphertext)` em `src/lib/admin/encryption.ts` usando chave de env var `PLATFORM_ENCRYPTION_KEY`. Credenciais entram como base64 ciphertext no jsonb.

**Decisão:** preferir **Opção A (pgsodium)** se disponível no plano Supabase atual; fallback para **Opção B** se houver restrição. `@db-admin` decide no Sprint 8 conforme ambiente.

---

## Helper function: `is_platform_admin`

SQL function para uso em RLS policies ou queries (caso necessário no futuro):

```sql
CREATE OR REPLACE FUNCTION public.is_platform_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = check_user_id AND is_active = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
```

Uso típico: dentro de policies que queiram conceder acesso a platform admins (raro — preferimos service_role pela clareza).

---

## Ordem sugerida de migration (Sprint 1)

Para evitar problemas de FK e dependências:

```
1. CREATE EXTENSION pgsodium                    -- se precisar
2. CREATE TABLE platform_admins
3. CREATE TABLE plans
4. INSERT INTO plans (seed inicial)
5. CREATE TABLE subscriptions
6. INSERT INTO subscriptions (backfill de organizations.plan)
7. CREATE TABLE platform_audit_log + trigger
8. CREATE TABLE impersonation_sessions + trigger
9. CREATE TABLE platform_settings + seed singleton
10. CREATE TABLE platform_integration_credentials
11. CREATE FUNCTION is_platform_admin
12. Bootstrap do primeiro platform admin (owner) — via script pós-migration
```

## Atualização do `schema_snapshot.json`

Após a migration aplicar, o `@db-admin` deve atualizar `docs/schema_snapshot.json` com as 7 tabelas novas + colunas + indexes + policies, seguindo o formato existente.
