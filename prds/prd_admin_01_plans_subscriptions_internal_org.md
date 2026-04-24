# PRD: Planos, Assinaturas e Org Interna AxonAI — Foundation DB

**Template:** PRD_COMPLETE
**Complexity Score:** 11 points (DB 5 + API 2 + UI 1 + Business 3 + Deps 0)
**Sprint:** sprint_admin_01_plans_subscriptions_internal_org
**Created:** 2026-04-24
**Status:** Draft

---

## 1. Overview

### Business Goal

Substituir o mecanismo frágil atual de plano (`organizations.plan text`) por um modelo comercial próprio: catálogo `plans` com limites tipados + `subscriptions` (vínculo org↔plano com status canônico). Criar a organização interna AxonAI que ancora os platform admins nos sprints seguintes. Migrar as orgs existentes sem quebrar nenhum caminho do customer app.

Pré-requisito de todos os sprints 05+ do [plano da Área Administrativa](../docs/admin_area/sprint_plan.md). Cobre RF-PLAN-1, RF-PLAN-6, RF-SUB-1 (via INV-1/G-12), RF-SUB-2, RF-SUB-6, INV-1, INV-4, INV-5 (parcial), INV-8 (embutida no conjunto de status).

### User Story

- Como **platform admin (futuro)**, quero planos comerciais como entidades próprias com limites tipados, para operar catálogo e assinaturas sem SQL manual.
- Como **dono da Axon**, quero a organização interna marcada distintivamente no banco, para que nenhuma ação destrutiva atinja a conta de dogfood.
- Como **desenvolvedor**, quero um único helper `getOrgPlan(orgId)` lendo de `subscriptions`, para que o restante do código não dependa da coluna legada `organizations.plan`.

### Success Metrics

- **Cobertura de backfill:** 100% das orgs existentes com exatamente uma `subscription` com `status IN ('trial','ativa','past_due')`.
- **Regressão zero:** golden flows (login, criar lead, listar produtos, pipeline) passam inalterados.
- **Org interna registrada:** `organizations` com `slug='axon'`, `is_internal=true`, `subscriptions` ativa no plano `internal`.
- **Invariante provada:** tentativa de INSERT de segunda subscription vigente para a mesma org falha com `unique_violation` (G-12/INV-1).

---

## 2. Database Requirements

### New Tables

#### Table: `public.plans`

**Purpose:** Catálogo comercial de planos. Fonte canônica dos limites hard-enforceáveis (Sprint 07) e dos metadados de exibição (preço, features, visibilidade).

**Schema & hosting (decisão explícita — ver § 9 Risk 1):** criada em `public.*`, não em `public_ref`. Dois motivos: (a) `subscriptions.plan_id` tem FK para `plans.id` e cross-schema FK adiciona complexidade de permissão sem ganho; (b) o banco ainda não usa `public_ref` em lugar nenhum, então introduzir o schema exclusivamente para esta tabela é custo sem benefício imediato. Esta é a **primeira exceção** ao rule de "toda `public.*` tem `organization_id`" do standards.md — Tech Lead registra `public.plans` na lista oficial de exceções no encerramento do sprint.

