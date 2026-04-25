# PRD: CRUD de Plans + Ciclo de Vida de Subscription

**Template:** PRD_COMPLETE  
**Complexity Score:** 16 pontos  
**Sprint:** admin_06  
**Created:** 2026-04-25  
**Status:** Draft

---

## 1. Overview

### Business Goal
Permitir que a equipe Axon opere comercialmente sem SQL manual: criar e manter catálogo de planos, trocar o plano de uma organização, estender trials, cancelar e reativar subscriptions. Fecha o ciclo comercial iniciado no Sprint 01 (schema) e Sprint 05 (CRUD orgs).

### User Story
Como platform admin (owner ou billing), quero gerenciar planos e o ciclo de vida de subscriptions das organizações para que o onboarding, upgrades, downgrades e cancelamentos aconteçam via UI em vez de SQL manual.

### Success Metrics
- Admin consegue criar plano, associar a uma org e alterar seu plano em < 2 min via UI
- INV-2 (plano em uso não exclui) e INV-8 (trial nunca reiniciado) jamais violados via UI ou RPC direto
- Zero race conditions em mudanças concorrentes de subscription (SELECT FOR UPDATE no RPC)

---

## 2. Database Requirements

### Novas Tabelas
Nenhuma. O schema de `plans` e `subscriptions` foi criado no Sprint 01 e está completo.

### Estado atual confirmado via MCP (2026-04-25)

#### Tabela `public.plans` — existente, completa
Colunas: `id`, `name` (UNIQUE), `description`, `price_monthly_cents`, `price_yearly_cents`, `features_jsonb`, `is_public`, `is_archived`, `max_users`, `max_leads`, `max_products`, `max_pipelines`, `max_active_integrations`, `max_storage_mb`, `allow_ai_features`, `created_at`, `updated_at`  
Índices: `plans_pkey`, `plans_name_key` (UNIQUE), `idx_plans_is_public_active`  
RLS: FORCE — `plans_select_public` (customer) + `platform_admins_select_all_plans` (admin). Sem policies de mutação (writes só via RPC/service client admin).

#### Tabela `public.subscriptions` — existente, completa
Colunas: `id`, `organization_id`, `plan_id`, `status` (CHECK), `period_start`, `period_end`, `metadata`, `created_at`, `updated_at`  
Índices: `subscriptions_pkey`, `idx_subscriptions_org_status`, `subscriptions_one_vigente_per_org` (partial UNIQUE — INV-1)  
RLS: FORCE — `subscriptions_select_own_org` (customer) + `platform_admins_select_all_subscriptions` (admin). Sem policies de mutação.

### Novos RPCs (Migration `admin_06`)

Todos `SECURITY DEFINER`, `SEARCH_PATH = public`, `REVOKE EXECUTE FROM anon, authenticated` após criação.

#### `admin_create_plan(p_name, p_description, p_price_monthly_cents, p_price_yearly_cents, p_features_jsonb, p_is_public, p_max_users, p_max_leads, p_max_products, p_max_pipelines, p_max_active_integrations, p_max_storage_mb, p_allow_ai_features, p_ip_address, p_user_agent) RETURNS uuid`
- Verifica que o caller é platform admin ativo (`platform_admins` com `profile_id = auth.uid()`)
- Verifica papel: `owner` apenas
- Insere em `plans`; rejeita se `name` já existe (UNIQUE violation → erro tipado `plan_name_taken`)
- Grava audit `'plan.create'` via `audit_write`
- Retorna o `id` do plano criado

#### `admin_update_plan(p_plan_id, p_name, p_description, p_price_monthly_cents, p_price_yearly_cents, p_features_jsonb, p_is_public, p_max_users, p_max_leads, p_max_products, p_max_pipelines, p_max_active_integrations, p_max_storage_mb, p_allow_ai_features, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin owner
- Rejeita se plano não existe ou já está arquivado (`plan_not_found`, `plan_archived`)
- Rejeita se `name` conflita com outro plano
- `diff_before` / `diff_after` calculados no RPC para audit
- Grava audit `'plan.update'`

