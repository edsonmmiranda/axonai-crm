# PRD: Shell Admin — Route group `(admin)`, MFA AAL2, Login isolado, Branding

**Template:** PRD_COMPLETE
**Complexity Score:** 12
**Sprint:** admin_04
**Created:** 2026-04-24
**Status:** Draft

---

## 1. Overview

### Business Goal

Entregar a "casca" da área administrativa da plataforma Axon AI. Qualquer rota sob `/admin/**` deve exigir que o solicitante seja um platform admin ativo com sessão MFA AAL2 confirmada. Um layout visualmente distinto ("Axon Admin", paleta neutra escura) reforça a separação de contexto. Sem esta sprint, todos os sprints de UI admin (05–12) não têm onde residir.

### User Stories

- Como **platform admin owner (Edson)**, quero acessar `/admin/login`, autenticar com e-mail/senha e completar MFA TOTP, para que eu entre na área admin com AAL2.
- Como **platform admin**, quero que o layout admin (sidebar, topbar, banner "Axon Admin") seja visualmente distinto do customer app, para que eu saiba imediatamente em qual contexto estou operando.
- Como **platform admin**, quero que minha sessão expire em 8h de inatividade (máx 12h absoluto), para que sessões esquecidas não persistam.
- Como **desenvolvedor**, quero que `npm run build:check` falhe se qualquer arquivo do customer app importar módulos admin-only, para que isolamento de bundle seja verificável mecanicamente em CI.

### Success Metrics

- G-01 (MFA enforcement): acesso a `/admin/dashboard` sem AAL2 é bloqueado 100% das vezes.
- G-04 (import isolation): `npm run build:check` sai com código 1 quando violação de import é introduzida.
- G-05 (session isolation): sessão customer ativa não concede acesso a rotas admin (verificado por teste manual).

---

## 2. Database Requirements

### Novas tabelas

Nenhuma — este sprint não cria tabelas.

### Tabelas existentes usadas

#### `auth.mfa_factors` (Supabase Auth — gerenciada pelo Supabase)

**Usage:** Supabase SDK (`supabase.auth.mfa.*`) lê e escreve automaticamente ao fazer enroll/challenge/verify de TOTP. O código da aplicação NÃO acessa esta tabela diretamente.

**SDK calls necessários:**
- `supabase.auth.mfa.enroll({ factorType: 'totp' })` → retorna `{ totp: { qr_code, secret, uri }, id }`
- `supabase.auth.mfa.challenge({ factorId })` → cria challenge, retorna `{ id }` (challenge_id)
- `supabase.auth.mfa.verify({ factorId, challengeId, code })` → verifica código TOTP; em sucesso, eleva sessão para AAL2
- `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` → retorna `{ currentLevel, nextLevel }` onde cada nível é `'aal1' | 'aal2'`

#### `public.platform_admins`

**Usage:** verificado no layout admin via `requirePlatformAdmin()` (Sprint 02). Não chamado diretamente no middleware — ver §3.

**Fields accessed:** `id`, `profile_id`, `role`, `is_active`.

---

## 3. API Contract

### Sem Server Actions novas

Este sprint não cria arquivos em `src/lib/actions/`. A lógica de autenticação usa o Supabase Auth SDK diretamente em componentes Server e no middleware. `@qa-integration` = n/a.

### Middleware de autenticação admin

**Arquivo:** `src/middleware.ts` (novo — Next.js middleware global)

**Responsabilidades:**
1. Para todas as rotas: atualiza cookies de sessão Supabase (chama a lógica existente de `src/lib/supabase/middleware.ts`).
2. Para rotas `/admin/**`: aplica duas verificações em série:
   - **Gate 1 — Autenticação:** `user` existe na sessão? Se não → redirect `/admin/login`.
   - **Gate 2 — AAL:** `currentLevel === 'aal2'`? Se `aal1` e `nextLevel === 'aal2'` (fator enrolado, challenge pendente) → redirect `/admin/mfa-challenge`. Se `aal1` e `nextLevel === 'aal1'` (sem fator) → redirect `/admin/mfa-enroll`.
