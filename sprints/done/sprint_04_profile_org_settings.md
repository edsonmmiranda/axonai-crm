# Sprint 04: Profile & Org Settings (STANDARD)

> **Nível:** STANDARD
> **Depende de:** [sprint_03_auth_tenancy](../done/sprint_03_auth_tenancy.md) — `getSessionContext()` e middleware de auth já existem.
> **Referência no roadmap:** [`docs/roadmap.md`](../../docs/roadmap.md) § Sprint 04.

---

## 🎯 Objetivo de Negócio

Fechar o bloco de autenticação/tenancy iniciado no Sprint 03. Depois deste sprint, o usuário autenticado consegue: (a) gerenciar o próprio perfil (nome, avatar, telefone, preferências), (b) — se for `owner`/`admin` — gerenciar a organização (nome, slug, `max_users`, `settings`), e (c) — se for `owner`/`admin` — convidar, revogar e reenviar convites para novos membros.

Critério binário de sucesso: toda linha editável das tabelas `profiles` e `organizations` existe na UI, e o fluxo de convite ponta-a-ponta (admin gera → convidado aceita via `/accept-invite/[token]` criado no Sprint 03) funciona sem passos manuais fora do app.

## 👤 User Stories

- Como **usuário autenticado**, quero editar meu nome, avatar, telefone e preferências em `/settings/profile`, para manter meu cadastro atualizado.
- Como **owner/admin**, quero editar o nome e o slug da organização em `/settings/organization`, para refletir mudanças da empresa no app.
- Como **owner/admin**, quero ver em `/settings/team` todos os membros da minha org e convites pendentes, para ter visão de quem tem acesso.
- Como **owner/admin**, quero criar um convite informando email + role e receber um link copiável, para adicionar um novo membro sem precisar de acesso ao Supabase.
- Como **owner/admin**, quero revogar ou reenviar um convite pendente, para lidar com erros de digitação ou emails perdidos.
- Como **member**, quero que `/settings/organization` e `/settings/team` sejam invisíveis/bloqueados, para não ver (nem tentar editar) configurações que não são minhas.

## 🎨 Referências Visuais

- **Layout:** `/settings/*` usa o layout `(app)` existente. Cria um sub-layout `src/app/(app)/settings/layout.tsx` com navegação lateral secundária (Profile · Organization · Team) — padrão "settings tabs" comum a apps SaaS.
- **Design system:** composição a partir de `src/components/ui/` conforme [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). Tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Zero hex, zero `bg-blue-500`, zero `p-[17px]`.
- **Componentes:** `Input`, `Button`, `Label`, `Card`, `Avatar`, `Badge` (roles), `Dialog` (confirmar revogação de convite), `Tabs` ou links de navegação lateral. Upload de avatar via input file + preview.
- **Gold Standard:** shell do `(app)` layout ([sprint_02_dashboard_mock](../done/sprint_02_dashboard_mock.md)) como base estrutural. Auth forms do Sprint 03 como referência de composição de formulários (`react-hook-form + zodResolver`).

## 🧬 Reference Module Compliance

Este é o primeiro sprint a introduzir **CRUDs de settings**. As convenções fixadas aqui viram referência para Sprints 05+ (Categories, Lead Settings, WhatsApp Groups, etc.). O `@backend` deve deixar explícito:

- **Location:** actions em `src/lib/actions/profile.ts`, `src/lib/actions/organization.ts`, `src/lib/actions/invitations.ts` (um arquivo por entidade).
- **Contrato:** todas as actions começam com `const ctx = await getSessionContext()` — zero duplicação de sessão.
- **Naming:** `updateProfileAction`, `updateOrganizationAction`, `createInvitationAction`, `revokeInvitationAction`, `resendInvitationAction`, `getTeamMembersAction`, `getPendingInvitationsAction`.
- **Response:** todas retornam `ActionResponse<T>` (padrão herdado de `src/lib/actions/auth.ts` do Sprint 03).
- **Authorization:** helper `assertRole(ctx, ['owner','admin'])` centralizado — usado em todas as actions de org e invitations. Member tentando chamar retorna `ActionResponse.error('forbidden')`.

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **DB probe antes de qualquer migration (`@db-admin`):**
  - Confirmar que `profiles`, `organizations`, `invitations` estão no estado esperado (colunas batem com o snapshot de 2026-04-15).
  - Confirmar existência do bucket Storage `avatars` — público para leitura, com policy de INSERT/UPDATE restrita a `auth.uid() = owner`. Se não existir, criar via migration SQL (`storage.create_bucket`) ou instruir criação manual no painel Supabase e registrar em `APRENDIZADOS.md`.
  - Confirmar RLS nas 3 tabelas: `profiles` (SELECT/UPDATE onde `organization_id = ctx.org`), `organizations` (SELECT todos membros, UPDATE só owner/admin), `invitations` (SELECT/INSERT/DELETE só owner/admin da org). Se políticas não existirem ou estiverem incompletas, criar migration.

