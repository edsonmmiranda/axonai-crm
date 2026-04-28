# PRD: CRUD Platform Admins + Convite Single-Use + Password Reset com MFA Re-enroll

**Template:** PRD_COMPLETE
**Complexity Score:** 24 (cap em 22 — ≥9 força COMPLETE; +integração API externa, +lógica nova/ambígua, +múltiplas tabelas novas)
**Sprint:** admin_11
**Created:** 2026-04-27
**Status:** Draft (aguardando @sanity-checker)

---

## 1. Overview

### Business Goal
Fechar a malha de gestão de operadores Axon. Hoje há **um** owner seedado manualmente (Edson). Esta sprint entrega o caminho via UI para convidar novos owners/support/billing, mudar papéis, desativar, e tratar reset de senha de admin com a defesa correta (re-enroll obrigatório de MFA). É o último sprint do ciclo admin que toca auth/identidade — Sprint 12 (audit UI + rate limit) depende disso para popular dados realísticos.

### User Stories (consolidadas do sprint file §"User Stories")
- Owner convida novo admin via UI; convite chega como email transacional ou link copiável (fallback offline).
- Owner muda papel/desativa admin existente; trigger Sprint 02 bloqueia desativar último owner.
- Convidado abre link → cria conta → enrolla MFA → entra no admin.
- Admin que perdeu TOTP pede reset a outro owner; reset exige aprovação de **terceiro** owner distinto.
- Admin que completa password reset é forçado a re-enroll de MFA antes de qualquer rota admin.
- Auditor vê tudo no `audit_log` com slugs canônicos.

### Success Metrics (binários, do sprint file §"Métrica de sucesso")
- Owner consegue convidar segundo owner via UI sem SQL manual; sender Sprint 10 é chamado com payload correto.
- G-15: 2 chamadas concorrentes a `consumeInvitationAction` com mesmo token → exatamente 1 vence; outra recebe `'invitation_already_consumed'`.
- G-22: admin pós-reset → `requireAdminSession()` redireciona para `/admin/mfa-enroll?reenroll=true` antes de servir qualquer rota `/admin/*`.
- G-08: tentar desativar/downgrade último owner → `'last_owner_protected'`.
- Step-up duplo: auto-solicitação, auto-aprovação e target-aprovação rejeitadas via CHECK + RPC.
- 11 action slugs novos no `audit_log` (lista em §3.6).

---

## 2. Database Requirements

> **Estado vivo confirmado via MCP** (2026-04-27): `profiles` não tem `mfa_reset_required`; `platform_admins` tem trigger `prevent_last_owner_deactivation` cobrindo BEFORE UPDATE+DELETE; `email_delivery_log.related_entity_type` já aceita `'platform_admin_invitation'` (CHECK do Sprint 10); `audit_write` aceita 9 args; `is_platform_admin(target_profile_id uuid)` SECURITY DEFINER existente; `log_email_delivery` SECURITY DEFINER existente.

### Modified Tables

#### `public.profiles` — adicionar coluna `mfa_reset_required`

```sql
alter table public.profiles
  add column if not exists mfa_reset_required boolean not null default false;
```

- **Lida** pelo `requireAdminSession` (modificação no §3.5).
- **Setada** por `mark_admin_password_reset(p_profile_id)` (service-role) e por `admin_approve_mfa_reset(p_request_id)` (transacionalmente).
- **Resetada** por `complete_admin_mfa_reenroll(p_profile_id)` (sem step-up) ou `consume_admin_mfa_reset(p_request_id, p_target_profile_id)` (com step-up).
- **Sem audit nessa coluna** — eventos de mutação auditados via `password_reset.complete_admin` / `platform_admin.mfa_reset_consume`.

### New Tables

#### `public.platform_admin_invitations` — convite single-use

**Justificativa para sem `organization_id`:** catálogo da plataforma admin (não do tenant). Adicionar à tabela de exceções em [`docs/conventions/standards.md`](../docs/conventions/standards.md) §"Exceções em `public.*`" e em [`docs/PROJECT_CONTEXT.md`](../docs/PROJECT_CONTEXT.md) §2.

**Schema canônico:**

```sql
create table if not exists public.platform_admin_invitations (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null,
  role                     text not null,
  token                    uuid not null unique default gen_random_uuid(),
  expires_at               timestamptz not null,
  consumed_at              timestamptz null,
  consumed_by_profile_id   uuid null references public.profiles(id) on delete restrict,
  revoked_at               timestamptz null,
  revoked_by               uuid null references public.profiles(id) on delete set null,
  email_delivery_log_id    uuid null,                                  -- FK lógica para email_delivery_log.id (Sprint 10)
  created_by               uuid not null references public.profiles(id) on delete restrict,
  created_at               timestamptz not null default now(),

  constraint pai_email_format        check (length(email) between 3 and 320 and email = lower(email)),
  constraint pai_role_enum           check (role in ('owner','support','billing')),
  constraint pai_expires_after_created check (expires_at > created_at),
  constraint pai_consume_coherence   check (
    (consumed_at is null and consumed_by_profile_id is null)
    or (consumed_at is not null and consumed_by_profile_id is not null)
  ),
  constraint pai_revoke_coherence    check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null)
  ),
  constraint pai_terminal_state_xor  check (not (consumed_at is not null and revoked_at is not null))
);

create unique index if not exists pai_one_pending_per_email_idx
  on public.platform_admin_invitations (lower(email))
  where consumed_at is null and revoked_at is null and expires_at > now();

create index if not exists pai_email_idx       on public.platform_admin_invitations (email);
create index if not exists pai_expires_at_idx  on public.platform_admin_invitations (expires_at);
create index if not exists pai_creator_recent  on public.platform_admin_invitations (created_by, created_at desc);

alter table public.platform_admin_invitations enable row level security;
alter table public.platform_admin_invitations force row level security;

create policy "pai_select_platform_admin_active" on public.platform_admin_invitations
  for select using (public.is_platform_admin(auth.uid()) is not null);
-- Sem policies de mutação — writes via RPC SECURITY DEFINER.
```

#### `public.platform_admin_mfa_reset_requests` — step-up duplo

**Justificativa para sem `organization_id`:** mesma da tabela acima — catálogo da plataforma admin.

**Schema canônico:**

