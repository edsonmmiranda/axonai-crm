# PRD: Leads — Lista & CRUD

**Template:** PRD_COMPLETE
**Complexity Score:** 10 points
**Sprint:** 10
**Created:** 2026-04-20
**Status:** Draft

---

## 1. Overview

### Business Goal
O módulo de Leads é o **core do CRM**. Sem ele, o produto não tem função principal. Este sprint substitui o placeholder em `/leads` pelo CRUD completo, consumindo os sub-módulos de suporte já existentes (origens, motivos de perda, tags).

### User Stories
- Como **vendedor**, quero ver leads da minha org em tabela paginada, buscar por nome/email/telefone/empresa, filtrar por status/origem/responsável/tag, cadastrar leads com dados de contato + UTM + empresa + notas, editar leads, atribuir tags (multi-select), atribuir a outro membro da equipe, e marcar como "perdido" com motivo obrigatório.
- Como **admin**, quero excluir leads permanentemente.
- Como **usuário de outra org**, NÃO consigo ver nem editar leads alheios (RLS).

### Success Metrics
- Usuário loga, acessa `/leads`, vê lista paginada dos leads da org.
- CRUD completo funcional com todos os filtros, busca, paginação e sort.
- RLS impede acesso cross-org.

---

## 2. Database Requirements

### New Tables
Nenhuma — tabelas `leads` e `lead_tags` já existem.

### Modified Tables
Nenhuma — schema já está completo.

### Existing Tables Used

#### Table: `leads` (27 colunas)
**Usage:** Tabela principal do CRUD.
**Campos:** `id`, `organization_id`, `name`, `email`, `phone`, `medium`, `campaign`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `company`, `position`, `notes`, `status` (default 'new'), `score` (default 0), `created_at`, `updated_at`, `created_by`, `assigned_to`, `stage_id`, `card_order`, `value` (default 0), `origin_id`, `loss_reason_id`, `loss_notes`.
**Índices:** `idx_leads_organization`, `idx_leads_status`, `idx_leads_email`, `idx_leads_assigned_to`, `idx_leads_stage_id`, `idx_leads_created_at`, `idx_leads_loss_reason`, `idx_leads_card_order`.
**RLS:** 4 policies (SELECT/INSERT/UPDATE por org; DELETE apenas admin).
**Campos fora de escopo neste sprint:** `stage_id`, `card_order` (Sprint 13 — Pipeline).

#### Table: `lead_tags` (M2M)
**Usage:** Relação many-to-many entre leads e tags.
**Campos:** `lead_id`, `tag_id`, `created_at`.
**PK:** composta `(lead_id, tag_id)`.
**RLS:** 3 policies (SELECT/INSERT/DELETE por org).

#### Table: `lead_origins`
**Usage:** Lookup para popular selects de origem.
**Campos acessados:** `id`, `name`, `is_active`.

#### Table: `loss_reasons`
**Usage:** Lookup para dialog "Marcar como perdido".
**Campos acessados:** `id`, `name`, `is_active`.

#### Table: `profiles`
**Usage:** Lookup para selects de responsável.
**Campos acessados:** `id`, `full_name`, `is_active`, `organization_id`.

#### Table: `tags`
**Usage:** Lookup para multi-select de tags.
**Campos acessados:** `id`, `name`, `color`, `is_active`.

### @db-admin — Confirmação obrigatória
- Verificar comportamento ON DELETE das FKs: `lead_tags.lead_id → leads.id`, `leads.origin_id → lead_origins.id`, `leads.loss_reason_id → loss_reasons.id`.
- Se `lead_tags → leads` é CASCADE, hard delete de lead limpa `lead_tags` automaticamente. Se RESTRICT, código precisa deletar `lead_tags` antes do lead.
- Se `leads → lead_origins` / `leads → loss_reasons` é SET NULL, OK. Se RESTRICT, precisa limpar `origin_id`/`loss_reason_id` antes de deletar origin/reason.

---

## 3. API Contract

### Server Actions — `src/lib/actions/leads.ts`

Seguindo padrão exato de `src/lib/actions/tags.ts`: `ActionResponse<T>`, Zod validation, `getSessionContext()`, `assertRole()`, `revalidatePath()`, try/catch com log + mensagem amigável.