#### `admin_archive_plan(p_plan_id, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin owner
- Rejeita se plano não existe ou já arquivado
- Seta `is_archived = true`, `is_public = false`
- Grava audit `'plan.archive'`
- **Não** exige ausência de subscriptions ativas (plano arquivado pode ter subs históricas; novas orgs não podem escolhê-lo)

#### `admin_delete_plan(p_plan_id, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin owner
- Rejeita se plano não existe
- **Rejeita se existir qualquer subscription com este `plan_id` e status IN ('trial','ativa','past_due')** → erro tipado `plan_in_use` (INV-2)
- Deleta o plano
- Grava audit `'plan.delete'`

#### `admin_change_plan(p_subscription_id, p_new_plan_id, p_effective_at, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin `owner` OR `billing`
- `SELECT ... FOR UPDATE` na subscription (anti race-condition)
- Rejeita se subscription não encontrada ou status não em ('trial','ativa','past_due') → `subscription_not_active`
- Rejeita se novo plano não existe ou arquivado → `plan_not_found`
- Valida downgrade: se `new_plan.max_users < current_users_count` → erro tipado `downgrade_users_exceed` (RF-SUB-4). Mesma validação para leads, products, pipelines se limite < contagem atual
- Calcula `diff_before` (limites antigos) / `diff_after` (limites novos) para audit
- Atualiza `subscriptions.plan_id`, `period_start = p_effective_at`
- Grava audit `'subscription.change_plan'`

#### `admin_extend_trial(p_subscription_id, p_days, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin `owner` OR `billing`
- `SELECT ... FOR UPDATE` na subscription
- Rejeita se subscription não está em status `trial` → erro tipado `not_in_trial` (INV-8 — trial não pode ser reiniciado; extensão só enquanto ainda em trial)
- Acumula: `metadata.trial_days_override = coalesce(metadata->>'trial_days_override', '0')::int + p_days`
- Atualiza `period_end = period_end + interval '${p_days} days'`
- Grava audit `'subscription.extend_trial'` com `diff_after.days_added`

#### `admin_cancel_subscription(p_subscription_id, p_effective_at, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin `owner` OR `billing`
- `SELECT ... FOR UPDATE` na subscription
- Rejeita se status já é `cancelada` → `already_cancelled`
- Seta `status = 'cancelada'`, `period_end = p_effective_at`
- Grava audit `'subscription.cancel'`

#### `admin_reactivate_subscription(p_subscription_id, p_new_plan_id, p_ip_address, p_user_agent) RETURNS void`
- Verifica caller = platform admin `owner` OR `billing`
- `SELECT ... FOR UPDATE` na subscription
- Rejeita se status não é `cancelada` nem `trial_expired` → `not_cancellable`
- Verifica INV-1: se org já tem subscription ativa (status IN ('trial','ativa','past_due')) → `org_already_has_active_subscription`
- Seta `status = 'ativa'`, `plan_id = p_new_plan_id`, `period_start = now()`, `period_end = null`
- Grava audit `'subscription.reactivate'`

#### `check_and_update_expired_trials(p_org_ids uuid[]) RETURNS int`
- Executa como `SECURITY DEFINER`; pode ser chamada via service client no middleware admin
- Para cada org em `p_org_ids`: se subscription com status `trial` e `period_end < now()` → flip para `trial_expired`
- Retorna count de subscriptions atualizadas
- Não grava audit (operação de sistema, não ação humana)

