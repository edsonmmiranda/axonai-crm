# Security Guidelines — Fonte Autoritativa

Diretrizes de segurança **obrigatrias** para todos os projetos derivados do framework. Este documento centraliza tudo que estava disperso em `standards.md`, `backend.md`, `guardian.md` e `env.example`.

**Leitores:** todos os agentes. **Writer:** Tech Lead (nica autoridade para emendar).
**Verificador:** `@guardian` (usa este arquivo como fonte normativa para 3).

---

## 1. Autenticao & Sesso

### 1.1 Identidade sempre do servidor

O `user_id` **nunca** vem do cliente. Sempre extraa do JWT server-side:

```typescript
// CORRETO  server-side, impossvel de falsificar
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { success: false, error: 'No autenticado' };

// user.id  confivel  veio do JWT validado no servidor
```

```typescript
//  PROIBIDO  aceitar user_id como parmetro do cliente
export async function getItemAction(userId: string, itemId: string) { ... }
```

**Regra:** Server Actions **nunca** aceitam `user_id`, `organization_id` ou `tenant_id` como parmetro. Esses valores so extrados de `supabase.auth.getUser()` ou `auth.jwt()` no servidor.

### 1.2 Service Role Key

A `SUPABASE_SERVICE_ROLE_KEY` **bypassa todas as RLS**. Regras:

- **Nunca** use prefixo `NEXT_PUBLIC_` para esta chave
- **Nunca** importe em componentes client-side (`'use client'`)
- **Nunca** logue o valor da chave
- Se vazar, **rotacione imediatamente** no dashboard do Supabase
- Uso permitido apenas em Server Actions/API Routes server-side para operaes admin

### 1.3 Sesso e cookies

- Use `@supabase/ssr` para gerenciamento de sesso (no custom JWT)
- No armazene dados sensveis em `localStorage` ou `sessionStorage`
- Tokens de sesso devem ser `httpOnly`, `secure`, `sameSite: 'lax'`

---

## 2. Autorizao & Isolamento de Dados

### 2.1 Row Level Security (RLS)  obrigatrio

**Toda tabela** com dados de usurio deve ter RLS habilitado. Sem exceo.

```sql
-- Obrigatrio em toda migration
alter table public.nome_tabela enable row level security;

-- Policies mnimas (CRUD completo)
create policy "select_own" on public.nome_tabela for select
  using (auth.uid() = user_id);

create policy "insert_own" on public.nome_tabela for insert
  with check (auth.uid() = user_id);

create policy "update_own" on public.nome_tabela for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete_own" on public.nome_tabela for delete
  using (auth.uid() = user_id);
```

### 2.2 Multi-tenancy — `organization_id` obrigatrio

**Regra inviolvel** (ver `standards.md`  Multi-tenancy): toda tabela de domnio em `public.*` tem coluna `organization_id uuid not null` e RLS que filtra por ela. Sem exceo, mesmo em projetos "single-tenant"  a coluna existe desde a primeira migration para permitir expanso futura.

```sql
-- Toda tabela com dados de cliente
create policy "select_own_org" on public.nome_tabela for select
  using (
    auth.uid() = user_id
    AND organization_id = (auth.jwt() ->> 'organization_id')::uuid
  );
```

- **Fonte do valor:** `organization_id` vem exclusivamente de `auth.jwt() ->> 'organization_id'` (custom claim), **nunca** do request body ou de parmetro de funo.
- **Como popular o custom claim:** via **Supabase Auth Hook** (`custom_access_token_hook`)  caminho oficial desde 2024. **No use triggers em `auth.users`**: triggers no re-executam ao renovar sesso, ento o claim pode ficar desatualizado e a RLS passa a falhar silenciosamente "open".

#### Configurao do Auth Hook (passo nico por projeto)

Sem este passo, **nenhum dado aparece** para usurios autenticados  a RLS fecha por padro quando o claim est ausente.

1. Criar uma funo Postgres `public.custom_access_token_hook(event jsonb) returns jsonb` que:
   - L o `organization_id` do usurio (normalmente de `profiles.organization_id` ou tabela equivalente)
   - Retorna `event` com o claim injetado em `event.claims.organization_id`
   - Deve ser `SECURITY DEFINER` com GRANTS restritos (`supabase_auth_admin` executa; `anon` e `authenticated` revogados)
2. No dashboard do Supabase: **Auth  Hooks  Custom Access Token  selecionar `custom_access_token_hook`**  Save.
3. Testar: fazer login, inspecionar o JWT em jwt.io, confirmar que `organization_id` aparece nos claims.
4. Repetir para cada ambiente (dev, staging, prod) separadamente  cada projeto Supabase tem sua prpria configurao.
- **Falha-modo crtico:** se o JWT no contiver `organization_id`, a expresso `(auth.jwt() ->> 'organization_id')::uuid` retorna `NULL` e a comparao `organization_id = NULL` retorna `NULL` (tratado como falso pelas policies)  ou seja, nenhum dado aparece. Teste isso explicitamente ao configurar um novo ambiente.
- **Exceo nica:** tabelas globais read-only (catlogos compartilhados, feature flags do sistema) vivem em schema separado `public_ref`, listado em `standards.md`. Qualquer coisa em `public.*` exige `organization_id`.