#### Schemas Zod

```typescript
const LEAD_STATUS_VALUES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;

const CreateLeadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().trim().min(8).max(20).optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  position: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  status: z.enum(LEAD_STATUS_VALUES).optional().default('new'),
  score: z.number().int().min(0).max(100).optional().default(0),
  value: z.number().min(0).optional().default(0),
  medium: z.string().trim().max(100).optional().or(z.literal('')),
  campaign: z.string().trim().max(100).optional().or(z.literal('')),
  utm_source: z.string().trim().max(200).optional().or(z.literal('')),
  utm_medium: z.string().trim().max(200).optional().or(z.literal('')),
  utm_campaign: z.string().trim().max(200).optional().or(z.literal('')),
  utm_content: z.string().trim().max(200).optional().or(z.literal('')),
  utm_term: z.string().trim().max(200).optional().or(z.literal('')),
  origin_id: z.string().uuid().optional().or(z.literal('')),
  assigned_to: z.string().uuid().optional().or(z.literal('')),
  tagIds: z.array(z.string().uuid()).optional().default([]),
});

const UpdateLeadSchema = CreateLeadSchema.partial().required({ name: true });

const MarkAsLostSchema = z.object({
  lossReasonId: z.string().uuid('Motivo de perda obrigatório'),
  lossNotes: z.string().trim().max(500).optional().or(z.literal('')),
});

const UpdateStatusSchema = z.object({
  status: z.enum(LEAD_STATUS_VALUES),
});

const AssignLeadSchema = z.object({
  assignedTo: z.string().uuid('Responsável inválido'),
});

const ListLeadsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUS_VALUES).optional(),
  originId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sortBy: z.string().optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});
```

#### getLeadsAction(input)
**Output:** `ActionResponse<LeadRow[]>` com `metadata: PaginationMeta`
**Business Logic:**
1. Validate input com `ListLeadsSchema`
2. `getSessionContext()` → `organizationId`
3. Query `leads` com `select()` incluindo campos necessários + `count: 'exact'`
4. `.eq('organization_id', ctx.organizationId)`
5. Filtros condicionais: `status`, `origin_id`, `assigned_to`
6. Busca ILIKE em `name`, `email`, `phone`, `company` (OR entre campos)
7. Filtro por tag via subquery: `id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ?)`
8. `.order(sortBy, { ascending: sortOrder === 'asc' })`
9. `.range(from, to)`
10. Após obter leads, carregar em batch: `lead_origins.name` (via `origin_id`), `profiles.full_name` (via `assigned_to`), tags (via `lead_tags` JOIN `tags`)
11. Retornar `LeadRow[]` com joins resolvidos + `PaginationMeta`

**Nota sobre joins:** Supabase client permite `.select('*, lead_origins(name), profiles!assigned_to(full_name)')` ou queries separadas. Escolher a abordagem que não quebra o `.range()` — se o join embedded interfere na paginação, usar queries em batch.

#### getLeadByIdAction(id)
**Output:** `ActionResponse<LeadDetail>`
**Logic:** Retorna lead com todos os campos + tags associadas (via `lead_tags` + `tags`) + `origin_name` + `assigned_to_name`. 404 se não encontrado (RLS filtra cross-org).

#### createLeadAction(input)
**Output:** `ActionResponse<LeadRow>`
**Logic:**
1. Validate com `CreateLeadSchema`
2. `getSessionContext()` → seta `organization_id`, `created_by`
3. INSERT em `leads`
4. Se `tagIds.length > 0`, INSERT em `lead_tags` para cada tag
5. `revalidatePath('/leads')`

#### updateLeadAction(id, input)
**Output:** `ActionResponse<LeadRow>`
**Logic:**
1. Validate ID + `UpdateLeadSchema`
2. `getSessionContext()` + verificar que lead pertence à org
3. UPDATE em `leads` com `updated_at = now()`
4. Se `tagIds` fornecido: sync tags → DELETE existing de `lead_tags` WHERE `lead_id` + INSERT novas
5. `revalidatePath('/leads')` + `revalidatePath('/leads/[id]')`

