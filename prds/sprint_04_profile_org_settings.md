# PRD: Profile & Org Settings

**Template:** PRD_COMPLETE
**Complexity Score:** 16 points
**Sprint:** 04 (`sprints/active/sprint_04_profile_org_settings.md`)
**Created:** 2026-04-15
**Status:** Draft

**Complexity breakdown:**
- DB: schema modifications (RLS + avatars bucket) (+2) + multiple tables affected (`profiles`, `organizations`, `invitations`) (+2) = **4**
- API: new Server Actions (+2) + multiple endpoints (+2) = **4**
- UI: new components (+2) = **2**
- Business logic: new rules (role gating, max_users, invite dedup) (+3) + complex validation (+2) = **5**
- Dependencies: internal (Sprint 03 `getSessionContext`) (+1) = **1**

---

## 1. Overview

### Business Goal

Fechar o bloco auth/tenancy iniciado no Sprint 03. Usuário autenticado passa a gerenciar o próprio `profile`; `owner`/`admin` passam a gerenciar a organização e a emitir/revogar convites — sem depender de acesso manual ao Supabase. Bloqueia Sprints 05+ porque todos os CRUDs subsequentes assumem que o padrão de actions com `getSessionContext()` + `assertRole` está fixado.

### User Stories

- Como **usuário autenticado**, quero editar meu nome, telefone, avatar e preferências em `/settings/profile`, para manter meu cadastro atualizado.
- Como **owner/admin**, quero editar o nome e slug da organização em `/settings/organization`, para refletir a empresa no app.
- Como **owner/admin**, quero listar membros e convites pendentes em `/settings/team`, para ter visão do acesso.
- Como **owner/admin**, quero gerar convite (email + role) e receber `inviteUrl` copiável, para adicionar membro sem console do Supabase.
- Como **owner/admin**, quero revogar e reenviar convites pendentes, para corrigir digitação ou reemitir link.
- Como **member**, quero que `/settings/organization` e `/settings/team` sejam invisíveis/bloqueados.

### Success Metrics

- Toda coluna editável das 3 tabelas (profiles, organizations, invitations) tem UI correspondente.
- Fluxo ponta-a-ponta: admin gera convite → link copiado → convidado aceita via `/accept-invite/[token]` (entregue no Sprint 03) sem passos manuais.
- Todo Server Action nesta sprint consome `getSessionContext()` + `assertRole` (zero duplicação de sessão/auth).

---

## 2. Database Requirements

### Existing Tables Used (read-only confirmation via DB probe)

#### Table: `profiles`
**Fields accessed:** `id`, `organization_id`, `full_name`, `avatar_url`, `phone`, `role`, `preferences` (jsonb), `is_active`, `email`, `created_at`.
**Usage:** read (self via `getSessionContext`; team listing filtrada por `organization_id = ctx.organizationId`) e update (self-only: `full_name`, `avatar_url`, `phone`, `preferences`).

#### Table: `organizations`
**Fields accessed:** `id`, `name`, `slug`, `plan` (read-only), `max_users` (read-only), `is_active`, `settings` (jsonb), `created_at`.
**Usage:** read por todos membros; update (`name`, `slug`, `settings`) restrito a `owner`/`admin`.

#### Table: `invitations`
**Fields accessed:** `id`, `organization_id`, `email`, `role`, `token`, `invited_by`, `expires_at`, `accepted_at`, `created_at`.
**Usage:** INSERT/SELECT/UPDATE/DELETE restrito a `owner`/`admin` da mesma `organization_id`.

### Schema changes (aplicadas somente se probe indicar ausência)

Migrations são **idempotentes** (`DROP POLICY IF EXISTS` + `CREATE POLICY`, `CREATE TABLE/BUCKET IF NOT EXISTS`).

#### Migration: `NNNN_settings_rls.sql`

Garante as policies abaixo. A introspecção via `get_schema_tables` reporta apenas tabelas; @db-admin consulta `pg_policies` para confirmar policies existentes antes de gravar.

**`profiles`:**
- SELECT: `organization_id = (select organization_id from profiles where id = auth.uid())`.
- UPDATE: apenas self (`id = auth.uid()`).