```sql
create table if not exists public.platform_admin_mfa_reset_requests (
  id                          uuid primary key default gen_random_uuid(),
  target_platform_admin_id    uuid not null references public.platform_admins(id) on delete restrict,
  target_profile_id           uuid not null references public.profiles(id) on delete restrict,
  requested_by                uuid not null references public.profiles(id) on delete restrict,
  reason                      text not null,
  requested_at                timestamptz not null default now(),
  expires_at                  timestamptz not null,
  approved_by                 uuid null references public.profiles(id) on delete restrict,
  approved_at                 timestamptz null,
  consumed_at                 timestamptz null,
  revoked_at                  timestamptz null,
  revoked_by                  uuid null references public.profiles(id) on delete set null,

  constraint pamr_reason_length          check (length(reason) between 5 and 500),
  constraint pamr_expires_after_request  check (expires_at > requested_at),
  constraint pamr_no_self_request        check (requested_by <> target_profile_id),
  constraint pamr_approver_distinct      check (
    approved_by is null
    or (approved_by <> requested_by and approved_by <> target_profile_id)
  ),
  constraint pamr_approve_coherence      check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null)
  ),
  constraint pamr_consume_after_approve  check (
    consumed_at is null
    or (consumed_at is not null and approved_at is not null)
  ),
  constraint pamr_revoke_coherence       check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null)
  ),
  constraint pamr_terminal_state_xor     check (not (consumed_at is not null and revoked_at is not null))
);

create unique index if not exists pamr_one_pending_per_target_idx
  on public.platform_admin_mfa_reset_requests (target_platform_admin_id)
  where consumed_at is null and revoked_at is null and expires_at > now();

create index if not exists pamr_target_idx     on public.platform_admin_mfa_reset_requests (target_platform_admin_id);
create index if not exists pamr_requester_idx  on public.platform_admin_mfa_reset_requests (requested_by, requested_at desc);
create index if not exists pamr_approver_idx   on public.platform_admin_mfa_reset_requests (approved_by) where approved_at is not null;

alter table public.platform_admin_mfa_reset_requests enable row level security;
alter table public.platform_admin_mfa_reset_requests force row level security;

create policy "pamr_select_platform_admin_active" on public.platform_admin_mfa_reset_requests
  for select using (public.is_platform_admin(auth.uid()) is not null);
-- Sem policies de mutação — writes via RPC SECURITY DEFINER.
```

### Existing Tables Used

| Tabela | Uso |
|---|---|
| `public.profiles` | JOIN para nome/email/avatar; modificada (coluna `mfa_reset_required`) |
| `public.platform_admins` | INSERT no consume; UPDATE em role/deactivate; trigger Sprint 02 enforça last-owner |
| `public.audit_log` | Append via `audit_write` em toda mutation |
| `public.email_delivery_log` | INSERT via `log_email_delivery` (chamado dentro de `sendEmail`); FK lógica `email_delivery_log_id` em invitations |
| `auth.users` | `last_sign_in_at` para coluna "último login"; criação via `auth.admin.createUser` no consume |
| `auth.mfa_factors` | `factor_type='totp'` + `status='verified'` para coluna "MFA Configurado"; `auth.mfa.unenroll` no re-enroll |

---

## 3. API Contract

> **Padrão obrigatório (gold standard Sprint 10):** todo Server Action em `src/lib/actions/admin/*.ts` segue o pattern de [`src/lib/actions/admin/integration-credentials.ts`](../src/lib/actions/admin/integration-credentials.ts):
> - `'use server'` no topo; `import 'server-only'` adicional em helpers de auth (`admin-auth.ts`).
> - `requirePlatformAdmin()` ou `requirePlatformAdminRole(['owner'])` antes de qualquer write.
> - `createServiceClient()` para chamadas RPC com SECURITY DEFINER.
> - `RPC_ERRORS: Record<string,string>` mapeando códigos para mensagens amigáveis em pt-BR.
> - `rpcError(error: unknown)` com narrowing tipado (APRENDIZADO 2026-04-26 — `error instanceof Error` é falso para `PostgrestError`).
> - `getRequestMeta()` para `ip_address`/`user_agent` repassados ao audit.
> - Schema Zod separado em `*.schemas.ts` com `safeParse` e `parsed.error.issues[0]?.message`.
> - Retorno `ActionResponse<T> = { success, data?, error? }`.
> - `revalidatePath('/admin/admins', 'layout')` após mutações.

### 3.1 RPCs (todas SECURITY DEFINER, `set search_path = public`, REVOKE de `public/anon/authenticated` por padrão; GRANT só para `service_role`; APRENDIZADO 2026-04-24)

> Convenção de erro: RPC raise via `raise exception '<code>' using errcode = 'P0001'`; Server Action `rpcError()` mapeia code → mensagem amigável.

| RPC | Quem chama | Validações dentro | Audit slug |
|---|---|---|---|
| `admin_create_platform_admin_invitation(p_email, p_role, p_ip_address, p_user_agent)` | service_role (Server Action chama após `requirePlatformAdminRole(['owner'])`) | RPC re-valida `is_platform_admin(auth.uid()).role='owner'` (`unauthorized`); `p_email` lower + regex; `p_role in (owner,support,billing)`; sem admin ativo com mesmo email (`email_already_active_admin`); UNIQUE parcial enforça pendente único (`invitation_already_pending`); INSERT com `expires_at=now()+'72h'` | `platform_admin.invite_create` |
| `admin_revoke_platform_admin_invitation(p_id, p_ip, p_ua)` | service_role | RPC re-valida owner; UPDATE `revoked_at=now(),revoked_by=auth.uid()` WHERE `id=p_id AND consumed_at IS NULL AND revoked_at IS NULL` RETURNING; 0 rows → `invitation_not_found_or_terminal` | `platform_admin.invite_revoke` |
| `admin_consume_platform_admin_invitation(p_token, p_consumer_profile_id, p_ip, p_ua)` | service_role only (REVOKE de authenticated/anon) | UPDATE atômico `WHERE token=p_token AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING *`; 0 rows → SELECT auxiliar classifica (`invitation_already_consumed` / `invitation_revoked` / `invitation_expired`); INSERT `platform_admins(profile_id=p_consumer_profile_id, role=row.role, is_active=true, created_by=row.created_by)` — trigger `enforce_internal_org` valida org `is_internal=true` (Server Action garante) | `platform_admin.invite_consume` |
| `admin_change_platform_admin_role(p_target_id, p_new_role, p_ip, p_ua)` | service_role | RPC re-valida owner; valida enum; UPDATE `role=p_new_role` (trigger Sprint 02 dispara se downgrade do último owner → `last_owner_protected`); diff `{role_before, role_after}` no audit | `platform_admin.role_change` |
| `admin_deactivate_platform_admin(p_target_id, p_ip, p_ua)` | service_role | RPC re-valida owner; UPDATE `is_active=false, deactivated_at=now()` WHERE row ativa (trigger Sprint 02 dispara → `last_owner_protected`); coerência `platform_admins_active_state_coherence` enforça | `platform_admin.deactivate` |
| `admin_request_mfa_reset(p_target_admin_id, p_reason, p_ip, p_ua)` | service_role | RPC re-valida owner; resolve `target_profile_id` via JOIN; `requested_by=auth.uid()` e `<> target_profile_id` (CHECK + RPC); `length(p_reason) between 5 and 500`; UNIQUE parcial enforça pendente único por target (`mfa_reset_already_pending`); INSERT com `expires_at=now()+'24h'` | `platform_admin.mfa_reset_request` |
| `admin_approve_mfa_reset(p_request_id, p_ip, p_ua)` | service_role | RPC re-valida owner; SELECT FOR UPDATE → `auth.uid() <> requested_by` (`self_approve_forbidden`) e `<> target_profile_id` (`target_approve_forbidden`); pendente não expirada (`mfa_reset_request_expired` / `mfa_reset_already_approved`); UPDATE `approved_by, approved_at`; **mesma transação:** chama `mark_admin_password_reset(target_profile_id)` (set `mfa_reset_required=true`) | `platform_admin.mfa_reset_approve` |
| `admin_revoke_mfa_reset_request(p_request_id, p_ip, p_ua)` | service_role | RPC re-valida owner; UPDATE WHERE pendente → 0 rows = `mfa_reset_request_not_pending` | `platform_admin.mfa_reset_revoke` |
| `consume_admin_mfa_reset(p_request_id, p_target_profile_id, p_ip, p_ua)` | service_role only | SELECT FOR UPDATE; aprovada, não consumida nem revogada nem expirada; `target_profile_id = p_target_profile_id` (`target_mismatch`); UPDATE `consumed_at=now()`; mesma TX: `update profiles set mfa_reset_required=false where id=p_target_profile_id` | `platform_admin.mfa_reset_consume` |
| `mark_admin_password_reset(p_profile_id, p_ip, p_ua)` | service_role only | Se `is_platform_admin(p_profile_id)` retorna não-null → UPDATE `profiles.mfa_reset_required=true`; senão no-op silencioso (sem audit) | `password_reset.complete_admin` (apenas no caso admin) |
| `complete_admin_mfa_reenroll(p_profile_id, p_ip, p_ua)` | service_role only | Re-valida `auth.uid() = p_profile_id` (apenas o próprio admin pode chamar para si); UPDATE `mfa_reset_required=false` | `password_reset.mfa_reenroll_complete` |
| `admin_list_platform_admins()` | qualquer platform admin (RPC valida `is_platform_admin(auth.uid()) is not null`) | LEFT JOIN `profiles`, `auth.users` (last_sign_in_at), `auth.mfa_factors` (totp verified) | n/a |
| `admin_list_platform_admin_invitations(p_filter text default 'pending')` | qualquer platform admin | filtros: `'pending'` (não consumido/revogado/expirado), `'all'`, `'expired'`, `'consumed'`, `'revoked'` | n/a |
| `admin_list_mfa_reset_requests(p_filter text default 'pending')` | qualquer platform admin | filtros: `'pending'`, `'all'`, `'approved'`, `'consumed'`, `'expired'` | n/a |
| `get_invitation_by_token(p_token uuid)` | service_role only | Retorna `(email, role, expires_at, consumed_at, revoked_at)` — **sem expor `id` nem `created_by`** | n/a (read) |