**Fields:**
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `name text NOT NULL UNIQUE` — slug interno (`free`, `basic`, `premium`, `internal`); também é o label exibido ao customer quando necessário.
- `description text NULL` — descrição comercial; sem limite de tamanho no MVP.
- `price_monthly_cents int NOT NULL DEFAULT 0` — valor em centavos, BRL.
- `price_yearly_cents int NOT NULL DEFAULT 0`
- `features_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb` — lista descritiva (`[{label:string}]`) para UI customer.
- `is_public boolean NOT NULL DEFAULT true` — `false` oculta o plano em listagens públicas (usado por `internal`).
- `is_archived boolean NOT NULL DEFAULT false` — RF-PLAN-2: plano archived não aparece em novas assinaturas; orgs existentes seguem.
- **Limites tipados (RF-PLAN-6 — conjunto fechado):**
  - `max_users int NULL` (NULL = ilimitado)
  - `max_leads int NULL`
  - `max_products int NULL`
  - `max_pipelines int NULL`
  - `max_active_integrations int NULL`
  - `max_storage_mb int NULL`
  - `allow_ai_features boolean NOT NULL DEFAULT false`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` — atualizado via trigger (ver "Shared function" abaixo).

**Check constraints:**
- `CHECK (price_monthly_cents >= 0)`
- `CHECK (price_yearly_cents >= 0)`
- `CHECK (max_users IS NULL OR max_users >= 0)` (mesmo padrão para os demais `max_*`)

**Indexes:**
- `plans_pkey` (automático)
- `plans_name_key` (UNIQUE em `name`, automático)
- `CREATE INDEX idx_plans_is_public_active ON public.plans (is_public) WHERE is_archived = false;` — acelera listagens públicas do customer (Sprint 06).

**Security (RLS):** `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` (bloqueia superusuário do Postgres, não bypassável por `rls.bypass`).
- **SELECT (authenticated):** `USING (is_public = true AND is_archived = false)`. Usuários autenticados só enxergam planos comerciais públicos e não-arquivados. O plano `internal` (is_public=false) fica invisível por RLS; o RPC `get_current_subscription` (SECURITY DEFINER) acessa-o server-side via privilégios do definer.
- **INSERT/UPDATE/DELETE:** **nenhuma policy** — negado por default. Mutações de catálogo ficam para Sprint 06 (via RPCs `SECURITY DEFINER` executáveis apenas por platform admins).

**Seed (parte da mesma migration, idempotente via `ON CONFLICT (name) DO NOTHING`):**

| name | is_public | is_archived | price_monthly_cents | max_users | max_leads | max_products | max_pipelines | max_active_integrations | max_storage_mb | allow_ai_features |
|---|---|---|---|---|---|---|---|---|---|---|
| `free` | true | false | 0 | **3** | 100 | 50 | 1 | 0 | 100 | false |
| `basic` | true | false | 0 | 5 | 1000 | 500 | 3 | 2 | 1000 | false |
| `premium` | true | false | 0 | NULL | NULL | NULL | NULL | NULL | 10000 | true |
| `internal` | false | false | 0 | NULL | NULL | NULL | NULL | NULL | NULL | true |

- **Decisão `free.max_users = 3`:** preserva o default atual de `organizations.max_users = 3` — reduzir para 2 quebraria orgs existentes no limite. Downgrades futuros são decisão comercial explícita, não efeito colateral de schema.
- **Preços zerados no MVP:** o schema suporta preço, mas o Sprint 01 não fixa valores comerciais. Sprint 06 (CRUD admin) preenche. Mantém a invariante `price_*_cents >= 0` válida.
- **`features_jsonb`** vazio no seed; preenchido na UI admin (Sprint 06).

#### Table: `public.subscriptions`

**Purpose:** Vínculo org↔plano com status canônico. Uma org tem no máximo uma subscription "vigente" (INV-1); pode acumular histórico de `trial_expired`/`cancelada`/`suspensa`.

**Fields:**
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
- `plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT` — INV-2/G-11: plano em uso não é deletável.
- `status text NOT NULL CHECK (status IN ('trial','ativa','past_due','trial_expired','cancelada','suspensa'))` — conjunto fechado de RF-SUB-6.
- `period_start timestamptz NOT NULL DEFAULT now()`
- `period_end timestamptz NULL` — NULL para `ativa` perene; preenchido para `trial`/`cancelada`/`past_due`.
- `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` — inclui `trial_days_override`, notas livres, etc.
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` — trigger.

**Indexes:**
- `subscriptions_pkey` (automático)
- `CREATE INDEX idx_subscriptions_org_status ON public.subscriptions (organization_id, status);` — lookup canônico.
- `CREATE UNIQUE INDEX subscriptions_one_vigente_per_org ON public.subscriptions (organization_id) WHERE status IN ('trial','ativa','past_due');` — **G-12/INV-1**. Partial unique em IN-list é o mecanismo chave do sprint.

**Security (RLS):** `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- **SELECT (authenticated):** `USING (organization_id = (auth.jwt() ->> 'organization_id')::uuid)` — customer lê apenas a própria org.
- **INSERT/UPDATE/DELETE:** **nenhuma policy**. Mutações só via service_role / RPCs `SECURITY DEFINER` (Sprint 05/06).

### Modified Tables

#### Table: `public.organizations`

**Changes:**
- **Add field:** `is_internal boolean NOT NULL DEFAULT false`. Marcador da org Axon — ancora INV-4 ("org interna não pode ser suspensa/cancelada/removida") e INV-5 ("todo platform admin é membro da org interna"). Sprint 01 só cria a coluna e marca a org seed; enforcement via guarda em RPCs vem no Sprint 05.
- **Column deprecation:** `organizations.plan` **permanece** no schema. Adicionar `COMMENT ON COLUMN public.organizations.plan IS 'DEPRECATED — use subscriptions.plan_id via getOrgPlan(). Will be dropped in Sprint 05 once all callers migrate. Do NOT write to this column.';` (ver § 9 Risk 4 para a decisão de não instalar trigger de sincronia).

**Seed: org interna AxonAI** (idempotente via `ON CONFLICT (slug) DO NOTHING`):
- `INSERT INTO public.organizations (name, slug, plan, max_users, is_internal) VALUES ('Axon AI', 'axon', 'free', 3, true);` — o valor de `plan` é irrelevante (coluna deprecated), mas respeita o CHECK/NOT NULL legado. Preservamos `max_users=3` coerente com `free.max_users`.
- Segundo INSERT idempotente em `subscriptions` para a org `axon`: `status='ativa'`, `period_end=NULL`, `plan_id=(SELECT id FROM plans WHERE name='internal')`. Escrito via `INSERT ... SELECT ... WHERE NOT EXISTS (...)` para ser idempotente sem depender do partial unique.

### Backfill (passo crítico da migration)

Para cada `organizations` sem subscription vigente:

```sql
-- 1. Rejeitar universo desconhecido antes de escrever qualquer coisa
DO $$
DECLARE unknown_count int;
BEGIN
  SELECT count(*) INTO unknown_count
  FROM public.organizations
  WHERE plan NOT IN ('free','basic','premium','internal');
  IF unknown_count > 0 THEN
    RAISE EXCEPTION 'Backfill abortado: % org(s) com valor de plan fora do enum conhecido. Inspecione manualmente antes de rodar a migration.', unknown_count;
  END IF;
END $$;