### 2.3 SECURITY DEFINER

Funes PostgreSQL com `SECURITY DEFINER` rodam com privilgios do criador (geralmente superuser). Regras:

- Usar **apenas** para operaes read-only de introspeco
- Sempre restringir GRANTS: revogar `anon`, conceder apenas `authenticated` e `service_role`
- Nunca criar funes SECURITY DEFINER que aceitam input do usurio sem validao

---

## 3. Validao de Input

### 3.1 Zod na borda de toda Server Action

```typescript
// Obrigatrio: validar ANTES de qualquer lgica
const parsed = ItemInputSchema.safeParse(input);
if (!parsed.success) {
  return { success: false, error: parsed.error.issues[0]?.message ?? 'Input invlido' };
}
```

### 3.2 Schemas strict

- **Sem** `.passthrough()` — apenas campos declarados so aceitos
- **Sem** `.catchall()` em schemas de input
- IDs devem ser validados como UUID: `z.string().uuid()`
- Strings devem ter `.trim()` e limites de tamanho (`.min()`, `.max()`)

### 3.3 Parmetros de URL e query strings

- Sempre valide `params` e `searchParams` com Zod antes de usar
- Nunca interpole parmetros de URL diretamente em queries

---

## 4. Proteo contra Ataques

### 4.1 XSS (Cross-Site Scripting)

- **Proibido:** `dangerouslySetInnerHTML` — exceto para contedo sanitizado por biblioteca dedicada (ex: `DOMPurify`)
- **Proibido:** `innerHTML` via refs do DOM
- **Proibido:** `href={userInput}` sem validao — URLs devem comear com `https://` ou `/` (bloquear `javascript:`)
- React/JSX escapa automaticamente — no desabilite esse comportamento

### 4.2 SQL Injection

- **Obrigatrio:** usar SDK parametrizado do Supabase (`.eq()`, `.insert()`, `.ilike()`)
- **Proibido:** SQL raw com interpolao de strings (`\`SELECT * FROM ${table}\``)
- **Proibido:** `.rpc()` com parmetros no validados
- Se SQL raw for inevitvel (extremamente raro): usar `$1, $2` placeholders, nunca template literals

### 4.3 CSRF (Cross-Site Request Forgery)

- Next.js 15 Server Actions tm proteo CSRF implcita (validao de `Origin` header)
- **No crie rotas REST custom** para mutaes — use Server Actions (regra j existente em `standards.md`)
- Se API Route REST for obrigatria (webhooks), valide `Origin`/`Referer` ou use tokens CSRF

### 4.4 Rate Limiting

Projetos derivados **devem** implementar rate limiting em:

| Superfcie | Prioridade | Recomendao |
|---|---|---|
| Login / auth endpoints | **Alta** | Supabase Auth j tem rate limiting bsico; configure limites no dashboard |
| Server Actions de mutao | Mdia | Middleware com `@upstash/ratelimit` ou similar |
| API Routes pblicas (webhooks) | **Alta** | Validar assinatura + rate limit por IP |
| Buscas / listagens | Baixa | Rate limit por usurio autenticado |

Exemplo de implementao:

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests por 10 segundos
});

// No incio da Server Action:
const { success } = await ratelimit.limit(user.id);
if (!success) return { success: false, error: 'Muitas requisies. Tente novamente em instantes.' };
```

---

## 5. Headers de Segurana

Projetos derivados **devem** configurar os seguintes headers em `next.config.js` ou middleware:

```javascript
// next.config.js
const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',                    // Previne clickjacking
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',                 // Previne MIME-type sniffing
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',  // Ajustar conforme necessidade
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',  // Fora HTTPS
  },
];

module.exports = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};
```

**Content Security Policy (CSP):** Configurar conforme o projeto. Mnimo recomendado:

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co;
```

> **Nota:** `unsafe-inline` e `unsafe-eval` podem ser necessrios para Next.js. Refine com nonces quando possvel.

---

## 6. Exposio de Dados

### 6.1 Erros

- **Nunca** retorne `error.message` ou stack traces para o cliente
- **Sempre** `console.error` no servidor + mensagem genrica para o usurio
- Formato obrigatrio: `return { success: false, error: 'Mensagem amigvel' }`

### 6.2 Logs

- **Nunca** logue: passwords, tokens, API keys, PII (email, CPF, telefone)
- **Permitido:** action name, user.id (UUID), timestamps, error codes
- Prefixe logs com nome da action: `console.error('[createItemAction]', error)`