### Erros tipados (adicionados ao mapa `RPC_ERROR_MESSAGES` nas actions)
```
plan_name_taken        → 'Já existe um plano com este nome.'
plan_not_found         → 'Plano não encontrado.'
plan_archived          → 'Plano já está arquivado.'
plan_in_use            → 'Plano tem subscriptions ativas e não pode ser excluído.'
subscription_not_found → 'Subscription não encontrada.'
subscription_not_active→ 'Subscription não está em estado ativo.'
not_in_trial           → 'Extensão de trial só é possível enquanto a subscription estiver em trial.'
already_cancelled      → 'Subscription já está cancelada.'
not_cancellable        → 'Apenas subscriptions canceladas ou expiradas podem ser reativadas.'
org_already_has_active_subscription → 'Organização já possui uma subscription ativa.'
downgrade_users_exceed → 'Downgrade inválido: organização possui mais usuários do que o limite do novo plano.'
downgrade_leads_exceed → 'Downgrade inválido: organização possui mais leads do que o limite do novo plano.'
```

---

## 3. API Contract

### Arquivos
- `src/lib/actions/admin/plans.schemas.ts` — schemas Zod de plans
- `src/lib/actions/admin/plans.ts` — Server Actions de plans
- `src/lib/actions/admin/subscriptions.schemas.ts` — schemas Zod de subscriptions
- `src/lib/actions/admin/subscriptions.ts` — Server Actions de subscription lifecycle

### 3.1 Plans — Schemas Zod (`plans.schemas.ts`)

```typescript
export const ListPlansSchema = z.object({
  search:      z.string().trim().max(100).optional(),
  isPublic:    z.boolean().optional(),
  isArchived:  z.boolean().optional().default(false),
  page:        z.number().int().min(1).default(1),
  pageSize:    z.number().int().min(1).max(100).default(25),
  sortBy:      z.enum(['name', 'created_at', 'price_monthly_cents']).default('created_at'),
  sortOrder:   z.enum(['asc', 'desc']).default('desc'),
});

const planLimitsSchema = z.object({
  maxUsers:              z.number().int().min(1).nullable(),
  maxLeads:              z.number().int().min(1).nullable(),
  maxProducts:           z.number().int().min(1).nullable(),
  maxPipelines:          z.number().int().min(1).nullable(),
  maxActiveIntegrations: z.number().int().min(1).nullable(),
  maxStorageMb:          z.number().int().min(1).nullable(),
  allowAiFeatures:       z.boolean().default(false),
});

export const CreatePlanSchema = z.object({
  name:                z.string().trim().min(2, 'Nome muito curto').max(100, 'Nome muito longo'),
  description:         z.string().trim().max(500).optional(),
  priceMonthly:        z.number().int().min(0, 'Preço deve ser >= 0'),
  priceYearly:         z.number().int().min(0, 'Preço deve ser >= 0'),
  featuresJsonb:       z.array(z.string()).default([]),
  isPublic:            z.boolean().default(true),
}).merge(planLimitsSchema);

export const UpdatePlanSchema = z.object({
  id: z.string().uuid(),
}).merge(CreatePlanSchema);

export const ArchivePlanSchema = z.object({ id: z.string().uuid() });
export const DeletePlanSchema  = z.object({ id: z.string().uuid() });

export type ListPlansInput   = z.input<typeof ListPlansSchema>;
export type CreatePlanInput  = z.input<typeof CreatePlanSchema>;
export type UpdatePlanInput  = z.input<typeof UpdatePlanSchema>;
```

### 3.2 Plans — Server Actions (`plans.ts`)

**Tipos exportados:**
```typescript
export interface PlanListItem {
  id: string; name: string; description: string | null;
  priceMonthly: number; priceYearly: number;
  isPublic: boolean; isArchived: boolean;
  maxUsers: number | null; maxLeads: number | null;
  maxProducts: number | null; maxPipelines: number | null;
  maxActiveIntegrations: number | null; maxStorageMb: number | null;
  allowAiFeatures: boolean; createdAt: string;
  activeSubscriptionsCount: number;
}
```

**`getPlansAction(input)`** → `ActionResponse<PlanListItem[]>`
- `requirePlatformAdmin()` (leitura: qualquer papel)
- Query em `plans` com filtros + contagem de subscriptions ativas por plano
- Paginação server-side

**`getPlanDetailAction(id)`** → `ActionResponse<PlanListItem>`
- `requirePlatformAdmin()`
- Retorna plano + count de subscriptions ativas