-- 2. Criar subscription 'ativa' para cada org sem vigente (idempotente via NOT EXISTS)
INSERT INTO public.subscriptions (organization_id, plan_id, status, period_start, period_end)
SELECT
  o.id,
  p.id,
  'ativa',
  o.created_at,
  NULL
FROM public.organizations o
JOIN public.plans p ON p.name = o.plan
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE s.organization_id = o.id
    AND s.status IN ('trial','ativa','past_due')
);

-- 3. Validação pós-backfill — prova INV-1
DO $$
DECLARE violators int;
BEGIN
  SELECT count(*) INTO violators
  FROM (
    SELECT organization_id FROM public.subscriptions
    WHERE status IN ('trial','ativa','past_due')
    GROUP BY organization_id
    HAVING count(*) > 1
  ) v;
  IF violators > 0 THEN
    RAISE EXCEPTION 'INV-1 violada: % org(s) com >1 subscription vigente após backfill.', violators;
  END IF;

  -- Toda org deve ter EXATAMENTE 1 vigente (INV-1)
  SELECT count(*) INTO violators
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.organization_id = o.id
      AND s.status IN ('trial','ativa','past_due')
  );
  IF violators > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % org(s) sem subscription vigente.', violators;
  END IF;
END $$;
```

### New Functions / RPCs

#### Function: `public.set_updated_at()`
**Purpose:** trigger helper compartilhado por `plans` e `subscriptions` para manter `updated_at` sincronizado. Criada `CREATE OR REPLACE` (idempotente). Se já existir no schema (via migrations anteriores fora do repo), `OR REPLACE` é no-op seguro.

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
```

Triggers:
- `CREATE TRIGGER trg_plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();`
- `CREATE TRIGGER trg_subscriptions_set_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();`

(Wrapped com `DROP TRIGGER IF EXISTS` antes para garantir idempotência.)

#### Function: `public.get_current_subscription(p_org_id uuid)`

**Purpose:** Retorna a subscription vigente (`status IN ('trial','ativa','past_due')`) da org solicitada, junto com os metadados do plano necessários para `getOrgPlan` no backend.

**Signature:**
```sql
CREATE OR REPLACE FUNCTION public.get_current_subscription(p_org_id uuid)
RETURNS TABLE (
  subscription_id      uuid,
  organization_id      uuid,
  plan_id              uuid,
  plan_name            text,
  status               text,
  period_start         timestamptz,
  period_end           timestamptz,
  metadata             jsonb,
  max_users            int,
  max_leads            int,
  max_products         int,
  max_pipelines        int,
  max_active_integrations int,
  max_storage_mb       int,
  allow_ai_features    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_org text;
  caller_role text;
BEGIN
  caller_org := auth.jwt() ->> 'organization_id';
  caller_role := auth.jwt() ->> 'role';

  IF caller_role IS NULL OR caller_role <> 'service_role' THEN
    IF caller_org IS NULL OR caller_org::uuid <> p_org_id THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.organization_id, s.plan_id, p.name, s.status,
    s.period_start, s.period_end, s.metadata,
    p.max_users, p.max_leads, p.max_products, p.max_pipelines,
    p.max_active_integrations, p.max_storage_mb, p.allow_ai_features
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_org_id
    AND s.status IN ('trial','ativa','past_due')
  ORDER BY s.period_start DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_vigente_subscription' USING ERRCODE = 'P0002', DETAIL = 'org_id=' || p_org_id::text;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_current_subscription(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_current_subscription(uuid) TO authenticated, service_role;
```

**Notas:**
- `SECURITY DEFINER` é necessário porque o RPC lê `plans.internal` (is_public=false, bloqueado pelo RLS de SELECT). Definer roda com privilégios do owner → bypassa RLS.
- Auth check no corpo da função reproduz server-side a invariante de multi-tenancy: customer só lê a própria org; service_role bypassa para uso interno.
- Erros usam códigos SQLSTATE tipados (`42501` não autorizado, `P0002` não encontrado) para callers distinguirem em código TS.

### Existing Tables Used

#### Table: `public.organizations`
**Usage:** origem do backfill; recebe coluna `is_internal`; `plan` marcada como deprecated por comentário.
**Fields accessed:** `id, slug, plan, max_users, created_at` (leitura) + `is_internal` (write: seed + DEFAULT para novas orgs).

### Migration header (rollback documentado — G-17)

Topo do arquivo `.sql` contém comentário estruturado com:
- O que a migration faz (6 blocos: plans, subscriptions, organizations.is_internal, trigger function, RPC, seed+backfill).
- **Rollback em staging** (não em produção sem backup):
  ```
  -- DROP FUNCTION public.get_current_subscription(uuid);
  -- DROP TABLE public.subscriptions;
  -- DROP TABLE public.plans;
  -- ALTER TABLE public.organizations DROP COLUMN is_internal;
  -- COMMENT ON COLUMN public.organizations.plan IS NULL; -- limpa o COMMENT
  -- DROP FUNCTION IF EXISTS public.set_updated_at(); -- só se a função foi criada por esta migration (verificar)
  ```
- Observação explícita: **rollback apaga a org interna axon** se ela foi criada por esta migration. Restore via backup se necessário.

---

## 3. API Contract

### Server Actions

#### `getOrgPlan` — helper novo

**File:** `src/lib/plans/getOrgPlan.ts`