#### deleteLeadAction(id)
**Output:** `ActionResponse<{ ok: true }>`
**Logic:**
1. `assertRole(ctx, ['owner', 'admin'])`
2. DELETE de `leads` (se FK CASCADE em `lead_tags`, limpeza automática; senão, deletar `lead_tags` antes)
3. `revalidatePath('/leads')`

#### markLeadAsLostAction(id, input)
**Output:** `ActionResponse<LeadRow>`
**Logic:**
1. Validate `MarkAsLostSchema` — `lossReasonId` obrigatório
2. Verificar que `loss_reason` pertence à mesma org
3. UPDATE `status = 'lost'`, `loss_reason_id`, `loss_notes`
4. `revalidatePath('/leads')` + `revalidatePath('/leads/[id]')`

#### updateLeadStatusAction(id, input)
**Output:** `ActionResponse<LeadRow>`
**Logic:**
1. Validate `UpdateStatusSchema`
2. Se `status !== 'lost'`: limpar `loss_reason_id = null`, `loss_notes = null`
3. UPDATE `status`
4. `revalidatePath('/leads')` + `revalidatePath('/leads/[id]')`

#### assignLeadAction(id, input)
**Output:** `ActionResponse<LeadRow>`
**Logic:**
1. Validate `AssignLeadSchema`
2. Verificar que o profile `assignedTo` pertence à mesma org e `is_active = true`
3. UPDATE `assigned_to`
4. `revalidatePath('/leads')` + `revalidatePath('/leads/[id]')`

#### syncLeadTagsAction(leadId, tagIds[])
**Output:** `ActionResponse<{ ok: true }>`
**Logic:**
1. DELETE FROM `lead_tags` WHERE `lead_id`
2. INSERT novas entradas
3. `revalidatePath('/leads')` + `revalidatePath('/leads/[leadId]')`

#### Actions auxiliares de lookup (se necessário)
- `getActiveOriginsAction()` → lista `lead_origins` ativas da org (para selects)
- `getActiveLossReasonsAction()` → lista `loss_reasons` ativas da org
- `getActiveProfilesAction()` → lista `profiles` ativos da org
- `getActiveTagsAction()` → lista `tags` ativas da org

**Nota:** Se essas actions já existem em outros módulos (`lead-origins.ts`, `loss-reasons.ts`, `tags.ts`), reutilizar. Se não, criar versões simples dentro de `leads.ts` ou como imports.

---

## 4. External API Integration

Não aplicável — nenhuma API externa neste sprint.

---

## 5. Componentes de UI

Todos os componentes seguem o contrato do design system em `design_system/components/CONTRACT.md`: wrappers finos sobre Radix Primitives, estilizados com tokens semânticos, variantes via `cva`, ícones Lucide.

### Component Tree

```
Page: /leads (Server Component)
├── Breadcrumb (Home > Leads > Todos os Leads)
├── Header (título + descrição + CTA "Novo Lead")
├── LeadsToolbar
│   ├── Input (busca debounced 300ms)
│   └── LeadFilters
│       ├── Select (status)
│       ├── Select (origem)
│       ├── Select (responsável)
│       └── Select (tag)
├── Table container (border-border, bg-surface-raised)
│   ├── LeadsSortableHeader
│   └── LeadsList
│       ├── LeadStatusBadge (por linha)
│       ├── TagBadge[] (por linha — reutilizado da Sprint 09)
│       └── LeadRowActions (menu por linha)
│           ├── "Editar" → /leads/[id]
│           ├── "Atribuir" → AssignLeadDialog
│           ├── "Marcar como perdido" → MarkAsLostDialog
│           └── "Excluir" → DeleteConfirmationDialog
└── Pagination

Page: /leads/new (Server Component)
├── Breadcrumb (Home > Leads > Novo Lead)
├── Header (título + Cancelar + Criar lead)
└── LeadForm (mode="create")
    ├── Tab "Dados Básicos": name, email, phone, company, position, origin_id, assigned_to
    ├── Tab "UTM": utm_source, utm_medium, utm_campaign, utm_content, utm_term, medium, campaign
    ├── Tab "Comercial": status, score, value, tags (LeadTagsSelect)
    └── Tab "Notas": notes

Page: /leads/[id] (Server Component)
├── Breadcrumb (Home > Leads > [Nome do Lead])
├── Header (nome + status badge + metadata)
├── LeadForm (mode="edit", lead={data})
│   └── (mesmas tabs do create, preenchidas)
└── DangerZone
    └── "Excluir Lead" → DeleteConfirmationDialog
```

