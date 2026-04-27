# PRD: Credenciais cifradas + bootstrap email com fallback

**Template:** PRD_COMPLETE
**Complexity Score:** 22 points (cap; ≥9 dispara COMPLETE; integração externa + lógica nova reforçam)
**Sprint:** sprint_admin_10
**Created:** 2026-04-27
**Status:** Draft

---

## 1. Overview

### Business Goal

Resolver dois problemas que travam a operação da Admin Area antes do Sprint 11 (CRUD platform admins + convite single-use):

1. **Credenciais sensíveis em claro** (RF-SET-4 + G-14): qualquer credencial transacional (SMTP no MVP; SMS/webhooks na fase 2) precisa estar **cifrada em repouso** com plaintext acessível apenas via decifragem server-side por caller autorizado, e nunca ecoar em response da Admin API.
2. **Chicken-and-egg do bootstrap de email** (RF-SET-7): primeiro acesso à plataforma — admin precisa convidar o segundo owner, mas SMTP ainda não foi cadastrado. Sistema precisa cair em **fallback chain de 3 níveis** (credencial cifrada no banco → env vars `BOOTSTRAP_EMAIL_*` → link copiável offline) sem intervenção do usuário, registrando a fonte usada em `email_delivery_log`.

Esta sprint **entrega só a infra**: o sender genérico (`src/lib/email/sender.ts`) que outros sprints (Sprint 11 convite admin, fase 2 emails customer) consomem. Não migra calls existentes nem produz templates HTML.

### User Story

- Como **platform admin owner**, quero cadastrar a credencial SMTP via UI uma única vez para que envios admin saiam pelo nosso domínio sem vazar segredo no banco.
- Como **platform admin owner em primeiro acesso**, quero convidar o segundo owner via link copiável quando ainda não há SMTP cadastrado, sem ficar bloqueado.
- Como **DevOps**, em incidente onde Vault perde acesso, quero fallback automático para env vars `BOOTSTRAP_EMAIL_*` sem intervenção manual.
- Como **auditor**, quero rastro de toda criação/rotação/revogação com diff mascarado (nunca plaintext) no `audit_log`.

### Success Metrics

- **G-14 enforced**: scan automatizado (Guardian) + teste integrado garantem que `secretPlaintext` e `vault_secret_id` nunca aparecem em response JSON, log de console, payload de audit, ou cache em request.
- **Fallback chain demonstrável**: 3 caminhos (`platform_setting`, `env_var`, `offline_fallback`) testados com inputs determinísticos; cada um grava `email_delivery_log` com `source` correto.
- **Banner global "Email não configurado"** aparece quando ambas as fontes ativas (DB + env) estão vazias e desaparece após cadastro pela UI sem reload (via `revalidatePath`).
- **Audit imutável**: rotação e revogação geram audit row com `metadata={kind, label, hint}` e nenhuma referência a plaintext, validado por SQL spot-check.
- **RBAC**: owner cria/rotaciona/revoga; support/billing leem (botões mutation ocultos); customer (JWT regular) recebe 403 ao acessar `/admin/settings/integrations/email`; chamada direta a `get_integration_credential_plaintext` via JWT regular falha com `42501`.

---

## 2. Database Requirements

### Decisão de cifragem (locked)

**Supabase Vault** (`extensions.supabase_vault` v0.3.1, schema `vault`) — **já instalado**. O catálogo `pgsodium` não é habilitado e não será requisitado. Vault expõe `vault.create_secret(secret, name, description)`, `vault.update_secret(id, secret, name, description)`, table `vault.secrets`, e view `vault.decrypted_secrets` (apenas privilegiada). REVOKE default do Supabase fecha `authenticated/anon` para `vault.*`.

**Sem `vault.delete_secret`**: deleção via `DELETE FROM vault.secrets WHERE id=...` chamado de `SECURITY DEFINER` owned por `postgres` (que tem grant DELETE no schema vault).

### New Tables

#### Table: `public.platform_integration_credentials`

**Purpose:** metadata da credencial cadastrada na plataforma; o secret real (password SMTP) vive em `vault.secrets`. Catálogo global — sem `organization_id` (será listado em §2 do PROJECT_CONTEXT como exceção compensada por RLS).

**Fields:**
- `id` — `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `kind` — `text NOT NULL CHECK (kind IN ('email_smtp'))` — enum aberto via migration explícita; MVP só `email_smtp`.
- `label` — `text NOT NULL CHECK (length(label) BETWEEN 1 AND 80)` — humano-legível ("Production SMTP — Brevo").
- `vault_secret_id` — `uuid NOT NULL` — FK lógica para `vault.secrets.id`. **Não declarada como FK física** (cross-schema; preserva idempotência da migration; vault não suporta FK reversa).
- `metadata_jsonb` — `jsonb NOT NULL DEFAULT '{}'::jsonb` — config não-secreta. Para `email_smtp`: `{ host: text, port: int, user: text, secure: bool, fromEmail: text }`. Senha vai cifrada para o vault separadamente.
- `hint` — `text NULL CHECK (hint IS NULL OR (length(hint) = 8 AND hint LIKE '****%'))` — exatamente 8 chars: `****` + últimos 4 chars do plaintext. Sempre populado pela RPC; coluna nullable apenas para tolerar criação manual em incidente.
- `created_at` — `timestamptz NOT NULL DEFAULT now()`
- `created_by` — `uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
- `last_used_at` — `timestamptz NULL` — atualizado por `mark_credential_used` em sucesso de envio.
- `rotated_at` — `timestamptz NULL` — `now()` na rotação. `vault_secret_id` permanece o mesmo (rotação in-place via `vault.update_secret`).
- `revoked_at` — `timestamptz NULL` — soft-revoke; query "ativa" filtra `WHERE revoked_at IS NULL`.

**Indexes:**
- PK em `id` (default).
- **UNIQUE parcial** `idx_one_active_per_kind` em `(kind) WHERE revoked_at IS NULL` — garante no máx 1 ativa por kind. Mesmo padrão de INV-1 do Sprint 01.

**Security (RLS):**
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- Policy SELECT `select_platform_admin_active`: `is_platform_admin(auth.uid())`. Projeção da Server Action **não retorna `vault_secret_id`** (defesa em profundidade — UUID isolado é inerte sem privilégio em vault, mas nunca o expomos).
- **Sem policies de mutação** — INSERT/UPDATE/DELETE via RPCs `SECURITY DEFINER`.

**Constraints:**
- UNIQUE parcial conforme acima.
- CHECK length em `label` e `hint`.

#### Table: `public.email_delivery_log`

**Purpose:** rastreio de cada envio de email transacional admin (incluindo fallback offline). Catálogo global de eventos da plataforma — sem `organization_id` (exceção em §2 do PROJECT_CONTEXT).