**Signature:**
```typescript
import { cache } from 'react';

export type SubscriptionStatus =
  | 'trial' | 'ativa' | 'past_due'
  | 'trial_expired' | 'cancelada' | 'suspensa';

export interface PlanLimits {
  maxUsers: number | null;
  maxLeads: number | null;
  maxProducts: number | null;
  maxPipelines: number | null;
  maxActiveIntegrations: number | null;
  maxStorageMb: number | null;
  allowAiFeatures: boolean;
}

export interface OrgPlanSnapshot {
  subscriptionId: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  periodStart: string;
  periodEnd: string | null;
  limits: PlanLimits;
}

export const getOrgPlan = cache(
  async (orgId: string): Promise<OrgPlanSnapshot>
);
```

**Business Logic:**
1. `createClient()` via `@/lib/supabase/server` (RLS-enforced client — propaga JWT claims).
2. `supabase.rpc('get_current_subscription', { p_org_id: orgId })`.
3. Se `error.code === '42501'` → lança `Error('org_plan_forbidden')`.
4. Se `error.code === 'P0002'` (no rows) ou `data` vazio → lança `Error('org_plan_missing')`.
5. Mapeia snake_case → camelCase, retorna `OrgPlanSnapshot`.
6. **`React.cache`** dedupe por argumento dentro de um render (TTL = request).
7. Tipos canônicos exportados: `SubscriptionStatus`, `PlanLimits`, `OrgPlanSnapshot`.

**Não é Server Action** (sem `'use server'`) — é um helper server-only chamado por Server Actions e páginas server. Sem revalidatePath (é leitura).

#### `signupWithOrgAction` — guard de flag

**File:** `src/lib/actions/auth.ts` (arquivo existente; modifica `signupWithOrgAction` apenas)

**Mudança:**
```typescript
import { enablePublicSignup } from '@/lib/config/flags';

export async function signupWithOrgAction(input: SignupWithOrgInput): Promise<ActionResponse<{ userId: string; organizationId: string }>> {
  if (!enablePublicSignup) {
    return { success: false, error: 'Signup público desativado.' };
  }
  // ... restante do corpo original inalterado
}
```

**Nota:** `signupWithInviteAction` **NÃO** recebe guard — signup por convite segue habilitado (é o único caminho de onboarding no MVP).

#### Sem novas Server Actions

Sprint 01 é foundation; não adiciona actions de catálogo (ficam para Sprint 06).

### New Configuration Module

**File:** `src/lib/config/flags.ts` (novo)

```typescript
/**
 * Feature flags estáticos. Hardcoded no MVP.
 * Infra de feature flags em DB vem no Sprint 09 — substituir este módulo então.
 */
export const enablePublicSignup = false;
```

Módulo cliente-seguro (sem `server-only`) porque pode ser importado de qualquer camada.

### Refactor de consumidores de `organizations.plan`

Grep executado em `src/`:

| File | Linha | Ação |
|---|---|---|
| `src/app/(app)/settings/organization/page.tsx` | 44 | trocar `plan: org.plan` por `plan: (await getOrgPlan(ctx.organizationId)).planName` (usa `ctx` já disponível) |
| `src/components/settings/OrganizationForm.tsx` | 124 | **nenhuma mudança** — o componente continua recebendo `plan` como prop readonly; só a origem do valor muda |
| `src/lib/actions/organization.ts` | 21, 50 | `OrganizationRow.plan` continua na interface (deprecated em runtime, mas o SELECT mantém a coluna enquanto ela existir). **Não** remover o campo da interface nesta sprint — Sprint 05 faz a remoção quando a coluna for dropada |
| `src/lib/supabase/getSessionContext.ts` | — | grep confirma: não lê `organizations.plan`. Sem mudança. Documentar. |

Grep comando de validação (rodar antes do commit):
```bash
# Deve retornar apenas organization.ts (que mantém a coluna pelo SELECT, não consome) e plans/getOrgPlan.ts (novo)
grep -rn "\.plan\b\|organizations\.plan\|org\.plan" src/
```

### Desativação do `/signup` público (D-1)

**Decisão atualizada durante execução (2026-04-24, a pedido do usuário):** a página `/signup/page.tsx` **não é deletada**; fica gatada com a flag `enablePublicSignup`. Quando a flag é `false` (MVP), a página chama `notFound()` de `next/navigation` → resposta 404. Quando a flag flipar para `true` no futuro (Fase 2), a rota volta a renderizar `<SignupForm />` sem redeploy de código novo, só mudando a flag. Isto preserva o código do formulário como dormant artifact em vez de arqueologia git.

**Arquivos mantidos com gate de flag:**
- `src/app/(auth)/signup/page.tsx` — `if (!enablePublicSignup) notFound();` no topo do componente.

**Arquivos movidos** (para preservar invite + email callback — ver § 9 Risk 2):
- `src/app/(auth)/signup/check-email/page.tsx` → `src/app/(auth)/check-email/page.tsx`
- `src/app/(auth)/signup/link-expired/page.tsx` → `src/app/(auth)/link-expired/page.tsx`

