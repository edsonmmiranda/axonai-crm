# PRD: Platform Admins, RBAC Base e Normalização de Role

**Template:** PRD_COMPLETE
**Complexity Score:** 12 points (DB 5 + API 2 + UI 0 + Business 5 + Deps 0)
**Sprint:** sprint_admin_02_platform_admins_rbac
**Created:** 2026-04-24
**Status:** Draft

---

## 1. Overview

### Business Goal

Introduzir o modelo de **platform admin** (membros da equipe Axon com poder administrativo) ancorado na organização interna `axon` criada no Sprint 01. Proteger a invariante INV-3 (sempre existe ao menos um owner ativo) via trigger em `platform_admins` que cobre UPDATE **e** DELETE. Resolver a inconsistência de role entre código e banco (D-5 do plano): alinhar `SessionRole` com o CHECK já vigente no DB (`'owner','admin','user','viewer'`). Corrigir bug preexistente em `invitations.role` cujo DEFAULT `'member'` viola seu próprio CHECK.

Sprint **sem UI** — é infraestrutura de autorização. O primeiro exercício real dos helpers `requirePlatformAdmin`/`requirePlatformAdminRole` acontece no Sprint 04 (shell admin) e Sprint 05 (primeiro CRUD admin).

Cobre: RF-ADMIN-1, RF-ADMIN-2, RF-ADMIN-3, RF-ADMIN-6 (parcial — enforcement só no DB, sem UI), INV-3, INV-5, T-14, G-06 (preparação), G-08, RNF-SEC-7. Resolve D-5; fixa D-6 como matriz de referência para sprints 04–13.

### User Story

- Como **platform admin (futuro)**, quero ser identificado server-side em qualquer request, para que rotas admin dos sprints 04+ possam me autorizar sem JWT claim novo.
- Como **dono da Axon**, quero que o último owner ativo **não** possa ser desativado, para que a plataforma nunca entre em lockout via UI (T-14).
- Como **desenvolvedor**, quero que `ctx.role` seja o mesmo valor que o DB armazena, para que ramos de autorização não dependam de tradução frágil no `normalizeRole`.

### Success Metrics

- **Tabela `platform_admins`** criada com FORCE RLS; SELECT restrito ao próprio admin + service_role; sem policies de mutação (mutações só via RPCs `SECURITY DEFINER` em sprints futuros).
- **Trigger `prevent_last_owner_deactivation`** ativo cobrindo UPDATE **e** DELETE; teste manual falha com `last_owner_protected` quando tentado.
- **Edson identificado** como `platform_admins` owner ativo: `SELECT role FROM is_platform_admin('<edson-profile-id>')` retorna `owner` e `is_active=true`.
- **`SessionRole`** em `src/lib/supabase/getSessionContext.ts` é `'owner' | 'admin' | 'user' | 'viewer'` (sem `'member'`).
- **Rewrite completo**: `grep -rn "role === 'member'" src/` = 0; `grep -rn "'member'" src/` retorna **apenas** a linha do `normalizeRole` legacy-mapping.
- **Customer app `(app)/*`** nunca importa `@/lib/auth/platformAdmin.ts` — validado por `scripts/check-admin-isolation.mjs`.
- **Build + lint verdes**; golden flows customer (login, criar lead, listar produtos, pipeline, team) sem regressão.
- **Bug fix em `invitations.role` DEFAULT** (`'member'` → `'user'`) — bug preexistente que violava seu próprio CHECK.

---

## 2. Database Requirements

### New Tables

#### Table: `public.platform_admins`

**Purpose:** Catálogo global de operadores da Axon AI com poder administrativo. Cada linha referencia um `profiles.id` da organização interna (`slug='axon'`, `is_internal=true`). Fonte canônica consultada server-side para autorizar rotas admin nos sprints 04+.

**Schema & hosting:** criada em `public.*` (não em `public_ref`). É **segunda exceção formal** à regra "toda `public.*` tem `organization_id`" documentada em `docs/conventions/standards.md` (a primeira é `public.plans` do Sprint 01). Justificativa: `platform_admins` não pertence a uma org-tenant — é catálogo da plataforma. O próprio registro é escopado à org Axon via FK para `profiles` cujo `organization_id` aponta para a org interna (defesa INV-5). Tech Lead adiciona `public.platform_admins` à lista "Exceções em `public.*`" em standards.md no encerramento do sprint.

**Fields:**
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT` — admin é um profile da org interna Axon. RESTRICT evita que remoção do profile orfanize o admin silenciosamente.
- `role text NOT NULL CHECK (role IN ('owner','support','billing'))` — os três papéis do MVP (RF-ADMIN-2). Conjunto fechado.
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `deactivated_at timestamptz NULL` — NULL quando ativo; preenchido ao desativar.
- `created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL` — nullable pelo seed inicial (bootstrap não tem criador anterior).

**Check constraints:**
- `CHECK ((is_active = true AND deactivated_at IS NULL) OR (is_active = false AND deactivated_at IS NOT NULL))` — coerência de estado.

**Indexes:**
- `platform_admins_pkey` (automático em `id`)
- `CREATE UNIQUE INDEX platform_admins_active_profile_unique ON public.platform_admins (profile_id) WHERE is_active = true;` — **partial unique**: um profile não acumula múltiplas linhas ativas simultâneas. Permite histórico: linha inativa anterior (ex: papel antigo revogado) convive com linha ativa nova.
- `CREATE INDEX platform_admins_role_active ON public.platform_admins (role) WHERE is_active = true;` — acelera queries por papel (útil no trigger de last-owner e em contagens futuras).

**Security (RLS):** `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` (RNF-SEC-7 — bloqueia superusuário do Postgres, não bypassável por `rls.bypass`).

- **SELECT (authenticated):** `USING (profile_id = auth.uid())` — admin só enxerga a própria linha. Serve o helper `getPlatformAdmin()` no backend, que roda como authenticated.
- **SELECT (service_role):** implícito (service_role bypassa RLS em modo não-FORCE; com FORCE, precisa de policy explícita). Por segurança, **não** adicionamos policy de SELECT para `service_role`: o RPC `is_platform_admin` roda com `SECURITY DEFINER` e bypassa RLS via privilégios do definer, que é o caminho canônico. Service_role continua podendo ler via SQL direto porque pg_roles superuser/bypassrls atributos estão fora do escopo de FORCE RLS no Supabase — FORCE RLS afeta apenas o owner da tabela em queries regulares.
- **INSERT/UPDATE/DELETE:** **nenhuma policy** — negado por default. Mutações só via:
  - `seed_initial_platform_admin_owner(...)` (este sprint)
  - RPCs do Sprint 11 (`admin_create_platform_admin_invitation`, `admin_deactivate_platform_admin`, etc.)

**Trigger de validação FK org interna (defesa INV-5):**

```sql
CREATE OR REPLACE FUNCTION public.platform_admins_enforce_internal_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_in_internal boolean;
BEGIN
  SELECT o.is_internal INTO is_in_internal
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = NEW.profile_id;

  IF NOT FOUND OR is_in_internal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_not_in_internal_org'
      USING ERRCODE = 'P0001',
            DETAIL = 'profile_id=' || NEW.profile_id::text;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_platform_admins_enforce_internal_org ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_enforce_internal_org