### LeadsList
**File:** `src/components/leads/LeadsList.tsx`
**Colunas:** Nome · Email · Telefone · Origem · Status (LeadStatusBadge) · Score · Valor (BRL) · Responsável · Tags (TagBadge[]) · Criado em · Ações.
**Empty state:** "Nenhum lead cadastrado — crie o primeiro" (com CTA).
**No results:** "Nenhum lead encontrado para os filtros aplicados" (com "Limpar filtros").
**Skeleton loading** durante transições.

### LeadsToolbar
**File:** `src/components/leads/LeadsToolbar.tsx`
**Comportamento:** Busca debounced 300ms (atualiza query param `search`). Filtros como dropdowns que atualizam query params. CTA "Novo Lead" → `/leads/new`.

### LeadFilters
**File:** `src/components/leads/LeadFilters.tsx`
**Filtros:** status (single select), origem (select, carrega `lead_origins` ativas), responsável (select, carrega `profiles` ativos), tag (select, carrega `tags` ativas).
**Cada filtro atualiza query params e reseta `page=1`.**

### LeadsSortableHeader
**File:** `src/components/leads/LeadsSortableHeader.tsx`
**Headers clicáveis:** nome, email, status, score, value, created_at.
**Direção:** asc/desc via query param `sortBy` + `sortOrder`.

### LeadRowActions
**File:** `src/components/leads/LeadRowActions.tsx`
**Menu de ações:** Editar, Atribuir responsável, Marcar como perdido, Excluir.

### LeadStatusBadge
**File:** `src/components/leads/LeadStatusBadge.tsx`
**Variantes (tokens semânticos via `cva`):**
- `new` → info tokens (`bg-feedback-info-bg`, `text-feedback-info-fg`, `border-feedback-info-border`)
- `contacted` → warning tokens
- `qualified` → action tokens (`bg-action-primary`, `text-action-primary-fg`)
- `proposal` → accent tokens
- `negotiation` → warning tokens
- `won` → success tokens (`bg-feedback-success-bg`, `text-feedback-success-fg`)
- `lost` → danger tokens (`bg-feedback-danger-bg`, `text-feedback-danger-fg`)

### LeadForm
**File:** `src/components/leads/LeadForm.tsx`
**Props:** `mode: 'create' | 'edit'`, `lead?: LeadDetail`, `origins: Origin[]`, `profiles: Profile[]`, `tags: Tag[]`, `lossReasons: LossReason[]`.
**Tabs:** Dados Básicos / UTM / Comercial / Notas.
**Validação client-side** antes do submit. Erros inline nos campos.
**`useTransition`** para feedback visual no submit.

### LeadTagsSelect
**File:** `src/components/leads/LeadTagsSelect.tsx`
**Multi-select** com preview visual (TagBadge por tag selecionada). Carrega tags ativas da org.

### MarkAsLostDialog
**File:** `src/components/leads/MarkAsLostDialog.tsx`
**Campos:** loss_reason_id (Select obrigatório), loss_notes (Textarea opcional).
**Botão confirmar desabilitado** até selecionar motivo.

### AssignLeadDialog
**File:** `src/components/leads/AssignLeadDialog.tsx`
**Select** com profiles ativos da org (`is_active = true`).

