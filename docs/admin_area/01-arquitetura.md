# 01 — Arquitetura

## Estrutura de pastas

```
src/app/
├── (app)/                          ← CUSTOMER (existente, sem mudança)
│   ├── dashboard/
│   ├── leads/
│   ├── leads-origins/
│   ├── leads-loss-reasons/
│   ├── leads-tags/
│   ├── pipeline/
│   ├── products/
│   ├── funnels/
│   ├── settings/
│   │   ├── catalog/categories/
│   │   ├── organization/
│   │   ├── profile/
│   │   └── team/
│   ├── whatsapp-groups/
│   └── layout.tsx                  ← AppLayout (sidebar customer)
│
├── (admin)/                        ← NOVO — área SaaS owner
│   ├── dashboard/
│   │   └── page.tsx                ← 3 KPIs (orgs, users, leads)
│   ├── organizations/
│   │   ├── page.tsx                ← list
│   │   ├── [id]/
│   │   │   ├── page.tsx            ← detalhe
│   │   │   └── actions.ts          ← suspend, activate, impersonate
│   │   └── actions.ts
│   ├── plans/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   ├── new/page.tsx
│   │   └── actions.ts
│   ├── subscriptions/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   └── actions.ts
│   ├── admins/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   ├── new/page.tsx
│   │   └── actions.ts
│   ├── audit-log/
│   │   └── page.tsx
│   ├── platform-settings/
│   │   ├── page.tsx
│   │   ├── features/page.tsx
│   │   ├── trial/page.tsx
│   │   ├── integrations/page.tsx
│   │   ├── policies/page.tsx
│   │   └── actions.ts
│   └── layout.tsx                  ← AdminLayout (sidebar admin distinta)
│
├── (auth)/                         ← COMPARTILHADO
│   ├── login/
│   │   └── page.tsx                ← detecta se é admin via flag ou subdomínio
│   ├── signup/                     ← só customer
│   ├── accept-invite/              ← só customer
│   └── admin-login/                ← NOVO — login dedicado do admin com MFA
│       └── page.tsx
│
├── api/
│   └── impersonation/              ← NOVO — endpoints para customer consumir
│       ├── start/route.ts
│       └── end/route.ts
│
├── auth/callback/                  ← existente
└── middleware.ts                   ← AJUSTADO — reconhece (admin)/*
```

## Árvore de decisão do middleware

```
request em /?
│
├── /admin/*                        ── rota admin
│   ├── user não logado?            → redirect /admin-login
│   ├── user logado mas SEM entrada ativa em platform_admins? → 403 ou /admin-login
│   ├── user OK mas MFA não satisfeito? → /admin-login?mfa=1
│   └── tudo OK → renderiza
│
├── /api/impersonation/*            ── endpoint público protegido
│   └── valida HMAC do token + TTL antes de criar sessão customer
│
├── /login, /signup, /admin-login   ── rotas públicas
│   └── renderiza
│
└── /* (tudo o mais)                ── rota customer
    ├── user não logado?            → redirect /login
    ├── user logado mas SEM profile? → /login?err=no_profile
    └── tudo OK → renderiza
```

## Padrão service_role

### Customer (comportamento existente, sem mudança)

```ts
// src/app/(app)/leads/actions.ts
import { createServerClient } from '@/lib/supabase/server'

export async function createLead(data: LeadInput) {
  const supabase = await createServerClient()  // client com sessão do user
  const { data: lead, error } = await supabase
    .from('leads')
    .insert(data)                               // RLS filtra por organization_id
    .select()
    .single()
  // ...
}
```

### Admin (novo padrão)

```ts
// src/app/(admin)/organizations/actions.ts
import { assertPlatformAdmin } from '@/lib/admin/guards'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { logAdminAction } from '@/lib/admin/audit'

export async function suspendOrganization(orgId: string, reason: string) {
  const admin = await assertPlatformAdmin()           // lança se não for admin ativo
  const supabase = createServiceRoleClient()           // bypassa RLS

  const { data, error } = await supabase
    .from('organizations')
    .update({ is_active: false })
    .eq('id', orgId)
    .select()
    .single()

  if (error) throw error

  await logAdminAction({
    adminId: admin.id,
    action: 'organization.suspend',
    targetType: 'organization',
    targetId: orgId,
    metadata: { reason }
  })

  return data
}
```

### Regras invioláveis

| Pasta | Usa `createServerClient()`? | Usa `createServiceRoleClient()`? | Chama `assertPlatformAdmin()`? |
|---|---|---|---|
| `src/app/(app)/**/actions.ts` | ✅ Sempre | ❌ Nunca | ❌ Nunca |
| `src/app/(admin)/**/actions.ts` | ❌ Nunca | ✅ Sempre | ✅ Sempre (primeira linha) |
| `src/app/api/impersonation/**` | Caso especial — ver fluxo de impersonation abaixo |

Essas regras são enforced por:
1. **ESLint** — `no-restricted-imports` bloqueando service_role fora de `(admin)/`
2. **@guardian agent** — audita Server Actions no GATE 4

## Fluxo de auth

### Login customer (existente — sem mudança)

```
1. User acessa /login
2. Preenche email + senha
3. Supabase auth.signInWithPassword()
4. Servidor valida que user tem profile ativo
5. Redirect para /dashboard
```

### Login admin (novo)

```
1. Admin acessa /admin-login
2. Preenche email + senha
3. Supabase auth.signInWithPassword()
4. Servidor valida platform_admins.user_id = auth.user.id AND is_active = true
5. Se MFA não configurado → força enrollment TOTP (Supabase MFA)
6. Prompt do 6 dígitos TOTP
7. Valida TOTP → cria session com claim platform_admin = true
8. Redirect para /admin/dashboard
```