**`organizations`:**
- SELECT: `id = (select organization_id from profiles where id = auth.uid())`.
- UPDATE: `id = (select organization_id from profiles where id = auth.uid()) AND (select role from profiles where id = auth.uid()) IN ('owner','admin')`.

**`invitations`:**
- SELECT/INSERT/UPDATE/DELETE: `organization_id = (select organization_id from profiles where id = auth.uid()) AND (select role from profiles where id = auth.uid()) IN ('owner','admin')`.

> **Nota:** actions usam `createClient` (server) + RLS. `createServiceClient` é usado apenas quando a operação exige privilégio (ex.: revalidar token de convite aceito por usuário ainda não logado — padrão herdado de `auth.ts`).

#### Migration: `NNNN_avatars_bucket.sql`

Bucket `avatars`:
- `public = true` (leitura pública do avatar é aceitável — mesmo padrão de Gravatar).
- INSERT policy: `bucket_id = 'avatars' AND auth.role() = 'authenticated' AND (storage.foldername(name))[1] = auth.uid()::text` — cada user só escreve em `avatars/{userId}/...`.
- UPDATE/DELETE policy: idem.
- SELECT policy: `bucket_id = 'avatars'` (público).

Criação via SQL:

```sql
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
```

### Indexes

Não requeridos nesta sprint. Filtros primários (`organization_id`, `id`, `token`, `accepted_at`) já indexados pelas PK/FK existentes.

### Constraints

- `organizations.slug` UNIQUE já existe (confirmar na probe).
- `invitations.token` UNIQUE já existe (confirmar na probe).
- Business rule "invite dedup" é **aplicada em código** (ver § 3), não em constraint — um email pode ter múltiplas linhas em `invitations` ao longo do tempo, desde que no máximo uma esteja pendente + não expirada.

---

## 3. API Contract

### Shared helper

#### `assertRole(ctx, allowed)`
**File:** `src/lib/actions/_shared/assertRole.ts`

```typescript
import type { SessionContext, SessionRole } from '@/lib/supabase/getSessionContext';

export function assertRole(
  ctx: SessionContext,
  allowed: readonly SessionRole[]
): { ok: true } | { ok: false; error: string } {
  if (!allowed.includes(ctx.role)) {
    return { ok: false, error: 'Ação restrita a administradores.' };
  }
  return { ok: true };
}
```

Usado em todas as actions de `organization.ts` e `invitations.ts`. Action retorna `ActionResponse.error` em caso negativo — nunca joga.

---

### File: `src/lib/actions/profile.ts`

#### `updateProfileAction`

**Input Schema:**
```typescript
const UpdateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Nome obrigatório').max(100),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  avatarUrl: z.string().url('URL inválida').nullable().optional(),
  preferences: z.object({
    emailNotifications: z.boolean().optional(),
  }).partial().optional(),
});
```

**Business Logic:**
1. `ctx = await getSessionContext()`.
2. Valida input com Zod (`.issues[0].message` em erro — cf. APRENDIZADO Zod 4).
3. Merge de `preferences`: ler `profiles.preferences` atual e fazer `{ ...existing, ...input.preferences }` para preservar chaves desconhecidas.
4. UPDATE em `profiles` onde `id = ctx.userId` (RLS já garante). Campos tocados: `full_name`, `phone` (vazio → null), `avatar_url`, `preferences`, `updated_at = now()`.
5. `revalidatePath('/settings/profile')` + `revalidatePath('/', 'layout')` (Topbar lê nome/avatar do ctx).
6. Retorna `ActionResponse<{ ok: true }>`.

**Erros mapeados:** inconsistências de DB → `"Não foi possível atualizar perfil"`.

#### `uploadAvatarAction`

**Input:** `FormData` contendo arquivo `file` (`File`).

**Business Logic:**
1. `ctx = await getSessionContext()`.
2. Valida `file.type` ∈ `['image/png','image/jpeg','image/webp']`; caso contrário → `"Formato não suportado. Use PNG, JPG ou WEBP."`.
3. Valida `file.size <= 2 * 1024 * 1024`; caso contrário → `"Arquivo maior que 2MB."`.
4. Determina extensão a partir do mime; path = `${ctx.userId}/${Date.now()}.${ext}`.
5. `supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type })`.
6. `publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl`.
7. Retorna `ActionResponse<{ url: string }>`.
8. **Não** persiste em `profiles.avatar_url` — fluxo chama `updateProfileAction({ avatarUrl })` em seguida.

