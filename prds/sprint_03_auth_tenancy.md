# PRD: Auth & Tenancy

**Template:** PRD_COMPLETE
**Complexity Score:** 17 points (DB:4 + API:4 + UI:3 + Logic:5 + Deps:1)
**Sprint:** 03
**Created:** 2026-04-15
**Status:** Draft

---

## 1. Overview

### Business Goal
O app hoje tem dashboard mockado e zero auth. Nenhum módulo de negócio (sprints 05+) pode ser construído enquanto não existe (a) login real contra `auth.users`, (b) proteção das rotas `(app)/*`, e (c) um helper canônico que entrega `{ userId, organizationId, role }` para toda Server Action.

### User Stories
- Como **usuário existente**, quero logar com email+senha ou magic-link.
- Como **novo usuário sem convite**, quero fazer signup com nome + slug de org, criando minha conta como owner.
- Como **convidado**, quero abrir `/accept-invite/[token]` e entrar direto na org de quem me convidou.
- Como **visitante sem sessão**, quero ser redirecionado a `/login` ao tentar abrir rota protegida.
- Como **dev** futuro, quero um único `getSessionContext()` Server-side para obter `organizationId` sem duplicar código.

### Success Metrics
- **Critério binário:** qualquer Server Action futura obtém `organizationId` via `getSessionContext()` sem código duplicado.
- Zero rota `(app)/*` acessível sem sessão válida (`middleware` bloqueia antes de render).
- Signup sem convite, aceitar-convite e login (senha + magic-link) funcionam end-to-end no happy path.

---

## 2. Database Requirements

### Probe obrigatório (antes de qualquer migration)

O `@db-admin` deve introspectar e confirmar:

1. **`profiles` columns:** snapshot mostra `organization_id uuid NOT NULL`, `role text NOT NULL DEFAULT 'user'`, `email text NULL`. Confirmar ao vivo que isso persiste.
2. **`organizations.slug`:** snapshot mostra `organizations_slug_key UNIQUE`. Confirmar.
3. **`invitations`:** snapshot mostra `token uuid UNIQUE`, `expires_at NOT NULL`, `accepted_at NULL`. Confirmar.
4. **Trigger `on_auth_user_created`:** verificar se já existe e o corpo da função. Introspecção SQL:
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';
   SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
   ```
5. **CHECK constraint em `profiles.role`:** verificar se existe constraint limitando valores.

### Decisão arquitetural (nova — corrige contradição do sprint)

O sprint propõe trigger que cria profile com `organization_id = NULL` e preenche depois. **Incompatível com schema atual** (`organization_id` NOT NULL). A solução é:

**Padrão "metadata-driven trigger":** antes de `supabase.auth.signUp`, a Server Action cria a `organizations` row (no caso de signup novo) ou lê o `invitation.organization_id`. Em seguida chama `signUp({ email, password, options: { data: { full_name, organization_id, role } } })`. O trigger `handle_new_user` lê `NEW.raw_user_meta_data` e insere profile com `organization_id` e `role` preenchidos — NOT NULL constraint satisfeita na própria inserção.

### Migration

**Localização:** `supabase/migrations/NNNN_auth_user_provisioning.sql`

**Conteúdo (idempotente):**

```sql
-- Função: provisiona profile a partir de raw_user_meta_data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_full_name TEXT;
  v_role TEXT;