**Observação:** Supabase nativo suporta MFA TOTP desde 2024. Usar a API oficial (`supabase.auth.mfa.enroll`, `challenge`, `verify`). Não implementar TOTP manualmente.

## Fluxo de impersonation

### Início (admin → customer)

```
1. Admin abre /admin/organizations/[orgId]
2. Clica em "Impersonar [User X]" na lista de users da org
3. Browser envia POST /admin/organizations/[orgId]/actions (server action)
4. Server action:
   a. assertPlatformAdmin() → OK
   b. Gera token HMAC assinado: {adminId, targetUserId, orgId, exp: now + 30min, nonce}
   c. Grava em impersonation_sessions: started_at = now, status = 'active'
   d. logAdminAction('impersonation.start')
   e. Retorna URL: app.axonai.com.br/api/impersonation/start?token=<hmac_token>
5. Browser segue redirect
6. Endpoint /api/impersonation/start:
   a. Valida HMAC + exp
   b. Cria cookie de sessão customer usando supabase admin API (signInWithId ou similar)
   c. Seta cookie marker: impersonation_active=true, impersonation_session_id=<uuid>
   d. Redirect /dashboard
7. Customer app renderiza com banner permanente
```

### Fim (manual ou TTL)

```
Manual:
1. User/admin clica em "Sair da impersonation" no banner
2. Browser POST /api/impersonation/end
3. Endpoint:
   a. Lê cookie impersonation_session_id
   b. Atualiza impersonation_sessions.ended_at = now, status = 'ended'
   c. Limpa cookies de sessão + marker
   d. Redirect /admin/dashboard (ou /login se sessão admin expirou)

TTL:
- Job diário (cron Supabase ou edge function) marca sessions expiradas como status = 'expired'
- Se user tentar usar sessão expirada, middleware do customer valida e força logout
```

### Banner obrigatório

Componente `<ImpersonationBanner />` renderizado **no root layout** do customer `src/app/(app)/layout.tsx` quando cookie `impersonation_active=true`. Texto exato:

```
⚠️ Você está visualizando como [User X] da org [Org Y] — admin: [Admin Z]
[Botão: Sair da impersonation]
```

Fundo warning (amarelo do design system), sticky no topo, **não dismissível**.

## Subdomain rewrite (opcional, Sprint 2)

Se decidirmos servir admin em subdomínio separado em vez de path prefix:

```ts
// next.config.ts
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'admin.axonai.com.br' }],
        destination: '/admin/:path*',
      },
    ]
  }
}
```

**Efeitos:**
- URL visível: `admin.axonai.com.br/organizations` (sem o `/admin` prefix)
- Cookie separado: browser trata `admin.axonai.com.br` como origem diferente de `app.axonai.com.br`
- Sessões de admin e customer ficam totalmente isoladas em nível de cookie
- Config DNS: apontar `admin.axonai.com.br` para o mesmo deploy Next.js

**Config de cookie:** **não** usar `domain=.axonai.com.br` nos cookies — deixar default (host-only) para garantir isolamento.

## Prevenção de cross-imports

### ESLint config

```js
// eslint.config.mjs — adicionar à config existente
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['**/app/(admin)/**', '**/app/\\(admin\\)/**'],
          message: 'Código em (app) não pode importar de (admin) — viola isolamento'
        },
        {
          group: ['**/app/(app)/**', '**/app/\\(app\\)/**'],
          message: 'Código em (admin) não pode importar de (app) — viola isolamento'
        },
        {
          group: ['**/lib/supabase/service-role'],
          message: 'service_role client só pode ser usado em src/app/(admin)/**/actions.ts'
        }
      ]
    }]
  }
}
```

**Overrides:** permitir `service-role` import **apenas** em `src/app/(admin)/**/actions.ts` e `src/lib/admin/**` via `overrides` na config.

### Guardian (GATE 4) — verificações extras

Ao revisar código em `(admin)/`:
- Toda Server Action começa com `assertPlatformAdmin()`? (fail se não)
- Toda Server Action de mutação chama `logAdminAction()`? (fail se não)
- Nenhum componente server/client importa de `(app)/`? (fail se sim)
- Nenhum uso de `createServerClient` em `(admin)/`? (fail se sim)

## Shared utilities

Compartilhados entre customer e admin (não copiar):

| Path | Uso |
|---|---|
| `src/lib/supabase/server.ts` | Client com sessão — usado por customer |
| `src/lib/supabase/browser.ts` | Client de browser — usado por ambos (com cuidado) |
| `src/lib/supabase/service-role.ts` | **NOVO** — factory de client com service role (admin only) |
| `src/lib/admin/guards.ts` | **NOVO** — `assertPlatformAdmin()` |
| `src/lib/admin/audit.ts` | **NOVO** — `logAdminAction()` |
| `src/lib/admin/impersonation.ts` | **NOVO** — `signImpersonationToken()`, `verifyImpersonationToken()` |
| `src/lib/admin/encryption.ts` | **NOVO** — wrappers para cifragem de `platform_integration_credentials` |
| `src/components/ui/*` | Design system — usado por ambos |
| `src/types/database.ts` | Types gerados do Supabase — usado por ambos |

## Convenção de componentes

- `src/app/(admin)/**/_components/` — componentes locais do módulo admin
- `src/app/(app)/**/_components/` — componentes locais do módulo customer (já existe)
- `src/components/admin/` — componentes compartilhados **apenas entre telas admin** (ex: `AdminSidebar`, `AdminTopbar`)
- `src/components/ui/` — design system, usado por ambos

**Nunca** criar `src/components/shared/` — se o componente serve ambos, fica em `src/components/ui/`.