**Nota:** upload via Server Action com `FormData` é suportado nativamente no Next 15 (`'use server'` + `async function(formData: FormData)`).

---

### File: `src/lib/actions/organization.ts`

#### `getOrganizationAction`

**Business Logic:**
1. `ctx = await getSessionContext()`.
2. SELECT em `organizations` onde `id = ctx.organizationId`.
3. Retorna `ActionResponse<OrganizationRow>` com `{ id, name, slug, plan, max_users, settings, is_active, created_at }`.

#### `updateOrganizationAction`

**Input Schema:**
```typescript
const SLUG_REGEX = /^[a-z0-9](-?[a-z0-9])*$/;
const UpdateOrgSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório').max(100),
  slug: z.string().trim().min(3).max(40).regex(SLUG_REGEX, 'Use apenas minúsculas, números e hífens (sem hífens consecutivos).'),
  settings: z.record(z.string(), z.unknown()).optional(),
});
```

**Business Logic:**
1. `ctx = await getSessionContext()`; `assertRole(ctx, ['owner','admin'])`.
2. Valida Zod.
3. Merge `settings` (preservar chaves desconhecidas).
4. UPDATE em `organizations` onde `id = ctx.organizationId`. Campos: `name`, `slug`, `settings`. `plan` e `max_users` intocados.
5. Se erro Postgres `23505` em `slug` → retorna `"Slug já em uso. Tente um diferente."`.
6. `revalidatePath('/settings/organization')` + `revalidatePath('/', 'layout')`.
7. Retorna `ActionResponse<{ ok: true }>`.

---

### File: `src/lib/actions/invitations.ts`

#### `getTeamMembersAction`

1. `ctx = await getSessionContext()`.
2. SELECT `id, full_name, email, role, avatar_url, is_active, created_at` de `profiles` onde `organization_id = ctx.organizationId`. ORDER BY `created_at ASC`.
3. Retorna `ActionResponse<TeamMember[]>`.

#### `getPendingInvitationsAction`

1. `ctx = await getSessionContext()`; `assertRole(ctx, ['owner','admin'])`.
2. SELECT `id, email, role, token, invited_by, expires_at, created_at` de `invitations` onde `organization_id = ctx.organizationId` AND `accepted_at IS NULL`. Inclui **expirados** (UI os marca como expirados; permitir reenviar/revogar).
3. Enriquecer com `invited_by_name` via JOIN em `profiles`.
4. ORDER BY `created_at DESC`.

#### `createInvitationAction`

**Input Schema:**
```typescript
const CreateInviteSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase(),
  role: z.enum(['admin', 'member']),
});
```

**Business Logic:**
1. `ctx = await getSessionContext()`; `assertRole(ctx, ['owner','admin'])`.
2. Valida Zod.
3. Busca `profiles` na org com `email = input.email` (case-insensitive). Se existe → erro `"Este email já faz parte da sua organização."`.
4. Busca `invitations` pendente não expirada (`accepted_at IS NULL AND expires_at > now()`) com `email = input.email` e `organization_id = ctx.organizationId`. Se existe → erro `"Já existe convite pendente para este email. Reenvie ou revogue o anterior."`.
5. Calcula `max_users` gate: `count(profiles onde organization_id = ctx.org) + count(invitations pendentes não expiradas) >= organizations.max_users` → erro `"Limite de usuários (${max}) atingido para o plano atual."`.
6. INSERT em `invitations`: `organization_id = ctx.org`, `email`, `role`, `invited_by = ctx.userId`, `expires_at = now() + interval '7 days'`. `token` default (uuid).
7. `inviteUrl = ${process.env.NEXT_PUBLIC_SITE_URL}/accept-invite/${inserted.token}` — fallback para `headers().origin` se a env não estiver setada.
8. `revalidatePath('/settings/team')`.
9. Retorna `ActionResponse<{ token: string, inviteUrl: string }>`.