**Call-sites atualizados:**
- `src/components/auth/AcceptInviteForm.tsx:45` — `/signup/check-email?email=…` → `/check-email?email=…`
- `src/components/auth/SignupForm.tsx:63` — `/signup/check-email?email=…` → `/check-email?email=…` (arquivo se torna dead code quando `/signup` é removido, mas **não deletamos** — sprint diz para preservar o form junto com a action; reutilizado quando signup público reativar na Fase 2).
- `src/app/(auth)/login/page.tsx:17` — `<Link href="/signup">` → **remover completamente o bloco "Já tem conta? Criar conta"** do footer. Login não oferece mais criar conta; usuários só entram via convite ou retomam acesso pré-existente.
- `src/app/auth/callback/route.ts:21` — `/signup/link-expired` → `/link-expired`.

**Resultado esperado:**
- `GET /signup` → 404 (gatada por `enablePublicSignup=false` via `notFound()`; código do formulário permanece em disco)
- `GET /signup/check-email` → 404 (diretório removido; conteúdo agora em `/check-email`)
- `GET /signup/link-expired` → 404 (diretório removido; conteúdo agora em `/link-expired`)
- Fluxo de convite (`AcceptInviteForm` → `/check-email`) funciona.
- Callback de confirmação de email com erro GoTrue → `/link-expired` funciona.
- Login não exibe mais CTA "criar conta".

**Validação (grep de comando antes do commit):**
```bash
grep -rn 'href="/signup\|push.*"/signup\|replace.*"/signup\|redirect.*"/signup' src/
# Esperado: zero matches
```

---

## 4. External API Integration

**N/A.** Nenhuma integração externa neste sprint.

---

## 5. Componentes de UI

**Estrutura zero** — sprint é foundation. Única superfície de UI tocada: `src/app/(app)/settings/organization/page.tsx` + `src/components/settings/OrganizationForm.tsx`.

### Component Tree

```
Page: /settings/organization
└── OrganizationPage (server component)
    └── OrganizationForm (client component — inalterado)
        └── Input (from src/components/ui/input) — exibe `organization.plan` readonly
```

### OrganizationPage (mudança mínima)
**File:** `src/app/(app)/settings/organization/page.tsx`

**Mudança única:**
```diff
- const res = await getOrganizationAction();
- // ...
- plan: org.plan,
+ const res = await getOrganizationAction();
+ const planSnapshot = await getOrgPlan(ctx.organizationId);
+ // ...
+ plan: planSnapshot.planName,
```

**Semantic tokens used:** nenhum token novo — estrutura do Card/CardHeader/CardContent já segue o DS, sem alterações.

### OrganizationForm
**File:** `src/components/settings/OrganizationForm.tsx`
**Changes:** **nenhuma**. Prop `organization.plan` continua `string`; apenas a origem muda.

### Sem novos componentes, sem novas páginas, sem novas rotas.

---

## 6. Edge Cases (CRITICAL)

Cobertura mínima para PRD_COMPLETE = 10, 7 categorias. Listados 15, cobrindo as 7 categorias (Estados vazios, Erros de validação, Erros de rede, Erros de autenticação, Operações concorrentes, Limites de dados, Browser/ambiente).

### Database Invariants

- [ ] **Org sem subscription vigente após backfill:** não deve existir — bloco `DO $$` no fim da migration `RAISE EXCEPTION` se count > 0. Se por algum bug escapar, `get_current_subscription` lança `no_vigente_subscription` → `getOrgPlan` lança `org_plan_missing` → consumidor exibe mensagem amigável.
- [ ] **Duas tentativas simultâneas de criar subscription vigente para a mesma org:** segundo INSERT falha com `unique_violation` (partial unique `subscriptions_one_vigente_per_org`). G-12/INV-1.
- [ ] **Plano referenciado por subscription é deletado:** `ON DELETE RESTRICT` em `plan_id` impede. INV-2/G-11 (exercitado em Sprint 06; a constraint **está** agora).
- [ ] **Rerun da migration:** todos os `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`. Segunda execução é no-op.
- [ ] **Org interna já existe** (rollback+replay): seed `ON CONFLICT (slug) DO NOTHING`. Subscription ativa idempotente via `WHERE NOT EXISTS`. Rodar 2× não duplica.
- [ ] **Org com `plan` fora do enum conhecido:** primeiro bloco `DO $$` aborta com mensagem tipada — zero writes realizados. Operador inspeciona manualmente antes de re-rodar.

### Runtime (helper e Server Actions)

- [ ] **`getOrgPlan` chamado para org inexistente ou sem vigente:** lança `org_plan_missing`. UI (settings/organization) captura e renderiza fallback `Plano: não identificado — contate o suporte` em vez de crash. Fallback implementado em `page.tsx` dentro de `try/catch` ao redor do `getOrgPlan`.
- [ ] **`getOrgPlan` chamado sem JWT org_id / org_id diferente do caller:** `get_current_subscription` lança `42501` → helper lança `org_plan_forbidden`. Page exibe "Acesso negado" e o request não renderiza a tela.
- [ ] **Deduplicação dentro de um request:** múltiplas chamadas a `getOrgPlan(sameOrgId)` em uma mesma render compartilham o resultado via `React.cache`. TTL = request.

### Routing (`/signup` desativado)

- [ ] **Acesso a `/signup` após deploy:** Next.js retorna 404 — a página chama `notFound()` porque `enablePublicSignup=false` (arquivo preservado como dormant code para reativação via flag na Fase 2).
- [ ] **Link stale em cache de browser apontando para `/signup`:** 404. Usuário pode voltar para `/login`.
- [ ] **Caller externo (email anterior ao deploy) apontando para `/signup/link-expired` ou `/signup/check-email`:** 404. Para `link-expired` (usado por emails de confirmação), o novo callback já emite `/link-expired`, então emails enviados pós-deploy funcionam. **Emails enviados pré-deploy com erro de GoTrue** redirecionam para `/signup/link-expired` 404; operador manual envia novo convite/link — aceito como trade-off de transição, registrado em § 9 Risk 5.