- [ ] **Migrations (se DB probe indicar necessidade):**
  - `NNNN_settings_rls.sql` — garante policies acima, idempotente (`DROP POLICY IF EXISTS` antes de `CREATE POLICY`).
  - `NNNN_avatars_bucket.sql` — cria bucket `avatars` + policies, se aplicável.
  - Após migration, re-rodar `node scripts/introspect-schema.mjs`.

- [ ] **Server Actions (`src/lib/actions/profile.ts`):**
  - `updateProfileAction({ fullName, phone?, avatarUrl?, preferences? })` — Zod schema, atualiza `profiles` onde `id = ctx.userId`. `revalidatePath('/settings/profile')` e `revalidatePath('/', 'layout')` pra refletir no Topbar.
  - `uploadAvatarAction(formData)` — recebe File, valida mime (`image/png|jpeg|webp`) e tamanho (≤ 2MB), upload pro bucket `avatars/{userId}/{timestamp}.{ext}`, retorna `{ url }`. A persistência em `profiles.avatar_url` fica por conta de `updateProfileAction`.

- [ ] **Server Actions (`src/lib/actions/organization.ts`):**
  - `getOrganizationAction()` — retorna organização do ctx (read).
  - `updateOrganizationAction({ name, slug, settings? })` — Zod, checa `assertRole(['owner','admin'])`, atualiza `organizations` onde `id = ctx.organizationId`. Slug validado como `kebab-case`, UNIQUE tratado no erro. `max_users` e `plan` são read-only nesta sprint.

- [ ] **Server Actions (`src/lib/actions/invitations.ts`):**
  - `getTeamMembersAction()` — retorna `profiles` da org (filtra por `organization_id = ctx.org`).
  - `getPendingInvitationsAction()` — retorna `invitations` onde `accepted_at IS NULL AND expires_at > now()`.
  - `createInvitationAction({ email, role })` — `assertRole(['owner','admin'])`, valida email + role ∈ {`admin`,`member`}, impede duplicata (mesma org + mesmo email + não aceito/não expirado), grava `invited_by = ctx.userId`, `expires_at = now() + 7 days`. Retorna `{ token, inviteUrl }` onde `inviteUrl` é `${NEXT_PUBLIC_SITE_URL}/accept-invite/${token}`.
  - `revokeInvitationAction({ invitationId })` — `assertRole(['owner','admin'])`, DELETE na linha (só se pertence à org do ctx). Idempotente.
  - `resendInvitationAction({ invitationId })` — regenera `token` e reseta `expires_at = now() + 7 days`. Retorna novo `inviteUrl`.

- [ ] **Decisão arquitetural (email provider):**
  - **Escolha desta sprint:** **não integrar provider transacional ainda**. `createInvitationAction` / `resendInvitationAction` retornam o `inviteUrl` e a UI exibe com botão "Copiar link". O envio real por email fica para uma sprint dedicada (recomendado Sprint 13 ou antes, se demanda emergir). Registrar essa decisão em [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md).
  - Rationale: evita introduzir dependência externa (Resend, SMTP) num sprint cujo coração é CRUD de settings; mantém escopo fechado e entregável.

### Frontend