**`createPlanAction(input)`** → `ActionResponse<{ id: string }>`
- `requirePlatformAdminRole(['owner'])`
- Chama RPC `admin_create_plan`
- `revalidatePath('/admin/plans')`

**`updatePlanAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner'])`
- Chama RPC `admin_update_plan`
- `revalidatePath('/admin/plans')` + `revalidatePath('/admin/plans/[id]/edit')`

**`archivePlanAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner'])`
- Chama RPC `admin_archive_plan`
- `revalidatePath('/admin/plans')`

**`deletePlanAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner'])`
- Chama RPC `admin_delete_plan`; mapeia `plan_in_use` → mensagem pt-BR
- `revalidatePath('/admin/plans')`

### 3.3 Subscriptions — Schemas Zod (`subscriptions.schemas.ts`)

```typescript
export const ChangePlanSchema = z.object({
  subscriptionId: z.string().uuid(),
  newPlanId:      z.string().uuid('Selecione um plano'),
  effectiveAt:    z.string().datetime().optional(), // ISO8601; default: now()
});

export const ExtendTrialSchema = z.object({
  subscriptionId: z.string().uuid(),
  days:           z.number().int().min(1, 'Mínimo 1 dia').max(365, 'Máximo 365 dias'),
});

export const CancelSubscriptionSchema = z.object({
  subscriptionId:  z.string().uuid(),
  effectiveAt:     z.string().datetime().optional(),
});

export const ReactivateSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  newPlanId:      z.string().uuid('Selecione um plano'),
});

export const MarkPastDueSchema = z.object({
  subscriptionId: z.string().uuid(),
});
```

### 3.4 Subscriptions — Server Actions (`subscriptions.ts`)

**`changePlanAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner', 'billing'])`
- Chama RPC `admin_change_plan`; mapeia erros de downgrade
- `revalidatePath('/admin/organizations/[orgId]/subscription')` + `/admin/organizations`

**`extendTrialAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner', 'billing'])`
- Chama RPC `admin_extend_trial`; mapeia `not_in_trial`

**`cancelSubscriptionAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner', 'billing'])`
- Chama RPC `admin_cancel_subscription`

**`reactivateSubscriptionAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner', 'billing'])`
- Chama RPC `admin_reactivate_subscription`

**`markPastDueAction(input)`** → `ActionResponse<{ ok: true }>`
- `requirePlatformAdminRole(['owner', 'billing'])`
- Update direto: `subscriptions.status = 'past_due'` via service client
- Grava audit `'subscription.mark_past_due'`

**`getOrgSubscriptionAction(orgId)`** → `ActionResponse<OrgSubscriptionDetail>`
- `requirePlatformAdmin()`
- Usa `get_current_subscription(orgId)` + join em `plans` para preview de limites

```typescript
export interface OrgSubscriptionDetail {
  subscriptionId: string;
  status: string;
  planId: string;
  planName: string;
  periodStart: string;
  periodEnd: string | null;
  metadata: { trial_days_override?: number };
  limits: {
    maxUsers: number | null; maxLeads: number | null;
    maxProducts: number | null; maxPipelines: number | null;
    maxActiveIntegrations: number | null; maxStorageMb: number | null;
    allowAiFeatures: boolean;
  };
}
```

---

## 4. External API Integration
N/A — sem APIs externas neste sprint.

---

## 5. Componentes de UI

Todos os componentes usam `src/components/ui/` (Button, Input, Select, Badge, Card, Dialog, Table). Tokens semânticos: `bg-surface-raised`, `text-text-primary`, `text-text-secondary`, `border-border`, `bg-action-primary`, `text-feedback-*`. Nenhum literal hex, nenhuma classe primitiva de cor.

### 5.1 Módulo Plans (`/admin/plans`)