### DeleteConfirmationDialog
Reutilizar padrão existente (crud.md regra #5). Digitação literal de "excluir" para confirmar.

---

## 6. Edge Cases (CRITICAL)

### Empty States
- [ ] Org sem leads → empty state com CTA "Cadastrar primeiro lead"
- [ ] Busca sem resultados → "Nenhum lead encontrado" com botão "Limpar filtros"

### Validation
- [ ] Lead com dados mínimos (apenas nome) → form permite salvar, colunas opcionais vazias na lista
- [ ] Lead com todos os 27 campos → tabs distribuem, tudo salva
- [ ] Email formato inválido → erro inline
- [ ] Phone fora do range 8-20 chars → erro inline
- [ ] Notes > 2000 chars → erro inline

### RLS / Segurança
- [ ] User da org A tenta `/leads/[id-da-org-B]` → 404 (RLS filtra)
- [ ] Member tenta excluir → `assertRole` bloqueia

### Status Machine
- [ ] Marcar como perdido sem motivo → botão confirmar desabilitado até selecionar `loss_reason_id`
- [ ] Mudar status de "lost" para outro → limpa `loss_reason_id` e `loss_notes` automaticamente
- [ ] Tentar definir `status = 'lost'` via `updateLeadStatusAction` sem motivo → rejeitar (forçar uso de `markLeadAsLostAction`)

### Tags M2M
- [ ] Tag desativada não aparece no select, mas tags já vinculadas continuam visíveis na lista (histórico)
- [ ] Sync de tags no update: remove todas, insere novas (idempotente)

### Atribuição
- [ ] Select de responsável só mostra profiles `is_active = true` da mesma org
- [ ] `assignedTo` de profile inativo/outra org → rejeitar com erro

### Delete
- [ ] Excluir lead com tags vinculadas → `lead_tags` limpo (CASCADE ou manual)
- [ ] Confirmação obrigatória (digitar "excluir")

### Filtros
- [ ] Filtros compostos simultâneos (status + origem + responsável + tag + busca)
- [ ] Ao aplicar filtro, resetar para `page=1`
- [ ] Email duplicado na mesma org → permitido (sem unique constraint)

### Concorrência
- [ ] Dois tabs editando mesmo lead → last-write-wins (sem lock otimista)
- [ ] Delete enquanto outro edita → "Lead não encontrado"

### Formatação
- [ ] Valor monetário formatado como BRL (R$ 1.234,56) na lista
- [ ] Input aceita números com decimais

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] @db-admin confirma comportamento ON DELETE das FKs
- [ ] Nenhuma migration necessária (schema já existe)

### Backend
- [ ] 8 Server Actions (get, getById, create, update, delete, markAsLost, updateStatus, assign) + syncTags
- [ ] Todas validam input com Zod
- [ ] Todas fazem `getSessionContext()` + check de auth
- [ ] `deleteLeadAction` exige `assertRole(['owner', 'admin'])`
- [ ] Todas retornam `ActionResponse<T>`
- [ ] Erros logados + mensagem amigável
- [ ] `revalidatePath` após cada mutação
- [ ] Filtro por tag usa subquery em `lead_tags`
- [ ] Busca ILIKE funciona em name/email/phone/company

### Frontend
- [ ] O código passa em todas as checagens do Guardian (§1a + §1b). Fonte normativa: `design_system/enforcement/rules.md` e `design_system/components/CONTRACT.md`.
- [ ] Componente verificado com `data-theme="dark"` togglado.
- [ ] Placeholder de `/leads` substituído pela listagem real.
- [ ] Form com tabs (Dados Básicos / UTM / Comercial / Notas).
- [ ] Busca debounced 300ms + filtros compostos via query params.
- [ ] Paginação server-side com `.range()`.
- [ ] TagBadge reutilizado da Sprint 09.
- [ ] LeadStatusBadge colorido por status (tokens semânticos, `cva`).
- [ ] MarkAsLostDialog com motivo obrigatório.
- [ ] AssignLeadDialog com profiles ativos.
- [ ] Danger Zone na edição com DeleteConfirmationDialog.
- [ ] Toast em toda operação com side-effect.
- [ ] Estado de loading e erro em formulários.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.

---

## 8. Implementation Plan

### Phase 1: Database — @db-admin
1. Verificar FKs ON DELETE behavior (CASCADE vs RESTRICT vs SET NULL) para `lead_tags → leads`, `leads → lead_origins`, `leads → loss_reasons`
2. Reportar resultado — nenhuma migration esperada

### Phase 2: Backend — @backend
1. Criar `src/lib/actions/leads.ts`
2. Definir schemas Zod (Create, Update, List, MarkAsLost, UpdateStatus, Assign)
3. Implementar 8 actions + syncLeadTags
4. Implementar lookup helpers se necessário (origens, loss_reasons, profiles, tags ativos)
5. GATE 2: build + lint