BEFORE INSERT OR UPDATE OF profile_id ON public.platform_admins
FOR EACH ROW EXECUTE FUNCTION public.platform_admins_enforce_internal_org();
```

**Por que não FK composta:** `profiles` hoje não tem índice composto `(id, organization_id)` + não queremos alterar `profiles` neste sprint. Trigger é mais simples e não depende de índices em `profiles`. Execução é O(1) (PK de profiles + PK de organizations).

### Trigger `prevent_last_owner_deactivation` (INV-3 / G-08 / T-14)

Protege contra lockout da plataforma. Cobre **UPDATE** (desativação via flag) **e** **DELETE** (cinto + suspensório).

```sql
CREATE OR REPLACE FUNCTION public.prevent_last_owner_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  other_active_owners int;
BEGIN
  -- Identifica se a operação remove o último owner ativo.
  IF TG_OP = 'UPDATE' THEN
    -- Só considera casos onde OLD é owner ativo.
    IF OLD.role = 'owner' AND OLD.is_active = true THEN
      -- Remoção efetiva se: virou inativa OU mudou de role.
      IF (NEW.is_active = false) OR (NEW.role IS DISTINCT FROM 'owner') THEN
        SELECT count(*) INTO other_active_owners
        FROM public.platform_admins
        WHERE role = 'owner' AND is_active = true AND id <> OLD.id;

        IF other_active_owners = 0 THEN
          RAISE EXCEPTION 'last_owner_protected'
            USING ERRCODE = 'P0001',
                  DETAIL = 'Cannot deactivate or demote the last active owner';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND OLD.is_active = true THEN
      SELECT count(*) INTO other_active_owners
      FROM public.platform_admins
      WHERE role = 'owner' AND is_active = true AND id <> OLD.id;

      IF other_active_owners = 0 THEN
        RAISE EXCEPTION 'last_owner_protected'
          USING ERRCODE = 'P0001',
                DETAIL = 'Cannot delete the last active owner';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_platform_admins_prevent_last_owner_upd ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_prevent_last_owner_upd
BEFORE UPDATE ON public.platform_admins
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_deactivation();

DROP TRIGGER IF EXISTS trg_platform_admins_prevent_last_owner_del ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_prevent_last_owner_del
BEFORE DELETE ON public.platform_admins
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_deactivation();
```

**Semântica coberta (4 vetores):**
1. UPDATE que muda `is_active=true → false` no último owner → bloqueado.
2. UPDATE que muda `role='owner' → <outro>` no último owner ativo → bloqueado (impede "demote silencioso").
3. DELETE do último owner ativo → bloqueado.
4. UPDATE em admins non-owner ou owner com outros owners ativos → passa normalmente.

**Não cobre (intencional):** self-update onde `OLD.id` é o próprio último owner mas a operação não muda nada relevante (ex: UPDATE só de `role` para o mesmo valor, ou UPDATE do `created_at`). O teste `OLD.role = 'owner' AND OLD.is_active = true AND (NEW.is_active = false OR NEW.role IS DISTINCT FROM 'owner')` só dispara quando há remoção efetiva — zero false-positive em edits de metadata.

### New Functions / RPCs

#### Function: `public.is_platform_admin(target_profile_id uuid)`

**Purpose:** Retorna a linha de `platform_admins` do profile alvo se ele for admin ativo, ou NULL. É o helper canônico consultado pelo backend em cada request admin nos sprints 04+.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.is_platform_admin(target_profile_id uuid)
RETURNS TABLE (
  id          uuid,
  profile_id  uuid,
  role        text,
  is_active   boolean,
  created_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  caller_role := auth.jwt() ->> 'role';

  -- Só o próprio profile (authenticated) ou service_role pode consultar.
  -- Valor NULL / missing / diferente é tratado como "não autorizado" → retorna vazio (não vaza existência).
  IF caller_role IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> target_profile_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pa.id, pa.profile_id, pa.role, pa.is_active, pa.created_at
  FROM public.platform_admins pa
  WHERE pa.profile_id = target_profile_id
    AND pa.is_active = true
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
```

**Notas:**
- `STABLE` + `SECURITY DEFINER`: read-only do ponto de vista SQL, bypassa RLS de `platform_admins` (SELECT policy só libera `profile_id = auth.uid()`; função DEFINER lê sem restrição). `STABLE` habilita cache por query no executor do Postgres.
- **Política conservadora de vazamento:** caller que não é o próprio alvo nem service_role recebe **zero linhas** — não um erro. Isso evita side-channel de "existência" (atacante saberia se X é admin testando o erro).
- Retorno tabular em vez de RECORD/ROW permite mapping direto em Supabase-JS (`.returns<{...}>`).
- `REVOKE EXECUTE ... FROM anon` explícito seguindo armadilha registrada em APRENDIZADOS 2026-04-24.

#### Function: `public.seed_initial_platform_admin_owner(target_profile_id uuid)`