**Total:** 15 RPCs novas (12 do sprint file + 3 reads). Spec consolida.

### 3.2 Server Actions — `src/lib/actions/admin/platform-admins.ts` + `.schemas.ts`

```typescript
// schemas
export const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role:  z.enum(['owner','support','billing']),
});

export const RevokeInvitationSchema = z.object({ id: z.string().uuid() });
export const ConsumeInvitationSchema = z.object({
  token:    z.string().uuid(),
  password: z.string().min(8).max(128),
});
export const ChangeRoleSchema = z.object({
  id:      z.string().uuid(),
  newRole: z.enum(['owner','support','billing']),
});
export const DeactivateSchema = z.object({
  id:           z.string().uuid(),
  confirmEmail: z.string().email(),  // server compara com email do target
});
export const RequestMfaResetSchema = z.object({
  targetAdminId: z.string().uuid(),
  reason:        z.string().trim().min(5).max(500),
});
export const ApproveMfaResetSchema  = z.object({ requestId: z.string().uuid() });
export const RevokeMfaResetSchema   = z.object({ requestId: z.string().uuid() });
```

**Actions exportadas (10):**

| Action | Auth | RPC chamada | Side-effects |
|---|---|---|---|
| `listPlatformAdminsAction()` | `requirePlatformAdmin()` | `admin_list_platform_admins` | — |
| `listInvitationsAction(filter)` | `requirePlatformAdmin()` | `admin_list_platform_admin_invitations` | — |
| `listMfaResetRequestsAction(filter)` | `requirePlatformAdmin()` | `admin_list_mfa_reset_requests` | — |
| `createInvitationAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_create_platform_admin_invitation` → `sendEmail` → UPDATE `email_delivery_log_id` | revalidate `/admin/admins`; retorna `{ invitation, deliveryStatus, offlineLink? }` |
| `revokeInvitationAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_revoke_platform_admin_invitation` | revalidate |
| `getInvitationByTokenAction(token)` | sem auth (token = portador); validado por Zod | `get_invitation_by_token` (service client) | retorna `{ email, role, expiresAt, status: 'valid' \| 'expired' \| 'consumed' \| 'revoked' }`; **NÃO retorna `id` nem `created_by`** |
| `consumeInvitationAction(input)` | sem auth de admin (consumidor anônimo); precisa estar logado como o email-alvo OU criar conta nova | (1) lê `get_invitation_by_token`; (2) `auth.admin.createUser` se conta não existe; (3) garante profile em org `axon`; (4) `admin_consume_platform_admin_invitation` | retorna `{ profileId, redirectTo: '/admin/mfa-enroll?firstEnroll=true' }` |
| `changePlatformAdminRoleAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_change_platform_admin_role` | revalidate |
| `deactivatePlatformAdminAction(input)` | `requirePlatformAdminRole(['owner'])` | server-side compara `confirmEmail` com email do target → `confirm_email_mismatch`; `admin_deactivate_platform_admin` | revalidate |
| `requestMfaResetAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_request_mfa_reset` | revalidate |
| `approveMfaResetAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_approve_mfa_reset` | revalidate |
| `revokeMfaResetRequestAction(input)` | `requirePlatformAdminRole(['owner'])` | `admin_revoke_mfa_reset_request` | revalidate |

**RPC_ERRORS map (consolidado pt-BR):**

```typescript
const RPC_ERRORS: Record<string, string> = {
  unauthorized:                     'Acesso negado. Apenas owner pode executar esta ação.',
  email_already_active_admin:       'Este email já é admin ativo da plataforma.',
  invitation_already_pending:       'Já existe convite pendente para este email. Revogue antes de criar novo.',
  invitation_already_consumed:      'Convite já foi utilizado.',
  invitation_revoked:               'Convite foi revogado.',
  invitation_expired:               'Convite expirou. Peça novo ao admin que te convidou.',
  invitation_not_found_or_terminal: 'Convite não encontrado ou já em estado terminal.',
  email_mismatch:                   'O email do link não bate com a conta logada.',
  profile_not_in_internal_org:      'Profile precisa estar na organização interna axon antes do consume.',
  last_owner_protected:             'Não é possível desativar/rebaixar o último owner ativo.',
  confirm_email_mismatch:           'Confirmação de email não bate com o admin selecionado.',
  self_request_forbidden:           'Você não pode solicitar reset de MFA para si mesmo.',
  mfa_reset_already_pending:        'Já existe pedido de reset MFA pendente para este admin.',
  self_approve_forbidden:           'Você não pode aprovar um pedido que você mesmo abriu.',
  target_approve_forbidden:         'Você não pode aprovar um pedido cujo alvo é você mesmo.',
  mfa_reset_request_expired:        'Pedido expirou (mais de 24h sem aprovação).',
  mfa_reset_request_not_pending:    'Pedido não está pendente.',
  mfa_reset_already_approved:       'Pedido já foi aprovado.',
  target_mismatch:                  'Inconsistência: profile do consumer não bate com target do request.',
};
```

### 3.3 Server Actions — `src/lib/actions/admin/admin-auth.ts`