### Phase 3: Frontend — @frontend+
1. Substituir placeholder `src/app/(app)/leads/page.tsx` por listagem real (Server Component)
2. Criar `src/app/(app)/leads/new/page.tsx`
3. Criar `src/app/(app)/leads/[id]/page.tsx`
4. Criar componentes em `src/components/leads/`:
   - LeadsList, LeadsToolbar, LeadFilters, LeadsSortableHeader, LeadRowActions
   - LeadStatusBadge, LeadForm, LeadTagsSelect
   - MarkAsLostDialog, AssignLeadDialog
5. GATE 2: build + lint
6. GATE 5: design verification

### Phase 4: Review — @guardian
1. Validate design system compliance
2. Validate TypeScript quality
3. Validate security (RLS, auth checks, input validation)
4. Approve or reject

---

## 9. Risks & Mitigations

### Risk 1: Paginação quebra com joins embedded do Supabase
**Impact:** Medium
**Probability:** Medium
**Mitigation:** Se `.select('*, lead_origins(name)')` interfere no `.range()`, fazer queries em batch separadas para origin_name, assigned_to_name e tags.

### Risk 2: Filtro por tag via subquery pode ser lento
**Impact:** Low
**Probability:** Low
**Mitigation:** Índice `idx_lead_tags_tag` já existe em `tag_id`. Performance aceitável para volume MVP.

### Risk 3: Sync de tags (delete all + insert) pode ter race condition
**Impact:** Low
**Probability:** Low
**Mitigation:** Last-write-wins aceitável para MVP. Transação única no Supabase client minimiza janela.

### Risk 4: FK ON DELETE behavior desconhecido
**Impact:** High
**Probability:** Medium
**Mitigation:** @db-admin verifica antes da implementação. Se RESTRICT em `lead_tags → leads`, código deve deletar `lead_tags` antes do lead.

---

## 10. Dependencies

### Internal (já existem)
- [x] Tabela `leads` com 27 colunas — Sprint 07
- [x] Tabela `lead_tags` (M2M) — Sprint 07
- [x] RLS em `leads` e `lead_tags` — Sprint 07
- [x] Módulo `lead_origins` (CRUD) — Sprint 07
- [x] Módulo `loss_reasons` (CRUD) — Sprint 08
- [x] Módulo `tags` (CRUD + TagBadge) — Sprint 09
- [x] `getSessionContext()`, `assertRole()` — compartilhados
- [x] Componentes UI: Button, Input, Table, Dialog, Badge, Select, Tabs — `src/components/ui/`
- [x] Layout `/leads/layout.tsx` — já existe (precisa confirmar se envelopa DashboardShell)

### External
Nenhuma.

---

## 11. Rollback Plan

1. **Imediato:** `git revert [commit-hash]` — reverte código (nenhuma migration neste sprint)
2. **Sem rollback de banco** — nenhuma migration criada
3. **Cache:** revalidação automática via `revalidatePath`

---

## Reference Module Compliance

### Módulo de referência: Tags (`src/app/(app)/leads/tags/` + `src/lib/actions/tags.ts`)

### O que copiar (estrutura e padrão):
- **Actions:** `ActionResponse<T>`, Zod validation first, `getSessionContext()`, `assertRole()`, try/catch com log + mensagem amigável, `revalidatePath()`, `.select(COLUMNS)` com colunas explícitas
- **Pages:** Server Components com `await props.searchParams`, breadcrumb com tokens semânticos, header com título + CTA
- **Components:** List com tabela, Toolbar com busca, Form com validação client-side, RowActions com dropdown menu

### O que adaptar (domínio leads):
- 27 campos no schema (vs 7 de tags) → form com tabs
- Filtros compostos (status, origem, responsável, tag) — tags só tinha isActive + search
- Joins com `lead_origins`, `profiles`, `tags` via `lead_tags` — tags não tinha joins
- Status machine (7 estados) com regra de perda obrigatória
- Multi-select de tags (LeadTagsSelect) — componente novo
- Dialogs específicos: MarkAsLostDialog, AssignLeadDialog
- Paginação com filtros compostos e busca multi-campo

---

## Approval

**Created by:** @spec-writer
**Reviewed by:** [Sanity Checker]
**Approved by:** [User]
**Date:** 2026-04-20