3. `platform_admins` **não** é verificado no middleware — é verificado no layout admin via `requirePlatformAdmin()`. Razão: query de DB em cada request de middleware seria cara e o layout já garante a verificação antes de qualquer Server Component render.

**Rotas públicas admin (exemptadas dos gates acima):**
- `/admin/login`
- `/admin/mfa-enroll`
- `/admin/mfa-challenge`
- `/admin/unauthorized`

**Diagrama de estados (entrada em rota admin protegida):**

```
Request → /admin/**
│
├─ É rota pública? (login/mfa-enroll/mfa-challenge/unauthorized)
│   └─ Sim → passa direto
│
└─ Não (rota protegida)
    │
    ├─ user == null → redirect /admin/login
    │
    └─ user existe
        ├─ currentLevel == 'aal2' → deixa passar
        │   (layout admin chama requirePlatformAdmin() → 404 se não for platform admin)
        │
        ├─ currentLevel == 'aal1' && nextLevel == 'aal2' → redirect /admin/mfa-challenge
        │   (fator enrolado, challenge necessário)
        │
        └─ currentLevel == 'aal1' && nextLevel == 'aal1' → redirect /admin/mfa-enroll
            (sem fator enrolado)
```

**Implementação — pseudocódigo:**

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_PUBLIC = ['/admin/login', '/admin/mfa-enroll', '/admin/mfa-challenge', '/admin/unauthorized'];