> ⛔ **Crítico:** este arquivo lida com fluxos de auth (password reset + MFA enroll). Topo do arquivo: `import 'server-only'` (Guardian valida via grep no GATE 4).

```typescript
export const CompletePasswordResetSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

export const CompleteMfaReenrollSchema = z.object({
  factorId: z.string().min(1),
  code:     z.string().regex(/^\d{6}$/),  // TOTP 6 dígitos
});
```

**Actions exportadas (2):**

| Action | Fluxo |
|---|---|
| `completeAdminPasswordResetAction({ newPassword })` | (1) `supabase.auth.updateUser({ password })` — exige sessão de recuperação ativa (token de reset Supabase); (2) `mark_admin_password_reset(profile.id)` (no-op silencioso para customer); (3) retorna `{ redirectTo: '/admin/login' }` |
| `completeAdminMfaReenrollAction({ factorId, code })` | (1) `supabase.auth.mfa.challenge({ factorId })` → `verify({ factorId, code, challengeId })`; (2) lista factors antigos (`factor_type='totp'`, `status='verified'`, id ≠ factorId), `auth.mfa.unenroll(oldFactorId)` para cada; (3) verifica se há `mfa_reset_request` aprovada para este admin → `consume_admin_mfa_reset(requestId, profile.id)`; senão `complete_admin_mfa_reenroll(profile.id)`; (4) retorna `{ redirectTo: '/admin/dashboard' }` |

**Decisão de ordem (ponto (f) do sprint file):** `enroll new + verify` antes de `unenroll old` — janela sem MFA é zero porque o factor novo já está verified quando o antigo cai.

### 3.4 Templates de email — `src/lib/email/templates/admin-invitation.ts`

```typescript
export interface AdminInvitationVars {
  inviterName: string;
  role:        'owner'|'support'|'billing';
  acceptUrl:   string;
  expiresAt:   Date;
}

export function adminInvitationHtml(v: AdminInvitationVars): string;  // HTML simples, escape literal de strings
export function adminInvitationText(v: AdminInvitationVars): string;  // texto plano alternativo
```

**Decisão (ponto edge case "XSS no template"):** sem `dangerouslySetInnerHTML`. Interpolação literal via template strings; helper interno `escapeHtml(s: string)` aplicado a `inviterName` e `role` antes de embutir no HTML.

### 3.5 Modificação mínima de `src/lib/auth/requireAdminSession.ts` (Sprint 04)

> Snippet canônico — `@backend` aplica literalmente. Não modifique outras checks (AAL2, role, etc.) — apenas adicione o bloco `mfa_reset_required` ANTES do return final.

```typescript
// ... checagens existentes (Sprint 04): user, AAL2, is_platform_admin, etc.

// NOVO (Sprint 11): bloqueia rotas admin se profile precisa re-enrollar MFA.
const { data: profile } = await supabase
  .from('profiles')
  .select('mfa_reset_required')
  .eq('id', user.id)
  .single<{ mfa_reset_required: boolean }>();

if (profile?.mfa_reset_required) {
  const headersList = await headers();
  const path = headersList.get('x-pathname') ?? '';   // middleware Sprint 04 já popula
  if (!path.startsWith('/admin/mfa-enroll') && !path.startsWith('/admin/login')) {
    redirect('/admin/mfa-enroll?reenroll=true');
  }
}

// ... return da snapshot existente
```

**Decisão (ponto 7 do sprint file):** query separada (não JOIN com `is_platform_admin`). Razão: `is_platform_admin` já é cacheada via React `cache()` em `getPlatformAdmin`; alterar a RPC para devolver mais colunas inflaria a superfície dela. Custo: 1 round-trip extra por request admin — aceitável (query é índice de PK).

### 3.6 Action slugs do `audit_log` (11 novas)

| Slug | target_type | target_id | metadata |
|---|---|---|---|
| `platform_admin.invite_create` | `platform_admin_invitation` | invitation.id | `{email, role, expires_at}` |
| `platform_admin.invite_revoke` | `platform_admin_invitation` | invitation.id | `{email}` |
| `platform_admin.invite_consume` | `platform_admin` | new_admin.id | `{invitation_id, role, consumer_email}` |
| `platform_admin.role_change` | `platform_admin` | admin.id | `{role_before, role_after}` (em diff_before/diff_after) |
| `platform_admin.deactivate` | `platform_admin` | admin.id | `{email}` |
| `platform_admin.mfa_reset_request` | `platform_admin_mfa_reset_request` | request.id | `{target_admin_id, target_profile_id, reason}` |
| `platform_admin.mfa_reset_approve` | `platform_admin_mfa_reset_request` | request.id | `{target_admin_id, target_profile_id}` |
| `platform_admin.mfa_reset_revoke` | `platform_admin_mfa_reset_request` | request.id | `{target_admin_id}` |
| `platform_admin.mfa_reset_consume` | `platform_admin_mfa_reset_request` | request.id | `{target_profile_id}` |
| `password_reset.complete_admin` | `profile` | profile.id | `{}` (sem campo sensível — senha nunca aqui) |
| `password_reset.mfa_reenroll_complete` | `profile` | profile.id | `{}` |

⛔ **Crítico:** nenhum slug tem `password`, `token`, `factor_secret`, `recovery_code` no `metadata`. Guardian valida via grep no GATE 4.

---

## 4. External API Integration

### Supabase Auth API

**Métodos consumidos:**

| Método | Onde | Por quê |
|---|---|---|
| `auth.admin.createUser({ email, password, email_confirm: true })` | `consumeInvitationAction` | criar conta de novo admin se email não existe em `auth.users` |
| `auth.updateUser({ password })` | `completeAdminPasswordResetAction` | atualizar senha após sessão de recuperação |
| `auth.resetPasswordForEmail(email)` | página `/admin/login` (link "Esqueci senha" — fora do escopo de Server Action) | dispara email padrão Supabase |
| `auth.mfa.enroll({ factorType: 'totp' })` | UI Sprint 04 `MfaEnrollForm` (já existe) | gera novo factor TOTP |
| `auth.mfa.challenge({ factorId })` + `verify({ factorId, challengeId, code })` | `completeAdminMfaReenrollAction` | confirma posse do TOTP novo |
| `auth.mfa.unenroll(factorId)` | `completeAdminMfaReenrollAction` | invalida TOTP antigo após verify do novo |
| `auth.mfa.listFactors()` | `completeAdminMfaReenrollAction` | identifica factors antigos para unenroll |

**Sem dependência externa de pacote novo:** todos via `@supabase/supabase-js` já em `package.json`.

### Sender de email interno (Sprint 10)

**Contrato consumido:** `sendEmail(payload: SendEmailPayload): Promise<EmailDeliveryResult>` em [`src/lib/email/sender.ts`](../src/lib/email/sender.ts).

**Uso em `createInvitationAction`:**