**Purpose:** Bootstrap idempotente do primeiro owner. Executável **apenas uma vez** (enquanto `platform_admins` estiver vazia). Protege contra race na janela de deploy.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.seed_initial_platform_admin_owner(target_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  is_in_internal boolean;
BEGIN
  -- Advisory lock protege contra INSERTs concorrentes durante a janela de seed.
  -- Lock key: hash textual estável "seed_initial_platform_admin_owner".
  PERFORM pg_advisory_xact_lock(hashtext('seed_initial_platform_admin_owner'));

  -- Idempotência: só seeda se a tabela estiver vazia.
  IF EXISTS (SELECT 1 FROM public.platform_admins LIMIT 1) THEN
    RAISE EXCEPTION 'platform_admins_already_seeded'
      USING ERRCODE = 'P0001',
            DETAIL = 'platform_admins table is not empty; use Sprint 11 RPCs for subsequent admins';
  END IF;

  -- Pre-check de org interna (espelha o trigger, mas dá erro mais específico aqui).
  SELECT o.is_internal INTO is_in_internal
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found'
      USING ERRCODE = 'P0002', DETAIL = 'profile_id=' || target_profile_id::text;
  END IF;

  IF is_in_internal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_not_in_internal_org'
      USING ERRCODE = 'P0001',
            DETAIL = 'profile_id=' || target_profile_id::text
                   || ' must belong to org with is_internal=true before seeding';
  END IF;

  INSERT INTO public.platform_admins (profile_id, role, is_active, created_by)
  VALUES (target_profile_id, 'owner', true, target_profile_id)
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END $$;

REVOKE ALL ON FUNCTION public.seed_initial_platform_admin_owner(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.seed_initial_platform_admin_owner(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_initial_platform_admin_owner(uuid) TO service_role;
```

**Notas:**
- **Advisory lock transacional** (`pg_advisory_xact_lock`) resolve o race de "dois SELECT count(*)=0 simultâneos tentam inserir". Lock é liberado automaticamente ao fim da transação (sucesso ou erro).
- `REVOKE EXECUTE FROM authenticated`: esta função é **operacional**, não usada pelo app em runtime. Só `service_role` (executado manualmente via Supabase SQL editor ou CLI do Sprint 12 futuro) invoca.
- `created_by = target_profile_id` (auto-referência) porque no bootstrap não existe criador anterior.

### Modified Tables

#### Table: `public.invitations`

**Changes (bug fix oportunístico):**
- **Alterar DEFAULT**: de `'member'::text` para `'user'::text`.
- **Razão:** DEFAULT atual viola o CHECK `('admin','user','viewer')` — qualquer INSERT sem role explícito falharia. É bug silencioso preexistente; zero linhas existentes afetadas (grep mostrou 2× `'admin'`, zero `'member'`). Corrigir agora evita armadilha para sprints futuros que possam usar default.

```sql
ALTER TABLE public.invitations
  ALTER COLUMN role SET DEFAULT 'user'::text;
```

**Nenhuma outra mudança em `invitations`**. Dados não migrados (zero linhas com `'member'`).

### Existing Tables Used

#### Table: `public.profiles`
**Usage:** leitura no trigger `platform_admins_enforce_internal_org`; FK target de `platform_admins.profile_id` e `platform_admins.created_by`.
**Fields accessed:** `id`, `organization_id`.

**Nenhuma modificação em `profiles`** — o CHECK de `profiles.role` já está em `('owner','admin','user','viewer')` (confirmado via live DB; `schema_snapshot.json` de 2026-04-23 está defasado). DEFAULT já é `'user'::text`. Zero linhas com `'member'`.

#### Table: `public.organizations`
**Usage:** leitura no trigger `platform_admins_enforce_internal_org` para validar `is_internal=true`.
**Fields accessed:** `id`, `is_internal`.

### Migration header (rollback documentado — G-17)

Topo do arquivo `.sql` com comentário estruturado:
- O que a migration faz (6 blocos: tabela, trigger FK interna, trigger last-owner UPDATE, trigger last-owner DELETE, RPC `is_platform_admin`, RPC `seed_initial_platform_admin_owner`, ALTER DEFAULT em `invitations`).
- **Rollback em staging:**
  ```
  -- DROP FUNCTION IF EXISTS public.seed_initial_platform_admin_owner(uuid);
  -- DROP FUNCTION IF EXISTS public.is_platform_admin(uuid);
  -- DROP TABLE IF EXISTS public.platform_admins CASCADE;
  -- DROP FUNCTION IF EXISTS public.prevent_last_owner_deactivation();
  -- DROP FUNCTION IF EXISTS public.platform_admins_enforce_internal_org();
  -- ALTER TABLE public.invitations ALTER COLUMN role SET DEFAULT 'member'::text;
  --   (reverte ao estado bugado para paridade; reaplicar a migration de Sprint 02 restaura o fix)
  ```
- **Observação:** rollback apaga o registro do Edson como platform admin. Re-aplicar Sprint 02 + re-executar `seed_initial_platform_admin_owner` restaura.

---

## 3. API Contract

### Novo módulo: `src/lib/auth/platformAdmin.ts`

**File:** `src/lib/auth/platformAdmin.ts` (novo — diretório `src/lib/auth/` também é novo).

**Signature:**

```typescript
import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type PlatformAdminRole = 'owner' | 'support' | 'billing';

export interface PlatformAdminSnapshot {
  id: string;
  profileId: string;
  role: PlatformAdminRole;
  isActive: boolean;
  createdAt: string;
}

// Cache-per-request: dedupe múltiplas chamadas dentro do mesmo render.
export const getPlatformAdmin = cache(
  async (): Promise<PlatformAdminSnapshot | null>
);

export async function requirePlatformAdmin(): Promise<PlatformAdminSnapshot>;

export async function requirePlatformAdminRole(
  allowed: readonly PlatformAdminRole[]
): Promise<PlatformAdminSnapshot>;
```

**Business Logic:**

1. **`getPlatformAdmin()`:**
   1. `createClient()` (server client, RLS-enforced).
   2. `supabase.auth.getUser()` → se não autenticado, retorna `null`.
   3. `supabase.rpc('is_platform_admin', { target_profile_id: user.id })`.
   4. Se `error` ou `data` vazio → retorna `null` (não é admin).
   5. Mapeia snake_case → camelCase e retorna `PlatformAdminSnapshot`.
   6. Wrapped em `React.cache` → dedupe por render (TTL = request).

2. **`requirePlatformAdmin()`:**
   - Chama `getPlatformAdmin()`.
   - Se `null` → chama `notFound()` (renderiza o 404 do Next.js).
   - **Decisão fixada:** `notFound()` em vez de `redirect('/admin/login')`. A rota `/admin/login` só existe a partir do Sprint 04; redirecionar para ela hoje seria redirect para uma 404. Sprint 04 substitui `notFound()` por `redirect('/admin/login?reason=unauthorized')` quando a rota existir — a mudança é localizada neste único arquivo.

3. **`requirePlatformAdminRole(allowed)`:**
   - Chama `requirePlatformAdmin()`.
   - Se `admin.role` não está em `allowed` → chama `notFound()`.
   - Retorna o admin se ok.

**Não é Server Action** (sem `'use server'`). É helper server-only importado por páginas/server components futuros (sprints 04+). **Neste sprint, nenhum arquivo em `src/app/`, `src/lib/actions/**` ou `src/components/**` importa este módulo** — é criado para sprints futuros e validado por guard de isolamento.

### Modificação: `src/lib/supabase/getSessionContext.ts`

**Mudanças:**

```diff
- export type SessionRole = 'owner' | 'admin' | 'member';
+ export type SessionRole = 'owner' | 'admin' | 'user' | 'viewer';
  export type ThemePreference = 'system' | 'light' | 'dark';

- const VALID_ROLES: readonly SessionRole[] = ['owner', 'admin', 'member'] as const;
+ const VALID_ROLES: readonly SessionRole[] = ['owner', 'admin', 'user', 'viewer'] as const;

  function normalizeRole(raw: unknown): SessionRole {
    if (typeof raw === 'string' && (VALID_ROLES as readonly string[]).includes(raw)) {
      return raw as SessionRole;
    }
-   return 'member';
+   // Legacy mapping: qualquer valor desconhecido (incluindo 'member' de orgs pre-Sprint-02)
+   // cai para 'user' — papel menos privilegiado. Mantido como cinto durante a janela de deploy.
+   return 'user';
  }
```

**Nada mais no arquivo muda** — query, tratamento de erro, e estrutura do retorno permanecem idênticos.

### Modificação: `src/lib/actions/_shared/assertRole.ts`

**Nenhuma mudança no arquivo.** Assinatura `assertRole(ctx, allowed)` não muda; apenas o tipo `SessionRole` por baixo muda. Callers que passam `'member'` explicitamente seriam quebrados pelo TypeScript no build (GATE 2) — `grep` confirma zero calls com `'member'`:

```bash
grep -rn "assertRole(.*'member'" src/
# 0 matches
```

### Rewrite mecânico em `src/app/(app)/**`

**Inventário exato (24 arquivos — `grep -rn "role === 'member'" src/`):**

| # | File:line |
|---|---|
| 1 | `src/app/(app)/funnels/[id]/page.tsx:23` |
| 2 | `src/app/(app)/funnels/new/page.tsx:10` |
| 3 | `src/app/(app)/funnels/page.tsx:23` |
| 4 | `src/app/(app)/leads-loss-reasons/[id]/page.tsx:22` |
| 5 | `src/app/(app)/leads-loss-reasons/new/page.tsx:10` |
| 6 | `src/app/(app)/leads-loss-reasons/page.tsx:24` |
| 7 | `src/app/(app)/leads-origins/[id]/page.tsx:22` |
| 8 | `src/app/(app)/leads-origins/new/page.tsx:10` |
| 9 | `src/app/(app)/leads-origins/page.tsx:25` |
| 10 | `src/app/(app)/leads-tags/[id]/page.tsx:24` |
| 11 | `src/app/(app)/leads-tags/new/page.tsx:10` |
| 12 | `src/app/(app)/leads-tags/page.tsx:24` |
| 13 | `src/app/(app)/products/[id]/page.tsx:17` |
| 14 | `src/app/(app)/products/new/page.tsx:11` |
| 15 | `src/app/(app)/products/page.tsx:44` |
| 16 | `src/app/(app)/settings/catalog/categories/[id]/page.tsx:20` |
| 17 | `src/app/(app)/settings/catalog/categories/new/page.tsx:17` |
| 18 | `src/app/(app)/settings/catalog/categories/page.tsx:27` |
| 19 | `src/app/(app)/settings/organization/page.tsx:11` |
| 20 | `src/app/(app)/settings/team/[id]/page.tsx:20` |
| 21 | `src/app/(app)/settings/team/page.tsx:15` |
| 22 | `src/app/(app)/whatsapp-groups/[id]/page.tsx:22` |
| 23 | `src/app/(app)/whatsapp-groups/new/page.tsx:11` |
| 24 | `src/app/(app)/whatsapp-groups/page.tsx:24` |

**Transformação mecânica:**

```diff
- if (ctx.role === 'member') {
+ if (ctx.role === 'user' || ctx.role === 'viewer') {
```

**Política `viewer` ≡ `user` (fixada):** neste sprint, ambos caem no early-return / gate "restrita a administradores". A diferenciação funcional de `viewer` (read-only) não está prevista no plano admin — vira decisão de sprint futuro dedicado ao customer app. Agrupar os dois preserva o comportamento atual (`member` → "non-admin" → bloqueado) sem introduzir nova regra de negócio.

**Validação pós-rewrite (comando):**

```bash
grep -rn "role === 'member'" src/
# Esperado: 0 matches

grep -rn "'member'" src/
# Esperado: 1 match apenas — o comentário legacy-mapping em getSessionContext.ts
```

### Novo script: `scripts/check-admin-isolation.mjs`

**Purpose:** Guard de import isolation (G-04 preparação) — falha se qualquer arquivo sob `src/app/(app)/**` ou `src/lib/actions/**` importa de `@/lib/auth/platformAdmin`. Standalone; Sprint 04 compõe no `build:check` maior.

**Comportamento:**

```javascript
// scripts/check-admin-isolation.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const PROTECTED_IMPORT = '@/lib/auth/platformAdmin';
const SCAN_ROOTS = ['src/app/(app)', 'src/lib/actions'];
// Regex propositalmente frouxa: cobre named/default/type imports e require().
const IMPORT_RE = /(?:from\s+['"]|require\(\s*['"])@\/lib\/auth\/platformAdmin\b/;

async function walk(dir, out = []) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (/\.(tsx?|mjs|cjs|js)$/.test(e.name)) out.push(full);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return out;
}

const violations = [];
for (const root of SCAN_ROOTS) {
  const files = await walk(root);
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    if (IMPORT_RE.test(content)) {
      violations.push(relative(process.cwd(), f));
    }
  }
}

if (violations.length > 0) {
  console.error('❌ check-admin-isolation: customer-app files must not import @/lib/auth/platformAdmin');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`✅ check-admin-isolation: ${SCAN_ROOTS.join(', ')} clean of ${PROTECTED_IMPORT}`);
```

**Integração:**
- Adicionar em `package.json`:
  ```json
  "scripts": {
    "check:admin-isolation": "node scripts/check-admin-isolation.mjs"
  }
  ```
- **Não** é adicionado ao `build:check` agregado neste sprint (Sprint 04 compõe). Executado manualmente pelo `@guardian` neste sprint.

### Documentação: `docs/admin_area/rbac_matrix.md`

**Purpose:** D-6 do plano — matriz de ações admin × papel que serve como contrato humano lido pelos `@spec-writer` dos sprints 05+.

**Regras de escrita:**
- Cada linha é uma **ação nomeada literalmente no plano** (`sprint_plan.md`), não invenção.
- Três colunas: **owner**, **support**, **billing**.
- Marcações: `✓` (permitido), `—` (negado), `R` (read-only onde existir leitura dedicada).
- Abertura declara **ortogonalidade** entre `profiles.role` (tenant) e `platform_admins.role` (plataforma).
- Nota final: "**Esta matriz é contrato humano, não código autoritativo.** Cada RPC nos sprints 05+ continua validando papel no próprio corpo (defesa em profundidade). Quando matriz e código divergem, código vence — atualizar a matriz via PR dedicado."

**Conteúdo completo (ações extraídas do `sprint_plan.md`):**

| Ação (RPC / módulo) | Sprint | owner | support | billing |
|---|---|---|---|---|
| **Sprint 05 — Organizations** | | | | |
| `admin_suspend_organization(org_id, reason)` | 05 | ✓ | — | — |
| `admin_reactivate_organization(org_id)` | 05 | ✓ | — | — |
| `admin_create_organization(name, slug, plan_id, first_admin_email)` | 05 | ✓ | — | — |
| Listagem de organizations (read) | 05 | R | R | R |
| Detalhe de organization (read) | 05 | R | R | R |
| **Sprint 06 — Plans & Subscriptions** | | | | |
| `admin_change_plan(subscription_id, new_plan_id, effective_at)` | 06 | ✓ | — | ✓ |
| `admin_extend_trial(subscription_id, days)` | 06 | ✓ | — | ✓ |
| `admin_cancel_subscription(subscription_id, effective_at)` | 06 | ✓ | — | ✓ |
| `admin_reactivate_subscription(subscription_id)` | 06 | ✓ | — | ✓ |
| `admin_archive_plan(plan_id)` | 06 | ✓ | — | ✓ |
| `admin_delete_plan(plan_id)` | 06 | ✓ | — | ✓ |
| CRUD de `plans` (UI) | 06 | ✓ | — | ✓ |
| Listagem de subscriptions (read) | 06 | R | R | R |
| **Sprint 07 — Grants & Limits** | | | | |
| `admin_grant_limit(org_id, limit_key, value, reason, expires_at)` | 07 | ✓ | — | ✓ |
| `admin_revoke_grant(grant_id)` | 07 | ✓ | — | ✓ |
| Listagem de grants (read) | 07 | R | R | R |
| **Sprint 08 — Deep Inspect** | | | | |
| `inspect_log(org_id, resource_type, record_ids[])` | 08 | ✓ | ✓ | — |
| Read-only de leads/users/products/pipelines/categorias/tags/origins/loss_reasons/whatsapp_groups de qualquer org | 08 | R | R | — |
| **Sprint 09 — Dashboard & Settings base** | | | | |
| `refresh_platform_metrics()` | 09 | ✓ | ✓ | ✓ |
| `admin_set_feature_flag(key, enabled, config)` | 09 | ✓ | — | — |
| `admin_update_platform_setting(key, value)` (trial default, past_due grace) | 09 | ✓ | — | — |
| CRUD de `legal_policies` (novas versões) | 09 | ✓ | — | — |
| **Sprint 10 — Integration credentials** | | | | |
| CRUD de `platform_integration_credentials` (email/SMS) | 10 | ✓ | — | — |
| Rotação de credenciais | 10 | ✓ | — | — |
| `get_credential(id)` | 10 | ✓ (via server-side whitelist) | — | — |
| **Sprint 11 — Platform admins** | | | | |
| `admin_create_platform_admin_invitation(email, role)` | 11 | ✓ | — | — |
| `admin_deactivate_platform_admin(admin_id)` | 11 | ✓ | — | — |
| `admin_change_platform_admin_role(admin_id, new_role)` | 11 | ✓ | — | — |
| Consumir convite via `/admin/accept-invite/[token]` | 11 | n/a (owner não consome o próprio convite; step-up via segundo owner no Sprint 11b) | n/a | n/a |
| Listagem de `platform_admins` (read) | 11 | R | R (sem ver metadata sensível) | R (sem ver metadata sensível) |
| Password reset + re-enroll MFA | 11 | ✓ (para si) | ✓ (para si) | ✓ (para si) |
| **Sprint 12 — Audit UI, Rate limit, Break-glass** | | | | |
| Visualizar `audit_log` (UI) | 12 | R | R | R (escopo billing apenas) |
| `login_attempts_admin` (read) | 12 | R | R | — |
| CLI `scripts/break-glass.ts` | 12 | n/a (CLI, fora do modelo de papel — exige dois segredos) | n/a | n/a |
| **Sprint 13 — Transitions & deploy ops** | | | | |
| Reconfigurar slug via runbook (INV-9) | 13 | ✓ (via DB, fora da UI) | — | — |

**Nota sobre `support` e `billing` vs `owner`:**
- **owner** tem **tudo** — é o papel privilegiado.
- **support** prioriza inspeção (Sprint 08) e leitura de dashboards/audit. Não toca plans/subscriptions/grants. Não cria/gere platform admins. Acessa `refresh_platform_metrics` porque é ação de observabilidade.
- **billing** prioriza ciclo de vida comercial (Sprint 06 + Sprint 07). Não toca platform admins (Sprint 11), não toca credenciais (Sprint 10), não toca feature flags/platform settings (Sprint 09).
- **Neste sprint (02)**, apenas `owner` foi seeded. `support` e `billing` ficam para Sprint 11 materializar.

**Localização:** `docs/admin_area/rbac_matrix.md`. Referenciada em:
- Abertura do próprio arquivo (explicação de ortogonalidade + escopo).
- `docs/admin_area/sprint_plan.md` (atualização do bullet D-6 apontando para ela).
- Cada sprint file subsequente (05+) cita esta matriz como entrada do `@spec-writer`.

### Documentação: `docs/admin_area/runbook_seed_owner.md`

**Purpose:** procedimento operacional para Edson (ou sucessor) executar o seed do primeiro platform admin owner.

**Estrutura:**

1. **Pré-requisitos:**
   - Migration Sprint 02 aplicada no banco alvo (staging **antes** de prod).
   - Acesso `service_role` via Supabase Studio SQL editor (ou `SUPABASE_SERVICE_ROLE_KEY` em `.env.local` para CLI).
   - Profile alvo existe e **está vinculado à org `slug='axon'`** (se não estiver, passo 2 corrige primeiro).

2. **Bloqueador conhecido: Edson está na org `'pessoal'`, não `'axon'`.**
   - Verificação:
     ```sql
     SELECT p.id, o.slug, o.is_internal
     FROM public.profiles p
     JOIN public.organizations o ON o.id = p.organization_id
     WHERE p.id = '<edson-profile-id>';
     ```
   - Se `slug <> 'axon'`:
     1. Decidir migração de dados — Edson **atualmente é owner da org `pessoal`**. Ao mover profile, a org `pessoal` ficará sem owner (pode quebrar INV futura se houver enforcement).
     2. Opções documentadas:
        - **(a) Preferida:** mover profile de Edson para `axon`. Assumir que a org `pessoal` era de dogfood/teste. Se existir dado de produção em `pessoal`, avaliar manter a org ativa com outro owner ou arquivar.
        - **(b) Alternativa:** deixar Edson em `pessoal` e seedar outro profile (ex: `admin@axon.ai`) como primeiro owner da Axon Admin. Requer criar o profile primeiro via fluxo de convite da org `axon`.
     3. Edson escolhe a opção explicitamente antes do runbook prosseguir. Default recomendado: **(a)** + arquivar/remover `pessoal` em passo separado se for teste.
   - Comando de mover (opção a):
     ```sql
     BEGIN;
     UPDATE public.profiles SET organization_id = 'c6d506ca-08f0-4714-b330-6eb1a11f679b'
       WHERE id = 'c0bb904c-0939-4b66-838e-eabf23df4377';
     -- Validar:
     SELECT p.id, o.slug, o.is_internal FROM public.profiles p
       JOIN public.organizations o ON o.id = p.organization_id
       WHERE p.id = 'c0bb904c-0939-4b66-838e-eabf23df4377';
     -- Se OK:
     COMMIT;
     -- Se erro:
     -- ROLLBACK;
     ```
   - **Aviso:** essa mudança de `organization_id` em `profiles` **não** tem gate RLS nesta sprint. É executada via service_role. Edson perde acesso aos dados da org `pessoal` (RLS do customer app filtra por `organization_id` no JWT claim — que vem do profile). Se Edson faz login depois, vai ver a org `axon` como contexto.

3. **Execução do seed:**
   ```sql
   -- Deve retornar o UUID da linha criada em platform_admins:
   SELECT public.seed_initial_platform_admin_owner(
     'c0bb904c-0939-4b66-838e-eabf23df4377'::uuid
   );
   ```

4. **Verificação pós-seed:**
   ```sql
   -- Deve retornar uma linha com role='owner', is_active=true:
   SELECT id, profile_id, role, is_active, created_at, deactivated_at
   FROM public.platform_admins;

   -- Deve retornar a mesma linha (via RPC):
   SELECT * FROM public.is_platform_admin(
     'c0bb904c-0939-4b66-838e-eabf23df4377'::uuid
   );
   ```

5. **Teste do trigger last-owner:**
   ```sql
   -- Deve falhar com P0001 / last_owner_protected:
   UPDATE public.platform_admins SET is_active = false, deactivated_at = now()
     WHERE profile_id = 'c0bb904c-0939-4b66-838e-eabf23df4377';

   -- Deve falhar com P0001 / last_owner_protected:
   DELETE FROM public.platform_admins
     WHERE profile_id = 'c0bb904c-0939-4b66-838e-eabf23df4377';
   ```

6. **Desfazer o seed (só se errou o profile):**
   - Enquanto Sprint 11 não existe, remover é operacionalmente hostil porque o trigger protege o último owner. Procedimento:
     ```sql
     BEGIN;
     ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_prevent_last_owner_del;
     ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_prevent_last_owner_upd;
     DELETE FROM public.platform_admins;
     ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_prevent_last_owner_del;
     ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_prevent_last_owner_upd;
     COMMIT;
     -- Re-executar seed_initial_platform_admin_owner com o profile correto.
     ```
   - **⚠️ Só execute se tiver certeza.** Desabilitar trigger requer privilégio de owner da tabela. Ambiente só via service_role.

---

## 4. External API Integration

**N/A.** Nenhuma integração externa.

---

## 5. Componentes de UI

**Zero componentes de UI.** Sprint é infraestrutura pura de autorização.

### Component Tree

Nenhuma.

### Semantic tokens

N/A.

---

## 6. Edge Cases (CRITICAL)

Cobertura alvo: ≥10 edge cases distribuídos por categoria.

### Database Invariants / Triggers

- [ ] **Tentativa de desativar o último owner ativo via SQL direto (T-14):** `UPDATE platform_admins SET is_active=false, deactivated_at=now() WHERE id='<last-owner-id>'` falha com `ERRCODE=P0001`, mensagem `last_owner_protected`. Testado em staging: seedar owner, tentar desativar, receber erro, confirmar linha intacta.
- [ ] **Tentativa de DELETE do último owner:** `DELETE FROM platform_admins WHERE id='<last-owner-id>'` falha com mesmo erro tipado. Cinto + suspensório.
- [ ] **Tentativa de "demote silencioso" do último owner:** `UPDATE platform_admins SET role='support' WHERE id='<last-owner-id>'` falha com `last_owner_protected` (cobre o vetor 2 do trigger).
- [ ] **Remoção do último owner quando há outro owner ativo:** `UPDATE ... SET is_active=false` em owner X quando existe owner Y ativo **passa** (trigger só bloqueia se `other_active_owners = 0`).
- [ ] **UPDATE de metadata irrelevante no último owner:** ex. `UPDATE ... SET created_at = created_at WHERE id=<last-owner>` **passa** sem trigger (nem `is_active` nem `role` mudam — trigger não dispara via test de remoção efetiva).
- [ ] **INSERT com `profile_id` que não pertence à org interna:** profile em org `'pessoal'` ou qualquer org com `is_internal=false` → trigger `platform_admins_enforce_internal_org` rejeita com `ERRCODE=P0001`, mensagem `profile_not_in_internal_org`.
- [ ] **UPDATE de `profile_id` para um profile que não é da org interna:** mesmo erro — trigger `BEFORE INSERT OR UPDATE OF profile_id`.

### Seed function

- [ ] **Dois INSERTs concorrentes do seed inicial (race):** `pg_advisory_xact_lock` serializa as duas transações. A primeira sucede; a segunda, ao adquirir o lock, encontra a tabela populada e falha com `platform_admins_already_seeded` (ERRCODE=P0001).
- [ ] **Seed chamado em tabela já populada (qualquer linha):** retorna `platform_admins_already_seeded` — operador usa RPCs do Sprint 11 para admins subsequentes.
- [ ] **Seed chamado com `target_profile_id` inexistente:** `profile_not_found` (ERRCODE=P0002).
- [ ] **Seed chamado com profile de org não-interna:** `profile_not_in_internal_org` (antes do INSERT; zero writes).
- [ ] **Seed chamado por role `authenticated` direto (bypass do runbook):** `permission denied for function seed_initial_platform_admin_owner` — só `service_role` tem EXECUTE.
- [ ] **Seed chamado por `anon`:** também `permission denied`.

### RPC `is_platform_admin`

- [ ] **Caller `authenticated` consultando o próprio profile:** retorna linha se admin ativo, vazio se não.
- [ ] **Caller `authenticated` consultando outro profile:** retorna vazio (política conservadora — não vaza existência).
- [ ] **Caller `service_role` consultando qualquer profile:** retorna linha se admin ativo.
- [ ] **Caller `anon`:** `permission denied for function is_platform_admin` (REVOKE EXECUTE FROM anon explícito).
- [ ] **`authenticated` sem linha em `platform_admins`:** retorna vazio → `getPlatformAdmin()` retorna `null` → `requirePlatformAdmin()` chama `notFound()`.
- [ ] **Profile existe em `platform_admins` com `is_active=false`:** função filtra `WHERE is_active=true` → retorna vazio → mesmo caminho de "não é admin".

### Code (helpers + rewrite)

- [ ] **`getPlatformAdmin()` em request sem sessão:** `supabase.auth.getUser()` retorna null → helper retorna `null` sem chamar RPC.
- [ ] **Customer app `(app)/*` importando `@/lib/auth/platformAdmin` por engano:** `node scripts/check-admin-isolation.mjs` falha com `exit 1`, listando arquivo(s) violadores. Teste manual: adicionar import temporário em `src/app/(app)/funnels/page.tsx`, rodar script, ver erro, remover import.
- [ ] **Rewrite pós-refactor deixa resíduo `'member'`:** `grep -rn "role === 'member'" src/` retorna 0; `grep -rn "'member'" src/` retorna apenas o comentário de legacy-mapping em `getSessionContext.ts`. Se a segunda checagem acusar mais, é regressão.
- [ ] **Build TypeScript após rewrite:** `SessionRole` não tem mais `'member'` — qualquer caller que referencie `'member'` (seja `=== 'member'`, array literal `['member', ...]`, ou comparação com union) quebra o build com erro tipado. Esse é o sinal de catch-all para rewrites esquecidos.
- [ ] **`getSessionContext` recebendo `role='member'` do DB (cenário impossível no DB atual mas possível em janela de downgrade):** `normalizeRole` cai em `'user'` (fallback legacy). O usuário entra como `'user'` → gates `user||viewer` bloqueiam tudo que era bloqueado antes. Sem crash, sem leak.

### Legacy / bug fix

- [ ] **`invitations.role` DEFAULT antes do fix:** `INSERT INTO invitations (organization_id, email, token, invited_by, expires_at) VALUES (...)` (sem `role`) falhava com `check_constraint_violation` (role='member' viola `('admin','user','viewer')`). Cenário preexistente, nunca disparado em produção porque os 2 call-sites em `src/lib/actions/organization.ts` passam `role` explicitamente.
- [ ] **`invitations.role` DEFAULT pós-fix:** mesmo INSERT sem `role` sucede com `role='user'`. Não regride os 2 call-sites existentes (que continuam passando `role` explicitamente).

### Concurrent / edge

- [ ] **Dois admins consultando `is_platform_admin` simultaneamente:** função `STABLE` + sem side effects → segura. Cache de plan cache por query independe.
- [ ] **Dry-run da migration em DB já parcialmente aplicado:** `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`, `ALTER TABLE ... ALTER COLUMN SET DEFAULT` (idempotente) → segunda execução é no-op.

### Network / transport errors

- [ ] **Timeout ou falha de conexão na RPC `is_platform_admin`:** `supabase.rpc(...)` retorna `error` com `code` ≠ `42501`/`P0002` (ex.: `ECONNRESET`, timeout do PostgREST). `getPlatformAdmin()` trata como "não é admin" defensivamente → retorna `null`. Rationale: fail-closed é seguro aqui — usuário é tratado como não-privilegiado, o pior caso é usuário admin legítimo ver 404 transiente e retentar. `requirePlatformAdmin()` chama `notFound()` como em qualquer outro caminho de null.
- [ ] **Supabase auth endpoint offline** durante `supabase.auth.getUser()` em `getPlatformAdmin()`: retorna `user = null` (erro é silencioso no cliente). Helper retorna `null` sem chamar RPC. Mesmo caminho fail-closed.

### Data limits / uniqueness

- [ ] **Tentativa de INSERT segundo admin ativo para o mesmo profile:** `platform_admins_active_profile_unique` (partial unique em `profile_id WHERE is_active=true`) rejeita com `unique_violation` (SQLSTATE `23505`). Cenário previsto no Sprint 11: trocar papel = desativar linha antiga + INSERT linha nova, operação transacional na RPC futura (não exercitada neste sprint).
- [ ] **Profile com 2 linhas em `platform_admins` — uma ativa + uma inativa:** partial unique permite (só uma é ativa por vez). Trigger last-owner conta só ativas — não há conflito. Valida o modelo de histórico antes do Sprint 11 implementar transições reais.
- [ ] **CHECK de coerência entre `is_active` e `deactivated_at` violado via UPDATE parcial:** `UPDATE platform_admins SET is_active = false WHERE id = <X>` (sem setar `deactivated_at`) falha com `check_violation` porque CHECK exige `is_active=false → deactivated_at IS NOT NULL`. RPC futura do Sprint 11 precisa setar ambos atomicamente.

### Browser / environment / build-time

- [ ] **Tentativa de importar `platformAdmin.ts` de Client Component:** arquivo inicia com `import 'server-only';`. Next.js quebra o build com erro `You're importing a component that imports server-only` quando qualquer módulo do client bundle o alcança. Defesa complementar ao `scripts/check-admin-isolation.mjs` — o script bate em `(app)/**` e `lib/actions/**`, o `server-only` bate em qualquer tentativa de cliente mesmo fora desses diretórios.
- [ ] **Build isolation via `server-only`:** `npm run build` com import acidental do `platformAdmin` em qualquer componente cliente (`'use client'`) falha em build-time com mensagem tipada do Next.js. Teste manual: adicionar `import { getPlatformAdmin } from '@/lib/auth/platformAdmin'` em um client component e confirmar falha de build; remover e confirmar build volta a passar.
- [ ] **Script `check-admin-isolation.mjs` roda em ambiente Node puro:** usa apenas `node:fs/promises` e `node:path`. Funciona em Node 18+ (matching `package.json` engines). Não depende de TypeScript/tsx. CI e dev local ambos passam.

---

## 7. Acceptance Criteria (BINARY)

### Database (GATE 1)

- [ ] `supabase db push --dry-run` passa sem erro.
- [ ] Contagem `CREATE TABLE` vs `ENABLE ROW LEVEL SECURITY` + `FORCE` na migration: 1 tabela, 1 ENABLE, 1 FORCE.
- [ ] Migration rodada duas vezes em staging sem diff no estado final (idempotente).
- [ ] `platform_admins_active_profile_unique` (partial unique) existe e é UNIQUE WHERE is_active=true.
- [ ] 2 triggers em `platform_admins`: `trg_platform_admins_enforce_internal_org` (BEFORE INSERT OR UPDATE OF profile_id) e `trg_platform_admins_prevent_last_owner_upd` (BEFORE UPDATE) e `trg_platform_admins_prevent_last_owner_del` (BEFORE DELETE) — 3 triggers no total.
- [ ] RPC `is_platform_admin(uuid)` existe; `has_function_privilege('anon', 'public.is_platform_admin(uuid)', 'execute')` retorna `false`; `has_function_privilege('authenticated', 'public.is_platform_admin(uuid)', 'execute')` retorna `true`; idem para `service_role`.
- [ ] RPC `seed_initial_platform_admin_owner(uuid)` existe; `has_function_privilege('anon',...,'execute')=false`, `authenticated=false`, `service_role=true`.
- [ ] `invitations.role` DEFAULT é `'user'::text` após a migration.
- [ ] Seed do Edson executado em staging e prod via runbook; `SELECT count(*) FROM platform_admins WHERE role='owner' AND is_active=true` retorna `1`.
- [ ] Teste manual (staging): `UPDATE platform_admins SET is_active=false WHERE id=<last-owner>` → erro `last_owner_protected`.
- [ ] Teste manual (staging): `DELETE FROM platform_admins WHERE id=<last-owner>` → erro `last_owner_protected`.

### Backend (GATE 2)

- [ ] `src/lib/auth/platformAdmin.ts` criado; exporta `PlatformAdminRole`, `PlatformAdminSnapshot`, `getPlatformAdmin`, `requirePlatformAdmin`, `requirePlatformAdminRole`.
- [ ] Primeira linha do arquivo é `import 'server-only';`.
- [ ] `src/lib/supabase/getSessionContext.ts`: `SessionRole` é `'owner' | 'admin' | 'user' | 'viewer'`; `VALID_ROLES` reflete; `normalizeRole` fallback é `'user'` com comentário explicativo.
- [ ] `src/lib/actions/_shared/assertRole.ts`: **sem mudança** (tipo muda por baixo).
- [ ] Os 24 arquivos em `src/app/(app)/**` listados no inventário trocam `ctx.role === 'member'` por `ctx.role === 'user' || ctx.role === 'viewer'`.
- [ ] `grep -rn "role === 'member'" src/` retorna 0 matches.
- [ ] `grep -rn "'member'" src/` retorna no máximo 1 match (comentário de legacy-mapping em `getSessionContext.ts`).
- [ ] `grep -rn "@/lib/auth/platformAdmin" src/app/(app) src/lib/actions` retorna 0 matches.
- [ ] `scripts/check-admin-isolation.mjs` criado e executável via `npm run check:admin-isolation`; exit 0 com tree atual.
- [ ] `scripts/check-admin-isolation.mjs` detecta violação: adicionar `import '@/lib/auth/platformAdmin';` em qualquer arquivo sob `src/app/(app)/**`, rodar o script, confirmar exit 1 com nome do arquivo, remover o import, confirmar exit 0.
- [ ] `npm run build` passa (TypeScript + Next.js).
- [ ] `npm run lint` passa sem novos warnings.
- [ ] `tsc` não acusa `any` novo.

### Documentação

- [ ] `docs/admin_area/rbac_matrix.md` criado conforme §3 "Documentação: rbac_matrix.md"; cobre ações dos Sprints 05–13 literalmente nomeadas no `sprint_plan.md`.
- [ ] `docs/admin_area/runbook_seed_owner.md` criado conforme §3 "Documentação: runbook_seed_owner.md".
- [ ] `docs/conventions/standards.md` § "Exceções em `public.*`" inclui linha para `platform_admins` (sprint 02, justificativa, proteção compensatória FORCE RLS + policies mínimas + mutações via RPC SECURITY DEFINER).
- [ ] `docs/admin_area/sprint_plan.md` D-6 atualizado apontando para `docs/admin_area/rbac_matrix.md`.

### Frontend (GATE 5)

- [ ] **Zero arquivos novos** em `src/app/(app)/**` ou `src/components/**`.
- [ ] O rewrite mecânico em 24 arquivos não introduz tokens de cor, classes arbitrárias, nem altera layout — é edit lógico de condição, nenhum impacto visual.
- [ ] `node scripts/verify-design.mjs --changed` roda nos 24 arquivos tocados e retorna 0 violações (sanity check — mudança é non-visual mas o script é barato).

### Guardian (GATE 4)

- [ ] Guardian aprova sem violações.
- [ ] Guardian executa manualmente `node scripts/check-admin-isolation.mjs` e confirma exit 0.
- [ ] Guardian confirma que `src/app/(app)/**` não importa `@/lib/auth/platformAdmin.ts` (também via grep manual como double-check do script).

### Smoke manual (pós-deploy)

- [ ] Edson faz login no customer app; `/settings/organization` carrega sem regressão; `ctx.role='owner'` continua (profiles.role = 'owner' não muda).
- [ ] Outros usuários (profile com `role='admin'`) acessam gates e veem o mesmo comportamento (não bloqueados — `admin` passa).
- [ ] Smoke: criar lead, listar produtos, navegar pipeline — sem regressão.
- [ ] Endpoint admin (quando Sprint 04 existir) consultará `requirePlatformAdmin()` — fora do escopo deste sprint.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)

1. Gerar timestamp e criar `supabase/migrations/<timestamp>_platform_admins_rbac.sql`.
2. Header comentado (o que faz, rollback, warnings).
3. Blocos na ordem:
   1. `CREATE TABLE IF NOT EXISTS public.platform_admins (...)` + CHECK de coerência.
   2. `CREATE UNIQUE INDEX ... platform_admins_active_profile_unique ...`.
   3. `CREATE INDEX ... platform_admins_role_active ...`.
   4. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
   5. `DROP POLICY IF EXISTS` + `CREATE POLICY` SELECT (`profile_id = auth.uid()`).
   6. `CREATE OR REPLACE FUNCTION public.platform_admins_enforce_internal_org()` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.
   7. `CREATE OR REPLACE FUNCTION public.prevent_last_owner_deactivation()` + 2 triggers (UPDATE e DELETE, com `DROP TRIGGER IF EXISTS` antes).
   8. `CREATE OR REPLACE FUNCTION public.is_platform_admin(uuid) RETURNS TABLE ...` + REVOKE/GRANT.
   9. `CREATE OR REPLACE FUNCTION public.seed_initial_platform_admin_owner(uuid) RETURNS uuid ...` + REVOKE/GRANT.
   10. `ALTER TABLE public.invitations ALTER COLUMN role SET DEFAULT 'user'::text;`
4. Rodar `supabase db push --dry-run` e checar output.

**Estimated Time:** 30 min.

### Phase 2: Backend (`@backend`)

1. Criar diretório `src/lib/auth/` e arquivo `src/lib/auth/platformAdmin.ts` conforme §3.
2. Editar `src/lib/supabase/getSessionContext.ts`: trocar `SessionRole`, `VALID_ROLES`, fallback do `normalizeRole`.
3. Aplicar o rewrite mecânico nos 24 arquivos do inventário (`ctx.role === 'member'` → `ctx.role === 'user' || ctx.role === 'viewer'`).
4. Criar `scripts/check-admin-isolation.mjs` conforme §3.
5. Adicionar entry em `package.json` `"scripts"`: `"check:admin-isolation": "node scripts/check-admin-isolation.mjs"`.
6. Criar `docs/admin_area/rbac_matrix.md` conforme conteúdo §3.
7. Criar `docs/admin_area/runbook_seed_owner.md` conforme §3.
8. Atualizar `docs/conventions/standards.md` — adicionar linha em "Exceções em `public.*`" (Tech Lead faz isso no encerramento, não o @backend).
9. Atualizar `docs/admin_area/sprint_plan.md` D-6 apontando para a matriz.
10. Rodar `npm run build`, `npm run lint`, `npm run check:admin-isolation`.

**Estimated Time:** 45 min (rewrite mecânico em 24 arquivos + novo módulo + 2 docs + script).

### Phase 3: Guardian (`@guardian`)

1. Ler código alterado/criado.
2. Verificar §1a, §1b do guardian contract.
3. Manualmente: executar `node scripts/check-admin-isolation.mjs`, confirmar exit 0.
4. Manualmente: grep `@/lib/auth/platformAdmin` em `src/app/(app)/`, confirmar 0 matches.
5. Aprovar ou reportar violações.

**Estimated Time:** 10 min.

### Phase 4: Manual verification + Gates

1. Tech Lead roda GATE 1 (`supabase db push --dry-run` + checagens SQL de FORCE RLS/privileges).
2. Tech Lead roda GATE 2 (`npm run build && npm run lint`).
3. Tech Lead roda GATE 4 (Guardian report).
4. Tech Lead roda GATE 5 estático (`node scripts/verify-design.mjs --changed`).
5. Tech Lead orienta Edson a executar o runbook de seed (fora da sprint em si — operação manual).
6. Smoke manual do usuário: login customer, criar lead, listar produtos, pipeline — confirmar zero regressão.

**Estimated Time:** 20 min (inclui smoke manual).

### Phase 5: QA (on-demand, não incluída)

Skip — usuário não ativou.

**Total Estimated Time:** ~105 min (excluindo execução do runbook de seed pelo Edson).

---

## 9. Risks & Mitigations

### Risk 1: Edson na org `'pessoal'` em vez da org `'axon'`

**Impact:** High (sem Edson vinculado à org interna, seed não pode rodar sem violar INV-5; sprint não encerra operacional sem primeiro owner seeded).
**Probability:** Certain (confirmado via live DB: `org_slug='pessoal', is_internal=false`).
**Mitigation:** Runbook `runbook_seed_owner.md` documenta o bloqueador explicitamente e oferece 2 opções (mover profile ou seedar outro profile). A operação de mover é um simples `UPDATE profiles SET organization_id = '<axon-id>' WHERE id='<edson-id>'` via service_role — não é parte da migration, é manual. Tech Lead comunica o bloqueador ao Edson no encerramento do sprint e aguarda decisão antes de invocar `seed_initial_platform_admin_owner`.

### Risk 2: Rewrite de role em 24 arquivos introduz regressão silenciosa

**Impact:** High (um `ctx.role === 'user'` esquecido em gate crítico = elevação de privilégio silenciosa).
**Probability:** Medium (rewrite é mecânico mas escala).
**Mitigation:** (a) build TypeScript com `SessionRole` sem `'member'` quebra em qualquer caller esquecido (catch-all compile-time); (b) `grep -rn "role === 'member'" src/` = 0 como critério binário; (c) `grep -rn "'member'" src/` ≤ 1 match (só o comentário de legacy-mapping); (d) smoke manual dos golden flows após deploy; (e) @backend edita os 24 arquivos em um commit único, facilitando revert atômico se algo der errado.

### Risk 3: Trigger `prevent_last_owner_deactivation` causa deadlock em self-update

**Impact:** Medium (se trigger fizer lookup recursivo na própria tabela em transação).
**Probability:** Low.
**Mitigation:** Trigger usa `WHERE id <> OLD.id` — nunca olha a linha sendo modificada. Query é simples COUNT(*) com index `platform_admins_role_active`. Postgres não cria deadlock em self-update desde que não haja lock escalation — aqui não há. Teste manual no staging confirma comportamento.

### Risk 4: Decisão `notFound()` vs `redirect()` pré-Sprint 04

**Impact:** Low (helper só é chamado a partir de Sprint 04; neste sprint ninguém importa).
**Probability:** N/A (decisão fixada para `notFound()` — §3 acima).
**Mitigation:** Sprint 04 substitui a linha em 1 arquivo. Mudança localizada, sem efeito colateral.

### Risk 5: Race no seed sob concorrência

**Impact:** Medium (se dois operadores rodarem o runbook simultaneamente, poderíamos ter 2 owners bootstrap — viola idempotência declarada).
**Probability:** Low (seed manual é feito por um humano; janela de race é segundos).
**Mitigation:** `pg_advisory_xact_lock` na função seeda serializa explicitamente. Segunda transação encontra tabela populada → erro tipado `platform_admins_already_seeded`.

### Risk 6: `REVOKE FROM anon` esquecido em alguma RPC

**Impact:** Medium (anon conseguiria executar `is_platform_admin(<any-uuid>)` e descobrir, via tempo de resposta ou erro, quem é admin).
**Probability:** Low com o checklist.
**Mitigation:** Migration tem `REVOKE EXECUTE FROM anon` explícito em ambas as RPCs. Critério de aceite verifica via `has_function_privilege('anon', ..., 'execute') = false` — teste binário direto.

### Risk 7: Bug fix em `invitations.role` DEFAULT causa regressão

**Impact:** Low (zero linhas usam DEFAULT hoje; 2 call-sites passam role explícito).
**Probability:** Very Low.
**Mitigation:** Grep de `INSERT INTO invitations` em `src/lib/actions/organization.ts` confirma 2 call-sites com `role: input.role` explícito (valor vem de form Zod-validado). Fix é oportunístico — zero risco de regressão, previne armadilha futura.

---

## 10. Dependencies

### Internal

- [ ] **Sprint 01 aplicado em prod e staging:** `organizations.is_internal` existe, org `axon` existe com `is_internal=true`, `plans`, `subscriptions` existem. ✅ Confirmado via live DB.
- [ ] **`docs/schema_snapshot.json` re-gerado:** `@db-admin` re-roda introspecção no encerramento do sprint para refletir `platform_admins` + CHECK atualizado de `invitations.role`. **Observação:** o snapshot de 2026-04-23 está defasado (mostra `profiles.role` default como `'member'`, mas DB já tem `'user'`). Regeneração é obrigatória.
- [ ] **`docs/conventions/standards.md` atualizado:** Tech Lead adiciona linha de exceção em "Exceções em `public.*`" para `platform_admins` no encerramento.
- [ ] **Runbook `runbook_seed_owner.md` executado pelo Edson** (fora do gate automatizado; operação manual pós-deploy).

### External

Nenhuma.

### Sprints bloqueados por este

- Sprint 04 (shell admin + MFA) — precisa de `requirePlatformAdmin()` + `is_platform_admin` RPC.
- Sprint 05 (CRUD organizations) — precisa de `requirePlatformAdminRole(['owner'])` para gatear admin_create_organization.
- Sprint 06 (plans + subscriptions admin) — precisa de `requirePlatformAdminRole(['owner','billing'])`.
- Sprint 08 (Deep Inspect) — precisa de `requirePlatformAdminRole(['owner','support'])`.
- Sprint 11 (CRUD platform admins + convite + reset MFA) — precisa da tabela `platform_admins`, triggers INV-3 já em vigor, e do próprio modelo de papéis.

---

## 11. Rollback Plan

Migration é um bloco transacional. Falha em qualquer etapa aborta tudo.

### Se a migration rodou com sucesso mas causou regressão

1. **Immediate:** reverter commit de código (`git revert <commit>`), deployar. O código volta a ter `SessionRole = 'owner'|'admin'|'member'` e o rewrite dos 24 arquivos reverte. Build ainda passa porque `'member'` é tipo válido no pre-revert state.
2. **Database:** rodar bloco de rollback documentado no topo da migration:
   ```sql
   DROP FUNCTION IF EXISTS public.seed_initial_platform_admin_owner(uuid);
   DROP FUNCTION IF EXISTS public.is_platform_admin(uuid);
   DROP TABLE IF EXISTS public.platform_admins CASCADE;
   DROP FUNCTION IF EXISTS public.prevent_last_owner_deactivation();
   DROP FUNCTION IF EXISTS public.platform_admins_enforce_internal_org();
   ALTER TABLE public.invitations ALTER COLUMN role SET DEFAULT 'member'::text;
   -- Reverte o bug preexistente; operador decide se quer manter o fix ou não.
   ```
3. **Cache:** `revalidatePath('/', 'layout')` via re-deploy.
4. **Monitoring:** checar logs Supabase por `last_owner_protected`, `platform_admins_already_seeded`, `profile_not_in_internal_org` para confirmar que RPCs/triggers não são mais invocados.

### Se a migration falhou no meio

Transação rollada automaticamente. Estado do banco = estado pré-migration. Operador inspeciona mensagem do `RAISE EXCEPTION`, corrige, re-executa.

### Rollback do seed apenas (sem rollback da estrutura)

Ver §3 "Documentação: runbook_seed_owner.md", item 6 (desfazer seed com trigger desativado temporariamente).

**Rollback Command Cheatsheet:**

```bash
git revert <commit>
# Em Supabase SQL editor (staging primeiro):
# (bloco de rollback do topo da migration)
```

---

## Approval

**Created by:** `@spec-writer` (persona do Tech Lead)
**Reviewed by:** `@sanity-checker` — APPROVED (Binary Approval Script 7/7 PASS, 2026-04-24)
**Approved by:** Usuário — pendente
**Date:** 2026-04-24