**Fields:**
- `id` — `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `recipient` — `text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 320)` — email destinatário; **não mascarado** (admin precisa diagnosticar).
- `subject` — `text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200)`
- `kind` — `text NOT NULL CHECK (kind IN ('invitation','password_reset','admin_notification'))` — enum aberto.
- `source` — `text NOT NULL CHECK (source IN ('platform_setting','env_var','offline_fallback'))` — qual nível da chain entregou.
- `status` — `text NOT NULL CHECK (status IN ('sent','fallback_offline','error'))` — `sent` = transport OK; `fallback_offline` = link gerado, sem transport; `error` = transport falhou. **Combinações válidas** (CHECK composto):
  - `(source='platform_setting' OR source='env_var') AND status IN ('sent','error')`
  - `source='offline_fallback' AND status='fallback_offline'`
- `offline_link` — `text NULL` — preenchido **apenas** quando `source='offline_fallback'`; URL completa, signed, recebida do caller.
- `error_message` — `text NULL CHECK (error_message IS NULL OR length(error_message) <= 1000)` — preenchido quando `status='error'`. Truncado pela RPC.
- `related_entity_type` — `text NULL CHECK (related_entity_type IS NULL OR related_entity_type IN ('invitation','platform_admin_invitation','password_reset'))` — FK lógica para o objeto que disparou.
- `related_entity_id` — `uuid NULL` — id do objeto. Sem FK física (race com revoke do objeto não bloqueia o log).
- `sent_at` — `timestamptz NOT NULL DEFAULT now()`
- `sent_by` — `uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL` — admin que originou; null em jobs futuros.

**Indexes:**
- `(sent_at DESC)` — listagem cronológica.
- `(recipient, sent_at DESC)` — diagnose por destinatário.
- `(related_entity_type, related_entity_id)` — correlação com convite/reset.

**Security (RLS):**
- `FORCE ROW LEVEL SECURITY`
- Policy SELECT: platform admins ativos.
- **Sem policies de mutação** — writes apenas via RPC `log_email_delivery` chamada pelo sender com service client.
- **Sem trigger de deny** UPDATE/DELETE — log operacional (retenção curta), não evidência forense imutável; admin pode purgar antigos. Diferente de `audit_log`. Documentado no header da migration.

### Existing Tables Used

#### `public.platform_settings` (Sprint 09)
**Usage:** ler `signup_link_offline_fallback_enabled` (bool) para decidir se fallback offline está ativo.
**Fields accessed:** `key`, `value_bool`.

#### `public.audit_log` (Sprint 03, via `audit_write`)
**Usage:** registrar `integration_credential.create`/`rotate`/`revoke` e `email.delivery_offline_fallback`.

#### `vault.secrets` (Supabase Vault)
**Usage:** armazenar plaintext SMTP cifrado.
**Fields accessed:** `id` (apenas referenciado).

#### `vault.decrypted_secrets` (Supabase Vault)
**Usage:** decifrar secret on-demand dentro de RPC `SECURITY DEFINER`. Acesso só pelo função-owner (`postgres`); nunca direto pela aplicação.
**Fields accessed:** `id`, `decrypted_secret`.

### Modified Tables

Nenhuma. Esta sprint não altera schemas existentes.

---

## 3. API Contract

### RPCs (Postgres) — fonte canônica de privilégios

Todas `SECURITY DEFINER`, `SET search_path TO 'public'`, com REVOKE EXECUTE explícito de `public, anon, authenticated`. GRANT seletivo conforme tabela:

| RPC | Caller (GRANT EXECUTE) | Audit | Observação |
|---|---|---|---|
| `admin_create_integration_credential(p_kind, p_label, p_metadata, p_secret_plaintext) → row` | `service_role` | `integration_credential.create` | Chamada por Server Action após `requirePlatformAdminRole(['owner'])`. RPC re-valida owner via `platform_admins`. |
| `admin_rotate_integration_credential(p_id, p_new_secret_plaintext, p_new_metadata) → row` | `service_role` | `integration_credential.rotate` | Rotação **in-place** via `vault.update_secret(vault_secret_id, ...)`. Same UUID, novo plaintext. |
| `admin_revoke_integration_credential(p_id) → void` | `service_role` | `integration_credential.revoke` | Soft-set `revoked_at=now()` + `DELETE FROM vault.secrets WHERE id=vault_secret_id` (best-effort; falha em vault não aborta). |
| `admin_list_integration_credentials() → setof row` | `service_role` | — | Projeção sem `vault_secret_id`. |
| `get_integration_credential_plaintext(p_kind) → (plaintext text, metadata jsonb, credential_id uuid)` | `service_role` | — (alta frequência) | **⛔ Único caminho** ao plaintext. Chamada apenas por `src/lib/email/getCredential.ts`. |
| `mark_credential_used(p_credential_id)` | `service_role` | — | UPDATE `last_used_at=now()`. UPDATE permitido **mesmo em soft-revoked** (envio em flight conclui). |
| `log_email_delivery(...)` | `service_role` | `email.delivery_offline_fallback` somente quando `p_source='offline_fallback'` | Trunca `error_message` a 1000 chars dentro da RPC. |

**REVOKE pattern obrigatório** (APRENDIZADO 2026-04-24 — `REVOKE FROM public` não cobre `anon`):
```sql
REVOKE EXECUTE ON FUNCTION public.<rpc>(...) FROM public;
REVOKE EXECUTE ON FUNCTION public.<rpc>(...) FROM anon;
REVOKE EXECUTE ON FUNCTION public.<rpc>(...) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.<rpc>(...) TO   service_role;
```

**Validação SQL (acceptance):**
```sql
SELECT has_function_privilege('anon',           'public.get_integration_credential_plaintext(text)', 'execute'); -- false
SELECT has_function_privilege('authenticated',  'public.get_integration_credential_plaintext(text)', 'execute'); -- false
SELECT has_function_privilege('service_role',   'public.get_integration_credential_plaintext(text)', 'execute'); -- true
```

### Audit payloads (locked — Guardian valida via grep)

| Action | `target_type` | `target_id` | `target_organization_id` | `metadata` | `diff_before` | `diff_after` |
|---|---|---|---|---|---|---|
| `integration_credential.create` | `'platform_integration_credential'` | new credential UUID | NULL | `{kind, label, hint}` | NULL | `{kind, label, hint}` |
| `integration_credential.rotate` | idem | credential UUID | NULL | `{kind, label}` | `{hint: hint_before}` | `{hint: hint_after}` |
| `integration_credential.revoke` | idem | credential UUID | NULL | `{kind, label}` | `{revoked_at: NULL}` | `{revoked_at: now()}` |
| `email.delivery_offline_fallback` | `'email_delivery'` | `email_delivery_log.id` | NULL | `{kind, recipient, related_entity_type, related_entity_id}` | NULL | `{source: 'offline_fallback'}` |

**Proibido em qualquer payload de audit:** `secretPlaintext`, `password`, `vault_secret_id`, valores literais do plaintext.

### Server Actions

#### File: `src/lib/actions/admin/integration-credentials.ts` + `.schemas.ts`

**Schemas (`.schemas.ts`):**
```typescript
const credentialKindSchema = z.literal('email_smtp');

const smtpMetadataSchema = z.object({
  host:      z.string().trim().min(1).max(255),
  port:      z.number().int().min(1).max(65535),
  user:      z.string().trim().min(1).max(255),
  secure:    z.boolean(),
  fromEmail: z.string().trim().email().max(320),
});

export const CreateIntegrationCredentialSchema = z.object({
  kind:           credentialKindSchema,
  label:          z.string().trim().min(1).max(80),
  metadata:       smtpMetadataSchema,
  secretPlaintext: z.string().min(1).max(500),
});

export const RotateIntegrationCredentialSchema = z.object({
  id:                 z.string().uuid(),
  newSecretPlaintext: z.string().min(1).max(500),
  newMetadata:        smtpMetadataSchema,
});