```typescript
const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/accept-invite/${invitation.token}`;
const result = await sendEmail({
  kind:        'invitation',
  to:          invitation.email,
  subject:     'Convite Axon Admin',
  html:        adminInvitationHtml({ inviterName: caller.email, role: invitation.role, acceptUrl, expiresAt: new Date(invitation.expires_at) }),
  text:        adminInvitationText({ ... }),
  related:     { type: 'platform_admin_invitation', id: invitation.id },
  offlineLink: acceptUrl,
  sentBy:      caller.profileId,
});
// UPDATE invitation.email_delivery_log_id = result.deliveryLogId via service client
```

---

## 5. Componentes de UI

> Todos seguem o contrato em [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). Wrappers DS já existentes: `Button`, `Input`, `Label`, `Select`, `Dialog`, `Tabs`, `Card`, `Badge`, `Alert`, `Skeleton`, `useToast`. **APRENDIZADOS 2026-04-21 e 2026-04-20** alertam: `<Button variant="danger">` é obrigatório; nunca `<button className="bg-action-danger ...">`.

### 5.1 Component Tree

```
Page: /admin/admins
└── AdminsTabs (Client) — wrapper de src/components/ui/tabs
    ├── AdminsList            (Server) — table de platform_admins
    ├── InvitationsList       (Server) — table de invitations pendentes
    └── MfaResetRequestsList  (Server) — table de pedidos pendentes

Page: /admin/admins/invite
└── InviteAdminForm (Client) — react-hook-form + zodResolver

Page: /admin/admins/[id]
└── AdminDetailCard (Server)
    ├── ChangeRoleDialog       (Client)
    ├── DeactivateAdminDialog  (Client) — confirmação digitada do email
    └── RequestMfaResetDialog  (Client) — escondido se caller===target

Page: /admin/accept-invite/[token]   (PÚBLICA — sem requireAdminSession)
└── AcceptInviteFlow (Client) — 3 passos: senha → MFA → redirect

Page: /admin/mfa-enroll  (modificada — Sprint 04)
└── MfaEnrollForm (Client) — prop `mode: 'first' | 'reenroll'` + banner condicional
```

### 5.2 Componentes — props e tokens

#### `AdminsTabs.tsx` (Client)
- **Props:** `{ admins, invitations, resetRequests, currentRole: PlatformAdminRole, currentProfileId: string }`
- **DS components:** `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `src/components/ui/tabs`
- **Tokens:** `bg-surface-base` (root), `text-text-primary` (labels), `border-border` (separator)
- **Behavior:** estado da tab atual em `?tab=` (URL é fonte da verdade — `crud.md` regra 2)

#### `AdminsList.tsx` (Server)
- **Props:** `{ admins: AdminRow[], canMutate: boolean }`
- **DS components:** `Table`, `Badge` (variant `default|outline` para role), `Skeleton`
- **Tokens:** `bg-surface-raised`, `text-text-secondary` (timestamps), `border-border-subtle` (rows)
- **Empty state:** "Nenhum admin ativo" + CTA "Convidar primeiro admin" (visível só para owner)

#### `InvitationsList.tsx` (Server)
- **Props:** `{ invitations: InvitationRow[], canMutate: boolean }`
- **Action buttons:** "Copiar link" (`<Button variant="secondary" size="sm">`), "Revogar" (`<Button variant="danger" size="sm">`)
- **Empty state:** "Sem convites pendentes"

#### `MfaResetRequestsList.tsx` (Server)
- **Props:** `{ requests: MfaResetRow[], currentProfileId: string, canMutate: boolean }`
- **Action buttons:** "Aprovar" (`<Button variant="primary">` — escondido se `request.requested_by === currentProfileId || request.target_profile_id === currentProfileId`), "Revogar" (`<Button variant="danger" size="sm">`)
- **Alerta deadlock:** `<Alert variant="warning">` quando há ≤2 owners ativos: "Atenção: você precisa de um terceiro owner para aprovar pedidos de reset MFA."

#### `InviteAdminForm.tsx` (Client)
- **Props:** `{}` (vazio — Server Action é chamada direto)
- **DS components:** `Form`, `Input`, `Select`, `Label`, `Button` (variant `primary`, size `lg`)
- **Tokens:** `bg-surface-raised` (form card), `text-text-primary`, `border-field-border`, `focus:shadow-focus`
- **State:** loading via `useTransition`; resultado em estado local `{ kind: 'idle' | 'sent' | 'offline_fallback' | 'error', offlineLink? }`
- **Behavior pós-submit:**
  - `sent` → `useToast({ variant: 'success', description: 'Convite enviado para X' })`; redirect para detalhe
  - `fallback_offline` → `<Alert variant="warning">` persistente com `<Input readonly value={offlineLink}>` + botão "Copiar"
  - `error` → toast error

#### `AdminDetailCard.tsx` (Server)
- **Props:** `{ admin: AdminFullRow, currentRole: PlatformAdminRole, currentProfileId: string }`
- **Tokens:** `bg-surface-raised` (card), `text-text-primary` (name), `text-text-secondary` (email/timestamps)
- **Action buttons:** visíveis apenas se `currentRole === 'owner'`. Botão "Solicitar reset MFA" escondido se `admin.profile_id === currentProfileId`.

#### `DeactivateAdminDialog.tsx` (Client)
- **Padrão:** `crud.md` regra 5 (Danger Zone com confirmação digitada literal — RNF-UX-2)
- **DS components:** `Dialog`, `DialogContent`, `Input`, `Button` (variant `danger`)
- **Validação client:** botão "Desativar" disabled enquanto digitação ≠ `admin.email`
- **Server-side:** Server Action **também** valida (`confirm_email_mismatch`) — defesa em profundidade

#### `RequestMfaResetDialog.tsx` (Client)
- **Form:** textarea de motivo (5-500 chars), validação client + server
- **DS components:** `Dialog`, `Textarea`, `Button` (variant `primary`)

#### `ApproveMfaResetDialog.tsx` (Client)
- **Display:** mostra requester + target + motivo + idade do pedido; confirma com `<Button variant="primary">`

#### `AcceptInviteFlow.tsx` (Client)
- **Props:** `{ email: string, role: 'owner'|'support'|'billing', token: string }`
- **Estado:** stepper 3 passos: `'create_account' | 'mfa_enroll' | 'redirect'`
- **Passo 1 (create_account):** form com email pré-preenchido (`disabled`), senha + confirmação. Submit chama `consumeInvitationAction`. Em sucesso → redirect para `/admin/mfa-enroll?firstEnroll=true`.
- **Decisão (ponto (g) do sprint file):** se há sessão atual (cookie Supabase) cujo email ≠ convite → `<Alert variant="error">` "Você está logado como X. Faça logout antes de continuar." + botão "Sair e tentar novamente" (chama `supabase.auth.signOut()`).

#### Modificação `src/app/admin/mfa-enroll/page.tsx` (Sprint 04)
- Detecta `?reenroll=true` → banner topo `<Alert variant="warning">` "Sua sessão exige reconfiguração de MFA antes de continuar." → `MfaEnrollForm mode="reenroll"` → submit chama `completeAdminMfaReenrollAction`.
- Detecta `?firstEnroll=true` → título "Configure MFA para entrar na área admin" → `MfaEnrollForm mode="first"` → submit chama `completeAdminMfaReenrollAction` (mesmo handler — sem request pendente, RPC `complete_admin_mfa_reenroll` apenas zera flag).

#### Modificação `AdminSidebar.tsx`
- Item raiz "Administradores" → `/admin/admins` (tabs internas dispensam sub-itens). Visível para todos os papéis (read-only para support/billing); botões de mutação escondidos via gate visual.

### 5.3 Acessibilidade