- [ ] **Sub-layout `src/app/(app)/settings/layout.tsx`:**
  - Navegação lateral secundária com 3 links: Profile (todos), Organization (owner/admin), Team (owner/admin).
  - Server Component que consulta `getSessionContext()` e esconde Organization/Team se `role === 'member'`.
  - Breadcrumb "Configurações / [subpágina]".

- [ ] **Rotas novas:**
  - `src/app/(app)/settings/profile/page.tsx` — Server Component que busca `profiles` do ctx + renderiza `ProfileForm`.
  - `src/app/(app)/settings/organization/page.tsx` — Server Component, chama `getOrganizationAction`, renderiza `OrganizationForm`. Retorna 403 visual (Card com mensagem) se `member`.
  - `src/app/(app)/settings/team/page.tsx` — Server Component, chama `getTeamMembersAction` + `getPendingInvitationsAction`, renderiza `TeamMembersList` + `PendingInvitationsList` + botão "Convidar membro" que abre `InviteMemberDialog`. 403 visual se `member`.

- [ ] **Componentes (`src/components/settings/`):**
  - `ProfileForm` — `react-hook-form + zodResolver`. Campos: full_name (obrigatório), phone (opcional, máscara BR), avatar (upload + preview), preferences (por ora só um toggle "notificações por email" guardado em `preferences.emailNotifications`). Submit chama `uploadAvatarAction` → `updateProfileAction`.
  - `OrganizationForm` — Zod com slug `kebab-case`. Campos: name, slug (com preview "url: app.com/org/{slug}"), `max_users` e `plan` renderizados como read-only com tooltip "contate o suporte".
  - `TeamMembersList` — tabela: avatar, nome, email, role (Badge), status (is_active), data de entrada. Sem ações nesta sprint (edição de role/desativação fica pra futura).
  - `PendingInvitationsList` — tabela: email, role, invited_by, expires_at (com badge "expira em 3d"), ações: **Copiar link**, Reenviar, Revogar (Dialog de confirmação).
  - `InviteMemberDialog` — form com email + role select, submit chama `createInvitationAction`, sucesso exibe o `inviteUrl` com botão "Copiar" + mensagem "copie o link e envie manualmente ao convidado".
  - Estados: loading no submit, erro inline, toast de sucesso (`sonner` ou equivalente já em uso).

- [ ] **Ajustes no Topbar/Sidebar `(app)`:**
  - Sidebar ganha item "Configurações" com ícone de engrenagem apontando pra `/settings/profile`.
  - Dropdown de usuário no Topbar ganha item "Minha conta" → `/settings/profile`.

- [ ] **Navegação:**
  - Adicionar "Configurações" ao menu lateral principal.
  - Rotas sob `/settings/organization` e `/settings/team` redirecionam `member` pra `/settings/profile` com toast "Acesso restrito a administradores".

## 🧪 Edge Cases

- [ ] **Avatar > 2MB ou mime inválido** — erro inline no form, upload não é disparado.
- [ ] **Avatar upload falha no meio** — `profiles.avatar_url` não muda; mensagem "não foi possível atualizar o avatar, tente novamente".
- [ ] **Slug duplicado** — erro no campo (não no form inteiro), sugestão "já existe, tente `{slug}-2`".
- [ ] **Convite para email já membro da org** — bloqueia com "este email já faz parte da sua organização".
- [ ] **Convite para email com convite pendente válido** — bloqueia com "já existe convite pendente; reenvie ou revogue o anterior".
- [ ] **Convite expirado listado em Team** — aparece com Badge "expirado" e ação "Reenviar" (que regenera token + expires_at). Revogar também disponível.
- [ ] **Member acessa `/settings/organization` digitando URL** — middleware não bloqueia (é `(app)`), mas o Server Component detecta `role === 'member'` e redireciona.
- [ ] **Owner tenta revogar próprio acesso** — não aplicável (owner edita org, não se auto-convida); deixar claro que remover membro não faz parte desta sprint.
- [ ] **Preferences malformadas** (jsonb corrompido) — Zod valida shape conhecido; campos desconhecidos são preservados (merge).
- [ ] **Slug com caracteres inválidos** (acentos, espaços) — Zod com regex `/^[a-z0-9](-?[a-z0-9])*$/`.
- [ ] **Dois admins editando a org simultaneamente** — last-write-wins; após sucesso, Server Component revalida. Sem optimistic locking nesta sprint.
- [ ] **`max_users` atingido** — `createInvitationAction` bloqueia novos convites quando `count(profiles) + count(invitations pendentes) >= organizations.max_users`, com mensagem clara.