#### Component Tree
```
src/app/admin/plans/
├── layout.tsx                        → AdminShell wrapper
├── page.tsx                          → PlansPage (Server Component)
│   └── PlansList (Client Component)
│       ├── PlansFilters              → search + isPublic + isArchived toggles
│       ├── Table (DS)                → colunas: Nome, Preço Mensal, Público, Arquivado, Subs ativas, Ações
│       │   └── PlanRowActions        → Editar | Arquivar | Excluir (com confirmação)
│       └── Pagination (DS)
├── new/
│   └── page.tsx                      → NewPlanPage (Server Component)
│       └── PlanForm (Client Component, mode="create")
└── [id]/
    └── edit/
        └── page.tsx                  → EditPlanPage (Server Component)
            └── PlanForm (Client Component, mode="edit", initialData)
```

**`PlanForm`** — `src/components/admin/plans/PlanForm.tsx`
Props: `mode: 'create' | 'edit'`, `initialData?: PlanListItem`

Seções:
1. **Informações básicas**: Nome, Descrição (Textarea), Preço mensal (cents → R$), Preço anual, Is Public (Switch), Features (array de strings, add/remove)
2. **Limites do plano**: 7 campos de número (nullable = ilimitado) — Max Usuários, Max Leads, Max Produtos, Max Pipelines, Max Integrações, Max Storage MB; Allow AI Features (Switch)
3. **Botão**: "Criar plano" / "Salvar alterações" + estado loading
4. **Danger zone** (só em `mode="edit"`): "Arquivar plano" (com `ArchivePlanDialog`) + "Excluir plano" (com `DeletePlanDialog` mostrando mensagem de erro se `plan_in_use`)

**`ArchivePlanDialog`** — `src/components/admin/plans/ArchivePlanDialog.tsx`
- Confirmação simples (sem digitação de slug, pois archive é reversível indiretamente via update)
- Chama `archivePlanAction`; toast de sucesso + redirect para `/admin/plans`

**`DeletePlanDialog`** — `src/components/admin/plans/DeletePlanDialog.tsx`
- Mostra badge "N subscriptions ativas" se `activeSubscriptionsCount > 0` → botão "Excluir" desabilitado com tooltip "Plano tem subscriptions ativas"
- Se `activeSubscriptionsCount === 0`: confirmação com digitação literal do nome do plano
- Chama `deletePlanAction`

### 5.2 Módulo Subscription (`/admin/organizations/[id]/subscription`)

#### Component Tree
```
src/app/admin/organizations/[id]/subscription/
└── page.tsx                          → OrgSubscriptionPage (Server Component)
    └── SubscriptionPanel (Client Component)
        ├── SubscriptionStatusCard    → status badge + plano atual + datas + limites
        ├── ChangePlanSection         → Select de plano + preview de diff de limites
        ├── ExtendTrialSection        → Input days (visível só se status='trial')
        ├── CancelSubscriptionSection → Danger zone com confirmação
        ├── ReactivateSection         → Visível só se status='cancelada'|'trial_expired'
        └── MarkPastDueSection        → Visível só se status='ativa'
```

**`SubscriptionStatusCard`** — `src/components/admin/subscriptions/SubscriptionStatusCard.tsx`
- Badge semântico por status: `trial` → `bg-feedback-warning-bg`, `ativa` → `bg-feedback-success-bg`, `cancelada` / `trial_expired` → `bg-feedback-error-bg`, `past_due` → `bg-feedback-warning-bg`, `suspensa` → `text-text-secondary`
- Exibe: período de vigência, limites atuais do plano em grid 7 itens

**`ChangePlanSection`** — `src/components/admin/subscriptions/ChangePlanSection.tsx`
- `Select` com lista de planos ativos (não arquivados)
- Preview de diff: tabela inline mostrando limite atual vs limite do novo plano (verde se sobe, vermelho se desce)
- Data efetiva (DatePicker com default = agora)
- Botão "Trocar plano" → chama `changePlanAction`; mapeia erros de downgrade em mensagem inline

**`ExtendTrialSection`**
- Visível apenas se `status === 'trial'`
- Input numérico (1–365 dias) + botão "Estender trial"
- Exibe: trial atual expira em X dias (`period_end - now()`); acumulado se já houve extensões (`metadata.trial_days_override`)