- Form com `aria-required`, error inline com `aria-describedby`.
- `Dialog` herda `role="dialog"` + foco trap do Radix.
- Página pública `/admin/accept-invite/[token]` tem `<a href="#main" className="sr-only focus:not-sr-only">Pular para conteúdo</a>` (anônimos podem usar leitor de tela).

---

## 6. Edge Cases (CRITICAL)

### Estado de invitations (4 estados)
- [ ] **Token válido:** página de aceite renderiza fluxo de 3 passos.
- [ ] **Token expirado (>72h):** renderiza "Convite expirado" sem expor email; CTA "Peça novo ao admin que te convidou".
- [ ] **Token revogado:** renderiza "Convite revogado".
- [ ] **Token consumido:** renderiza "Convite já utilizado".

### Concorrência / atomicidade
- [ ] **G-15 (consumo duplo):** 2 chamadas concorrentes a `consumeInvitationAction` → exatamente 1 cria linha em `platform_admins`; outra recebe `'invitation_already_consumed'`. Garantido por `UPDATE ... WHERE consumed_at IS NULL ... RETURNING *` (Postgres atomic em READ COMMITTED — sem precisar SERIALIZABLE).
- [ ] **2 owners aprovam mesmo pedido em paralelo:** `UPDATE ... WHERE approved_at IS NULL ... RETURNING *` — 1 vence; outra recebe `'mfa_reset_already_approved'`.
- [ ] **2 owners desativam mesmo target em paralelo:** trigger Sprint 02 + check de `is_active=true` no UPDATE — 1 vence; outra recebe linha 0 row, traduzida para erro tipado.

### Validação de invariantes (sprint file §"Critérios de Aceite")
- [ ] **G-08 (last-owner protection):** desativar último owner → `'last_owner_protected'`. Downgrade do último owner → mesma trigger.
- [ ] **Step-up duplo (3 invariantes):** auto-solicitação rejeitada (CHECK `pamr_no_self_request` + RPC); auto-aprovação rejeitada (CHECK `pamr_approver_distinct` + RPC); target-aprovação rejeitada (mesmos).
- [ ] **G-22 (re-enroll pós-reset):** admin completa password reset → `mfa_reset_required=true` → próxima call a `requireAdminSession()` redireciona para `/admin/mfa-enroll?reenroll=true` independente da rota tentada.

### Validação de input (Zod + RPC)
- [ ] **Email inválido / role fora do enum:** Zod fail; sem chamada Supabase.
- [ ] **Reason < 5 chars:** Zod fail.
- [ ] **`confirmEmail` ≠ email do target:** server-side `'confirm_email_mismatch'`.
- [ ] **Convite duplicado pendente:** UNIQUE parcial enforça → RPC traduz para `'invitation_already_pending'`.

### Auth / RBAC
- [ ] **support/billing tenta mutation:** `requirePlatformAdminRole(['owner'])` → `notFound()` (Sprint 04 padrão).
- [ ] **customer user acessa `/admin/admins`:** `requireAdminSession` redireciona para `/admin/login`.
- [ ] **Convidado abre link logado em outra conta admin/customer:** `AcceptInviteFlow` detecta sessão ≠ email do convite → bloqueia até logout (decisão ponto (g)).
- [ ] **Convidado abre link sem sessão:** fluxo cria conta nova via `auth.admin.createUser`.

### Email delivery (Sprint 10 fallback chain)
- [ ] **DB/Vault tem credencial → email enviado:** `deliveryStatus: 'sent'`.
- [ ] **DB vazio + env vars completos → email enviado:** mesmo payload.
- [ ] **Tudo vazio + offline_fallback enabled:** `deliveryStatus: 'fallback_offline'`; UI mostra `offlineLink` para copiar; convite continua válido por 72h.
- [ ] **Tudo vazio + offline_fallback disabled:** `deliveryStatus: 'error'`, `errorMessage='email_not_configured'`; UI mostra erro; convite criado mesmo assim (decisão de produto: invitation existe, owner pode revogar e tentar novamente quando configurar).

### Estado de admin
- [ ] **Convidar email já admin ativo:** RPC `'email_already_active_admin'`.
- [ ] **Convidado profile não está em org `axon`:** Server Action garante via `auth.admin.createUser` (cria em axon) ou erro `'profile_not_in_internal_org'` apontando runbook.
- [ ] **Apenas 2 owners no sistema:** UI mostra `<Alert variant="warning">` em `MfaResetRequestsList`; tentativa de pedido cai em deadlock (sem terceiro owner para aprovar) — documentado.
- [ ] **Pedido de reset expira (>24h):** UI lista como "Expirado"; aprovar falha com `'mfa_reset_request_expired'`.
- [ ] **Reset aprovado mas target não completa re-enroll:** target permanece com `mfa_reset_required=true`; middleware redireciona em loop (sem auto-cleanup; documentado como follow-up Sprint 13).

### Auth flows compostos
- [ ] **Admin com password reset E reset MFA aprovado simultaneamente:** re-enroll único satisfaz ambos. Ordem: `consume_admin_mfa_reset` (se request pendente) precede `complete_admin_mfa_reenroll`.
- [ ] **Customer user (não-admin) completa password reset:** `mark_admin_password_reset` no-op silencioso; sem flag setada; sem audit `password_reset.complete_admin`.

### Segurança
- [ ] **Audit nunca contém `password`/`token`/`factor_secret`:** Guardian valida via grep no GATE 4 nos arquivos `src/lib/actions/admin/platform-admins.ts` e `admin-auth.ts`.
- [ ] **Email template sem XSS:** `escapeHtml()` aplicado a `inviterName`/`role`; sem `dangerouslySetInnerHTML`.
- [ ] **`admin_consume_platform_admin_invitation` REVOKE de anon/authenticated:** validado em §7 (Acceptance Criteria) por SQL.
- [ ] **SELECT direto em `platform_admin_invitations` por customer user:** RLS policy `pai_select_platform_admin_active` rejeita.

### Browser / responsividade / ambiente
- [ ] **Viewport 375px (mobile):** tabelas em `AdminsList`/`InvitationsList`/`MfaResetRequestsList` envolvem em wrapper com `overflow-x-auto` preservando todas as colunas; `Dialog` herda comportamento full-screen do Radix abaixo de breakpoint `sm`.
- [ ] **JS desabilitado:** página pública `/admin/accept-invite/[token]` renderiza no Server Component os 4 estados (válido/expirado/consumido/revogado) via SSR; o fluxo interativo (criar conta + MFA) não funciona sem JS, mas a tela inicial informa o estado do convite. `<noscript>` no layout admin orienta o usuário a habilitar JavaScript.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration aplica sem erro via `supabase db push --dry-run` (GATE 1).
- [ ] Migration idempotente: `IF NOT EXISTS` em todas as 2 tabelas + 1 coluna + todas as policies + todos os índices + todas as 15 RPCs (`CREATE OR REPLACE FUNCTION`).
- [ ] `relforcerowsecurity = true` para `platform_admin_invitations` e `platform_admin_mfa_reset_requests` (validar via SQL §"Critérios de Aceite").
- [ ] `profiles.mfa_reset_required` existe, `boolean NOT NULL DEFAULT false`; zero linhas com NULL pós-migration.
- [ ] Trigger Sprint 02 `prevent_last_owner_deactivation` ainda ativo (validar via SQL — não regrediu).
- [ ] Privilégios das 15 RPCs corretos (validar via `has_function_privilege`):
  - `service_role` tem EXECUTE em todas.
  - `anon` e `authenticated` **sem** EXECUTE em RPCs de mutation e em `*_consume_*`/`mark_admin_password_reset`/`complete_admin_mfa_reenroll`/`get_invitation_by_token`.
  - `authenticated` tem EXECUTE em RPCs de listagem (`admin_list_*`) — RPC re-valida `is_platform_admin` internamente.