BEGIN
  v_org_id := (NEW.raw_user_meta_data->>'organization_id')::UUID;
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'member');

  -- Se organization_id ausente, não cria profile (Server Action deve ter setado).
  -- A Server Action é responsável por reverter o auth.users nesse caso.
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organization_id missing in raw_user_meta_data for user %', NEW.id;
  END IF;

  INSERT INTO public.profiles (id, organization_id, full_name, email, role)
  VALUES (NEW.id, v_org_id, v_full_name, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

**Skip migration se:** probe confirma que função idêntica (mesmo comportamento metadata-driven) já existe. Caso contrário aplicar (CREATE OR REPLACE é idempotente).

### Existing Tables Used

- **`auth.users`:** gerenciada pelo Supabase. Server Actions chamam `supabase.auth.signUp` / `signInWithPassword` / `signInWithOtp`.
- **`organizations`:** INSERT no signup novo; SELECT em session context.
- **`profiles`:** INSERT via trigger; SELECT via `getSessionContext` (`id`, `organization_id`, `role`, `full_name`, `avatar_url`).
- **`invitations`:** SELECT para validar token; UPDATE para marcar `accepted_at`.

---

## 3. API Contract

### Server Actions — arquivo único `src/lib/actions/auth.ts`

Todas retornam `ActionResponse<T>` conforme `docs/conventions/standards.md`. Todas validam com Zod antes de qualquer I/O. Erros internos vão pro `console.error` com prefixo `[auth:<action>]`; usuário vê mensagem genérica.

#### `signupWithOrgAction`

**Input:**
```typescript
const SignupWithOrgSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  fullName: z.string().min(2, 'Nome obrigatório'),
  orgName: z.string().min(2, 'Nome da organização obrigatório'),
  orgSlug: z.string().regex(/^[a-z0-9-]+$/, 'Slug inválido').min(3).max(40),
});
```

**Lógica (ordem crítica — atomicidade):**
1. Valida input (Zod).
2. Cria `organizations` row com service-role client (bypass RLS) — captura `orgId`.
3. Chama `supabase.auth.signUp({ email, password, options: { data: { full_name, organization_id: orgId, role: 'owner' } } })`.
4. **Se `signUp` falha:** DELETE da org criada no passo 2 (compensação). Retorna `ActionResponse.error`.
5. Trigger DB cria profile automaticamente com role=owner.
6. `revalidatePath('/', 'layout')`.
7. Retorna `{ userId, organizationId }`.

**Output:** `ActionResponse<{ userId: string; organizationId: string }>`

#### `signupWithInviteAction`

**Input:**
```typescript
const SignupWithInviteSchema = z.object({
  password: z.string().min(8),
  fullName: z.string().min(2),
  inviteToken: z.string().uuid('Token inválido'),
});
```

**Lógica:**
1. Valida input.
2. SELECT em `invitations WHERE token = ? AND accepted_at IS NULL AND expires_at > NOW()` (via service-role).
3. Se não encontra → erro "Convite inválido ou expirado".
4. `supabase.auth.signUp` com `email = invite.email` (forçado), `options.data = { full_name, organization_id: invite.organization_id, role: invite.role }`.
5. UPDATE `invitations SET accepted_at = NOW() WHERE id = invite.id`.
6. `revalidatePath('/', 'layout')`.
7. Retorna `{ userId, organizationId: invite.organization_id }`.

#### `loginWithPasswordAction`

**Input:** `{ email, password }` (ambos via Zod).
**Lógica:** wrapper sobre `supabase.auth.signInWithPassword`. Em erro, retorna mensagem genérica `"Email ou senha inválidos"` (não vaza existência). Em sucesso, retorna `{ userId }` e cliente faz `router.push(redirectTo ?? '/dashboard')`.

#### `sendMagicLinkAction`

**Input:** `{ email }`.
**Lógica:** `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback' } })`. Retorna sempre sucesso genérico (não revela se email existe).

#### `logoutAction`

**Lógica:** `supabase.auth.signOut()` + `revalidatePath('/', 'layout')` + redirect via `redirect('/login')`.

### Session helper — `src/lib/supabase/getSessionContext.ts`

**Server-only.** Não é Server Action — é função utilitária chamada por Server Components / Server Actions.

```typescript
export type SessionContext = {
  userId: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member';
  fullName: string;
  avatarUrl: string | null;
  organizationName: string;
};

export async function getSessionContext(): Promise<SessionContext>;
```

**Lógica:**
1. `const supabase = await createClient()` (server.ts).
2. `const { data: { user } } = await supabase.auth.getUser()`. Se null → `redirect('/login')`.
3. SELECT `profiles` (id, organization_id, role, full_name, avatar_url) + JOIN `organizations.name` WHERE `profiles.id = user.id`.
4. Se `profile` não existe OU `organization_id` é null → log `[auth:getSessionContext] inconsistent profile for user ${user.id}` + `redirect('/login?error=inconsistent')`.
5. Se `role` ∉ `['owner','admin','member']` → log + trata como `'member'` (fallback defensivo, não bloqueia).
6. Retorna `SessionContext`.

**Nunca retorna null.** Happy path tipado; edge cases via `redirect`.

### Middleware — extensão de `middleware.ts`

Após `updateSession(request)`:

```typescript
const publicPaths = ['/login', '/signup', '/accept-invite', '/auth/callback'];
const { pathname } = request.nextUrl;
const isPublic = publicPaths.some(p => pathname.startsWith(p));
const isProtected = pathname.startsWith('/dashboard'); // futuro: + outras rotas (app)

if (isProtected && !user) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('redirectTo', pathname);
  return NextResponse.redirect(url);
}
```

Implementação real: modificar `src/lib/supabase/middleware.ts` para retornar `{ response, user }` e decidir o redirect em `middleware.ts` na raiz.

### OAuth/magic-link callback — `src/app/auth/callback/route.ts`

Route handler GET:
1. Pega `code` de `request.nextUrl.searchParams`.
2. Se `code` ausente → redirect para `/login?error=invalid_callback`.
3. `supabase.auth.exchangeCodeForSession(code)`. Se falhar → redirect `/login?error=invalid_code`.
4. Redirect para `searchParams.get('redirectTo') ?? '/dashboard'`.

---

## 4. External API Integration

N/A — Supabase Auth é SDK interno, não API externa. Magic-link usa provider nativo do Supabase (sem Resend nesta sprint).

---

## 5. Componentes de UI

Seguem [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). Tokens semânticos apenas.

### Component Tree

```
(auth)/layout.tsx                   — layout enxuto, centralizado, sem Sidebar/Topbar
├── (auth)/login/page.tsx
│   └── AuthCard
│       └── LoginForm (tabs: "Senha" | "Magic Link")
├── (auth)/signup/page.tsx
│   └── AuthCard
│       └── SignupForm
└── (auth)/accept-invite/[token]/page.tsx
    └── AuthCard
        └── AcceptInviteForm

(app)/layout.tsx                    — MODIFICADO: chama getSessionContext() e passa para AppLayout
```

### `src/app/(auth)/layout.tsx`
Layout Server Component. Container centralizado (`min-h-screen flex items-center justify-center bg-surface-base`). Sem Sidebar/Topbar. Dark mode via token.

### `AuthCard` (`src/components/auth/AuthCard.tsx`)
Wrapper visual: título, subtítulo, children, footer com link alternativo.
- Tokens: `bg-surface-raised`, `border-default`, `text-text-primary` (título), `text-text-secondary` (subtítulo).
- Composto de `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter` de `src/components/ui/card`.

### `LoginForm` (`src/components/auth/LoginForm.tsx`)
Client Component. `react-hook-form + zodResolver`. Dois modos via `Tabs` (Radix): "Senha" e "Magic Link".
- Modo senha: Input email + Input password + Button "Entrar" → `loginWithPasswordAction`.
- Modo magic-link: Input email + Button "Enviar link" → `sendMagicLinkAction` + feedback sucesso inline.
- Estados: loading (Button disabled + spinner), erro (Alert inline no topo, `bg-feedback-danger-surface`), sucesso magic-link (Alert `bg-feedback-success-surface`).
- Componentes DS: `Input`, `Label`, `Button` (variant `primary`), `Tabs`, `Alert`.

### `SignupForm` (`src/components/auth/SignupForm.tsx`)
Client. Campos: email, password, fullName, orgName, orgSlug.
- **Slug auto-sugerido:** watch `orgName` → slugify (lowercase, trim, `[^a-z0-9]+` → `-`). User pode editar.
- Zod no cliente = Zod no servidor.
- Erros de campo via `formState.errors`; erros globais (slug duplicado) via state local.
- Submit → `signupWithOrgAction` → se sucesso, `router.push('/dashboard')`.

### `AcceptInviteForm` (`src/components/auth/AcceptInviteForm.tsx`)
Client. Campos: email (readonly, pré-preenchido com `invite.email`), password, fullName. Recebe `inviteToken` como prop.
- Submit → `signupWithInviteAction` → push `/dashboard`.

### `(auth)/accept-invite/[token]/page.tsx`
**Server Component.** Pré-valida o token (SELECT invitations via service-role). Três outcomes:
- Válido → renderiza `AuthCard` + `AcceptInviteForm` com `email` e `orgName` pré-populados.
- Expirado/consumido/inexistente → renderiza `AuthCard` com mensagem específica (3 mensagens distintas) + botão "Ir para login". **Não vaza se email existe.**

### `(app)/layout.tsx` (modificação)
```typescript
export default async function AuthenticatedLayout({ children }) {
  const ctx = await getSessionContext(); // redireciona se não há sessão
  return (
    <AppLayout user={{ fullName: ctx.fullName, avatarUrl: ctx.avatarUrl, organizationName: ctx.organizationName }}>
      {children}
    </AppLayout>
  );
}
```
`AppLayout` ganha prop `user` e passa para Topbar/Sidebar, substituindo mocks. Topbar ganha item "Sair" no menu de usuário → `logoutAction`.

**Semantic tokens esperados:** `bg-surface-*`, `text-text-*`, `bg-action-primary`, `bg-feedback-{danger,success,info}-*`, `border-default`. **Zero hex, zero `bg-blue-500`, zero `p-[Npx]`.**

---

## 6. Edge Cases (CRITICAL)

### Autenticação
- [ ] **Login com credenciais inválidas:** mensagem genérica "Email ou senha inválidos" — não vaza existência.
- [ ] **Magic-link para email inexistente:** Supabase não revela; UI sempre mostra "Cheque seu email".
- [ ] **Sessão expira durante navegação `(app)`:** middleware pega no próximo request e redireciona pra `/login?redirectTo=<path>`.
- [ ] **Usuário já logado acessa `/login` ou `/signup`:** middleware não força redirect (fora de escopo); página faz client-side `router.push('/dashboard')` se `session` detectada via `createClient`.

### Signup
- [ ] **Slug de org já existente:** UNIQUE constraint dispara — catch `23505`, retorna `error: "Slug já em uso"` no campo.
- [ ] **Email já registrado em `auth.users`:** `signUp` retorna erro do Supabase; traduzir pra "Email já cadastrado. Faça login ou recupere sua senha."
- [ ] **`signUp` falha após org criada (passo 2→3):** compensação: DELETE da org; reportar erro genérico "Não foi possível criar conta. Tente novamente."

### Convite
- [ ] **Token inexistente:** "Convite inválido."
- [ ] **Token expirado (`expires_at < NOW()`):** "Este convite expirou. Peça um novo."
- [ ] **Token já consumido (`accepted_at NOT NULL`):** "Este convite já foi usado. Faça login."
- [ ] **Email do convite vs email digitado:** campo `email` no form é readonly e pré-preenchido — impossível divergir.

### Callback
- [ ] **`/auth/callback` sem `code`:** redirect `/login?error=invalid_callback`.
- [ ] **`code` inválido/expirado:** redirect `/login?error=invalid_code`.

### Consistência
- [ ] **`profiles.organization_id` NULL** (caso trigger falhe ou profile legado): `getSessionContext` detecta → log + `signOut` + redirect `/login?error=inconsistent`.
- [ ] **`profiles.role` fora de `owner/admin/member`:** `getSessionContext` faz fallback defensivo para `member` + log (não bloqueia sessão).

### UI/UX
- [ ] **Estado loading em todo submit:** Button disabled + ícone de loader.
- [ ] **Estado erro:** Alert inline no topo do form, mensagem de 1 linha.
- [ ] **Estado sucesso magic-link:** Alert verde "Cheque seu email." — este é o estado vazio/aguardando do fluxo magic-link (user aguarda email, form não colapsa).
- [ ] **Dark mode:** todas as rotas `(auth)/*` funcionam em `data-theme="dark"`.
- [ ] **Browser sem JS:** forms são Server Actions — mesmo sem JS client-side, `<form action={...}>` posta normalmente; degradação graceful preservada.

### Estados vazios (category 1)
- [ ] **Magic-link aguardando click:** após `sendMagicLinkAction` sucesso, o form colapsa e mostra card vazio "Cheque seu email — <email>. Link expira em 1 hora." (estado "não-clicado ainda"). Botão "Voltar" permite retornar ao form.
- [ ] **Accept-invite: preview do convite antes de finalizar:** Server Component mostra `orgName` + `email` + `role` read-only antes do form de senha — evita usuário submeter sem conferir a org.

### Erros de rede (category 3)
- [ ] **Timeout em `signUp` (>30s):** `try/catch` com Promise.race + timeout; retorna `ActionResponse.error("Conexão lenta, tente novamente")`. UI mostra erro inline, botão habilita de novo.
- [ ] **Supabase 5xx (`auth/login` indisponível):** catch genérico na Server Action → log do status → `error: "Serviço indisponível, tente em instantes"`.
- [ ] **Navegador offline durante submit:** browser rejeita fetch → `useFormStatus` captura → UI mostra "Sem conexão. Verifique sua internet."

### Operações concorrentes (category 5)
- [ ] **Dois tabs fazendo login simultâneo:** cookie do Supabase é idempotente, última sessão ganha; ambos os tabs convergem para o mesmo `userId`. **Documentado**, sem tratamento especial.
- [ ] **Race condition signup novo (org criada mas `signUp` falha entre passos 2 e 4):** compensação via DELETE (ver Seção 3). Se processo morre durante a compensação → org órfã documentada como risco (Seção 9 Risk 1), cleanup manual.
- [ ] **Usuário abre accept-invite em dois tabs, aceita em ambos:** UPDATE `invitations SET accepted_at` é idempotente; segundo tab lê `accepted_at NOT NULL` no SELECT → "Convite já foi usado".

### Limites de dados (category 6)
- [ ] **Password > 72 caracteres:** bcrypt do Supabase trunca em 72; Zod rejeita `z.string().max(72, 'Máximo 72 caracteres')`.
- [ ] **Slug > 40 caracteres:** Zod rejeita no cliente e servidor.
- [ ] **`fullName` > 100 caracteres:** Zod `.max(100)` em ambos os schemas de signup.
- [ ] **Rate limit de magic-link (Supabase default: 1 por minuto por email):** se Supabase retorna `429`, UI mostra "Aguarde alguns segundos antes de pedir novo link."

---

## 6.5. Reference Module Compliance

O sprint declara explicitamente: **não há módulo de auth anterior para copiar**. Em vez de "copiar de", este sprint **cria** a referência que sprints futuros (05+) consumirão. O compliance aqui é sobre **exportar padrões corretos**, não sobre imitar.

### Padrões a **fixar** (serão consumidos por CRUDs futuros)

| Padrão | Localização canônica | Consumidores futuros |
|---|---|---|
| `getSessionContext()` com retorno tipado `SessionContext` (sem null no happy path) | `src/lib/supabase/getSessionContext.ts` | Toda Server Action em `src/lib/actions/**.ts` |
| Service-role client isolado com `import 'server-only'` | `src/lib/supabase/service.ts` | Apenas Server Actions que precisam bypass RLS (signup, invite validation) |
| Server Action retornando `ActionResponse<T>` + try/catch + log prefixado `[module:action]` | `src/lib/actions/auth.ts` | Template de todas as Server Actions futuras |
| Form Client Component com `react-hook-form + zodResolver`, schemas Zod compartilhados entre client e server | `src/components/auth/LoginForm.tsx` etc. | Todos os forms de CRUD do sprint 05+ |
| Server Component de página que valida token/param antes de renderizar Client form | `src/app/(auth)/accept-invite/[token]/page.tsx` | Páginas de detalhe que precisam pré-validação (edit pages) |

### Padrões a **preservar** (já existentes, não desviar)

- **Path canônico de Server Actions:** `src/lib/actions/<domain>.ts` — não criar em `src/actions/` nem `src/app/actions/`.
- **Path canônico de Supabase clients:** `src/lib/supabase/{client,server,middleware}.ts` — service-role é adição nova em `service.ts`.
- **Zod 4 usa `.issues`**, não `.errors` (registrado em `docs/APRENDIZADOS.md`).
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Zero hex, zero primitivas de cor, zero arbitrários Tailwind.

### Substituições de naming (para sprints futuros que copiarem)

- `<Domain>` → ex: `Lead`, `Product`, `Category`
- `<domain>` → ex: `lead`, `product`, `category`
- `get<Domain>Action`, `create<Domain>Action`, `update<Domain>Action`, `delete<Domain>Action`
- `<Domain>Form` (Client Component)
- `src/lib/actions/<domain>.ts`

### Exemplo concreto (before/after — padrão de Server Action)

**This sprint (auth) establishes:**
```typescript
// src/lib/actions/auth.ts
export async function loginWithPasswordAction(
  input: z.infer<typeof LoginSchema>
): Promise<ActionResponse<{ userId: string }>> {
  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) { console.error('[auth:login]', error); return { success: false, error: 'Email ou senha inválidos' }; }
    revalidatePath('/', 'layout');
    return { success: true, data: { userId: data.user.id } };
  } catch (e) { console.error('[auth:login]', e); return { success: false, error: 'Erro interno, tente novamente' }; }
}
```

**Future sprint 05 (leads) will copy this structure:**
```typescript
// src/lib/actions/leads.ts
export async function createLeadAction(
  input: z.infer<typeof CreateLeadSchema>
): Promise<ActionResponse<{ leadId: string }>> {
  const parsed = CreateLeadSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const ctx = await getSessionContext(); // ← pattern from this sprint
    const supabase = await createClient();
    const { data, error } = await supabase.from('leads').insert({ ...parsed.data, organization_id: ctx.organizationId }).select().single();
    if (error) { console.error('[leads:create]', error); return { success: false, error: 'Não foi possível criar lead' }; }
    revalidatePath('/leads');
    return { success: true, data: { leadId: data.id } };
  } catch (e) { console.error('[leads:create]', e); return { success: false, error: 'Erro interno' }; }
}
```

A diferença é apenas a lógica de negócio — estrutura (validação + try/catch + log prefixado + ActionResponse + revalidate) é idêntica.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration aplica sem erro em `supabase db push --dry-run`.
- [ ] Migration é idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
- [ ] Trigger `on_auth_user_created` ativo em `auth.users` após apply.
- [ ] Inserção em `auth.users` com `raw_user_meta_data` contendo `organization_id` cria profile automaticamente.

### Backend
- [ ] Todas as 5 Server Actions validam input com Zod antes de I/O.
- [ ] Todas retornam `ActionResponse<T>`; nenhuma lança exceção para o cliente.
- [ ] Todos os erros internos são logados com prefixo `[auth:<action>]`.
- [ ] `revalidatePath('/', 'layout')` chamado em todas as mutações de sessão.
- [ ] `getSessionContext()` é a única forma de obter `{ userId, organizationId, role }` no codebase (grep confirma zero duplicação).
- [ ] Middleware bloqueia `/dashboard` sem sessão com `redirect('/login?redirectTo=/dashboard')`.
- [ ] `/auth/callback` com code válido cai em `/dashboard` (ou `redirectTo`).

### Frontend
- [ ] Código passa 100% dos checks do [`agents/quality/guardian.md`](../../agents/quality/guardian.md) §1a (automático) e §1b (semântico). **Este é o único gate frontend** — regras vivem em [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md).
- [ ] `scripts/verify-design.mjs --changed` sai com 0 violações.
- [ ] `(app)/layout.tsx` chama `getSessionContext()` e injeta dados reais no Topbar/Sidebar (fim dos mocks).
- [ ] Topbar tem item "Sair" funcional que dispara `logoutAction`.
- [ ] `data-theme="dark"` testado em `/login`, `/signup`, `/accept-invite/[token]`.
- [ ] Todos os forms têm loading + erro + sucesso visíveis.

### Qualidade
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código (GATE 4).

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)
1. Probe schema ao vivo (profiles/organizations/invitations/trigger).
2. Se trigger ausente ou não metadata-driven → gerar migration `NNNN_auth_user_provisioning.sql`.
3. `supabase db push --dry-run` para validar sintaxe.
4. Atualizar `docs/schema_snapshot.json`.