export const RevokeIntegrationCredentialSchema = z.object({
  id:          z.string().uuid(),
  confirmKind: credentialKindSchema, // server compara com o kind real do registro
});

export interface IntegrationCredentialView {
  id:          string;
  kind:        'email_smtp';
  label:       string;
  metadata:    z.infer<typeof smtpMetadataSchema>;
  hint:        string | null;
  createdAt:   string;
  createdBy:   { id: string; name: string | null } | null;
  lastUsedAt:  string | null;
  rotatedAt:   string | null;
  revokedAt:   string | null;
  // PROIBIDO: secretPlaintext, vaultSecretId — Guardian grep guard.
}
```

**Actions:**
- `listIntegrationCredentialsAction()` — owner+support+billing read. Chama `admin_list_integration_credentials`; mapeia para `IntegrationCredentialView[]`.
- `createIntegrationCredentialAction(input)` — owner-only (`requirePlatformAdminRole(['owner'])`). Zod → `admin_create_integration_credential` RPC. `revalidatePath('/admin/settings/integrations/email')` + `revalidatePath('/admin')` (banner global). Retorna `IntegrationCredentialView`.
- `rotateIntegrationCredentialAction(input)` — owner-only. Zod → `admin_rotate_integration_credential`. Mesma `revalidatePath`.
- `revokeIntegrationCredentialAction(input)` — owner-only. Zod → server lê o `kind` real do registro, compara com `confirmKind`, falha com `'confirm_kind_mismatch'` se diverge. Caso contrário, chama RPC. Mesma `revalidatePath`.

**Mapeamento de erro tipado** (APRENDIZADO 2026-04-26 — `error instanceof Error` falha para `PostgrestError`):
```typescript
const RPC_ERRORS: Record<string, string> = {
  unauthorized:                    'Acesso negado. Apenas owner pode gerenciar credenciais.',
  credential_kind_already_active:  'Já existe uma credencial ativa deste tipo. Revogue antes de criar nova.',
  credential_not_found:            'Credencial não encontrada ou já revogada.',
  confirm_kind_mismatch:           'Confirmação não bate com o tipo da credencial.',
  vault_secret_missing:            'Erro de Vault — credencial inconsistente. Revogue e recadastre.',
};

function rpcError(error: unknown): string {
  let msg = '';
  if (error !== null && typeof error === 'object' && 'message' in error
      && typeof (error as { message: unknown }).message === 'string') {
    msg = (error as { message: string }).message;
  } else { msg = String(error); }
  for (const [code, label] of Object.entries(RPC_ERRORS)) {
    if (msg.includes(code)) return label;
  }
  return 'Erro interno. Tente novamente.';
}
```

⛔ **Crítico (Guardian valida):** schemas e tipos de retorno **omitem** `secretPlaintext`, `password`, `vaultSecretId`. Grep guard:
```
grep -nE "(secretPlaintext|vault_secret_id|vaultSecretId)" src/lib/actions/admin/integration-credentials*.ts
# em qualquer ocorrência fora de input/parsed.data, falhar
```

### Email helpers (server-only)

#### File: `src/lib/email/getCredential.ts`

```typescript
import 'server-only';
import { cache } from 'react';
import { createServiceClient } from '@/lib/supabase/server';

interface SmtpCredential {
  source: 'platform_setting' | 'env_var';
  transport: 'smtp';
  host: string;
  port: number;
  user: string;
  secure: boolean;
  fromEmail: string;
  password: string;     // plaintext; nunca persistir, logar, ou retornar para client
  credentialId: string | null; // null quando source='env_var'
}

export class EmailNotConfiguredError extends Error {
  constructor() { super('email_not_configured'); }
}

export const getEmailCredential = cache(async (): Promise<SmtpCredential | null> => {
  const supabase = createServiceClient();

  // Nível 1: DB (Vault)
  const { data, error } = await supabase
    .rpc('get_integration_credential_plaintext', { p_kind: 'email_smtp' })
    .single();
  if (!error && data) {
    // mark_credential_used em fire-and-forget; fail-open (não bloqueia envio)
    void supabase.rpc('mark_credential_used', { p_credential_id: data.credential_id });
    const meta = data.metadata as Record<string, unknown>;
    return {
      source: 'platform_setting',
      transport: 'smtp',
      host:      String(meta.host),
      port:      Number(meta.port),
      user:      String(meta.user),
      secure:    Boolean(meta.secure),
      fromEmail: String(meta.fromEmail),
      password:  data.plaintext,
      credentialId: data.credential_id,
    };
  }

  // Nível 2: env vars (critério: HOST + USER + PASSWORD presentes; PORT/FROM/SECURE com defaults)
  const host = process.env.BOOTSTRAP_EMAIL_HOST;
  const user = process.env.BOOTSTRAP_EMAIL_USER;
  const pass = process.env.BOOTSTRAP_EMAIL_PASSWORD;
  if (host && user && pass) {
    return {
      source: 'env_var',
      transport: 'smtp',
      host,
      port:      Number(process.env.BOOTSTRAP_EMAIL_PORT  ?? 587),
      user,
      secure:    process.env.BOOTSTRAP_EMAIL_SECURE === 'true',
      fromEmail: process.env.BOOTSTRAP_EMAIL_FROM ?? user,
      password:  pass,
      credentialId: null,
    };
  }

  // Nível 3: offline fallback (caller decide o que fazer)
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value_bool')
    .eq('key', 'signup_link_offline_fallback_enabled')
    .single();
  if (setting?.value_bool === true) return null;

  throw new EmailNotConfiguredError();
});
```

#### File: `src/lib/email/sender.ts`

```typescript
import 'server-only';
import nodemailer from 'nodemailer';
import { createServiceClient } from '@/lib/supabase/server';
import { getEmailCredential, EmailNotConfiguredError } from './getCredential';

export type EmailDeliveryResult =
  | { status: 'sent';              deliveryLogId: string }
  | { status: 'fallback_offline';  deliveryLogId: string; offlineLink: string }
  | { status: 'error';             deliveryLogId: string; errorMessage: string };

export interface SendEmailPayload {
  kind: 'invitation' | 'password_reset' | 'admin_notification';
  to: string;
  subject: string;
  html: string;
  text?: string;
  related?: { type: 'invitation' | 'platform_admin_invitation' | 'password_reset'; id: string };
  /**
   * Caller-provided link para fallback offline. ⛔ Sender NÃO gera signed URLs —
   * caller (ex: Sprint 11 invitations) já possui token e monta o link.
   */
  offlineLink?: string;
  sentBy?: string | null;
}