### Backend
- [ ] Toda Server Action segue o gold standard Sprint 10 (`requirePlatformAdmin*`, `createServiceClient`, `RPC_ERRORS`, `rpcError`, `getRequestMeta`, `safeParse`, `ActionResponse<T>`, `revalidatePath`).
- [ ] Topo de `src/lib/actions/admin/admin-auth.ts` tem `import 'server-only'` (Guardian valida).
- [ ] `requireAdminSession.ts` modificado conforme snippet §3.5 — sem regressão das checks existentes Sprint 04.
- [ ] `npm run build` passa sem erro de tipo (GATE 2).
- [ ] `npm run lint` passa sem novos warnings (GATE 2).

### Integration tests (GATE 4.5)
- [ ] 3 arquivos criados: `tests/integration/admin-platform-admins.test.ts`, `admin-mfa-reset.test.ts`, `admin-auth-password-reset.test.ts`.
- [ ] ~40 testes passam (0 failed, 0 skipped, 0 todo) via `npm test -- --run tests/integration/`.
- [ ] Cobertura mínima por Server Action: happy + Zod fail + auth fail + 1 regra de negócio testável (contrato de testes em [`docs/conventions/standards.md`](../docs/conventions/standards.md) §Contrato de testes).
- [ ] G-15 testado por `Promise.all` de 2 chamadas a `consumeInvitationAction` com mesmo token; assert `count(*)=1` em `platform_admins`.
- [ ] G-22 testado simulando ciclo completo: `completeAdminPasswordResetAction` → SELECT `mfa_reset_required=true` → mock `requireAdminSession` retorna redirect → `completeAdminMfaReenrollAction` → SELECT `mfa_reset_required=false`.
- [ ] Step-up duplo testado: 3 testes (self-request, self-approve, target-approve) cada um esperando o erro tipado.
- [ ] Mocks em `tests/setup.ts` `__mockSupabase` sem inline; `vi.mock('@supabase/supabase-js')` para mfa.{enroll,verify,unenroll,challenge}; `vi.mock('@/lib/email/sender')` para `sendEmail`.