### Erros de rede (Supabase / GoTrue)

- [ ] **Timeout ou falha de conexão na RPC `get_current_subscription`:** `supabase.rpc(...)` retorna `error` com `code` ≠ `42501`/`P0002` (ex.: `ECONNRESET`, timeout do PostgREST). `getOrgPlan` re-lança como `Error('org_plan_network_error')`; a page `/settings/organization` captura no `try/catch` e renderiza fallback `Plano: indisponível — tente recarregar`. Nenhum crash SSR.
- [ ] **Sessão sem claim `organization_id` no JWT (GoTrue desatualizado):** defense-in-depth — `get_current_subscription` recebe `caller_org = NULL`, compara contra `p_org_id`, dispara `42501`. `getOrgPlan` traduz para `org_plan_forbidden`. Caller vê "Acesso negado" em vez de leak cross-tenant.

### Limites de dados

- [ ] **Seed de `plans` com conflito parcial** (rerun de migration em DB que já tem `free` + `basic` mas não `premium`/`internal`): `ON CONFLICT (name) DO NOTHING` converge — linhas existentes permanecem; apenas as faltantes são inseridas. Idempotência preservada sem upsert destrutivo dos valores do seed (decisão: seed não atualiza colunas existentes — Sprint 06 faz isso via UI admin).

---

## 7. Acceptance Criteria (BINARY)

### Database (GATE 1)

- [ ] `supabase db push --dry-run` passa sem erro.
- [ ] Contagem `CREATE TABLE` vs `ENABLE ROW LEVEL SECURITY` bate (2 tabelas novas, 2 RLS enables, ambas com `FORCE`).
- [ ] Migration rodada duas vezes em staging sem diff no estado final (idempotente).
- [ ] Bloco de backfill confirma 100% das orgs com exatamente uma subscription vigente.
- [ ] INSERT manual de segunda subscription `ativa` para mesma org falha com `unique_violation` (G-12 provado manualmente em staging).
- [ ] DELETE manual de plano referenciado por subscription falha com foreign key violation (INV-2 provado).
- [ ] `SELECT * FROM public.plans` como `authenticated` retorna só `(free, basic, premium)` — `internal` invisível (RLS SELECT policy).
- [ ] `SELECT public.get_current_subscription((SELECT id FROM organizations WHERE slug='axon'))` rodado como `service_role` retorna o plano `internal`.
- [ ] `organizations.is_internal = true` para a org `axon` e `false` para todas as demais.
- [ ] `COMMENT ON COLUMN organizations.plan` aplicado (`\d+ organizations` mostra "DEPRECATED").

### Backend (GATE 2)

- [ ] `src/lib/plans/getOrgPlan.ts` criado e exporta `getOrgPlan`, `PlanLimits`, `SubscriptionStatus`, `OrgPlanSnapshot`.
- [ ] `getOrgPlan` usa `React.cache` e chama `supabase.rpc('get_current_subscription', ...)`.
- [ ] `getOrgPlan` distingue `42501` de `P0002` e expõe erros tipados ao caller.
- [ ] `src/lib/config/flags.ts` criado com `enablePublicSignup = false`.
- [ ] `signupWithOrgAction` tem guard de flag (primeira linha do corpo).
- [ ] `signupWithInviteAction` **não** tem guard (convite permanece ativo).
- [ ] Nenhuma Server Action lança exceção para o cliente; todas retornam `ActionResponse<T>`.
- [ ] `revalidatePath('/settings/organization')` já existia em `updateOrganizationAction` e permanece inalterado.
- [ ] `tsc` passa sem erro e sem `any`.

### Frontend / Routing (GATE 2 + GATE 5)

