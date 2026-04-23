# 03 — Modelo de Segurança

Todas as regras aqui são complementares ao `docs/conventions/security.md` do framework. O Sprint 0 inclui um append a esse arquivo com uma seção "Platform Admin Area".

## Princípios

1. **Defesa em profundidade:** autenticação (Supabase) + autorização (`platform_admins` check) + MFA + asserções em cada action + audit log.
2. **Least privilege:** `service_role` só é usado onde RLS seria desnecessariamente complexa. Nunca usado em customer app.
3. **Auditabilidade:** toda mutação em dados sensíveis (organizations, plans, subscriptions, settings, credentials) é registrada em `platform_audit_log` de forma imutável.
4. **Separação de contextos:** customer nunca tem acesso a código ou dados da área admin; admin acessa dados de tenants apenas via service_role explicitamente gated.

## Helper `assertPlatformAdmin()`

### Contrato

```ts
// src/lib/admin/guards.ts
import { createServerClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { redirect } from 'next/navigation'

export type PlatformAdmin = {
  id: string
  user_id: string
  role: 'owner' | 'support' | 'billing'
  full_name: string
  email: string
}

/**
 * Garante que o caller é um platform admin ativo com MFA satisfeito.
 * Lança/redireciona se não for. Retorna os dados do admin caso OK.
 *
 * Uso obrigatório como PRIMEIRA linha de toda Server Action em src/app/(admin)/**.
 */
export async function assertPlatformAdmin(): Promise<PlatformAdmin> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/admin-login')

  // Checa MFA assurance level (AAL2 = MFA satisfeito)
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== 'aal2') redirect('/admin-login?mfa=1')

  const serviceClient = createServiceRoleClient()
  const { data: admin } = await serviceClient
    .from('platform_admins')
    .select('id, user_id, role, full_name, email, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!admin) redirect('/admin-login?err=not_admin')

  return admin as PlatformAdmin
}
```

### Regras de uso

- **Obrigatório como primeira linha** de toda Server Action em `src/app/(admin)/**/actions.ts`
- **Não chamar em Route Handlers (`/api/**`)** a menos que seja endpoint admin (a maioria das rotas API do admin será via Server Actions, não Route Handlers)
- **Não confiar** só no middleware — Server Actions podem ser chamadas por qualquer cliente autenticado que saiba o nome da action; o middleware só protege renderização de páginas

### Variante para Route Handlers

Caso seja necessário um endpoint HTTP (ex: webhook ou endpoint chamado por outro sistema):

```ts
// Em Route Handler
export async function POST(req: Request) {
  const admin = await assertPlatformAdminOrThrow() // variante que throws JSON em vez de redirect
  // ...
}
```

## Helper `logAdminAction()`

```ts
// src/lib/admin/audit.ts
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { headers } from 'next/headers'

type AuditActionInput = {
  adminId: string
  action: string                              // 'organization.suspend', etc
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}

export async function logAdminAction(input: AuditActionInput): Promise<void> {
  const supabase = createServiceRoleClient()
  const hdrs = await headers()

  const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = hdrs.get('user-agent') || null

  const { error } = await supabase.from('platform_audit_log').insert({
    admin_id: input.adminId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ip_address: ipAddress,
    user_agent: userAgent,
  })

  if (error) {
    // Log mas não bloqueia a action — audit log não deve quebrar operação
    console.error('[audit] failed to log action', { input, error })
  }
}
```

### Regras de uso

- Chamar **após** mutações bem-sucedidas, não antes. Se a operação falha, não loga.
- Toda Server Action **de mutação** em `(admin)/` deve chamar `logAdminAction()`. Leituras (list, detail) não precisam — geram ruído.
- O `action` deve seguir o formato `<resource>.<verb>` do catálogo em `02-schema-banco.md`.
- `metadata` pode conter contexto relevante (reason, before/after values, etc) — evitar incluir dados sensíveis como senhas.