export async function middleware(request: NextRequest) {
  // 1. Atualizar cookies de sessão (lógica existente de src/lib/supabase/middleware.ts)
  let response = NextResponse.next({ request });
  const supabase = createServerClient(/* ... cookies handler ... */);

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // 2. Proteção customer app (mantém lógica existente: /dashboard → /login)
  const CUSTOMER_PROTECTED = ['/dashboard'];
  const isCustomerProtected = CUSTOMER_PROTECTED.some(p => pathname === p || pathname.startsWith(`${p}/`));
  if (isCustomerProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // 3. Proteção área admin
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminPublic = ADMIN_PUBLIC.some(p => pathname === p || pathname.startsWith(`${p}/`));

  if (isAdminRoute && !isAdminPublic) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      return NextResponse.redirect(url);
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      const url = request.nextUrl.clone();
      url.pathname = aal?.nextLevel === 'aal2' ? '/admin/mfa-challenge' : '/admin/mfa-enroll';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

### Script de isolamento de imports

**Arquivo:** `scripts/check-import-isolation.mjs`

**Lógica:**
1. Coletar recursivamente todos os arquivos `.ts`, `.tsx` em `src/app/(app)/`.
2. Para cada arquivo, extrair imports estáticos (`import ... from '...'`, `export ... from '...'`).
3. Resolver caminhos relativos e aliases `@/` em relação ao arquivo.
4. Sinalizar como violação se qualquer import resolvido:
   - Começa com `src/app/(admin)/` ou é `src/lib/auth/platformAdmin.ts`.
5. Se violações encontradas: imprimir lista e sair com código 1.

**Integração em `package.json`:**
```json
"build:check": "node scripts/check-import-isolation.mjs && next build"
```
(ou adicionar como step independente se `build:check` já existe)

---

## 4. External API Integration

Não aplicável. Supabase Auth é o SDK interno do projeto.

---

## 5. Componentes de UI

Todos os componentes usam tokens semânticos do design system. Proibido: hex literais, `bg-blue-500`, `p-[17px]`. Variantes via `cva`. Ícones Lucide apenas.

### Component Tree

```
src/app/(admin)/layout.tsx                    ← AdminLayout (root do route group)
├── AdminSidebar                              ← sidebar com navegação admin
├── AdminTopbar                               ← topbar com nome do admin + logout
└── AdminContextBanner                        ← banner fixo "Axon Admin" com ícone Shield

src/app/(admin)/login/page.tsx
└── AdminLoginPage
    └── AdminLoginForm                        ← e-mail + senha + submit

src/app/(admin)/mfa-enroll/page.tsx
└── AdminMfaEnrollPage
    └── AdminMfaEnrollForm                    ← QR code + secret + código de verificação

src/app/(admin)/mfa-challenge/page.tsx
└── AdminMfaChallengePage
    └── AdminMfaChallengeForm                 ← campo de código TOTP

src/app/(admin)/unauthorized/page.tsx
└── AdminUnauthorizedPage                     ← mensagem + sem links para customer app

src/app/(admin)/dashboard/page.tsx
└── AdminDashboardStub                        ← placeholder "em construção"
```

---

### `AdminLayout` — `src/app/(admin)/layout.tsx`

**Tipo:** Server Component (chama `requirePlatformAdmin()`)

**Behavior:**
- Chama `requirePlatformAdmin()` no topo: se não for platform admin ativo → `notFound()` (404).
- Renderiza wrapper `<div data-admin>` que ativa tokens de tema admin definidos em CSS.
- Inclui `AdminContextBanner`, `AdminSidebar`, `AdminTopbar`.
- Dark mode: `data-admin` wrapper deve coexistir com `data-theme` do root layout.

**Tokens de tema "Axon Admin" (definir em `src/app/globals.css` ou arquivo CSS dedicado):**
```css
[data-admin] {
  --color-admin-accent: /* tom neutro distinto — ex: zinc-700 como referência, mas via CSS var */;
  /* Sobrescreve tokens semânticos para o contexto admin onde necessário */
}
```
> Nota para `@frontend+`: definir os valores reais dos tokens admin inspecionando `globals.css` existente e escolhendo valores harmônicos com a paleta neutra do design system. Documentar os tokens criados em comentário no arquivo CSS.

**Props:** `{ children: React.ReactNode, admin: PlatformAdminSnapshot }` (admin obtido de `requirePlatformAdmin()` e passado para sidebar/topbar como prop)

---

### `AdminLoginForm` — `src/components/admin/AdminLoginForm.tsx`

**Tipo:** Client Component (`'use client'`)

**Props:** nenhuma

**State:**
- `email: string` — campo e-mail
- `password: string` — campo senha
- `isLoading: boolean` — estado de submissão
- `error: string | null` — mensagem de erro da API

**Behavior:**
- Submit: chama `supabase.auth.signInWithPassword({ email, password })`.
- Sucesso → obtém `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`:
  - `nextLevel === 'aal2'` → `router.push('/admin/mfa-challenge')`
  - `nextLevel === 'aal1'` (sem MFA) → `router.push('/admin/mfa-enroll')`
- Erro do Supabase: mapear para mensagem amigável (não expor detalhes de auth):
  - `Invalid login credentials` → "E-mail ou senha incorretos."
  - `Email not confirmed` → "Confirme seu e-mail antes de continuar."
  - Outros → "Erro ao fazer login. Tente novamente."
- Loading state durante submissão (botão desabilitado + spinner).

**Design system components:**
- `Input` de `src/components/ui/input` (type email, type password)
- `Button` de `src/components/ui/button` (variant primary, size default, state loading)
- `Label` de `src/components/ui/label`
- Card wrapper: tokens `bg-surface-raised`, `border-border`

---

### `AdminMfaEnrollForm` — `src/components/admin/AdminMfaEnrollForm.tsx`

**Tipo:** Client Component

**State:**
- `factorId: string | null` — ID do fator enrolado (obtido de `enroll()`)
- `qrCode: string | null` — URI data do QR code
- `secret: string | null` — chave manual para copiar
- `challengeId: string | null` — ID do challenge criado após enroll
- `code: string` — campo de código de verificação
- `isLoading: boolean`
- `step: 'loading' | 'qr' | 'verify' | 'error'`
- `error: string | null`

**Behavior:**
1. On mount: chama `supabase.auth.mfa.enroll({ factorType: 'totp' })`.
   - Sucesso → `step = 'qr'`; exibe QR code (como `<img src={totp.qr_code}>`) e secret copiável.
   - Erro de fator já enrolado (código `enrollee_already_exists` ou similar) → `step = 'verify'` direto (redirecionar para mfa-challenge).
2. Submit do código de verificação:
   a. `supabase.auth.mfa.challenge({ factorId })` → obtém `challengeId`.
   b. `supabase.auth.mfa.verify({ factorId, challengeId, code })`.
   c. Sucesso → `router.push('/admin/dashboard')`.
   d. Erro de código inválido → mensagem "Código incorreto. Verifique o app autenticador."
   e. Challenge expirado → reiniciar enrollment.
3. QR code deve exibir aviso: "Salve a chave manual em local seguro — não será exibida novamente."

**Design system:** `Input` (code, maxLength 6, inputMode numeric), `Button` (primary), ícone `Copy` Lucide para botão de copiar secret.

---

### `AdminMfaChallengeForm` — `src/components/admin/AdminMfaChallengeForm.tsx`

**Tipo:** Client Component

**State:**
- `factorId: string | null` — ID do fator (obtido de `listFactors()` ou passado como prop)
- `challengeId: string | null`
- `code: string`
- `isLoading: boolean`
- `error: string | null`

**Behavior:**
1. On mount: lista fatores via `supabase.auth.mfa.listFactors()` e pega o fator TOTP ativo (primeiro `verified`).
2. Cria challenge: `supabase.auth.mfa.challenge({ factorId })`.
3. Submit: `supabase.auth.mfa.verify({ factorId, challengeId, code })`.
   - Sucesso → `router.push('/admin/dashboard')`.
   - Erro → "Código inválido ou expirado."
4. Link "Problemas com o autenticador?" → renderiza texto estático informando para contatar outro platform admin (sem link para recovery — Sprint 11).

---

### `AdminContextBanner` — `src/components/admin/AdminContextBanner.tsx`

**Tipo:** Server Component

**Props:** `{ adminName: string, adminRole: PlatformAdminRole }`

**Behavior:** banner fixo no topo com ícone `Shield` (Lucide), texto "Axon Admin", papel do admin ("owner"/"support"/"billing"). Cor de fundo com token `bg-surface-sunken` ou variante admin definida em `[data-admin]`.

---

## 6. Edge Cases

### Autenticação e AAL

- [ ] **Sem sessão:** GET `/admin/dashboard` → middleware redireciona 100% para `/admin/login` antes de qualquer render.
- [ ] **Sessão AAL1, MFA enrolado:** GET `/admin/dashboard` → middleware redireciona para `/admin/mfa-challenge` (nunca renderiza o dashboard).
- [ ] **Sessão AAL1, sem MFA:** GET `/admin/dashboard` → middleware redireciona para `/admin/mfa-enroll`.
- [ ] **Sessão AAL2, não é platform_admin:** middleware deixa passar → layout chama `requirePlatformAdmin()` → `notFound()` → 404 (não revela estrutura interna).
- [ ] **Sessão AAL2, platform_admin ativo:** acesso concedido normalmente.
- [ ] **Sessão customer ativa, sem platform_admin:** acesso a `/admin/dashboard` → 404 após layout check (não 401 — não revelamos que a rota existe).

### Enrollment MFA

- [ ] **Código TOTP incorreto na verificação de enroll:** mensagem "Código incorreto. Verifique o app autenticador." — sem revelar tempo de expiração.
- [ ] **Challenge expirado (> 5 min no enroll):** `verify()` retorna erro → UI reinicia enrollment (novo `enroll()` call, novo QR).
- [ ] **Fator já enrolado (usuário acessa `/admin/mfa-enroll` com fator ativo):** detectar `enrollee_already_exists` ou chamar `listFactors()` no mount — redirecionar para `/admin/mfa-challenge` sem mostrar QR duplicado.
- [ ] **MFA não habilitado no projeto Supabase:** `enroll()` retorna erro de feature desabilitada → exibir mensagem de erro técnico sem detalhes de SDK; runbook deve ser seguido antes do deploy.

### Challenge MFA

- [ ] **Nenhum fator ativo na listagem:** `listFactors()` retorna array vazio → redirecionar para `/admin/mfa-enroll`.
- [ ] **Código TOTP inválido:** mensagem genérica "Código inválido ou expirado" — sem distinguir "errado" de "expirado" (evita timing oracle).

### Import Isolation

- [ ] **Import de `platformAdmin.ts` adicionado em `(app)/`:** `npm run build:check` sai com código 1 e lista o arquivo violador.
- [ ] **Import de componente admin em arquivo customer:** mesma saída com código 1.
- [ ] **Nenhuma violação:** `npm run build:check` sai com código 0.

### Sessão e expiração

- [ ] **Sessão admin expirada (8h inatividade):** próximo request → Supabase retorna `user = null` → middleware redireciona para `/admin/login`.
- [ ] **Sessão admin expirada (12h absoluto):** mesmo comportamento.

### Navegação direta

- [ ] **GET `/admin` (sem trailing slash):** middleware trata como rota admin protegida — redireciona para login se não autenticado.
- [ ] **GET `/admin/login` com sessão AAL2 + platform_admin ativo:** rota pública — não redireciona (evitar loop); layout de login não chama `requirePlatformAdmin()`.

### Limites de dados (Cat 6)

- [ ] **Rate limit de tentativas TOTP inválidas:** Supabase limita tentativas consecutivas de `verify()` com código errado — após exceder o limite, retorna erro específico. UI mapeia para "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." Não expõe janela de tempo exata.

### Browser e ambiente (Cat 7)

- [ ] **Acesso via dispositivo mobile (viewport ≤375px):** página `/admin/mfa-enroll` renderiza QR code com dimensão mínima de 200×200px para ser escaneável; campo de código TOTP usa `inputMode="numeric"` para ativar teclado numérico em iOS/Android.

---

## 7. Acceptance Criteria (BINARY)

### Middleware

- [ ] Acesso a `/admin/dashboard` sem sessão → redireciona para `/admin/login` (verificado via `curl -I` ou navegador sem cookies).
- [ ] Acesso a `/admin/dashboard` com sessão AAL1 (MFA enrolado) → redireciona para `/admin/mfa-challenge`.
- [ ] Acesso a `/admin/dashboard` com sessão AAL1 (sem MFA) → redireciona para `/admin/mfa-enroll`.
- [ ] Acesso a `/admin/login` com qualquer sessão → não redireciona (rota pública admin).
- [ ] Acesso a `/dashboard` (customer) sem sessão → redireciona para `/login` (comportamento existente preservado).

### Autorização por layout

- [ ] Acesso a `/admin/dashboard` com AAL2 mas sem entrada em `platform_admins` → 404 (layout chama `notFound()`).
- [ ] Acesso a `/admin/dashboard` com AAL2 + platform_admin ativo → renderiza stub do dashboard.

### MFA Enroll

- [ ] QR code renderiza (elemento `<img>` com `src` iniciando em `data:image/png`).
- [ ] Código TOTP correto após enroll → sessão sobe para AAL2 → redireciona para `/admin/dashboard`.
- [ ] Código TOTP incorreto → mensagem de erro sem revelar detalhes técnicos.

### MFA Challenge

- [ ] Código TOTP correto → sessão sobe para AAL2 → redireciona para `/admin/dashboard`.
- [ ] Código TOTP incorreto → mensagem de erro genérica.

### Import Isolation

- [ ] `npm run build:check` sai 0 no estado clean.
- [ ] `npm run build:check` sai 1 quando `import '@/lib/auth/platformAdmin'` é adicionado em qualquer arquivo `src/app/(app)/**`.

### Build e qualidade

- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código (design system compliance + TypeScript strict).

### Branding e UX

- [ ] Layout admin visualmente distinto: banner "Axon Admin" com ícone Shield presente em todas as rotas protegidas.
- [ ] Tokens CSS admin (`[data-admin]`) definidos em globals.css.
- [ ] Dark mode funcional no layout admin (testado com `data-theme="dark"` no `<html>`).

### Runbook

- [ ] `docs/admin_area/runbook_mfa_setup.md` criado com passos para: (a) habilitar TOTP MFA no projeto Supabase, (b) configurar `JWT expiry` para 8h no dashboard Supabase.

---

## 8. Implementation Plan

### Fase 1: Backend — Middleware + Script CI

**Agente:** `@backend`

**Artefatos:**
- `src/middleware.ts` (novo — middleware global Next.js)
- `scripts/check-import-isolation.mjs` (novo — script CI ESM)
- `package.json` — adição de script `build:check`
- `docs/admin_area/runbook_mfa_setup.md` (novo)

**Passos:**
1. Criar `src/middleware.ts` com a lógica de três camadas descrita em §3: customer protection + admin protection (AAL gate) + rotas públicas admin.
2. Criar `scripts/check-import-isolation.mjs`: scanner de imports que rejeita referências admin em arquivos customer.
3. Adicionar `"build:check": "node scripts/check-import-isolation.mjs && next build"` em `package.json`.
4. Criar `docs/admin_area/runbook_mfa_setup.md` com passos manuais de configuração Supabase.

**Estimated time:** ~25 min

### Fase 2: Frontend — Layout + Páginas admin

**Agente:** `@frontend+`

**Artefatos:**
- `src/app/(admin)/layout.tsx`
- `src/app/(admin)/login/page.tsx`
- `src/app/(admin)/mfa-enroll/page.tsx`
- `src/app/(admin)/mfa-challenge/page.tsx`
- `src/app/(admin)/unauthorized/page.tsx`
- `src/app/(admin)/dashboard/page.tsx`
- `src/components/admin/AdminLoginForm.tsx`
- `src/components/admin/AdminMfaEnrollForm.tsx`
- `src/components/admin/AdminMfaChallengeForm.tsx`
- `src/components/admin/AdminContextBanner.tsx`
- `src/components/admin/AdminSidebar.tsx` (stub vazio — itens de navegação virão nos sprints 05+)
- `src/components/admin/AdminTopbar.tsx`
- `src/app/globals.css` — adição de tokens `[data-admin]`

**Passos:**
1. Adicionar tokens CSS `[data-admin]` em `globals.css`.
2. Criar `src/app/(admin)/layout.tsx` com `requirePlatformAdmin()` e wrapper `data-admin`.
3. Criar componentes compartilhados: `AdminContextBanner`, `AdminSidebar` (stub), `AdminTopbar`.
4. Criar `src/app/(admin)/login/page.tsx` + `AdminLoginForm`.
5. Criar `src/app/(admin)/mfa-enroll/page.tsx` + `AdminMfaEnrollForm`.
6. Criar `src/app/(admin)/mfa-challenge/page.tsx` + `AdminMfaChallengeForm`.
7. Criar `src/app/(admin)/unauthorized/page.tsx`.
8. Criar `src/app/(admin)/dashboard/page.tsx` (stub).

**Estimated time:** ~40 min

### Fase 3: Guardian + Gates

**Agente:** `@guardian`

1. Revisar compliance de design system em todos os arquivos novos.
2. Verificar TypeScript strict (sem `any`, tipos explícitos).
3. Verificar ausência de import de platformAdmin em `(app)/`.

**Estimated time:** ~10 min

### Fase 4: Gates automáticos

- GATE 1: n/a (sem migration)
- GATE 2: `npm run build` + `npm run lint`
- GATE 4: Guardian review
- GATE 4.5: n/a (sem Server Actions)
- GATE 5: verificação estática de design (`node scripts/verify-design.mjs --changed`)

**Estimated time:** ~5 min

**Total Estimated Time:** ~80 min (25 + 40 + 10 + 5)

---

## 9. Risks & Mitigations

### Risco 1: MFA não habilitado no projeto Supabase

**Impact:** Alto
**Probability:** Alta (tarefa manual de dashboard, fácil de esquecer)
**Mitigation:** `runbook_mfa_setup.md` documenta os passos explicitamente. `@frontend+` deve adicionar mensagem de erro amigável quando `supabase.auth.mfa.enroll()` retornar erro de feature desabilitada. Em dev local, usar `supabase.io/dashboard → Authentication → MFA → enable TOTP`.

### Risco 2: `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` indisponível no Edge Runtime

**Impact:** Alto
**Probability:** Baixa (Supabase SSR SDK é compatível com Edge, mas vale verificar)
**Mitigation:** Testar no build antes de merge. Se incompatível com Edge, alternativa: usar `supabase.auth.getSession()` e inspecionar `session.user.aal` da JWT — o valor AAL está no JWT como claim `aal`. Fallback: `session?.user?.factors?.length > 0 && session.amr?.includes('totp')` como proxy.

### Risco 3: Loop de redirecionamento

**Impact:** Alto
**Probability:** Média (rotas públicas admin precisam estar corretamente isentas)
**Mitigation:** A lista `ADMIN_PUBLIC` no middleware é exaustiva e testada manualmente antes do merge. O `@guardian` verifica a lista durante o review. Test: GET `/admin/login` com e sem sessão — nenhum redireciona de volta para login.

### Risco 4: `requirePlatformAdmin()` usa `notFound()` que pode vazar estrutura de rotas

**Impact:** Baixo
**Probability:** Baixa
**Mitigation:** `notFound()` do Next.js renderiza a página `not-found.tsx` mais próxima. Criar `src/app/(admin)/not-found.tsx` com mensagem genérica "Página não encontrada" sem revelar estrutura admin.

### Risco 5: Tokens CSS `[data-admin]` conflitando com dark mode

**Impact:** Médio
**Probability:** Média
**Mitigation:** O `data-admin` é um atributo distinto de `data-theme`. Tokens admin devem ser definidos como variáveis CSS absolutas (não relativos a `data-theme`), ou definidos em ambas as variantes `[data-admin][data-theme="dark"]` e `[data-admin][data-theme="light"]`.

---

## 10. Dependencies

### Internas

- [x] `src/lib/auth/platformAdmin.ts` (`requirePlatformAdmin`, `getPlatformAdmin`) — criado no Sprint 02 ✅
- [x] `src/lib/supabase/middleware.ts` (`updateSession`) — existente no projeto ✅
- [x] `src/lib/supabase/server.ts` (`createClient`) — existente ✅
- [x] `public.platform_admins` table + RPC `is_platform_admin` — criados no Sprint 02 ✅
- [ ] MFA habilitado no projeto Supabase (tarefa manual — documentada em runbook)
- [ ] Duração de sessão configurada (8h/12h) no dashboard Supabase (tarefa manual — documentada em runbook)

### Externas

Nenhuma dependência de npm nova esperada. Supabase Auth SDK já está presente.

---

## 11. Rollback Plan

Se issues forem encontrados após merge:

1. **Imediato:** `git revert [commit-hash]` — remove o middleware, as páginas admin e o script CI.
2. **Database:** nenhuma migration criada — sem ação de banco.
3. **Efeito colateral:** sem `src/middleware.ts`, a proteção `/dashboard` também é removida. Após rollback, verificar que `src/lib/supabase/middleware.ts` ainda é chamado de onde estava antes (investigar se havia um `middleware.ts` antes — confirmado: não havia, portanto rollback não quebra customer app).
4. **Verificação pós-rollback:** `npm run build` + acesso a `/dashboard` sem login deve ainda redirecionar para `/login` (verificar se havia middleware antes do sprint — se não havia, customer app usa proteção em layout — confirmar).

> **Nota para `@backend`:** antes de criar `src/middleware.ts`, documentar no PR se havia ou não proteção de rota no `/dashboard` antes deste sprint (via layout vs middleware). Se a proteção era via `getSessionContext()` no layout, o rollback não quebra nada. Se havia um middleware existente, fazer backup da lógica antes de sobrescrever.

---

## Approval

**Created by:** @spec-writer
**Reviewed by:** — (aguardando @sanity-checker)
**Approved by:** — (aguardando usuário)
**Date:** 2026-04-24