export async function sendEmail(payload: SendEmailPayload): Promise<EmailDeliveryResult> {
  const supabase = createServiceClient();
  let credential: Awaited<ReturnType<typeof getEmailCredential>> | null;
  try {
    credential = await getEmailCredential();
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      // Não há fonte e fallback offline desativado → caller recebe error
      const { data } = await supabase.rpc('log_email_delivery', {
        p_recipient:  payload.to,
        p_subject:    payload.subject,
        p_kind:       payload.kind,
        p_source:     'env_var', // melhor enum disponível para "tentei tudo"; ver edge case
        p_status:     'error',
        p_offline_link: null,
        p_error_message: 'email_not_configured',
        p_related_entity_type: payload.related?.type ?? null,
        p_related_entity_id:   payload.related?.id   ?? null,
        p_sent_by:    payload.sentBy ?? null,
      }).single();
      return { status: 'error', deliveryLogId: String(data?.id ?? ''), errorMessage: 'email_not_configured' };
    }
    throw err;
  }

  // Fallback offline (caller passou link OBRIGATORIAMENTE; spec valida)
  if (credential === null) {
    if (!payload.offlineLink) {
      throw new Error('sender_misuse: offlineLink ausente quando fallback offline está ativo');
    }
    const { data } = await supabase.rpc('log_email_delivery', {
      p_recipient:  payload.to,
      p_subject:    payload.subject,
      p_kind:       payload.kind,
      p_source:     'offline_fallback',
      p_status:     'fallback_offline',
      p_offline_link: payload.offlineLink,
      p_error_message: null,
      p_related_entity_type: payload.related?.type ?? null,
      p_related_entity_id:   payload.related?.id   ?? null,
      p_sent_by:    payload.sentBy ?? null,
    }).single();
    return { status: 'fallback_offline', deliveryLogId: String(data?.id ?? ''), offlineLink: payload.offlineLink };
  }

  // Envio via SMTP
  try {
    const transporter = nodemailer.createTransport({
      host: credential.host, port: credential.port, secure: credential.secure,
      auth: { user: credential.user, pass: credential.password },
    });
    await transporter.sendMail({
      from: credential.fromEmail, to: payload.to,
      subject: payload.subject, html: payload.html, text: payload.text,
    });
    const { data } = await supabase.rpc('log_email_delivery', {
      p_recipient:  payload.to,
      p_subject:    payload.subject,
      p_kind:       payload.kind,
      p_source:     credential.source,
      p_status:     'sent',
      p_offline_link: null,
      p_error_message: null,
      p_related_entity_type: payload.related?.type ?? null,
      p_related_entity_id:   payload.related?.id   ?? null,
      p_sent_by:    payload.sentBy ?? null,
    }).single();
    return { status: 'sent', deliveryLogId: String(data?.id ?? '') };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000);
    console.error('[email:sender]', err);
    const { data } = await supabase.rpc('log_email_delivery', {
      p_recipient:  payload.to,
      p_subject:    payload.subject,
      p_kind:       payload.kind,
      p_source:     credential.source,
      p_status:     'error',
      p_offline_link: null,
      p_error_message: errorMessage,
      p_related_entity_type: payload.related?.type ?? null,
      p_related_entity_id:   payload.related?.id   ?? null,
      p_sent_by:    payload.sentBy ?? null,
    }).single();
    return { status: 'error', deliveryLogId: String(data?.id ?? ''), errorMessage };
  }
}
```

#### File: `src/lib/email/getEmailSourceStatus.ts`

```typescript
import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export interface EmailSourceStatus {
  platformSetting: boolean;
  envVar:          boolean;
  offlineFallback: boolean;
}