## 🚫 Fora de escopo

- **Troca de email/senha do próprio usuário** — fluxos de Supabase Auth (`/auth/update-email`, `/auth/reset-password`) ficam para sprint futura.
- **Envio real de email de convite** — esta sprint entrega link copiável apenas. Integração com Resend/SMTP é sprint dedicada.
- **Edição de role ou desativação de membro** — `TeamMembersList` mostra mas não edita. Fica para sprint futura (provavelmente junto com audit log).
- **Remover membro da org** — idem acima.
- **Multi-org por usuário / troca de org** — mantém premissa do Sprint 03: um `profiles` = uma `organization_id`.
- **Upgrade de `plan`** — read-only; billing fica fora.
- **Configurações avançadas em `organizations.settings` jsonb** — esta sprint não define UI para settings avançadas; só expõe `name`, `slug` e um toggle simples se necessário.
- **Audit log** de quem mudou o quê — fora (roadmap marca como pós-MVP).
- **Criação de usuário diretamente por admin sem convite** — não; fluxo é sempre via convite + signup.

## ⚠️ Critérios de Aceite

- [ ] Usuário autenticado acessa `/settings/profile`, edita nome + telefone, faz upload de avatar, e vê a mudança refletida no Topbar após reload.
- [ ] Owner/admin acessa `/settings/organization`, edita nome e slug válido, vê sucesso; tenta slug duplicado e vê erro por campo.
- [ ] Member acessa `/settings/organization` e é redirecionado para `/settings/profile` com toast de bloqueio.
- [ ] Owner/admin acessa `/settings/team`, vê membros e convites pendentes separados.
- [ ] Criar convite retorna `inviteUrl` copiável; abrir o link em aba anônima cai no `/accept-invite/[token]` do Sprint 03 e finaliza o fluxo.
- [ ] Revogar convite pendente remove a linha do DB e da UI.
- [ ] Reenviar convite regenera token + expires_at; o link antigo deixa de funcionar no `/accept-invite`.
- [ ] Tentar criar convite duplicado (mesmo email já pendente) é bloqueado com mensagem acionável.
- [ ] Tentar criar convite quando a org atingiu `max_users` é bloqueado com mensagem explícita.
- [ ] RLS: usuário da org A não vê nem consegue editar `profiles`/`organizations`/`invitations` da org B, mesmo forjando id.
- [ ] Todos os edge cases acima tratados.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único de design system ([`agents/quality/guardian.md`](../../agents/quality/guardian.md)).

---

## 🧭 Notas para o Tech Lead

Sprint STANDARD — segue **Workflow A (Sprint Execution)** completo:

1. **Preflight** — checklist do roadmap § Pré-sprint: `git status` limpo, credenciais Supabase em `.env.local`, snapshot fresco (re-rodar `node scripts/introspect-schema.mjs` já que a sprint pode tocar em RLS/Storage), leituras de boot.
2. `@spec-writer` gera PRD em `docs/prds/sprint_04_profile_org_settings.md`.
3. `@sanity-checker` valida PRD (atenção especial: authorization por role, cálculo de `max_users`, política de bucket Storage para avatares, decisão de não enviar email nesta sprint).
4. **STOP & WAIT** pela aprovação do usuário.
5. Execução: `@db-admin` (probe + migrations de RLS/bucket, se necessárias) → `@backend` (actions de profile, organization, invitations + `assertRole` helper) → `@frontend` (sub-layout + 3 páginas + componentes + ajuste do menu) → `@guardian`.
6. Design verification manual — profile happy path + upload de avatar, org edit + slug duplicado, team list + criar/revogar/reenviar convite, bloqueio de member em rotas restritas.
7. Closing: atualizar snapshot se migration rodou; registrar em `APRENDIZADOS.md` a decisão de não integrar email provider nesta sprint e qualquer surpresa sobre RLS/Storage.
8. `@git-master` para commit.