#### `revokeInvitationAction`

**Input:** `{ invitationId: z.string().uuid() }`.

**Business Logic:**
1. `ctx = await getSessionContext()`; `assertRole(['owner','admin'])`.
2. DELETE em `invitations` onde `id = input.invitationId AND organization_id = ctx.organizationId AND accepted_at IS NULL`.
3. Idempotente (sem match → retorna sucesso silencioso).
4. `revalidatePath('/settings/team')`.

#### `resendInvitationAction`

**Input:** `{ invitationId: z.string().uuid() }`.

**Business Logic:**
1. `ctx = await getSessionContext()`; `assertRole(['owner','admin'])`.
2. UPDATE `invitations` SET `token = gen_random_uuid()`, `expires_at = now() + '7 days'` WHERE `id = input.invitationId AND organization_id = ctx.organizationId AND accepted_at IS NULL`.
3. Se 0 linhas → erro `"Convite não encontrado ou já aceito."`.
4. `inviteUrl` gerado igual a `createInvitationAction`.
5. `revalidatePath('/settings/team')`.
6. Retorna `ActionResponse<{ inviteUrl: string }>`.

---

### Shared response type

Todas as actions retornam o `ActionResponse<T>` canônico de `docs/conventions/standards.md` § "ActionResponse<T>" (copia o interface local já usado em `auth.ts`).

---

## 4. External API Integration

**N/A nesta sprint.**

**Decisão arquitetural registrada:** nenhum provider de email transacional (Resend/SMTP) é integrado. `createInvitationAction` e `resendInvitationAction` retornam `inviteUrl` e a UI entrega com botão "Copiar link". O envio real por email fica para sprint dedicada. **Registrar esta decisão em `docs/APRENDIZADOS.md`** no closing (categoria `[DEPLOY]` ou `[SECURITY]`), caso relevante.

---

## 5. Componentes de UI

Todos os componentes são compostos a partir de `src/components/ui/` conforme `design_system/components/CONTRACT.md`. Tokens semânticos apenas.

### Component Tree

```
/settings/* (sub-layout)
├── SettingsLayout (Server) — sidebar secundário Profile · Organization · Team
│   ├── SettingsSidebar (Server) — esconde Organization/Team se role=member
│   └── Breadcrumb
├── /settings/profile
│   └── ProfilePage (Server) → ProfileForm (client)
│       ├── Input (ui) · Label (ui)
│       ├── AvatarUploader (client) — input file + preview + action
│       ├── Switch (ui, novo) — toggle emailNotifications
│       └── Button (ui)
├── /settings/organization
│   └── OrganizationPage (Server) → OrganizationForm (client) | RestrictedCard (Server, if role=member redirect+toast)
│       ├── Input (slug preview)
│       └── Button
└── /settings/team
    └── TeamPage (Server) → [Button "Convidar"] · TeamMembersList · PendingInvitationsList · InviteMemberDialog (client)
        ├── Dialog (ui, novo) — usa Radix Dialog
        ├── Badge (ui, novo) — role + status
        └── ConfirmDialog — reaproveita Dialog
```

**Novos primitivos de UI em `src/components/ui/`:**
- `dialog.tsx` — wrapper sobre `@radix-ui/react-dialog` (instalar dep).
- `badge.tsx` — `cva` com variantes (`role-owner`, `role-admin`, `role-member`, `status-pending`, `status-expired`).
- `switch.tsx` — wrapper sobre `@radix-ui/react-switch` (instalar dep).
- `avatar.tsx` — wrapper sobre `@radix-ui/react-avatar` (instalar dep).

**Deps a instalar:** `@radix-ui/react-dialog`, `@radix-ui/react-switch`, `@radix-ui/react-avatar`, `sonner` (toast) — se não presente.

### ProfileForm
**File:** `src/components/settings/ProfileForm.tsx`
**Props:** `{ profile: { fullName, phone, avatarUrl, preferences, email } }`.
**Behavior:** `react-hook-form + zodResolver`; `avatar` troca via `AvatarUploader` que chama `uploadAvatarAction` e atualiza estado local (URL temporária). Submit chama `updateProfileAction`. Toast `sonner` em sucesso; erro inline no topo.
**Semantic tokens:** `bg-surface-raised`, `text-text-primary`, `text-text-secondary`, `border-default`, `bg-action-primary`, `bg-feedback-danger-bg`.