**`CancelSubscriptionSection`** (Danger Zone)
- `Dialog` de confirmação digitando o slug da org
- DatePicker para `effective_at` (default = `period_end ?? now()`)

**`ReactivateSection`**
- Visível se `status IN ('cancelada', 'trial_expired')`
- Select de plano + botão "Reativar com este plano"

---

## 6. Edge Cases

### INV-1 — Unicidade de subscription ativa
- [ ] Tentar criar segunda subscription ativa para mesma org via `admin_reactivate_subscription` quando já existe uma → erro `org_already_has_active_subscription`

### INV-2 — Plano em uso
- [ ] `deletePlanAction` com 1+ subscriptions ativas → botão desabilitado na UI + erro tipado do RPC
- [ ] Mesmo via chamada direta ao RPC → erro `plan_in_use`

### INV-8 — Trial não reiniciado
- [ ] `extendTrialAction` quando `status !== 'trial'` → erro `not_in_trial` com mensagem pt-BR
- [ ] Org com `status = 'trial_expired'` não pode estender trial — apenas reativar com novo plano

### Downgrade com uso acima do novo limite
- [ ] `changePlanAction` para plano com `max_users = 2` quando org tem 5 usuários ativos → erro `downgrade_users_exceed`
- [ ] Preview de diff na UI mostra vermelho + texto "Atenção: organização tem X usuários, novo plano permite Y"

### Race condition em subscription
- [ ] `SELECT ... FOR UPDATE` no RPC garante que dois admins simultâneos não dupliquem a subscription ativa
- [ ] Segundo request recebe erro tipado em vez de violar o partial UNIQUE index com mensagem obscura

### Plano arquivado
- [ ] Plano arquivado não aparece no Select de novos planos (filtrado por `is_archived = false`)
- [ ] Plano arquivado ainda aparece na listagem de plans com badge "Arquivado" e ações desabilitadas

### Estados vazios
- [ ] Lista de plans sem planos → empty state com CTA "Criar primeiro plano"
- [ ] Org sem subscription ativa → `SubscriptionPanel` exibe empty state "Sem subscription ativa"

### Autenticação e autorização
- [ ] Admin `support` acessa listagem de plans e detalhe de subscription → OK (read)
- [ ] Admin `support` tenta `createPlanAction` → `requirePlatformAdminRole(['owner'])` → erro "Permissão insuficiente"
- [ ] Admin `billing` tenta `deletePlanAction` → idem
- [ ] Sessão expirada em qualquer action → `requirePlatformAdmin()` lança → retorna `success: false, error: 'Sessão inválida.'`

### Preço e limites
- [ ] `priceMonthly = 0` (plano gratuito) → válido
- [ ] Limite `null` = ilimitado → exibido como "∞" na UI, não como "null" ou "0"

### Erros de rede (categoria 3)
- [ ] Server Action retorna erro 5xx (Supabase down) → `success: false, error: 'Erro interno. Tente novamente.'` com toast de erro visível; formulário não perde dados preenchidos
- [ ] Timeout na chamada ao RPC `admin_change_plan` → mesma resposta de erro; botão "Trocar plano" volta ao estado habilitado para retry
- [ ] Perda de conexão durante `deletePlanAction` → ação não é re-submetida automaticamente; usuário vê toast de erro e pode tentar de novo manualmente