## MFA obrigatório para platform admins

Supabase Auth nativo suporta TOTP MFA desde 2024. Fluxo de enrollment:

```ts
// No fluxo de login admin, após signInWithPassword:
const { data: { user } } = await supabase.auth.getUser()

// Verifica se MFA está configurado
const { data: factors } = await supabase.auth.mfa.listFactors()
const totpFactor = factors?.totp?.find(f => f.status === 'verified')

if (!totpFactor) {
  // Primeiro login — força enrollment
  const { data: enrollData } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator App',
  })
  // Mostra QR code ao user: enrollData.totp.qr_code
  // User digita o código → supabase.auth.mfa.challenge + verify
  // Só após verify bem sucedido → marca platform_admins.mfa_enrolled_at = now
}

// Login normal — se totpFactor existe mas aal2 não satisfeito:
// força challenge + verify
```

**Regra:** `assertPlatformAdmin()` **exige** `aal2`. Admin sem MFA ativo não consegue executar nenhuma action admin — é redirecionado para o fluxo de enrollment/challenge.

## Token de impersonation

### Formato

HMAC-SHA256 assinado, transmitido como base64url na query string.

```ts
// src/lib/admin/impersonation.ts
import { createHmac, timingSafeEqual, randomUUID } from 'crypto'

type ImpersonationPayload = {
  adminId: string
  targetUserId: string
  targetOrgId: string
  sessionId: string      // impersonation_sessions.id
  exp: number            // unix timestamp
  nonce: string
}

const SECRET = process.env.IMPERSONATION_SECRET!  // env var — gerar 64 bytes random
const TTL_SECONDS = 30 * 60  // 30 minutos

export function signImpersonationToken(payload: Omit<ImpersonationPayload, 'exp' | 'nonce'>): string {
  const full: ImpersonationPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    nonce: randomUUID(),
  }

  const body = Buffer.from(JSON.stringify(full)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url')

  return `${body}.${sig}`
}

export function verifyImpersonationToken(token: string): ImpersonationPayload {
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new Error('Invalid token format')

  const expectedSig = createHmac('sha256', SECRET).update(body).digest('base64url')
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid token signature')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as ImpersonationPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired')

  return payload
}
```

### Regras

- `IMPERSONATION_SECRET` deve ser **diferente** de outras env vars (não reusar NEXTAUTH_SECRET, etc). Mínimo 64 bytes random.
- Rotação da secret invalida todos os tokens ativos — ok porque TTL é 30min.
- Token é **single-use**: endpoint `/api/impersonation/start` valida, marca `impersonation_sessions.status = 'active'` e atomicamente consome o `nonce` em tabela `used_nonces` (ou checa no próprio `impersonation_sessions.id` se já está `active`).

## RLS das tabelas globais

### Princípio: DENY ALL como default