### OrganizationForm
**File:** `src/components/settings/OrganizationForm.tsx`
**Props:** `{ organization: { name, slug, plan, max_users, settings } }`.
**Behavior:** slug com preview `app.com/org/{slug}`; `plan` e `max_users` renderizados como read-only (`<Input disabled>` + tooltip `"contate o suporte"`).

### TeamMembersList
**File:** `src/components/settings/TeamMembersList.tsx`
**Props:** `{ members: TeamMember[] }`.
**Render:** tabela (semantic HTML `<table>`, `text-text-*`, `border-default`). Colunas: avatar, nome, email, role (Badge), status (`is_active`), data de entrada.

### PendingInvitationsList
**File:** `src/components/settings/PendingInvitationsList.tsx`
**Props:** `{ invitations: PendingInvitation[] }`.
**Render:** tabela. Colunas: email, role (Badge), convidado por, expira em (`2d`, `expirado` — calcular no client com `Date.now()`), ações (Copiar link, Reenviar, Revogar). Cada ação é um `form` ou botão dispatching Server Action.

### InviteMemberDialog
**File:** `src/components/settings/InviteMemberDialog.tsx`
**Props:** `{ open, onOpenChange }`. Campos: email, role. Submit → `createInvitationAction`. Em sucesso, estado do Dialog muda para "link gerado": mostra `inviteUrl` em `<input readonly>` + botão "Copiar" + subtítulo "copie e envie manualmente ao convidado".

### AvatarUploader
**File:** `src/components/settings/AvatarUploader.tsx`
**Props:** `{ value: string | null, onChange: (url: string | null) => void }`.
**Behavior:** `<input type="file" accept="image/png,image/jpeg,image/webp">`; valida tamanho/mime no client (UX) e dispara `uploadAvatarAction` via `FormData`; mostra preview com `<Avatar>`.

### Ajustes no layout `(app)`

- `src/components/layout/Sidebar.tsx`: adicionar item "Configurações" → `/settings/profile` (ícone `Settings` do Lucide).
- `src/components/layout/Topbar.tsx`: no dropdown do usuário, adicionar item "Minha conta" → `/settings/profile`.

**Semantic tokens (recap):** `bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`, `border-default`. Zero hex, zero `bg-blue-500`, zero `p-[17px]`.

---

## 6. Edge Cases

### Profile
- [ ] **Avatar > 2MB ou mime inválido** → erro inline, upload não dispara.
- [ ] **Upload falha no meio** → `profiles.avatar_url` não muda; erro `"não foi possível atualizar o avatar, tente novamente"`.
- [ ] **Phone vazio** → salvar como `null`, não string vazia.
- [ ] **Preferences malformadas** — Zod valida shape conhecido; chaves desconhecidas são preservadas (merge).

### Organization
- [ ] **Slug duplicado** → erro por campo (não form inteiro).
- [ ] **Slug inválido** (acentos, espaços, hífen consecutivo) → Zod regex bloqueia.
- [ ] **Dois admins editando simultaneamente** → last-write-wins; revalidate após sucesso.
- [ ] **Member força URL `/settings/organization`** → Server Component detecta `role === 'member'` e redireciona com toast `"Acesso restrito a administradores"`.

### Team / Invitations
- [ ] **Convite para email que já é membro** → `"Este email já faz parte da sua organização."`.
- [ ] **Convite para email com pending válido** → `"Já existe convite pendente; reenvie ou revogue."`.
- [ ] **Convite quando `max_users` atingido** → `"Limite de usuários (${max}) atingido para o plano atual."`.
- [ ] **Revogar convite já aceito** → bloqueado pela condição `accepted_at IS NULL`; retorna sucesso silencioso (idempotente).
- [ ] **Reenviar convite expirado** → permitido; regenera `token` + `expires_at`. Link antigo deixa de funcionar em `/accept-invite` (o backend do Sprint 03 valida `token`).
- [ ] **Convite expirado listado** → Badge `expirado`, ações Reenviar/Revogar disponíveis.