### Browser / ambiente (categoria 7)
- [ ] Painel de subscription (`/admin/organizations/[id]/subscription`) em viewport mobile (375px) → layout stack, sem overflow horizontal; botões de ação acessíveis sem scroll lateral
- [ ] `PlanForm` com JS desabilitado → página renderiza sem crash (Server Component); formulário sem interatividade exibe mensagem "JavaScript é necessário para esta funcionalidade"

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration aplica sem erros via SQL Studio
- [ ] Todos os 8 RPCs criados com `SECURITY DEFINER` e `REVOKE EXECUTE FROM anon, authenticated`
- [ ] `admin_delete_plan` falha com erro tipado `plan_in_use` quando existe subscription ativa
- [ ] `admin_extend_trial` falha com `not_in_trial` para subscription fora de trial
- [ ] `admin_change_plan` usa `SELECT ... FOR UPDATE` (verificável por `EXPLAIN ANALYZE`)
- [ ] `admin_reactivate_subscription` rejeita se org já tem subscription ativa (INV-1)
- [ ] `check_and_update_expired_trials` flipa status `trial` → `trial_expired` para `period_end < now()`

### Backend
- [ ] Todos os Server Actions validam input com Zod antes de qualquer chamada
- [ ] Todos os Server Actions chamam `requirePlatformAdmin()` ou `requirePlatformAdminRole()`
- [ ] Todos os Server Actions retornam `ActionResponse<T>`
- [ ] Erros tipados de RPC mapeados para mensagens pt-BR (tabela `RPC_ERROR_MESSAGES`)
- [ ] `revalidatePath` chamado após toda mutação nos paths afetados
- [ ] `support` não consegue criar/editar/arquivar/deletar planos (role check)
- [ ] `billing` consegue change_plan, extend_trial, cancel, reactivate (role check)

### Frontend (design system compliance)
- [ ] Código passa em todas as checagens do `@guardian` (rules.md + CONTRACT.md)
- [ ] Componentes verificados com `data-theme="dark"` togglado no `<html>`
- [ ] Todos os formulários têm estado de loading
- [ ] Todos os formulários têm estado de erro inline
- [ ] Todos os formulários têm feedback de sucesso via toast
- [ ] Limite `null` exibido como "∞" (nunca como "null" ou "0")
- [ ] Badge de status usa tokens semânticos de feedback (nunca classes primitivas)