- [ ] `src/app/(auth)/signup/page.tsx` **mantido** (scope change 2026-04-24) e gatado: chama `notFound()` quando `enablePublicSignup=false`.
- [ ] `src/app/(auth)/check-email/page.tsx` existe (movido de `/signup/check-email/page.tsx`).
- [ ] `src/app/(auth)/link-expired/page.tsx` existe (movido de `/signup/link-expired/page.tsx`).
- [ ] Diretório `src/app/(auth)/signup/` contém **apenas** `page.tsx` (sem subpastas).
- [ ] `grep -rn 'href="/signup\|"/signup/"' src/` retorna zero matches (nenhum call-site aponta para signup — página fica acessível só em `/signup` direto, e já responde 404).
- [ ] `src/app/auth/callback/route.ts` redireciona para `/link-expired` (não `/signup/link-expired`).
- [ ] `src/components/auth/AcceptInviteForm.tsx` redireciona para `/check-email`.
- [ ] `src/components/auth/SignupForm.tsx` redireciona para `/check-email` (preservado para Fase 2).
- [ ] `src/app/(auth)/login/page.tsx` **não** tem mais link para `/signup`.
- [ ] `npm run build` passa.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] O código passa em todas as checagens do [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a e § 1b (GATE 4). Frontend altera linhas triviais, GATE 5 estático (`node scripts/verify-design.mjs --changed`) precisa passar.
- [ ] Smoke manual: abrir `/settings/organization` e verificar que o campo "Plano" exibe `free` (ou o plano correspondente à org do usuário) via `getOrgPlan`, não via `organizations.plan`.
- [ ] Smoke manual: `GET /signup` → 404.

### Guardian (GATE 4)

- [ ] Guardian aprova sem violações.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`)
1. Gerar timestamp e criar `supabase/migrations/<timestamp>_plans_subscriptions_internal_org.sql`.
2. Header comentado (o que faz, rollback, warnings).
3. Blocos na ordem:
   1. `ALTER TABLE organizations ADD COLUMN is_internal ... DEFAULT false NOT NULL;` (idempotente via checagem `information_schema`).
   2. `CREATE TABLE IF NOT EXISTS public.plans (...)` + CHECK constraints + UNIQUE em `name`.
   3. `CREATE TABLE IF NOT EXISTS public.subscriptions (...)` + CHECK em `status` + FK com RESTRICT.
   4. Índices (regular + partial unique).
   5. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` em ambas.
   6. Policies SELECT (com `DROP POLICY IF EXISTS` antes).
   7. `CREATE OR REPLACE FUNCTION public.set_updated_at()` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` por tabela.
   8. `CREATE OR REPLACE FUNCTION public.get_current_subscription(...)` + REVOKE/GRANT.
   9. Pre-backfill check (`DO $$` com RAISE se unknown plans).
   10. Seed `plans` (`ON CONFLICT (name) DO NOTHING`).
   11. Seed `organizations` axon (`ON CONFLICT (slug) DO NOTHING`) + `UPDATE ... SET is_internal=true WHERE slug='axon'`.
   12. Seed subscription axon (`INSERT ... SELECT ... WHERE NOT EXISTS`).
   13. Backfill geral (`INSERT ... SELECT ... WHERE NOT EXISTS`).
   14. Pós-checks (`DO $$` com RAISE para INV-1).
   15. `COMMENT ON COLUMN organizations.plan`.

**Estimated Time:** 25 min.

### Phase 2: Backend (`@backend`)
1. Criar `src/lib/config/flags.ts`.
2. Criar `src/lib/plans/getOrgPlan.ts` com tipos + `cache(...)`.
3. Modificar `src/app/(app)/settings/organization/page.tsx` — 2 linhas (+ try/catch para fallback).
4. Adicionar guard em `signupWithOrgAction` em `src/lib/actions/auth.ts`.
5. Mover pastas `signup/check-email` → `check-email` e `signup/link-expired` → `link-expired` (2 `git mv` preservando histórico).
6. ~~Deletar `src/app/(auth)/signup/page.tsx`~~ → **mantida com gate de flag** (scope change 2026-04-24, ver § 3): adicionar `if (!enablePublicSignup) notFound();` no topo.
7. Atualizar 4 call-sites (`AcceptInviteForm`, `SignupForm`, `login/page.tsx`, `auth/callback/route.ts`).
8. Rodar `npm run build` e `npm run lint`.

**Estimated Time:** 20 min.

### Phase 3: Guardian (`@guardian`)
1. Ler código alterado/criado.
2. Verificar §1a, §1b.
3. Aprovar ou reportar violações.

**Estimated Time:** 5 min.

### Phase 4: Manual verification + Gates
1. Tech Lead roda GATE 1 (`supabase db push --dry-run`, RLS check).
2. Tech Lead roda GATE 2 (`npm run build && npm run lint`).
3. Tech Lead roda GATE 4 (Guardian report).
4. Tech Lead roda GATE 5 estático (`node scripts/verify-design.mjs --changed`).
5. Smoke manual do usuário (golden flow `/settings/organization`, validar 404 de `/signup`).

**Estimated Time:** 10 min.

### Phase 5: QA (on-demand, não incluída)
Skip — usuário não ativou.

**Total Estimated Time:** ~60 min.

---

## 9. Risks & Mitigations

### Risk 1: `plans` em `public.*` viola o rule genérico de multi-tenancy
**Impact:** Low (categoricamente: o rule existe para user-data, `plans` é catálogo comercial).
**Probability:** Certain (é uma deviação consciente).
**Mitigation:** Tech Lead adiciona `public.plans` à lista "Tabelas em `public_ref` atualmente registradas" em `docs/conventions/standards.md` no encerramento do sprint — transforma a exceção em regra documentada. Alternativa rejeitada (criar `public_ref.plans`): custo estrutural (novo schema, cross-schema FKs, search_path) sem benefício concreto no MVP.

### Risk 2: Remoção literal de `/signup/check-email` e `/signup/link-expired` quebra fluxo de convite e callback
**Impact:** High (invite flow é o **único** caminho de onboarding no MVP; quebrá-lo bloqueia novos usuários).
**Probability:** High sem mitigação (o sprint file exige remoção das rotas).
**Mitigation:** Mover as duas páginas para `/check-email` e `/link-expired` (fora de `/signup/`) e atualizar call-sites. Satisfaz o acceptance criterion "`/signup/*` retorna 404" e preserva fluxo. Esta decisão precisa de visto do sanity-checker — se rejeitada, escalamos ao usuário.

### Risk 3: Backfill executado com orgs contendo `plan` fora do enum
**Impact:** Medium (abortar a migration deixa banco parcialmente atualizado apenas se as checagens estivessem no final; mitigação abaixo garante zero-write).
**Probability:** Low (`organizations.plan` tem CHECK atual que restringe valores).
**Mitigation:** Pre-backfill check (`DO $$` no início do bloco de backfill) **antes** de qualquer INSERT. Se achar valor desconhecido, `RAISE EXCEPTION` aborta a transação inteira (migrations rodam em transação única) — zero-write. Operador inspeciona, decide, re-roda.

### Risk 4: Caller legado ainda escreve em `organizations.plan` (drift silencioso)
**Impact:** Medium (Sprint 05 dropará a coluna; escritas pre-drop ficariam órfãs).
**Probability:** Very Low (grep mostra zero writes; só 2 reads e 1 SELECT na action).
**Mitigation:** `COMMENT ON COLUMN` explícito + decisão explícita de **não** instalar trigger de sincronia (Opção B do sprint file). Se surgir escrita futura, ela fica detectável: a coluna não é mais lida (getOrgPlan usa subscription), então qualquer update passa a ser no-op visível via audit do próximo `@guardian` ou DB-auditor.

### Risk 5: Emails pré-deploy linkando `/signup/link-expired` → 404
**Impact:** Low (apenas emails de erro de confirmação; usuário ainda pode tentar novo signup ou pedir convite).
**Probability:** Low (janela pequena entre envio do email e deploy; emails têm TTL curto).
**Mitigation:** Aceito como trade-off de transição. Mensagem 404 default do Next.js é aceitável; não implementa redirect legado (complexidade > benefício).

### Risk 6: `get_current_subscription` sem ordenação determinística se o partial unique falhar
**Impact:** Low (partial unique já garante 0 ou 1 linha vigente).
**Probability:** Very Low (INV-1 reforçada no schema).
**Mitigation:** `ORDER BY period_start DESC LIMIT 1` como belt-and-suspenders no corpo da função — comportamento determinístico mesmo em estado inconsistente transitório.

### Risk 7: `React.cache` falha silenciosa com múltiplos orgs no mesmo request
**Impact:** Low (sprint atual só chama com `ctx.organizationId`; uma única org por render).
**Probability:** Low.
**Mitigation:** `React.cache` é keyed por arg, então multi-org funciona corretamente se surgir caso futuro. Nenhuma ação no Sprint 01.

---

## 10. Dependencies

### Internal
- [ ] Migration `20260423161000_db_housekeeping.sql` aplicada (estabelece `gen_random_uuid()` convention). Já aplicada.
- [ ] `docs/schema_snapshot.json` reflete estado atual — Tech Lead re-roda introspecção após GATE 1 passar.
- [ ] `docs/conventions/standards.md` atualizado (Tech Lead no encerramento) registrando `public.plans` como exceção formal.

### External
- Nenhuma.

### Sprints bloqueados por este
- Sprint 02 (platform_admins) — precisa de `organizations.is_internal`.
- Sprint 05 (onboarding / suspend / create org via UI admin) — precisa de `plans`/`subscriptions`/`get_current_subscription`.
- Sprint 06 (CRUD admin de planos e subscriptions).
- Sprint 07 (hard-enforcement de limites) — depende de `getOrgPlan`.

---

## 11. Rollback Plan

Migration é um bloco transacional. Falha em qualquer etapa aborta tudo.

### Se a migration rodou com sucesso mas causou regressão em produção

1. **Immediate:** reverter commit de código (`git revert`), deployar. A coluna `organizations.plan` ainda existe → customer app volta a funcionar via SELECT legado na `getOrganizationAction`. Mas... **`getOrgPlan` não existe mais** no branch revertido, então a página `settings/organization` que foi modificada para usar `getOrgPlan` também reverte. Coerente.
2. **Database:** rodar o bloco de rollback documentado no topo da migration:
   ```sql
   DROP FUNCTION IF EXISTS public.get_current_subscription(uuid);
   DROP TABLE IF EXISTS public.subscriptions;
   DROP TABLE IF EXISTS public.plans;
   ALTER TABLE public.organizations DROP COLUMN IF EXISTS is_internal;
   COMMENT ON COLUMN public.organizations.plan IS NULL;
   -- Não dropar set_updated_at() — outras migrations futuras podem depender
   ```
   `ON DELETE CASCADE` em `subscriptions.organization_id` garante que DROP TABLE não cascata para `organizations` (cascade é unidirecional).
3. **Org interna:** a org `axon` criada pelo seed **permanece** no banco (DROP TABLE só apaga `subscriptions` e `plans`). Se for desejada remoção, `DELETE FROM organizations WHERE slug='axon'` manual — mas isso normalmente é reversão total do sprint e deve ser decisão humana.
4. **Cache:** `revalidatePath('/', 'layout')` uma vez via script ou re-deploy.
5. **Monitoring:** checar logs Supabase por `org_plan_missing` ou `org_plan_forbidden` para confirmar que tudo voltou ao caminho legado.

### Se a migration falhou no meio

Transação rollada automaticamente. Estado do banco = estado pré-migration. Operador inspeciona mensagem de erro do `RAISE EXCEPTION`, corrige o problema raiz (ex: org com plan fora do enum), re-executa.

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
**Approved by:** Usuário (pendente)
**Date:** 2026-04-24
