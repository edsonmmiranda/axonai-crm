# Sprint 03: Auth & Tenancy (STANDARD)

> **Nível:** STANDARD
> **Bloqueia:** todos os sprints seguintes (05–13 dependem de sessão autenticada + `organization_id` disponível em Server Actions).
> **Referência no roadmap:** [`docs/roadmap.md`](../../docs/roadmap.md) § Sprint 03.

---

## 🎯 Objetivo de Negócio

Hoje o app tem dashboard mockado e zero auth. Nenhum módulo de negócio pode ser construído enquanto não existe (a) login real contra `auth.users`, (b) proteção das rotas `(app)/*`, e (c) um helper canônico que entrega `{ userId, organizationId, role }` para toda Server Action — sem isso não há como aplicar RLS multi-tenant por `organization_id`.

O sucesso deste sprint é medido por um critério binário: **qualquer Server Action futura consegue obter `organizationId` confiável sem duplicar código de sessão**, e nenhuma rota de produto é acessível sem sessão válida.

## 👤 User Stories

- Como **usuário existente**, quero logar com email+password ou magic-link, para acessar o CRM sem precisar criar conta nova.
- Como **novo usuário sem convite**, quero fazer signup informando nome + slug da minha organização, para criar minha conta junto com uma org nova da qual sou owner.
- Como **usuário convidado**, quero abrir o link de convite (`/accept-invite/[token]`) e definir senha, para entrar direto na organização de quem me convidou — sem criar org nova.
- Como **visitante sem sessão**, quero ser redirecionado a `/login` ao tentar abrir `/dashboard`, para não ver nada protegido.
- Como **dev** construindo os próximos módulos, quero um único `getSessionContext()` Server-side, para não replicar lógica de `organization_id`/`role` em cada action.

## 🎨 Referências Visuais

- **Layout:** telas de auth seguem o design system vigente. Rota `(auth)/*` usa layout próprio (sem Sidebar/Topbar), centralizado, respirando.
- **Design system:** composição a partir de `src/components/ui/` seguindo [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). Tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Zero hex literal, zero `bg-blue-500`, zero `p-[17px]`.
- **Componentes:** `Input`, `Button`, `Label`, `Card`, `Alert`/feedback inline — compostos dos primitivos existentes.
- **Gold Standard:** ainda não há módulo de auth anterior. O shell do `(app)` layout de [sprint_02_dashboard_mock](../done/sprint_02_dashboard_mock.md) é a referência estrutural para páginas autenticadas.

## 🧬 Reference Module Compliance

Não há módulo de auth prévio para copiar. O `@backend` deve, no entanto, deixar `src/lib/supabase/getSessionContext.ts` suficientemente idiomático para virar a **referência** que todos os CRUDs futuros (Sprint 05+) vão consumir. Padrões que precisam ser fixados aqui:

- Retorno tipado `SessionContext = { userId: string; organizationId: string; role: 'owner' | 'admin' | 'member' }` — sem `null` no happy path (função lança/redireciona se não houver sessão).
- Chamada única dentro de Server Action: `const ctx = await getSessionContext()`.
- Convenção de erro: se `profiles` do user não tiver `organization_id`, é inconsistência — loga + redireciona pra `/login` (não retorna `ActionResponse.error`).

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **DB probe antes de qualquer migration (`@db-admin`):**
  - Introspecção ao vivo do schema `auth` + `public` para confirmar: existe trigger `on_auth_user_created` ligando `auth.users` → `public.profiles`? Está funcional?
  - Listar colunas atuais de `profiles` e `organizations` (snapshot em `docs/schema_snapshot.json` pode estar defasado).
  - Confirmar se `organizations.slug` já tem UNIQUE.
  - Confirmar se `profiles.organization_id` é FK + NOT NULL.
  - Registrar achados em [`docs/APRENDIZADOS.md`](../../docs/APRENDIZADOS.md) **apenas se** houver surpresa.