**Estimativa:** 10 min.

### Phase 2: Backend (`@backend`)
1. `src/lib/supabase/getSessionContext.ts` (helper + tipos).
2. `src/lib/actions/auth.ts` (5 Server Actions + schemas Zod).
3. `src/lib/supabase/service.ts` (service-role client — helper separado para org creation).
4. Extensão de `src/lib/supabase/middleware.ts` + `middleware.ts` raiz (redirect logic).
5. `src/app/auth/callback/route.ts`.

**Estimativa:** 30 min.

### Phase 3: Frontend (`@frontend`)
1. `src/app/(auth)/layout.tsx` + 3 páginas (login, signup, accept-invite).
2. `src/components/auth/` (AuthCard, LoginForm, SignupForm, AcceptInviteForm).
3. Modificação de `(app)/layout.tsx` + AppLayout para receber `user` prop.
4. Item "Sair" no Topbar.

**Estimativa:** 40 min.

### Phase 4: Review (`@guardian`)
1. Checar regras do design system.
2. Checar contratos de Server Action (Zod, try/catch, ActionResponse, revalidatePath).
3. Confirmar zero `any`, zero hex, zero duplicação de session logic.

**Estimativa:** 5 min.

### Phase 5: Verificação de design
1. `scripts/verify-design.mjs --changed` (automático).
2. Verificação manual: login happy path + signup + accept-invite + magic-link + 3 edge cases (token expirado, slug duplicado, sessão expirada).