### 6.3 Variveis de ambiente

- `NEXT_PUBLIC_*` — apenas para dados **no sensveis** (URL do Supabase, anon key)
- Chaves de servio, secrets, tokens de API — **sem** prefixo `NEXT_PUBLIC_`
- Valide variveis obrigatrias no boot da aplicao:

```typescript
// lib/env.ts
const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) throw new Error(`Missing env var: ${envVar}`);
}
```

---

## 7. File Upload (quando aplicvel)

O framework no inclui template de upload. Quando um projeto adicionar, **deve** seguir:

### 7.1 Validao

- Validar **MIME type** real (no apenas extenso) — use `file-type` ou similar
- Limitar tamanho mximo (ex: 5MB para imagens, 50MB para documentos)
- Whitelist de tipos permitidos (ex: `image/jpeg`, `image/png`, `application/pdf`)
- Sanitizar nome do arquivo (remover `../`, caracteres especiais, limitar comprimento)

### 7.2 Storage

- Buckets do Supabase Storage **devem** ter RLS habilitado
- **Nunca** crie buckets pblicos para dados de usurio
- Poltica mnima: `auth.uid() = owner_id` para leitura e escrita
- Use URLs assinadas (signed URLs) para acesso temporrio, no URLs pblicas

### 7.3 Processamento

- **Nunca** execute arquivos uploaded (scripts, executveis)
- Processe imagens server-side (resize, compress) antes de armazenar
- Considere scan de antivrus para uploads crticos (via servio externo)

---

## 8. Dependncias

### 8.1 Auditoria

- Adicionar `npm audit --audit-level=high` no pipeline de CI
- Revisar dependncias novas antes de instalar — verificar popularidade, manuteno, issues de segurana
- Manter `package-lock.json` commitado e atualizado

### 8.2 Prticas

- **Sem** `eval()` ou `new Function()` com input dinmico
- **Sem** `child_process.exec()` com input do usurio (command injection)
- **Sem** desserializao insegura (`JSON.parse` em input no validado sem try/catch)
- Preferir dependncias bem mantidas e auditadas a solues custom para criptografia/auth

---

## 9. Checklist rpido por fase

### Ao criar nova tabela (`@db-admin`)

- [ ] Tabela em `public.*` (no em `public_ref`, que  exceo documentada)
- [ ] Coluna `organization_id uuid not null` com FK para tabela de organizaes
- [ ] RLS habilitado
- [ ] Policies CRUD com `auth.uid() = user_id` + `organization_id = (auth.jwt() ->> 'organization_id')::uuid`
- [ ] Sem `SECURITY DEFINER` desnecessrio

### Ao criar Server Action (`@backend`)

- [ ] Zod valida input na borda
- [ ] `supabase.auth.getUser()` antes de qualquer query
- [ ] user_id/organization_id do servidor (JWT), nunca do cliente
- [ ] Try/catch com mensagem amigvel
- [ ] `ActionResponse<T>` como retorno
- [ ] Sem `error.message` exposto ao cliente

### Ao criar pgina/componente (`@frontend+`)

- [ ] Sem `dangerouslySetInnerHTML`
- [ ] Sem dados sensveis em estado client-side
- [ ] Links externos com `rel="noopener noreferrer"`
- [ ] `href` dinmico validado (sem `javascript:`)

### Ao configurar projeto (setup inicial)

- [ ] Security headers no `next.config.js`
- [ ] `.env.local` no `.gitignore`
- [ ] `service_role_key` sem `NEXT_PUBLIC_`
- [ ] Rate limiting configurado
- [ ] `npm audit` no CI
- [ ] **Funo `custom_access_token_hook` criada no banco** (via migration) e ativada no **Dashboard  Auth  Hooks  Custom Access Token**. Sem isso, nenhum dado aparece  a RLS fecha quando o claim `organization_id` est ausente do JWT. Ver 2.2 para passo-a-passo.
- [ ] Testar em jwt.io que um JWT logado tem `organization_id` nos claims (ambiente dev, staging e prod separadamente)

### Ao implementar file upload

- [ ] Validao de MIME type
- [ ] Limite de tamanho
- [ ] Bucket com RLS
- [ ] Nome de arquivo sanitizado
- [ ] Sem execuo de uploads

### Configurao de multi-tenancy (obrigatrio em todo projeto)

- [ ] `organization_id uuid not null` em toda tabela de `public.*`
- [ ] RLS com `organization_id = (auth.jwt() ->> 'organization_id')::uuid` em todas as policies
- [ ] Custom claim `organization_id` populado via **Supabase Auth Hook** (no via trigger em `auth.users`)
- [ ] `organization_id` do JWT, nunca do request body ou parmetro de funo
- [ ] Teste explcito: JWT sem o claim no deve retornar dados (fail-closed)
- [ ] Testes de isolamento entre organizaes