- [ ] **Migration (se DB probe indicar ausência):**
  - Criar função + trigger `on_auth_user_created` que, ao inserir em `auth.users`, provisiona linha em `public.profiles` com `id = auth.users.id`, `email`, `full_name` vindo de `raw_user_meta_data`, e `organization_id = NULL` (preenchido no callback de signup, ver Server Actions abaixo).
  - Migration **idempotente** (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`).
  - Localização: `supabase/migrations/NNNN_auth_user_provisioning.sql`.

- [ ] **Server Actions (`src/lib/actions/auth.ts`):**
  - `signupWithOrgAction({ email, password, fullName, orgName, orgSlug })` — cria `auth.users` via `supabase.auth.signUp`, cria `organizations`, atualiza `profiles.organization_id + role='owner' + full_name`. Validação Zod. Retorna `ActionResponse<{ userId, organizationId }>`.
  - `signupWithInviteAction({ email, password, fullName, inviteToken })` — valida token em `invitations` (existe, não expirado, não consumido), cria `auth.users`, atualiza `profiles.organization_id = invite.organization_id + role = invite.role`, marca `invitations.accepted_at`. Validação Zod.
  - `loginWithPasswordAction({ email, password })` — wrapper tipado sobre `supabase.auth.signInWithPassword`.
  - `sendMagicLinkAction({ email })` — wrapper sobre `supabase.auth.signInWithOtp` com `emailRedirectTo` apontando para `/auth/callback`.
  - `logoutAction()` — `supabase.auth.signOut` + redirect.

- [ ] **Session helper (`src/lib/supabase/getSessionContext.ts`):**
  - Server-only. Lê sessão via `createServerClient` + busca `profiles` do usuário pra obter `organization_id + role`.
  - Retorno tipado; redireciona para `/login` se não houver sessão ou `profiles.organization_id` for null.
  - Zero duplicação — é o ponto único de verdade de contexto.

- [ ] **Middleware (`middleware.ts`):**
  - Estender o refresh atual. Após `getUser()`, se não há sessão **e** a rota começa com `/dashboard` (ou grupo `(app)`), redirecionar pra `/login?redirectTo=<path>`.
  - Rotas `(auth)/*`, `/auth/callback` e assets nunca redirecionam.

- [ ] **OAuth/magic-link callback (`src/app/auth/callback/route.ts`):**
  - Route handler GET que recebe `code` ou token, chama `supabase.auth.exchangeCodeForSession`, e redireciona para `redirectTo` ou `/dashboard`.

### Frontend

- [ ] **Rotas novas:**
  - `src/app/(auth)/layout.tsx` — layout enxuto (sem Sidebar/Topbar), centralizado.
  - `src/app/(auth)/login/page.tsx` — dois modos na mesma tela: tab/toggle "Senha" vs "Magic Link". Form de senha chama `loginWithPasswordAction`; magic-link chama `sendMagicLinkAction` e mostra feedback "cheque seu email".
  - `src/app/(auth)/signup/page.tsx` — email + password + nome + nome-da-org + slug-da-org (slug auto-sugerido a partir do nome da org, editável). Chama `signupWithOrgAction`.
  - `src/app/(auth)/accept-invite/[token]/page.tsx` — Server Component que pré-valida o token e renderiza form de finalização (senha + nome). Submissão chama `signupWithInviteAction`. Se token inválido/expirado/consumido, renderiza erro legível sem expor detalhes.

- [ ] **Componentes (`src/components/auth/`):**
  - `LoginForm` — controlado via `react-hook-form + zodResolver`, dois submit handlers (password / magic-link).
  - `SignupForm` — idem, com slug auto-gerado.
  - `AcceptInviteForm` — recebe `inviteToken` + dados pré-populados do convite.
  - `AuthCard` — wrapper visual (título + subtítulo + children + rodapé com link alternativo).
  - Estados: loading no submit, erro inline no topo, sucesso (magic-link enviado).

- [ ] **Layout `(app)` — ajuste:**
  - `src/app/(app)/layout.tsx` (ou equivalente atual) passa a chamar `getSessionContext()` e injetar `{ fullName, avatarUrl, organizationName }` no Topbar/Sidebar, substituindo qualquer valor hardcoded/mock remanescente.
  - Menu de usuário no Topbar ganha item "Sair" que dispara `logoutAction`.

- [ ] **Navegação:**
  - `/login`, `/signup`, `/accept-invite/[token]` não aparecem no menu — são rotas públicas.
  - Sem alteração no Sidebar do `(app)` nesta sprint.

## 🧪 Edge Cases

- [ ] **Login com credenciais inválidas** — mensagem genérica ("email ou senha inválidos"), não vaza existência de conta.
- [ ] **Magic-link para email inexistente** — Supabase não revela; UI mostra sempre o mesmo "cheque seu email".
- [ ] **Signup com slug de org já existente** — Zod + constraint UNIQUE; erro no campo, não na action inteira.
- [ ] **Signup com email já registrado em `auth.users`** — erro legível apontando pra login/recuperação.
- [ ] **Accept-invite com token inexistente, expirado, ou já consumido** — três mensagens distintas e acionáveis.
- [ ] **Accept-invite onde o email do convite difere do email digitado** — bloquear ou forçar o email do convite (decisão: forçar — o campo vem pré-preenchido readonly).
- [ ] **Sessão expira enquanto user navega `(app)`** — middleware pega no próximo request e redireciona pra `/login?redirectTo=<path>`.
- [ ] **`profiles.organization_id = NULL`** (ex.: trigger rodou mas signup falhou entre criar user e org) — `getSessionContext` detecta e força logout + mensagem "conta inconsistente, contate suporte".
- [ ] **OAuth callback com `code` inválido** — redirect pra `/login` com flag de erro.
- [ ] **Dois tabs fazendo login simultâneo** — Supabase cookie é idempotente; última sessão ganha.
- [ ] **Tentativa de acessar `/auth/callback` diretamente sem params** — redirect pra `/login`.

## 🚫 Fora de escopo

- **CRUD de `profiles`** (editar nome/avatar/telefone) → Sprint 04.
- **CRUD de `organizations`** (editar nome/slug/plan) → Sprint 04.
- **Criação e envio de convites** (gerar token, mandar email) → Sprint 04. Este sprint **apenas consome** convites já existentes no DB.
- **Escolha de provider de email transacional** (Resend etc.) → Sprint 04. Magic-link usa o provider nativo do Supabase Auth por padrão.
- **Recuperação de senha** (`/forgot-password`) — não pedido; fica para sprint futura.
- **OAuth Google/GitHub** — fora. Só email+password e magic-link.
- **Roles além de `owner/admin/member`** — não expandir o enum nesta sprint.
- **Multi-org por usuário** — um `profiles` tem um `organization_id`. Troca de org não existe ainda.

## ⚠️ Critérios de Aceite

- [ ] Logar com usuário já existente em `auth.users` via **senha** funciona e persiste a sessão.
- [ ] Solicitar magic-link envia email e, ao clicar, `/auth/callback` troca o code e cai em `/dashboard`.
- [ ] Signup sem convite cria `auth.users` + `organizations` + preenche `profiles` (org_id, role='owner', full_name) atomicamente — se um passo falhar, nenhum resíduo fica.
- [ ] Aceitar convite com token válido finaliza conta e deixa o user dentro da org correta com `role` correspondente; token é marcado como consumido.
- [ ] Aceitar convite com token expirado/consumido/inexistente mostra erro legível e não cria user.
- [ ] Acessar `/dashboard` sem sessão redireciona pra `/login?redirectTo=/dashboard`.
- [ ] Após login, `redirectTo` é respeitado.
- [ ] Todo Server Action pode chamar `getSessionContext()` e receber `{ userId, organizationId, role }` válidos — comprovado por um teste manual em qualquer action existente ou rascunho.
- [ ] Topbar/Sidebar do `(app)` mostram nome/avatar/org reais (fim dos mocks de usuário).
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único de design system ([`agents/quality/guardian.md`](../../agents/quality/guardian.md)).

---

## 🧭 Notas para o Tech Lead

Sprint STANDARD — segue **Workflow A (Sprint Execution)** completo:

1. **Preflight** — checklist do roadmap § Pré-sprint: `git status` limpo, credenciais Supabase em `.env.local`, snapshot fresco (re-rodar `node scripts/introspect-schema.mjs` já que a sprint toca em `auth`/`profiles`), leituras de boot.
2. `@spec-writer` gera PRD em `docs/prds/sprint_03_auth_tenancy.md`.
3. `@sanity-checker` valida PRD (atenção especial: atomicidade do signup, tratamento do `redirectTo`, LGPD/privacidade das mensagens de erro).
4. **STOP & WAIT** pela aprovação do usuário.
5. Execução: `@db-admin` (probe + migration do trigger, se necessária) → `@backend` (Server Actions + `getSessionContext` + middleware + callback) → `@frontend` (rotas `(auth)/*` + ajuste do layout `(app)`) → `@guardian`.
6. Design verification manual — login, signup, accept-invite, magic-link happy path + 3 edge cases (token expirado, slug duplicado, sessão expirada).
7. Closing: atualizar snapshot se a migration rodou; registrar em `APRENDIZADOS.md` apenas se houver algo não-óbvio sobre Supabase Auth / trigger de provisioning.
8. `@git-master` para commit.