Para tabelas sem `organization_id` (`platform_admins`, `platform_audit_log`, `platform_settings`, `impersonation_sessions`, `platform_integration_credentials`):

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
-- NENHUMA policy criada → default DENY para authenticated
-- service_role bypassa RLS (comportamento nativo Supabase)
```

**Exceções pontuais com policy específica:**

- `plans` — SELECT público para authenticated (customer precisa ver planos)
- `subscriptions` — SELECT para users da própria org (customer precisa ver a própria subscription)

### Validação (ligada ao GATE 1 do framework)

O `@db-admin` ao criar migrations do Sprint 1 deve garantir:
```sql
-- Para cada tabela global nova:
SELECT 1 FROM pg_policies WHERE tablename = 'platform_admins';
-- Deve retornar 0 linhas (DENY ALL é ausência de policy)
```

O `@guardian` no GATE 4 verifica que as actions admin usam `createServiceRoleClient()` — se usassem o client de sessão, cairiam no DENY e dariam erro em runtime.

## Proteção do `SUPABASE_SERVICE_ROLE_KEY`

### Ameaça

No modelo Opção 3 (route group `(admin)`), a env var `SUPABASE_SERVICE_ROLE_KEY` está disponível no processo Node.js de todo o app. Se uma Server Action customer **acidentalmente** importar `createServiceRoleClient()` e usar, bypassa RLS e expõe dados cross-tenant.

### Mitigações em camadas

1. **ESLint `no-restricted-imports`** — bloqueia import de `@/lib/supabase/service-role` fora de `src/app/(admin)/**` e `src/lib/admin/**`. Build falha.

2. **Guardian review (GATE 4)** — valida que nenhum arquivo em `(app)/` importa service_role. Falha se encontrar.

3. **Bundle analyzer no CI** — script opcional que inspeciona o bundle gerado do customer e confirma que `SUPABASE_SERVICE_ROLE_KEY` não aparece em chunks enviados ao browser (não deveria mesmo em Server Actions, mas é sanity check).

4. **Convenção de nome óbvia** — `createServiceRoleClient` (verboso de propósito) vs `createServerClient` (customer). Reduz chance de erro por autocomplete.

## Impersonation — proteções adicionais

1. **Banner permanente na UI** — user/admin sempre vê que está impersonando. Não é dismissível.

2. **Escopo limitado** — durante impersonation, o banner tem botão "Sair" que encerra a sessão imediatamente.

3. **Ações restritas durante impersonation** — considerar no Sprint 3 se há ações que NÃO podem ser executadas sob impersonation (ex: trocar senha do user, excluir a própria conta). Decisão: **bloquear** alterações de credenciais (senha, email, MFA) do user-alvo durante impersonation. O admin não deve conseguir trocar a senha do user sem autorização explícita.

4. **TTL curto** — 30 minutos é o default. Configurável em `platform_settings` em sprint futuro.

5. **Reason obrigatório** — admin precisa informar motivo ao iniciar impersonation. Fica em `impersonation_sessions.reason` e no audit log.

## Cifragem de credenciais de integração

Ver seção 7 de [02-schema-banco.md](./02-schema-banco.md). Escolha entre pgsodium e cifragem na aplicação fica para o Sprint 8.

**Requisitos invioláveis:**
- Nunca exibir valores decifrados em UI de listagem — só ao editar explicitamente.
- Rotação de credencial gera entrada no audit log (`integration_credential.update`).
- Ao decifrar para uso, manter o valor em memória apenas o tempo necessário, não logar.

## Logs e monitoramento

### O que DEVE logar no `platform_audit_log`

- Toda mutação em `organizations` (suspend, activate, update)
- Toda operação em `plans` (create, update, delete)
- Toda operação em `subscriptions` (assign, change, extend, cancel)
- Toda operação em `platform_admins` (create, update, deactivate)
- Toda operação em `platform_settings` (update)
- Toda operação em `platform_integration_credentials` (create, update, delete)
- `impersonation.start` e `impersonation.end`

### O que NÃO deve logar

- Reads (list, detail) — gera ruído sem valor
- Erros de validação de input (não é ação do admin, é erro de UX)
- Dados sensíveis no campo `metadata` — senhas, credenciais decifradas, tokens

## Checklist de segurança para code review (Guardian)

Ao revisar qualquer Server Action em `src/app/(admin)/`, o `@guardian` deve confirmar:

- [ ] Primeira linha é `await assertPlatformAdmin()`
- [ ] Uso de `createServiceRoleClient()` (não `createServerClient`)
- [ ] Mutations são seguidas de `logAdminAction()`
- [ ] Não há `console.log` de dados sensíveis (credenciais, tokens, senhas)
- [ ] Validação de input (Zod schema) antes de qualquer query
- [ ] Não importa de `(app)/`
- [ ] Erros não expõem estrutura interna do banco ou stack trace ao client

Qualquer item falhando → GATE 4 reprova e delega correção ao agente que escreveu o código.