### Integration Tests (obrigatórios — GATE 4.5)
- [ ] `tests/integration/admin-plans.test.ts` — happy path + Zod fail + auth fail por action
- [ ] `tests/integration/admin-subscriptions.test.ts` — happy path + INV-2 + INV-8 + downgrade + race condition mock
- [ ] Zero testes com `it.skip` ou `it.todo`

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`) — ~20 min
1. Escrever migration `supabase/migrations/[ts]_admin_06_plans_subscription_rpcs.sql`
2. Implementar os 8 RPCs (ordem: `admin_create_plan`, `admin_update_plan`, `admin_archive_plan`, `admin_delete_plan`, `admin_change_plan`, `admin_extend_trial`, `admin_cancel_subscription`, `admin_reactivate_subscription`, `check_and_update_expired_trials`)
3. `REVOKE` + `has_function_privilege` checks para `anon`
4. Validar via `dry-run` e queries de inspeção (GATE 1)

### Phase 2: Backend (`@backend`) — ~25 min
1. `src/lib/actions/admin/plans.schemas.ts` + `plans.ts` (5 actions)
2. `src/lib/actions/admin/subscriptions.schemas.ts` + `subscriptions.ts` (6 actions)
3. Build + lint (GATE 2)

### Phase 3: Integration Tests (`@qa-integration`) — ~15 min
1. `tests/integration/admin-plans.test.ts`
2. `tests/integration/admin-subscriptions.test.ts`
3. `npm test -- --run tests/integration/` (GATE 4.5 antecipado)

### Phase 4: Frontend (`@frontend+`) — ~35 min
1. `src/app/admin/plans/layout.tsx`
2. `src/app/admin/plans/page.tsx` + `PlansList` + `PlansFilters`
3. `src/app/admin/plans/new/page.tsx` + `PlanForm` (mode=create)
4. `src/app/admin/plans/[id]/edit/page.tsx` + `PlanForm` (mode=edit) + `ArchivePlanDialog` + `DeletePlanDialog`
5. `src/app/admin/organizations/[id]/subscription/page.tsx` + `SubscriptionPanel` + sub-componentes
6. Build + lint (GATE 2)

### Phase 5: Code Review (`@guardian`) — ~5 min
1. Validar design system compliance
2. Validar tipos, segurança, regras invioláveis
3. Aprovação → GATE 4.5 completo + GATE 5

**Tempo total estimado:** ~100 min

---

## 9. Risks & Mitigations

### Risk 1: Race condition em `admin_change_plan` concorrente
**Impact:** High — violaria INV-1 (duas subscriptions ativas)  
**Probability:** Low (UI serializa, mas CLI/testes podem triggerar)  
**Mitigation:** `SELECT ... FOR UPDATE` no RPC; partial UNIQUE index como cinto de segurança

### Risk 2: Downgrade com contagem de recursos em tempo real
**Impact:** Medium — RPC precisa fazer COUNT de leads/products/users na hora do downgrade  
**Probability:** Medium — COUNT em tabelas grandes pode ser lento  
**Mitigation:** COUNT só é executado quando o novo plano tem limite < current (evita query desnecessária). Se performance for problema, adicionar índice em `organization_id` nas tabelas contadas (já existem em leads, profiles).

### Risk 3: MCP em read-only — migration manual
**Impact:** Medium — padrão estabelecido desde Sprint 01  
**Probability:** High — MCP está em read-only  
**Mitigation:** Protocolo estabelecido (APRENDIZADOS 2026-04-24): pedir ao usuário para colar SQL no Studio; validar estruturalmente com `execute_sql`.

### Risk 4: `admin_change_plan` com `effective_at` futuro
**Impact:** Low — subscription muda `period_start` para data futura, mas status segue `ativa`  
**Probability:** Low  
**Mitigation:** UI usa "agora" como default; campo é opcional; documentar no tooltip que `effective_at` afeta `period_start`, não a data de vigência do bloqueio.

---

## 10. Dependencies

### Internas
- [x] `plans` e `subscriptions` tables existem (Sprint 01)
- [x] `audit_write` RPC existe (Sprint 03)
- [x] `requirePlatformAdmin` / `requirePlatformAdminRole` existem (Sprint 02)
- [x] `get_current_subscription` RPC existe (Sprint 01)
- [x] `src/lib/actions/admin/organizations.ts` padrão de código a seguir (Sprint 05)
- [x] Shell admin + layout + middleware (Sprint 04)
- [x] `tests/setup.ts` + `vitest.config.ts` existe (bootstrap)

### Externas
- Nenhuma

---

## 11. Rollback Plan

### Se a migration falhar após apply no Studio
1. Os RPCs são CREATE OR REPLACE / DROP IF EXISTS — re-aplicar é seguro
2. Nenhuma alteração de schema de tabela neste sprint → rollback é apenas dropar os RPCs criados

### Se o build ou tests falharem
1. `git restore src/lib/actions/admin/plans.ts src/lib/actions/admin/subscriptions.ts`
2. `git restore src/app/admin/plans/ src/app/admin/organizations/`
3. RPCs no banco permanecem (inofensivos sem o código TypeScript que os chama)

### Rollback commands
```bash
# Código
git revert <commit-hash>

# RPCs (executar no Studio se necessário)
DROP FUNCTION IF EXISTS admin_create_plan CASCADE;
DROP FUNCTION IF EXISTS admin_update_plan CASCADE;
DROP FUNCTION IF EXISTS admin_archive_plan CASCADE;
DROP FUNCTION IF EXISTS admin_delete_plan CASCADE;
DROP FUNCTION IF EXISTS admin_change_plan CASCADE;
DROP FUNCTION IF EXISTS admin_extend_trial CASCADE;
DROP FUNCTION IF EXISTS admin_cancel_subscription CASCADE;
DROP FUNCTION IF EXISTS admin_reactivate_subscription CASCADE;
DROP FUNCTION IF EXISTS check_and_update_expired_trials CASCADE;
```

---

## Approval

**Created by:** @spec-writer  
**Reviewed by:** @sanity-checker (pendente)  
**Approved by:** —  
**Date:** 2026-04-25