**Estimativa:** 10 min.

**Total:** ~95 min.

---

## 9. Risks & Mitigations

### Risk 1: Atomicidade do signup novo quebra (org criada mas user não)
**Impacto:** Alto — orfã em `organizations`.
**Probabilidade:** Baixa — `signUp` falha raramente (email duplicado é o caso comum, detectado antes da criação da org via pre-check opcional).
**Mitigação:** Passo 4 da Server Action: try/catch em volta do `signUp`; em erro, DELETE da org criada. Log detalhado. Aceitar risco de race condition (processo morre entre passos 2 e 4) — cleanup manual ou job de limpeza futuro.

### Risk 2: Trigger `handle_new_user` silenciosamente não roda (permissões)
**Impacto:** Alto — user em `auth.users` sem profile.
**Probabilidade:** Média — `SECURITY DEFINER` + search_path crítico.
**Mitigação:** `SET search_path = public` no corpo da função (previne hijacking). `RAISE EXCEPTION` se `organization_id` ausente — força erro explícito. Testar manualmente inserindo em `auth.users` via SQL com metadata completo.

### Risk 3: Middleware redireciona excessivamente (loop infinito)
**Impacto:** Alto — UX quebrada.
**Probabilidade:** Média — matchers mal configurados.
**Mitigação:** Lista whitelist de rotas públicas (`/login`, `/signup`, `/accept-invite`, `/auth/callback`). Teste manual: acesso a cada rota com e sem sessão.