### Auth / RLS
- [ ] **Usuário org A tenta ler `organizations.id` da org B via id forjado** → RLS SELECT bloqueia; `getOrganizationAction` retorna erro genérico.
- [ ] **Sessão expira durante form** → middleware do Sprint 03 intercepta no próximo request; toast `"Sessão expirada, faça login novamente"`.

### Network / Environment
- [ ] **Server Action falha por timeout ou 5xx durante submit** (qualquer form de settings) → `catch` devolve `ActionResponse { success: false, error: "Erro de conexão, tente novamente" }`; UI exibe toast e **preserva os valores digitados no form** (não faz reset nem navega).
- [ ] **Clipboard API indisponível** (contexto http inseguro ou browser antigo) no botão "Copiar link" do `InviteMemberDialog` → detectar `!navigator.clipboard` e fazer fallback: focar e selecionar o `<input readonly>` com a URL + toast `"Copie o link manualmente"`. Nunca lançar exceção não tratada.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] DB probe executada; resultado documentado em comentário de migration ou em APRENDIZADOS se surpresa.
- [ ] (Se migration rodou) Migration idempotente e aplicada sem erro.
- [ ] Policies RLS em `profiles`, `organizations`, `invitations` validadas via query de teste (user org A não SELECT/UPDATE registros de org B).
- [ ] Bucket `avatars` existe; policies ativas.

### Backend
- [ ] Todas as actions começam com `const ctx = await getSessionContext()`.
- [ ] Actions de `organization.ts` e `invitations.ts` usam `assertRole(['owner','admin'])`.
- [ ] Input validado com Zod; erros usam `.issues[0].message`.
- [ ] Retorno sempre `ActionResponse<T>`; errors logados no servidor e mensagem amigável no campo `error`.
- [ ] `revalidatePath` chamado após toda mutação.

### Frontend
- [ ] **O código passa em todas as checagens do `agents/quality/guardian.md` § 1a (regras automáticas) e § 1b (correção semântica).** A fonte normativa vive em `design_system/enforcement/rules.md` e `design_system/components/CONTRACT.md`. Este é o único gate frontend deste PRD.
- [ ] Componentes verificados com `data-theme="dark"` togglado no `<html>`.
- [ ] Todos os formulários têm estado de loading, erro e feedback de sucesso.
- [ ] Sidebar do `(app)` mostra item "Configurações".
- [ ] Topbar tem link "Minha conta" no dropdown do usuário.

### Fluxo ponta-a-ponta
- [ ] Usuário edita nome/telefone/avatar em `/settings/profile`; Topbar atualiza após reload.
- [ ] Owner/admin edita nome e slug; erro em slug duplicado.
- [ ] Member redirecionado de `/settings/organization` para `/settings/profile` com toast.
- [ ] Criar convite retorna `inviteUrl`; fluxo de aceitar via `/accept-invite/[token]` do Sprint 03 finaliza signup.
- [ ] Revogar remove linha do DB e da UI.
- [ ] Reenviar regenera token; link antigo deixa de funcionar.
- [ ] Convite duplicado, max_users atingido → erros claros.

### Gates do framework
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `node scripts/verify-design.mjs --changed` sai com 0 violações.
- [ ] `@guardian` aprova.

### Testing (on-demand only)
> Skip — QA agent não invocado nesta sprint.

---

## 8. Implementation Plan

### Phase 1: DB Admin (probe + migrations opcionais)
1. Rodar introspecção ao vivo: confirmar `profiles`, `organizations`, `invitations` batendo com snapshot + `pg_policies` por tabela.
2. Confirmar existência do bucket `avatars` via `storage.buckets`.
3. Gerar migrations apenas se ausência detectada.
4. `supabase db push --dry-run` → `supabase db push` → re-rodar `node scripts/introspect-schema.mjs`.

**Estimated Time:** 10 min.