### Frontend (design system compliance)
- [ ] **O código passa em todas as checagens do [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a (regras automáticas) e § 1b (correção semântica).** Fonte normativa em [`design_system/enforcement/rules.md`](../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). Guardian rejeita o PR se qualquer regra falhar — incluindo: (1) zero `<button>` inline para variantes existentes (`danger`, `secondary`, `primary`); (2) zero literal hex / `bg-blue-500` / arbitrary `[Xpx]`; (3) `import 'server-only'` em `admin-auth.ts`; (4) zero `password|token|factor_secret` em payload de audit ou response.
- [ ] Componentes verificados com `data-theme="dark"` togglado.
- [ ] Todos formulários têm loading state (via `useTransition`).
- [ ] Todos formulários têm error state (toast + inline).
- [ ] Todos formulários têm success feedback (toast).
- [ ] `node scripts/verify-design.mjs --changed` retorna 0 violações (GATE 5 estático).

### Audit
- [ ] Toda mutation grava linha em `audit_log` com `action` slug correto, `target_type` correto, `metadata` sem dado sensível. Validado via SQL pós-teste:
  ```sql
  SELECT action, target_type, metadata FROM audit_log
   WHERE action LIKE 'platform_admin.%' OR action LIKE 'password_reset.%'
   ORDER BY occurred_at DESC LIMIT 30;
  ```

### Documentação
- [ ] `docs/conventions/standards.md` §"Exceções em `public.*`" recebe 2 linhas novas.
- [ ] `docs/PROJECT_CONTEXT.md` §2 recebe 2 linhas novas; ganha bloco §5e documentando 2 tabelas + coluna + 15 RPCs + decisão step-up duplo + integração com sender Sprint 10.
- [ ] `docs/admin_area/rbac_matrix.md` recebe linhas novas para 11 ações novas.
- [ ] `docs/admin_area/runbook_seed_owner.md` recebe nota: "após Sprint 11, primeiro owner adicional é convidado via UI; runbook só se aplica a bootstrap inicial ou recovery break-glass".

---

## 8. Implementation Plan

### Phase 1 — Database (`@db-admin`)
1. Criar migration `supabase/migrations/[timestamp]_admin_11_platform_admin_invitations_mfa_reset.sql`.
2. ALTER `profiles` (1 coluna), CREATE 2 tabelas com CHECKs + UNIQUE parciais + índices, ENABLE/FORCE RLS, policies SELECT, 15 RPCs.
3. REVOKE EXECUTE de `public, anon, authenticated` para todas as 15 RPCs (APRENDIZADO 2026-04-24); GRANT EXECUTE seletivo.
4. Header da migration documenta 2 tabelas + 1 coluna + 15 RPCs + dependências (Sprints 02/03/04/10).
5. `supabase db push --dry-run` deve passar.
6. Atualizar `docs/conventions/standards.md` §exceções e `docs/PROJECT_CONTEXT.md` §2 + §5e.

**Estimated time:** 25 min.

### Phase 2 — Backend (`@backend`)
1. Criar `src/lib/actions/admin/platform-admins.ts` + `.schemas.ts` (10 actions).
2. Criar `src/lib/actions/admin/admin-auth.ts` + `.schemas.ts` (2 actions; `import 'server-only'`).
3. Criar `src/lib/email/templates/admin-invitation.ts` (htmlescape + 2 helpers).
4. Modificar `src/lib/auth/requireAdminSession.ts` conforme snippet §3.5.
5. Atualizar `docs/admin_area/rbac_matrix.md` + `docs/admin_area/runbook_seed_owner.md`.
6. `npm run build` + `npm run lint` devem passar.

**Estimated time:** 40 min.

### Phase 3 — Integration tests (`@qa-integration`)
1. Criar 3 arquivos em `tests/integration/`. Mock `auth.mfa.{enroll,verify,unenroll,challenge,listFactors}` e `sendEmail` no `tests/setup.ts` se necessário (mocks específicos do teste via `vi.mocked(...).mockResolvedValueOnce()`).
2. ~40 testes total. `npm test -- --run tests/integration/` passa com 0 failed/skipped.

**Estimated time:** 35 min.

### Checkpoint pré-frontend (Tech Lead pergunta)
Continuar ou limpar contexto.

### Phase 4 — Frontend (`@frontend+`)
1. Criar 4 rotas (`page.tsx`) + 11 componentes em `src/components/admin/admins/`.
2. Modificar `mfa-enroll/page.tsx` (Sprint 04) para detectar query params.
3. Modificar `AdminSidebar.tsx` (Sprint 04/09/10).
4. Reutilizar `MfaEnrollForm` Sprint 04 com prop `mode: 'first' | 'reenroll'`.
5. `npm run build` + `node scripts/verify-design.mjs --changed` devem passar.

**Estimated time:** 60 min.

### Checkpoint pós-frontend (Tech Lead pergunta)
Continuar ou limpar contexto antes do Guardian.

### Phase 5 — Guardian (`@guardian` em **agent mode**)
Code review automático + § 1a/1b. Tech Lead despacha via handoff file `sprints/handoffs/sprint_admin_11/guardian_input.md`.

**Estimated time:** 10 min.

### Phase 6 — GATE 4.5 + GATE 5 (Tech Lead executa)
Re-roda integration tests + design verification estática.

**Estimated time:** 5 min.

**Total Estimated Time:** ~3h (sem retries).

---

## 9. Risks & Mitigations

### R1: Bypass de MFA re-enroll (G-22) por race condition entre `mark_admin_password_reset` e próxima request admin
**Impacto:** Crítico (P0 segurança — elevação de privilégio com senha apenas).
**Probabilidade:** Baixa (depende de timing entre password reset confirm e próxima rota admin no mesmo browser).
**Mitigação:** `requireAdminSession` lê `mfa_reset_required` em **toda** request admin (não cacheado). React `cache()` é por-request, não cross-request — flag é re-lida.

### R2: Drift do `requireAdminSession` quebra todas as rotas `/admin/*` (regressão Sprint 04)
**Impacto:** Crítico (admin offline).
**Probabilidade:** Média (modificação de função load-bearing).
**Mitigação:** snippet canônico em §3.5 + Guardian valida que checks Sprint 04 (AAL2, role) permanecem; @qa-integration adiciona teste do redirect; manual smoke após deploy.

### R3: Single-use atomicidade falha sob carga (G-15)
**Impacto:** Alto (2 admins criados a partir do mesmo convite).
**Probabilidade:** Baixa (Postgres garante UPDATE atomic em READ COMMITTED com `WHERE consumed_at IS NULL`).
**Mitigação:** teste integrado com `Promise.all` de 2 chamadas; SELECT auxiliar só executa quando UPDATE retorna 0 rows (caminho de erro, não de race).

### R4: Step-up duplo bypass via service_role direto
**Impacto:** Crítico (auditor flag).
**Probabilidade:** Baixa (requer acesso a service_role key + SQL direto).
**Mitigação:** CHECKs `pamr_no_self_request` + `pamr_approver_distinct` no constraint da tabela — defesa em profundidade contra bypass de RPC. Mesma regra validada por: (1) Zod (client UX), (2) RPC (auth.uid()), (3) constraint do banco.

### R5: Email do convite cai em fallback offline e owner não percebe
**Impacto:** Médio (convite sem entrega — lockout do convidado).
**Probabilidade:** Alta no MVP (DB vazio + env vars não configuradas).
**Mitigação:** UI persistente em `InviteAdminForm` mostra `offlineLink` com banner; toast distinto de "enviado"; `email_delivery_log` registra `source='offline_fallback'`.

### R6: Convidado abre link em sessão errada (logado como outro admin/customer)
**Impacto:** Baixo (UX confuso, sem risco de segurança — Server Action valida email_mismatch).
**Probabilidade:** Média.
**Mitigação:** `AcceptInviteFlow` detecta sessão atual via `supabase.auth.getUser()` no client; bloqueia com `<Alert>` + botão "Sair".

### R7: Reset MFA fica órfão (aprovado mas não consumido) — admin loop indefinido
**Impacto:** Médio (admin alvo não consegue acessar até completar re-enroll).
**Probabilidade:** Média.
**Mitigação:** documentar como follow-up Sprint 13 (job pg_cron para revogar requests aprovadas há >7d sem consume); UI lista pedidos aprovados com idade visível.

---

## 10. Dependencies

### Internal (todas satisfeitas)
- [x] Sprint admin_02 — `platform_admins`, `is_platform_admin`, trigger `prevent_last_owner_deactivation`, helpers `requirePlatformAdmin*`, `rbac_matrix.md`.
- [x] Sprint admin_03 — `audit_log` + `audit_write` RPC.
- [x] Sprint admin_04 — shell `/admin/*`, middleware `requireAdminSession`, página `/admin/mfa-enroll`, `MfaEnrollForm`, AAL2 enforcement.
- [x] Sprint admin_10 — `sendEmail` + `EmailDeliveryResult` discriminated + `email_delivery_log` com `related_entity_type='platform_admin_invitation'` já no CHECK.

### External
- [x] `@supabase/supabase-js` (já em `package.json`) — `auth.admin.*`, `auth.mfa.*`, `auth.updateUser`, `auth.resetPasswordForEmail`.
- [x] `nodemailer` (Sprint 10).
- Sem novos pacotes a instalar.

---

## 11. Rollback Plan

### Caso o sprint precise ser revertido após deploy

1. **Imediato (revert código):**
   ```bash
   git revert <hash do commit do sprint admin_11>
   ```
2. **Database (rollback migration):**
   ```sql
   -- delegado ao @db-admin via runbook em-line
   drop function if exists public.admin_create_platform_admin_invitation(text,text,inet,text);
   drop function if exists public.admin_revoke_platform_admin_invitation(uuid,inet,text);
   drop function if exists public.admin_consume_platform_admin_invitation(uuid,uuid,inet,text);
   drop function if exists public.admin_change_platform_admin_role(uuid,text,inet,text);
   drop function if exists public.admin_deactivate_platform_admin(uuid,inet,text);
   drop function if exists public.admin_request_mfa_reset(uuid,text,inet,text);
   drop function if exists public.admin_approve_mfa_reset(uuid,inet,text);
   drop function if exists public.admin_revoke_mfa_reset_request(uuid,inet,text);
   drop function if exists public.consume_admin_mfa_reset(uuid,uuid,inet,text);
   drop function if exists public.mark_admin_password_reset(uuid,inet,text);
   drop function if exists public.complete_admin_mfa_reenroll(uuid,inet,text);
   drop function if exists public.admin_list_platform_admins();
   drop function if exists public.admin_list_platform_admin_invitations(text);
   drop function if exists public.admin_list_mfa_reset_requests(text);
   drop function if exists public.get_invitation_by_token(uuid);
   drop table if exists public.platform_admin_mfa_reset_requests;
   drop table if exists public.platform_admin_invitations;
   alter table public.profiles drop column if exists mfa_reset_required;
   ```
3. **Cache:** `revalidatePath('/admin', 'layout')` + restart container Next.js.
4. **Monitoring:** verificar `audit_log` por slugs novos remanescentes; verificar `email_delivery_log` por entries com `related_entity_type='platform_admin_invitation'`.

**Risco do rollback:** se algum convite foi consumido entre o deploy e o revert, o `platform_admins` recém-criado permanece (linha não some). É aceitável — o admin recém-convidado vira inacessível via UI mas existe no banco; remoção manual via service_role.

---

## Approval

**Created by:** @spec-writer (Tech Lead persona)
**Reviewed by:** @sanity-checker (pendente)
**Approved by:** [Aguardando STOP & WAIT do usuário]
**Date:** 2026-04-27