### Risk 4: `profiles.role` aceita valores fora do enum (`'user'` default)
**Impacto:** Médio — `getSessionContext` retorna role inválido.
**Probabilidade:** Alta (profiles legados podem ter `role = 'user'`).
**Mitigação:** Fallback defensivo em `getSessionContext` (tratar role desconhecida como `'member'` + log). NÃO adicionar CHECK constraint agora — quebraria dados legados. Sprint 04 pode migrar dados e adicionar constraint.

### Risk 5: Service-role key vazada no client bundle
**Impacto:** Crítico — bypass total de RLS.
**Probabilidade:** Baixa se bem isolada.
**Mitigação:** `src/lib/supabase/service.ts` com `import 'server-only'` no topo. Nunca importado por Client Component. Guardian deve verificar.

---

## 10. Dependencies

### Internal
- [x] Schema do DB (`profiles`, `organizations`, `invitations`) já existe (sprint 01).
- [x] `@supabase/ssr` instalado (sprint 01).
- [x] `createClient()` (server.ts) + `updateSession` (middleware.ts) já existem (sprint 01).
- [x] `react-hook-form` + `zod` + `@hookform/resolvers` instalados.
- [x] `AppLayout`, Sidebar, Topbar (sprint 02) — serão estendidos para receber `user`.

### External
- Nenhuma dependência nova. Magic-link usa provider nativo do Supabase.

---

## 11. Rollback Plan

Se issues forem encontrados após deploy:

1. **Imediato:** `git revert <commit-hash>` da sprint (reverte todos os arquivos novos/modificados).
2. **Database:** a migration é idempotente e adiciona apenas trigger/função. Rollback manual se necessário:
   ```sql
   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
   DROP FUNCTION IF EXISTS public.handle_new_user();
   ```
3. **Sessões ativas:** usuários continuam logados (cookies Supabase não são invalidados). Nova entrada via signup/signup-invite fica bloqueada até re-deploy.
4. **Cache:** `revalidatePath('/', 'layout')` manual via Server Action one-off se necessário.

---

## Approval

**Created by:** @spec-writer (persona adotada pelo Tech Lead)
**Reviewed by:** [Sanity Checker — pendente]
**Approved by:** [Usuário — pendente]
**Date:** 2026-04-15