### Phase 2: Backend
1. Criar `src/lib/actions/_shared/assertRole.ts` (+ re-exportar tipo `ActionResponse`).
2. Implementar `src/lib/actions/profile.ts` (update + uploadAvatar).
3. Implementar `src/lib/actions/organization.ts` (get + update).
4. Implementar `src/lib/actions/invitations.ts` (5 actions).
5. Testes manuais via Server Component probe.

**Estimated Time:** 25 min.

### Phase 3: Frontend
1. Instalar deps Radix Dialog/Switch/Avatar (+ sonner se ausente).
2. Criar primitivos em `src/components/ui/` (dialog, badge, switch, avatar) seguindo CONTRACT.
3. Criar `src/app/(app)/settings/layout.tsx` + `SettingsSidebar`.
4. Criar 3 rotas (`profile`, `organization`, `team`) como Server Components.
5. Criar componentes de domínio em `src/components/settings/`.
6. Ajustar `Sidebar.tsx` + `Topbar.tsx`.

**Estimated Time:** 40 min.

### Phase 4: Review (@guardian)
Rodar § 1a + § 1b + verify-design estático.

**Estimated Time:** 5 min.

### Phase 5: Testing
Skip (on-demand).

**Total Estimated Time:** ~80 min.

---

## 9. Risks & Mitigations

### Risk 1: Primitivos de UI ainda não existem (`dialog`, `badge`, `switch`, `avatar`).
**Impact:** Medium (atrasa frontend).
**Probability:** High (confirmado: só existem `alert`, `button`, `card`, `input`, `label`, `tabs` em `src/components/ui/`).
**Mitigation:** criar cada primitivo inline no início da Phase 3, seguindo CONTRACT. Contam como investimento reaproveitado por sprints futuras.

### Risk 2: Bucket `avatars` não existe e criação via SQL falha (permissões Supabase).
**Impact:** High (upload quebra).
**Probability:** Low.
**Mitigation:** se migration falhar, @db-admin orienta criação manual no painel Supabase; Tech Lead registra em APRENDIZADOS; continua sprint com o bucket já disponível.

### Risk 3: `max_users` gate com contagem eventual inconsistente (criar + aceitar em paralelo pode ultrapassar).
**Impact:** Low.
**Probability:** Low (1 org, poucos admins).
**Mitigation:** aceita. Documentado como "best effort" — não é um invariante de segurança, e a revogação de convite cobre overflow.

### Risk 4: `createClient` (server, anon) + RLS não aceita UPDATE em `organizations` mesmo para admin.
**Impact:** Medium.
**Probability:** Medium (policy depende de subquery em `profiles`).
**Mitigation:** se RLS bloquear, @backend usa `createServiceClient` após `assertRole` já ter validado. Isso é o padrão herdado de `auth.ts`. Documentar em APRENDIZADOS se precisar.

---

## 10. Dependencies

### Internal
- [x] Sprint 03 entregou `getSessionContext`, middleware de auth, `/accept-invite/[token]`.
- [x] `auth.ts` estabelece padrão de `ActionResponse<T>` e tratamento de Supabase error codes.
- [x] Snapshot de schema (`docs/schema_snapshot.json`) confirmado em 2026-04-15.

### External
- [ ] `NEXT_PUBLIC_SITE_URL` definido no env (fallback: `headers().origin`).
- [ ] Radix deps instaladas (`@radix-ui/react-dialog`, `@radix-ui/react-switch`, `@radix-ui/react-avatar`).
- [ ] Sonner ou equivalente para toast.

---

## 11. Rollback Plan

1. **Código:** `git revert <sha>` do commit do sprint 04.
2. **Migration de policies:** safe de rollback — nova migration `DROP POLICY IF EXISTS` + recria policies anteriores (se necessário). O @db-admin gera migration reversa on-demand.
3. **Bucket `avatars`:** pode ficar criado sem prejuízo; não há rollback obrigatório.
4. **Cache:** `revalidatePath('/', 'layout')` manualmente após revert.
5. **Monitoring:** checar logs do servidor Next por erros `[profile:...]`, `[organization:...]`, `[invitations:...]`.

---

## Approval

**Created by:** @spec-writer (Sprint 04)
**Reviewed by:** _pending @sanity-checker_
**Approved by:** _pending usuário_
**Date:** 2026-04-15