export const getEmailSourceStatus = cache(async (): Promise<EmailSourceStatus> => {
  const supabase = await createClient();
  const [{ count }, settingResp] = await Promise.all([
    supabase.from('platform_integration_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'email_smtp')
      .is('revoked_at', null),
    supabase.from('platform_settings')
      .select('value_bool')
      .eq('key', 'signup_link_offline_fallback_enabled')
      .single(),
  ]);
  return {
    platformSetting: (count ?? 0) > 0,
    envVar:          Boolean(process.env.BOOTSTRAP_EMAIL_HOST
                             && process.env.BOOTSTRAP_EMAIL_USER
                             && process.env.BOOTSTRAP_EMAIL_PASSWORD),
    offlineFallback: settingResp.data?.value_bool === true,
  };
});
```

⛔ **Server-only enforcement:** todos os arquivos em `src/lib/email/*` começam com `import 'server-only'` (Next.js falha o build se importado por Client Component).

---

## 4. External API Integration

### Supabase Vault

**Purpose:** cifragem em repouso de credenciais sensíveis com chave gerenciada pelo Supabase.

**Authentication:** N/A (interno ao banco; acesso controlado por privilégios de schema).

**Endpoints Used (RPCs):**
- `vault.create_secret(secret text, name text, description text DEFAULT NULL) → uuid` — chamada por `admin_create_integration_credential`.
- `vault.update_secret(id uuid, new_secret text, new_name text, new_description text)` — chamada por `admin_rotate_integration_credential` (rotação in-place).
- `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1` — chamada por `get_integration_credential_plaintext` apenas.
- `DELETE FROM vault.secrets WHERE id = $1` — chamada por `admin_revoke_integration_credential` (best-effort; falha não aborta a transação).

**Implementation Location:** dentro das RPCs `SECURITY DEFINER` em `supabase/migrations/<ts>_credentials_email_bootstrap.sql`. Não há cliente Vault no app TypeScript.

**Environment Variables:** N/A — Vault usa chave gerenciada pelo Supabase, não exige config.

### Nodemailer SMTP

**Purpose:** transport de email genérico — qualquer provider SMTP (Brevo, SendGrid, AWS SES via SMTP, mailgun) funciona.

**Authentication:** SMTP basic auth (`user`/`password`).

**Endpoints Used:** `nodemailer.createTransport({host, port, secure, auth})` + `transporter.sendMail({...})`.

**Implementation Location:** `src/lib/email/sender.ts` apenas. Importação proibida em qualquer outro arquivo (Guardian grep guard).

**Environment Variables (fallback nível 2):**
```
BOOTSTRAP_EMAIL_HOST=        # ex: smtp.brevo.com
BOOTSTRAP_EMAIL_PORT=        # default 587
BOOTSTRAP_EMAIL_USER=
BOOTSTRAP_EMAIL_PASSWORD=
BOOTSTRAP_EMAIL_FROM=        # default = USER
BOOTSTRAP_EMAIL_SECURE=      # 'true' | 'false', default false
```

Documentadas em `.env.example` com instrução: "Preencher apenas se Vault não disponível em incidente; uso normal é configurar via UI `/admin/settings/integrations/email`."

**Dep nova:** `nodemailer` + `@types/nodemailer`. Bundle impact é server-only — não afeta browser bundle.

---

## 5. Componentes de UI

Todos os componentes seguem o contrato em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md): wrappers finos sobre Radix Primitives, tokens semânticos, variantes via `cva`, ícones Lucide. **Não redeclarar regras** — Guardian rejeita PR que falhe em `agents/quality/guardian.md` § 1a/1b.

### Component Tree

```
Page: /admin/settings/integrations/email
├── EmailIntegrationPage (Server Component)
│   ├── IntegrationCredentialStatusCard (Server Component)
│   │   ├── Card / CardHeader / CardTitle / CardContent (DS)
│   │   └── Badge (DS, variants: success / warning / neutral)
│   ├── IntegrationCredentialForm (Client Component)
│   │   ├── Input (DS) × {label, host, port, user, fromEmail, password}
│   │   ├── Switch (DS, secure)
│   │   ├── Label (DS)
│   │   └── Button (DS, variant primary)
│   └── RevokeCredentialDialog (Client Component, owner-only)
│       ├── Dialog / DialogContent / DialogHeader / DialogTitle (DS, Radix-based)
│       ├── Input (DS, type=text, placeholder='email_smtp')
│       └── Button (DS, variant danger)

Shell: src/components/admin/AdminShell (modified)
└── EmailSourceBanner (Server Component) — renderizado acima do header
    └── Alert (DS) ou banner ad-hoc com tokens feedback-warning-* / feedback-danger-*
```

### EmailIntegrationPage
**File:** `src/app/admin/settings/integrations/email/page.tsx`

**Server Component.** Chama `listIntegrationCredentialsAction()` filtrando `kind='email_smtp'` + `getEmailSourceStatus()`. Passa o resultado para os filhos.

**Design system components used:**
- `Card`, `CardHeader`, `CardTitle`, `CardContent` from `src/components/ui/card`.

**Semantic tokens used:**
- Background da página: `bg-surface-base`.
- Heading: `text-text-primary`.
- Sub-heading: `text-text-secondary`.

**Behavior:**
- Loading skeleton no `<Suspense>` (padrão Sprint 09).
- Erro: mostra `<Alert variant="danger">` com mensagem retornada por `error`.

### IntegrationCredentialStatusCard
**File:** `src/components/admin/settings/integrations/IntegrationCredentialStatusCard.tsx`

**Server Component.** Recebe `credentials: IntegrationCredentialView[]` e `status: EmailSourceStatus`.

**Props:**
```typescript
interface Props {
  credentials: IntegrationCredentialView[]; // filtrado kind='email_smtp', revoked_at NULL
  status:      EmailSourceStatus;
}
```

**Design system components used:**
- `Card`, `CardHeader`, `CardTitle`, `CardContent` from `src/components/ui/card`.
- `Badge` from `src/components/ui/badge` (variant `success` | `warning` | `neutral`).

**Semantic tokens used:**
- Background: `bg-surface-raised` (card).
- Text: `text-text-primary` (título), `text-text-secondary` (descrição "última utilização há X").
- Border: `border-default` (do Card).
- Badge "Configurado": `bg-feedback-success-subtle text-feedback-success-strong`.
- Badge "Usando env vars": `bg-feedback-warning-subtle text-feedback-warning-strong`.
- Badge "Não configurado": `bg-surface-muted text-text-secondary`.

**State:** sem estado interno (Server Component).

**Behavior:** renderiza badge + linha "última utilização há Xmin" / "rotacionada há X dias" / "nunca usada" / "—". Cálculo de tempo relativo via helper existente (`formatDistanceToNow` do `date-fns` — já dep do projeto).

### IntegrationCredentialForm
**File:** `src/components/admin/settings/integrations/IntegrationCredentialForm.tsx`

**Client Component** — `'use client'`. Usa `react-hook-form` + `zodResolver(CreateIntegrationCredentialSchema)` ou `RotateIntegrationCredentialSchema` conforme presença de credencial existente.

**Props:**
```typescript
interface Props {
  existing: IntegrationCredentialView | null; // se !== null, modo "rotacionar"
  canMutate: boolean; // owner-only; se false, form não renderiza submit
}
```

**Design system components used:**
- `Input` from `src/components/ui/input` (text, number, email, password).
- `Switch` from `src/components/ui/switch` (boolean `secure`).
- `Label` from `src/components/ui/label`.
- `Button` from `src/components/ui/button` (variant `primary`, label "Configurar" ou "Rotacionar").

**Semantic tokens used:**
- Background do form container: `bg-surface-raised`.
- Inputs: tokens padrão `field-bg`, `field-border`, `field-text`, `field-placeholder` (já encapsulados no `<Input>`).
- Mensagens de erro: `text-feedback-danger-strong`.
- Texto auxiliar (helper): `text-text-secondary`.

**State:**
- `formState` (react-hook-form): valores, erros, isSubmitting.
- Toast feedback via `useToast()` (Sonner — padrão Sprint 09).

**Behavior:**
- Password input é `<input type="password">` SEMPRE. Se `existing !== null`, placeholder mostra `••••${existing.hint?.slice(-4) ?? ''}` e campo começa vazio (server **nunca retorna** plaintext, então a UI literalmente não tem acesso). Submeter sem tipar password é validation error em modo "rotacionar".
- On submit (criar): chama `createIntegrationCredentialAction`. Sucesso → toast "Credencial configurada"; erro → toast com `error`.
- On submit (rotacionar): chama `rotateIntegrationCredentialAction`. Mesma estrutura.
- `aria-invalid` nos campos com erro de validação.
- Após sucesso, `router.refresh()` (Next 15) para re-fetch do Server Component pai.

### RevokeCredentialDialog
**File:** `src/components/admin/settings/integrations/RevokeCredentialDialog.tsx`

**Client Component.** Owner-only — não renderiza para support/billing.

**Props:**
```typescript
interface Props {
  credential: IntegrationCredentialView; // não-null garantido pelo pai
}
```

**Design system components used:**
- `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` from `src/components/ui/dialog` (Radix-based; foco trap automático).
- `Input` from `src/components/ui/input` (placeholder=`email_smtp`).
- `Label` from `src/components/ui/label`.
- `Button` from `src/components/ui/button` (variant `danger` para confirmar; `secondary` para cancelar).

**Semantic tokens used:**
- Dialog overlay: `bg-overlay-backdrop` (já no Dialog primitivo).
- DialogContent bg: `bg-surface-raised`.
- Heading: `text-text-primary`. Description: `text-text-secondary`.
- Botão danger: tokens `bg-action-danger`, `text-action-danger-fg`, `hover:bg-action-danger-hover` (encapsulado pela variant `danger` do `<Button>`).

**State:**
- `confirmText` (string) — comparada client-side com `credential.kind` para habilitar o botão.
- `isPending` durante submit.

**Behavior:**
- Botão Confirmar fica `disabled` enquanto `confirmText !== credential.kind`.
- On submit: chama `revokeIntegrationCredentialAction({ id, confirmKind: confirmText })`. Server re-valida; em mismatch retorna `confirm_kind_mismatch`.
- Sucesso → toast "Credencial revogada" + dialog fecha + `router.refresh()`.

⛔ **AGENT-DRIFT 2026-04-21 prevention:** **NÃO** usar `<button className="...bg-action-danger...">` inline. Sempre `<Button variant="danger">` ou `<Button variant="secondary">` do DS.

### EmailSourceBanner
**File:** `src/components/admin/EmailSourceBanner.tsx`

**Server Component.** Renderizado dentro de `AdminShell` (modificação do shell — acima do header), em todas as rotas `/admin/*`.

**Props:** nenhuma (lê `getEmailSourceStatus()` direto).

**Design system components used:**
- `Alert` from `src/components/ui/alert` (variants: `warning`, `danger`).
- `Link` (Next.js) com classes via `cva` ou através de `<Button asChild variant="link">`.

**Semantic tokens used:**
- Banner amarelo (warning): `bg-feedback-warning-subtle`, `text-feedback-warning-strong`, `border-feedback-warning-border`.
- Banner vermelho (danger): `bg-feedback-danger-subtle`, `text-feedback-danger-strong`, `border-feedback-danger-border`.
- Link interno: `text-action-primary` ou `<Button asChild variant="link">`.

**Behavior:**
- Lê `getEmailSourceStatus()`. Decisão:
  - Se `platformSetting || envVar`: retorna `null` (não renderiza).
  - Se `!platformSetting && !envVar && offlineFallback`: banner amarelo "Email não configurado — convites e resets gerarão link copiável. [Configurar agora]".
  - Se `!platformSetting && !envVar && !offlineFallback`: banner vermelho "Email não configurado e fallback offline desativado — convites e resets vão falhar. [Configurar agora]".
- Acessibilidade: `role="alert"` no banner danger; `role="status"` no banner warning.
- `[Configurar agora]` aponta para `/admin/settings/integrations/email`.

### AdminSidebar (modified — `src/components/admin/AdminSidebar.tsx`)

**Mudança mínima:** dentro do grupo "Configurações" existente (Sprint 09), adicionar item "Integrações > Email" com rota `/admin/settings/integrations/email`. Estrutura: subitem nested — não criar grupo separado para evitar inflação de menu.

Visibilidade: support/billing veem o item (read-only); owner vê + opera.

---

## 6. Edge Cases (CRITICAL)

### Cifragem & Vault
- [ ] **Plaintext nunca em response JSON:** validado por (a) Zod response type que omite `secretPlaintext`, (b) teste integrado com `JSON.stringify(response)` + assert que não contém o plaintext, (c) Guardian grep em `actions/admin/integration-credentials*.ts`.
- [ ] **Plaintext nunca em audit:** Guardian grep verifica que `audit_write` nas RPCs não recebe `p_secret_plaintext`. SQL spot-check após teste: `SELECT NOT (diff_after::text LIKE '%${plaintext}%') FROM audit_log WHERE target_type='platform_integration_credential'` retorna `t`.
- [ ] **Hint não permite reconstrução:** `hint='****abc1'` para plaintext de 16 chars expõe ≤25%. Senha curta (<8) é rejeitada por Zod (`secretPlaintext.min(1).max(500)` — porém recomendação: documentar que password deve ter ≥8 chars; CHECK fica só no formato `****` + 4 chars).
- [ ] **Vault inacessível durante leitura:** RPC `get_integration_credential_plaintext` lança erro genérico (ex.: `vault.decrypted_secrets` view não responde). Sender cai automaticamente para env vars; `email_delivery_log` marca `source='env_var'`. Não bloqueia o envio.
- [ ] **Secret deletado fora-de-banda no Vault** (ex.: dashboard manual): `get_integration_credential_plaintext` lança `vault_secret_missing`. Sender cai para env vars. UI lista a credencial como inconsistente (badge warning).
- [ ] **Tentativa de chamar `get_integration_credential_plaintext` via JWT regular:** rejeitada com `42501` (insufficient_privilege). Teste integrado simula JWT customer e espera o erro.
- [ ] **Tentativa de SELECT direto em `vault.decrypted_secrets` via JWT customer:** rejeitada por REVOKE default do Supabase. Teste documenta.

### Fallback chain
- [ ] **Primeiro acesso, todas as fontes vazias, fallback ativo:** banner amarelo aparece; chamar `sendEmail` com `offlineLink` retorna `{status:'fallback_offline'}` e grava log com `source='offline_fallback'`.
- [ ] **Primeiro acesso, fallback desativado:** banner vermelho; sender lança `EmailNotConfiguredError`; caller (Sprint 11) recebe error e mostra "configure email primeiro".
- [ ] **Env vars parciais** (HOST sem PASSWORD): critério é "HOST + USER + PASSWORD presentes" — qualquer um faltando → cai para nível 3.
- [ ] **Caller não passa `offlineLink` quando fallback está ativo:** sender lança `Error('sender_misuse')`. Sprint 11 deve passar sempre. Documentado no contrato.
- [ ] **Mudança de fonte entre requests:** request A lê via DB (cache hit por request), credencial revogada em outro request, request B lê via env_var. Cache de `getEmailCredential` é por-request (React `cache()`); não há staleness cross-request.

### Concorrência
- [ ] **Rotação concorrente:** 2 owners clicam "Rotacionar" simultaneamente. RPC usa `SELECT ... FOR UPDATE` na linha; segunda rotação espera; ambas concluem em série (Vault `update_secret` é idempotente para o mesmo `id`). Sem erro tipado — última escrita vence (documentado).
- [ ] **Revogação durante envio em flight:** sender já leu credencial e está em `transporter.sendMail`. Admin revoga (UPDATE `revoked_at` + DELETE em `vault.secrets`). Envio em curso completa porque já tem o plaintext em memória; `mark_credential_used` em fire-and-forget tenta UPDATE — RPC permite UPDATE em soft-revoked (apenas `last_used_at`).
- [ ] **Duplicate active:** criar 2× `email_smtp` sem revogar a primeira → UNIQUE parcial força segunda a falhar com `credential_kind_already_active`.

### UI / Auditoria
- [ ] **Confirm mismatch na revogação:** server-side compara `confirmKind` com `kind` real do registro; mismatch retorna `'confirm_kind_mismatch'`.
- [ ] **Banner global causa flash em transições de rota:** aceito; status é cacheado por request (1 query DB por navegação). Listado como follow-up se virar gargalo medido.
- [ ] **`related_entity_id` aponta para invitation revogada:** `email_delivery_log` aceita id mesmo assim (sem FK física). Sprint 11 lida ao consultar logs.
- [ ] **Logs de retry de transport:** caller que recebe `status='error'` decide reenviar; cada tentativa = 1 row em `email_delivery_log`. Audit não infla — `audit_write` só dispara para `offline_fallback`.

### Browser / Ambiente
- [ ] **Mobile viewport (≤375px):** form `IntegrationCredentialForm` empilha campos em coluna única, botões full-width, sem overflow horizontal. Banner global não cobre conteúdo (mantém ordem `<EmailSourceBanner /><Header /><main>`). Verificado manualmente em GATE 5 Passo 2.
- [ ] **Tema dark via `data-theme="dark"`:** banner warning/danger e botão variant=`danger` mantêm contraste WCAG AA. Tokens semânticos (`feedback-warning-strong`, `action-danger-fg`) já calibrados pelo design system; verificação manual no GATE 5.
- [ ] **JS desabilitado / Server Component sem hidratação:** rotas admin assumem JS habilitado (Next.js App Router padrão). Banner é Server Component — renderiza mesmo sem JS. Form e Dialog requerem JS — comportamento padrão do projeto, sem fallback no-JS.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration `<ts>_credentials_email_bootstrap.sql` roda sem erros (GATE 1: `supabase db push --dry-run` retorna `Success`).
- [ ] Migration idempotente — todos os `CREATE TABLE`/`CREATE INDEX`/`CREATE POLICY`/`CREATE OR REPLACE FUNCTION` usam `IF NOT EXISTS` ou são idempotentes por natureza.
- [ ] **FORCE RLS** ativa em ambas as tabelas:
  ```sql
  SELECT relname, relforcerowsecurity FROM pg_class
   WHERE relname IN ('platform_integration_credentials','email_delivery_log');
  -- ambos: t
  ```
- [ ] **UNIQUE parcial** ativa: tentar criar 2× `email_smtp` sem revogar a primeira falha com `credential_kind_already_active`.
- [ ] **Privilégios das RPCs** validados (8 SQLs em §3 do PRD).
- [ ] **G-14 SQL spot-check:** após criar credencial com `secretPlaintext='supersecretXYZW'`, `SELECT diff_after::text NOT LIKE '%supersecret%' FROM audit_log WHERE target_type='platform_integration_credential'` retorna `t` em todas as rows.
- [ ] **Vault store cifrado:** `SELECT secret FROM vault.secrets WHERE id=<credential.vault_secret_id>` retorna `bytea` cifrado (não plaintext); apenas `vault.decrypted_secrets` retorna plaintext.
- [ ] **PROJECT_CONTEXT §2** atualizado registrando as 2 novas tabelas como exceções compensadas.

### Backend
- [ ] Todas as Server Actions validam input com Zod e retornam `ActionResponse<T>`.
- [ ] Todas as Server Actions chamam `requirePlatformAdmin()` ou `requirePlatformAdminRole(['owner'])` antes de qualquer write.
- [ ] `revalidatePath('/admin/settings/integrations/email')` + `revalidatePath('/admin')` após cada mutation (banner global precisa atualizar).
- [ ] Erros de RPC são mapeados via `RPC_ERRORS` (lista em §3).
- [ ] **G-14 grep:** `grep -nE "(secretPlaintext|vaultSecretId|vault_secret_id)" src/lib/actions/admin/integration-credentials*.ts | grep -v "input\|parsed.data"` retorna 0 ocorrências fora de input/parsing.
- [ ] `nodemailer` importado **apenas** em `src/lib/email/sender.ts`. Grep: `grep -rn "from 'nodemailer'" src/` retorna apenas esse arquivo.
- [ ] Helpers `src/lib/email/*` começam com `import 'server-only'`.
- [ ] `getEmailCredential()` cacheada por React `cache()` — chamadas repetidas no mesmo request fazem 1 RPC só.

### Frontend
- [ ] O código passa em **todas as checagens do `agents/quality/guardian.md`** § 1a e § 1b. Fonte normativa: `design_system/enforcement/rules.md` + `design_system/components/CONTRACT.md`. Guardian rejeita PR se qualquer regra falhar.
- [ ] Componente verificado com `data-theme="dark"` togglado.
- [ ] Form tem estado de loading, erro, e feedback de sucesso (toast).
- [ ] Banner global aparece quando ambas DB e env vars vazias; desaparece após cadastro sem reload.
- [ ] **AGENT-DRIFT 2026-04-21 prevention:** Guardian grep `grep -rn "<button" src/components/admin/settings/integrations/ src/components/admin/EmailSourceBanner.tsx` retorna 0 (uso só de `<Button>` do DS).
- [ ] RBAC visual: support/billing veem listagem; botões "Configurar"/"Rotacionar"/"Revogar" só renderizam para owner.

### Integration tests (GATE 4.5)
- [ ] `tests/integration/admin-integration-credentials.test.ts` — mín. 12 testes, 0 falhas, 0 skips.
- [ ] `tests/integration/email-sender.test.ts` — mín. 10 testes, 0 falhas, 0 skips.
- [ ] `tests/integration/email-source-status.test.ts` — mín. 6 testes, 0 falhas, 0 skips.
- [ ] G-14 explícito: testes fazem `JSON.stringify(actionResponse)` e assertam que não contém o plaintext literal usado no input.

### Build & Lint
- [ ] `npm run build` passa sem erros (GATE 2).
- [ ] `npm run lint` passa sem novos warnings (GATE 2).
- [ ] `node scripts/verify-design.mjs --changed` retorna 0 violações (GATE 5 estático).

### Documentação
- [ ] `docs/PROJECT_CONTEXT.md` §2 acrescenta `platform_integration_credentials` e `email_delivery_log` com proteção compensatória.
- [ ] `docs/PROJECT_CONTEXT.md` §5d (nova subseção) registra: 2 tabelas, 7 RPCs, decisão Vault vs pgsodium, contrato `EmailDeliveryResult`, snippet canônico de SMTP transport.
- [ ] `.env.example` ganha as 6 vars `BOOTSTRAP_EMAIL_*` documentadas.
- [ ] `package.json` ganha `nodemailer` + `@types/nodemailer`.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)
1. Criar `supabase/migrations/<ts>_credentials_email_bootstrap.sql`.
2. Definir as 2 tabelas com FORCE RLS, indexes, UNIQUE parcial, CHECK constraints (incluindo CHECK composto em `email_delivery_log` para `(source, status)` válidos).
3. Criar policies SELECT (sem mutação direta).
4. Criar 7 RPCs com `SECURITY DEFINER`, `SET search_path TO 'public'`, RAISE EXCEPTION com `ERRCODE='P0001'` + HINT, audit_write transacional.
5. REVOKE EXECUTE de `public, anon, authenticated` em todas; GRANT EXECUTE TO `service_role`.
6. Header documenta: 2 tabelas, 7 RPCs, decisão Vault, ponto crítico `get_integration_credential_plaintext` service-role-only, lista de privilégios.
7. GATE 1: `supabase db push --dry-run`.

**Estimated Time:** 25 minutos

### Phase 2: Backend (`@backend`)
1. `src/lib/email/getCredential.ts` — fallback chain + `cache()` + `EmailNotConfiguredError`.
2. `src/lib/email/sender.ts` — switch sobre credential, transport SMTP, log via RPC.
3. `src/lib/email/getEmailSourceStatus.ts` — paralelo DB + env + setting.
4. `src/lib/actions/admin/integration-credentials.schemas.ts` — Zod + types omitindo plaintext.
5. `src/lib/actions/admin/integration-credentials.ts` — 4 Server Actions com `RPC_ERRORS` map.
6. Atualizar `.env.example` com `BOOTSTRAP_EMAIL_*`.
7. Adicionar `nodemailer` + `@types/nodemailer` ao `package.json`; `npm install`.
8. GATE 2: `npm run build` + `npm run lint`.

**Estimated Time:** 35 minutos

### Phase 3: QA Integration (`@qa-integration`)
1. `tests/integration/admin-integration-credentials.test.ts` — 12 testes (happy + RBAC + Zod + G-14 explícito + duplicate + rotation concurrency + revoke confirm).
2. `tests/integration/email-sender.test.ts` — 10 testes (3 fontes × happy/error + G-14 + cache).
3. `tests/integration/email-source-status.test.ts` — 6 testes (cobre todas as combinações de fontes).
4. Mock de `nodemailer.createTransport` via `vi.mock('nodemailer')`.
5. Mock de `vault.create_secret`/`update_secret`/`decrypted_secrets` via `__mockSupabase` rpc/from chains.
6. GATE 4.5: `npm test -- --run tests/integration/`.

**Estimated Time:** 40 minutos

### Phase 4: Frontend (`@frontend+`)
1. `src/app/admin/settings/integrations/email/page.tsx` — Server Component com Suspense.
2. Componentes em `src/components/admin/settings/integrations/`:
   - `IntegrationCredentialStatusCard.tsx`
   - `IntegrationCredentialForm.tsx`
   - `RevokeCredentialDialog.tsx`
3. `src/components/admin/EmailSourceBanner.tsx` — Server Component.
4. Modificar `src/components/admin/AdminShell.tsx` para incluir `<EmailSourceBanner />` acima do header.
5. Modificar `src/components/admin/AdminSidebar.tsx` para subitem "Integrações > Email" no grupo Configurações.
6. Toggle `data-theme="dark"` para verificação manual.
7. GATE 2: build + lint. GATE 5 estático: `verify-design.mjs --changed`.

**Estimated Time:** 35 minutos

### Phase 5: Review (`@guardian` via SDK)
1. Validar design system compliance (8 regras).
2. Validar G-14 grep guards (lista em §7).
3. Validar import isolation (`nodemailer` apenas em `sender.ts`; `email/*` server-only).
4. Validar audit payloads (sem plaintext nem `vault_secret_id`).
5. Reportar via handoff `<sprint>/guardian_result.md`.

**Estimated Time:** 10 minutos

### Phase 6: Encerramento (Tech Lead)
1. APRENDIZADOS se algo surpreendente; AGENT-DRIFT se ≥2 retries no mesmo agente.
2. Atualizar `PROJECT_CONTEXT.md` §2 e §5d.
3. Mover sprint file para `done/`.
4. Limpar `sprints/handoffs/<sprint>/`.
5. `git add` + commit + push.

**Estimated Time:** 10 minutos

**Total Estimated Time:** ~155 minutos (~2h35m)

---

## 9. Risks & Mitigations

### Risk 1: Plaintext leak via response JSON ou audit
**Impact:** High (G-14 — incidente de segurança classe P0)
**Probability:** Medium (plaintext atravessa server action e RPC)
**Mitigation:**
- Schema Zod do response **omite** `secretPlaintext`/`vaultSecretId`; tipo TS `IntegrationCredentialView` não tem esses campos.
- Guardian grep guard em `actions/admin/integration-credentials*.ts`.
- Teste integrado faz `JSON.stringify(response)` e assert ausência do plaintext literal.
- Audit payloads usam `metadata={kind, label, hint}` — Guardian valida via grep que `audit_write` nas RPCs não recebe `p_secret_plaintext` como parâmetro.
- Header da migration documenta o invariante.

### Risk 2: Privilege escalation via `get_integration_credential_plaintext`
**Impact:** High (decifragem direta de credencial por JWT regular)
**Probability:** Low (REVOKE default + GRANT explícito a `service_role`)
**Mitigation:**
- `REVOKE EXECUTE FROM public, anon, authenticated` (cada um nominalmente — APRENDIZADO 2026-04-24).
- `GRANT EXECUTE TO service_role` apenas.
- Teste integrado simula JWT customer e espera `42501`.
- Guardian grep verifica que `get_integration_credential_plaintext` é chamada apenas por `src/lib/email/getCredential.ts`.

### Risk 3: Vault inacessível bloqueia envios admin
**Impact:** High (convite admin do Sprint 11 falha)
**Probability:** Low (Vault é parte do core Supabase)
**Mitigation:** fallback chain — sender cai automaticamente para env vars; depois para offline. Operador pode setar `BOOTSTRAP_EMAIL_*` em Vercel env vars sem mexer no banco.

### Risk 4: Drift do `@frontend+` em botões inline (AGENT-DRIFT histórico)
**Impact:** Medium (Guardian rejeita PR; retrabalho)
**Probability:** Medium (2 ocorrências históricas: Sprint 10, Sprint 15)
**Mitigation:** PRD lista explicitamente que `RevokeCredentialDialog` deve usar `<Button variant="danger">` e nada inline. Guardian grep `grep -rn "<button" src/components/admin/settings/integrations/` retorna 0.

### Risk 5: Bundle bloat por `nodemailer` no client
**Impact:** Medium (perf hit no first load)
**Probability:** Low (server-only enforcement)
**Mitigation:** `import 'server-only'` em `sender.ts`; Guardian valida que nenhum Client Component importa `src/lib/email/*`. Build do Next.js já avisa se importação leak para client bundle.

### Risk 6: Race entre rotação e envio em flight
**Impact:** Low (envio único pode falhar; caller faz retry)
**Probability:** Low (cenário raro — rotação manual)
**Mitigation:** documentado em edge cases. RPC permite UPDATE de `last_used_at` em soft-revoked; envio em flight conclui com plaintext em memória.

---

## 10. Dependencies

### Internal (já completas)
- ✅ `audit_write` RPC + `audit_log` table (Sprint 03).
- ✅ `requirePlatformAdmin` / `requirePlatformAdminRole(['owner'])` (Sprint 02).
- ✅ `is_platform_admin(uuid)` SQL helper (Sprint 02).
- ✅ `signup_link_offline_fallback_enabled` setting seedado em `platform_settings` (Sprint 09).
- ✅ AdminShell + AdminSidebar (Sprint 04, modificado em 09).
- ✅ Design system: `Button`, `Input`, `Label`, `Switch`, `Dialog`, `Card`, `Badge`, `Alert`.

### External
- 🆕 Dep nova: `nodemailer` + `@types/nodemailer` — adicionar via `npm install`.
- ✅ Supabase Vault: extension `supabase_vault` v0.3.1 já habilitada.

### Downstream (consumidores futuros — NÃO escopo desta sprint)
- Sprint 11: `platform_admin_invitations` consome `sendEmail({kind:'invitation', ..., offlineLink})`.
- Fase 2 customer: emails transacionais (reset, notificações) consomem `sendEmail` quando templates estiverem prontos.

---

## 11. Rollback Plan

Caso problemas sejam encontrados após deploy:

1. **Imediato:** revert do commit do sprint via Tech Lead (`git revert <hash>`). Remove código TypeScript e marca sprint como pendente.
2. **Database (se migration já aplicada em prod):**
   - As 2 tabelas novas podem ser dropadas com `DROP TABLE ... CASCADE` (não há FKs apontando pra elas; o `email_delivery_log.related_entity_id` é FK lógica sem constraint).
   - As 7 RPCs podem ser dropadas com `DROP FUNCTION IF EXISTS public.<rpc>(<sig>)`.
   - `vault.secrets` cifradas criadas durante teste podem ser limpas com `DELETE FROM vault.secrets WHERE description LIKE 'email_smtp:%'` (se a convenção de naming foi seguida).
3. **Cache:** `revalidatePath('/admin')` força re-fetch (não há cache externo CDN).
4. **Monitoring:** `SELECT * FROM email_delivery_log WHERE status='error' ORDER BY sent_at DESC LIMIT 50` para diagnose.

**Rollback Command (compactado):**
```bash
git revert <commit-hash>
# se migration já em prod:
psql $DATABASE_URL <<SQL
DROP FUNCTION IF EXISTS public.admin_create_integration_credential(text,text,jsonb,text);
DROP FUNCTION IF EXISTS public.admin_rotate_integration_credential(uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.admin_revoke_integration_credential(uuid);
DROP FUNCTION IF EXISTS public.admin_list_integration_credentials();
DROP FUNCTION IF EXISTS public.get_integration_credential_plaintext(text);
DROP FUNCTION IF EXISTS public.mark_credential_used(uuid);
DROP FUNCTION IF EXISTS public.log_email_delivery(text,text,text,text,text,text,text,text,uuid,uuid);
DROP TABLE IF EXISTS public.email_delivery_log;
DROP TABLE IF EXISTS public.platform_integration_credentials;
SQL
```

**Sprint 11 dependency:** se rollback acontece após Sprint 11 já estar consumindo `sendEmail`, pausar Sprint 11 e usar `supabase.auth.admin.inviteUserByEmail` como fallback temporário.

---

## Approval

**Created by:** @spec-writer (persona Tech Lead, modo agent híbrido)
**Reviewed by:** @sanity-checker (pendente)
**Approved by:** Edson (pendente — STOP & WAIT)
**Date:** 2026-04-27
