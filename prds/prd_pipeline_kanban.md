# PRD: Pipeline — Kanban com Drag-and-Drop

**Template:** PRD_COMPLETE
**Complexity Score:** 11 points
**Sprint:** sprint_13_pipeline_kanban
**Created:** 2026-04-21
**Status:** Draft (aguarda sanity-checker + aprovação do usuário)

> **Resolução de ambiguidade (TPM):** o sprint file menciona `leads.status = 'converted'` em linha 94. O enum `LEAD_STATUS_VALUES` em `src/lib/actions/leads.ts` contém `['new','contacted','qualified','proposal','negotiation','won','lost']` — **não existe `'converted'`**. Este PRD lock in `status='won'` (valor real do enum). Se o usuário quiser outro comportamento, flaggar no sanity-checker.
>
> **Nota sobre schema_snapshot:** o snapshot (2026-04-20) **não reflete** `funnel_stages.stage_role` (adicionado em Sprint 12-1, já presente em `src/lib/actions/funnels.ts` como `StageRole = 'entry' | 'won' | 'lost'`). `@db-admin` deve re-rodar introspecção no kickoff e atualizar o snapshot antes de escrever migration.

---

## 1. Overview

### Business Goal
Substituir a visualização tabular de leads (Sprint 10) por um board Kanban operacional onde colunas = estágios do funil e cards = leads. Drag-and-drop move leads entre estágios sem abrir o formulário de edição, com regra de captura obrigatória de motivo na transição para "perdido".

### User Story
- Como **user**, quero arrastar leads entre colunas de um funil para atualizar `stage_id`/`card_order` sem sair do board.
- Como **user**, ao mover para estágio `lost`, quero que o sistema exija motivo de perda antes de confirmar.
- Como **user**, ao mover para estágio `won`, quero que o lead seja automaticamente marcado como `status='won'`.
- Como **user de outra org**, **não** devo ver nem mover leads de outra organização (RLS).

### Success Metrics
- ≥ 1 funil acessível em `/pipeline` sem erro de runtime.
- 5 drags consecutivos (3 entre colunas, 2 dentro da mesma coluna) persistem após reload.
- Drop em coluna `lost` sem `loss_reason_id` bloqueia a mutação (cliente **e** servidor).
- Build + lint + Guardian + `verify-design.mjs` passam sem violações.

---

## 2. Database Requirements

### New Tables
Nenhuma.

### Modified Tables
Nenhuma modificação de schema de tabela.

### Novo Índice (idempotente)
```sql
CREATE INDEX IF NOT EXISTS idx_leads_stage_order
  ON leads (organization_id, stage_id, card_order);
```
**Por quê:** ordenação por coluna sob filtro de organização (`getPipelineDataAction` consulta `organization_id + stage_id IN (...) ORDER BY card_order`). `idx_leads_card_order` existente (`stage_id, card_order`) não cobre o filtro por org.

### Nova RPC: `move_lead_atomic`
Arquivo: `supabase/migrations/[ts]_move_lead_atomic_rpc.sql` (idempotente — `CREATE OR REPLACE FUNCTION`).

```sql
CREATE OR REPLACE FUNCTION public.move_lead_atomic(
  p_lead_id uuid,
  p_to_stage_id uuid,
  p_to_index integer,
  p_loss_reason_id uuid DEFAULT NULL,
  p_loss_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from_stage_id uuid;
  v_old_order integer;
  v_to_stage_role text;
  v_lead_org uuid;
  v_stage_funnel uuid;
  v_funnel_org uuid;
BEGIN
  -- 1. Load lead (RLS applies). If RLS hides it, FOUND is false → we raise.
  SELECT stage_id, card_order, organization_id
    INTO v_from_stage_id, v_old_order, v_lead_org
    FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  -- 2. Load target stage and verify its funnel belongs to the same org.
  SELECT fs.funnel_id, fs.stage_role, f.organization_id
    INTO v_stage_funnel, v_to_stage_role, v_funnel_org
    FROM funnel_stages fs JOIN funnels f ON f.id = fs.funnel_id
    WHERE fs.id = p_to_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAGE_NOT_FOUND'; END IF;
  IF v_funnel_org <> v_lead_org THEN RAISE EXCEPTION 'CROSS_ORG_BLOCKED'; END IF;

  -- 3. Role-specific validation.
  IF v_to_stage_role = 'lost' AND p_loss_reason_id IS NULL THEN
    RAISE EXCEPTION 'LOSS_REASON_REQUIRED';
  END IF;

  -- 4. Shift logic.
  IF v_from_stage_id IS DISTINCT FROM p_to_stage_id THEN
    -- cross-column
    IF v_from_stage_id IS NOT NULL THEN
      UPDATE leads SET card_order = card_order - 1
        WHERE stage_id = v_from_stage_id AND card_order > v_old_order;
    END IF;
    UPDATE leads SET card_order = card_order + 1
      WHERE stage_id = p_to_stage_id AND card_order >= p_to_index;
  ELSE
    -- same-column reorder
    IF v_old_order = p_to_index THEN
      RETURN jsonb_build_object('leadId', p_lead_id, 'newStageId', p_to_stage_id, 'newOrder', p_to_index);
    ELSIF v_old_order < p_to_index THEN
      UPDATE leads SET card_order = card_order - 1
        WHERE stage_id = p_to_stage_id AND card_order > v_old_order AND card_order <= p_to_index;
    ELSE
      UPDATE leads SET card_order = card_order + 1
        WHERE stage_id = p_to_stage_id AND card_order >= p_to_index AND card_order < v_old_order;
    END IF;
  END IF;

  -- 5. Update the moved lead (+ auto-status for won/lost).
  UPDATE leads SET
    stage_id = p_to_stage_id,
    card_order = p_to_index,
    status = CASE
      WHEN v_to_stage_role = 'won' THEN 'won'
      WHEN v_to_stage_role = 'lost' THEN 'lost'
      ELSE status
    END,
    loss_reason_id = CASE WHEN v_to_stage_role = 'lost' THEN p_loss_reason_id ELSE loss_reason_id END,
    loss_notes = CASE WHEN v_to_stage_role = 'lost' THEN p_loss_notes ELSE loss_notes END,
    updated_at = now()
  WHERE id = p_lead_id;

  RETURN jsonb_build_object('leadId', p_lead_id, 'newStageId', p_to_stage_id, 'newOrder', p_to_index);
END;
$$;
```

**Por quê `SECURITY INVOKER`:** preserva RLS do chamador (auth). `SECURITY DEFINER` daria acesso cross-org e exigiria validação manual — contra regra §10 de standards (RLS isola dados, não o código).

### Existing Tables Used
- `leads` — campos `stage_id`, `card_order`, `status`, `loss_reason_id`, `loss_notes`, `organization_id`.
- `funnel_stages` — `id`, `funnel_id`, `name`, `order_index`, `stage_role`.
- `funnels` — `id`, `organization_id`, `name`, `is_active`.
- `loss_reasons` — `id`, `name`, `is_active`, `organization_id`.
- `profiles` — `id`, `full_name`, `avatar_url`.
- `tags` + `lead_tags` — carregamento lateral dos chips.

### RLS
Mantém RLS já vigente (sprint 0X). Não há mudança de política.

---

## 3. API Contract

### Server Actions (estender `src/lib/actions/leads.ts`)

#### `getPipelineDataAction`
```typescript
const GetPipelineInputSchema = z.object({
  funnelId: z.string().uuid(),
  pageByStage: z.record(z.string().uuid(), z.number().int().min(1)).optional().default({}),
});

export interface PipelineLead {
  id: string;
  name: string;
  value: number;
  status: LeadStatus;
  card_order: number;
  tags: LeadTag[];
  assignedTo: { id: string; full_name: string; avatar_url: string | null } | null;
}

export interface PipelineStage {
  id: string;
  name: string;
  order_index: number;
  stage_role: StageRole | null;
  leadsTotal: number;
  leads: PipelineLead[];
}

export interface PipelineData {
  funnel: { id: string; name: string };
  stages: PipelineStage[];
}

export async function getPipelineDataAction(
  input: GetPipelineInput
): Promise<ActionResponse<PipelineData>>
```

**Lógica:**
1. Zod parse.
2. `getSessionContext()` → `ctx`.
3. Busca funnel; se não for da org, retorna erro amigável.
4. Busca stages (ordenadas por `order_index ASC`).
5. Para cada stage: count (`leadsTotal`) + leads paginados (default 50, página = `pageByStage[stageId] ?? 1`), ordenados por `card_order ASC, created_at DESC`. Filtro: `organization_id = ctx.organizationId`, `stage_id = stage.id`.
6. Hidrata `tags`, `assignedTo` (reusa helpers `loadLeadTags`, `loadProfileNames`).
7. **Leads com `stage_id IS NULL` não entram.**
8. Não chama `revalidatePath` (leitura).

#### `moveLeadAction`
```typescript
const MoveLeadInputSchema = z.object({
  leadId: z.string().uuid(),
  toStageId: z.string().uuid(),
  toIndex: z.number().int().min(0),
  lossReasonId: z.string().uuid().nullable().optional(),
  lossNotes: z.string().max(500).nullable().optional(),
});

export async function moveLeadAction(
  input: MoveLeadInput
): Promise<ActionResponse<{ leadId: string; newStageId: string; newOrder: number }>>
```

**Lógica:**
1. Zod parse. Se falhar: `{ success: false, error: parsed.error.issues[0].message }`.
2. `getSessionContext()`.
3. Se `lossReasonId` vier preenchido, validar que pertence à mesma org (pré-check, além do check dentro da RPC).
4. Chamar `supabase.rpc('move_lead_atomic', { p_lead_id, p_to_stage_id, p_to_index, p_loss_reason_id, p_loss_notes })`.
5. Mapear exceções da RPC para mensagens amigáveis:
   - `LEAD_NOT_FOUND` → "Lead não encontrado."
   - `STAGE_NOT_FOUND` → "Estágio não encontrado."
   - `CROSS_ORG_BLOCKED` → "Lead não encontrado." (não vazar info cross-org)
   - `LOSS_REASON_REQUIRED` → mesmo code string no `error` field (client detecta e reabre modal, se caso).
6. `revalidatePath('/pipeline')`.
7. Retornar `{ success: true, data: { leadId, newStageId, newOrder } }`.

#### Reusos
- **`getActiveLossReasonsAction`** (já existe em `src/lib/actions/leads.ts`) — usar para popular o Select do modal de perda. **Não criar nova action.**
- **`getFunnelsAction`** — já existe em `src/lib/actions/funnels.ts`, usar no page Server Component para popular o Select de funis. Filtrar `is_active=true` no caller.

---

## 4. External API Integration
**N/A** — Nenhuma.

---

## 5. Componentes de UI

Todos seguem o contrato em `design_system/components/CONTRACT.md` (tokens semânticos, Radix primitives, variantes `cva`, Lucide).

### Component Tree

```
Page: /pipeline (Server Component)
├── PipelineHeader (inline no page) — title + FunnelSelect
└── KanbanBoard (client)
    ├── DndContext (@dnd-kit/core)
    ├── KanbanColumn × N
    │   ├── ColumnHeader (name + role badge + count)
    │   ├── SortableContext
    │   │   └── KanbanCard × N  (useSortable)
    │   └── LoadMoreButton ("Ver mais")
    ├── DragOverlay (KanbanCardPreview)
    └── LossReasonModal (Dialog, abre em drop de role=lost)
```

### `src/app/(app)/pipeline/layout.tsx`
- Server Component. Wrap em `<DashboardShell>`. Breadcrumb: `Pipeline`.

### `src/app/(app)/pipeline/page.tsx`
- Server Component. Lê `?funnel=[id]`.
- Resolução do funil: `?funnel` → `is_default=true` (se existir coluna; hoje não existe — usar primeiro ativo por `created_at`) → `null` (empty state).
- Chama `getFunnelsAction({ isActive: true, pageSize: 100 })` + `getPipelineDataAction({ funnelId })`.
- Empty states (Server-rendered):
  - Nenhum funil → "Cadastre um funil em /funnels" (com `Link`).
  - Funil sem stages → "Este funil não tem estágios. Configure em /funnels/[id]".
- Passa `initialData`, `funnels`, `selectedFunnelId`, `lossReasons` para `<KanbanBoard>`.

### `src/components/pipeline/FunnelSelect.tsx` (client)
- Radix Select wrapper via `src/components/ui/select.tsx`.
- Opções: lista de funis ativos.
- `onValueChange` → `router.push('/pipeline?funnel=[id]')` (URL é fonte de verdade, regra do `crud.md`).
- Loading: skeleton do próprio componente; disabled durante transição.

### `src/components/pipeline/KanbanBoard.tsx` (client)
**Props:**
```typescript
interface KanbanBoardProps {
  initialData: PipelineData;
  funnelId: string;
  lossReasons: LossReasonOption[];
}
```

**Estado:**
- `stages: PipelineStage[]` (otimista, seeded do server).
- `activeLead: PipelineLead | null` (em drag).
- `pendingLoss: { leadId, toStageId, toIndex, originSnapshot } | null` (drop em `lost`).
- `pageByStage: Record<string, number>` (para "Ver mais").

**Comportamento:**
- `DndContext` com sensors `PointerSensor` (activation `distance: 8`) + `KeyboardSensor` (acessibilidade).
- `collisionDetection={closestCorners}`.
- `onDragStart(event)`: set `activeLead`.
- `onDragOver(event)`: só muda estado se cruzar coluna (evita thrashing intra-coluna).
- `onDragEnd(event)`:
  - Se drop na mesma posição: noop.
  - Se destino tem `stage_role === 'lost'`: abrir modal, **não** chamar action.
  - Caso contrário: update otimista + `moveLeadAction(...)`. Em erro: restaurar `stages` do snapshot pré-drag + toast de erro.
- `onDragCancel`: limpar `activeLead`.
- `DragOverlay`: renderiza preview do card (cópia visual, sem `useSortable`).
- "Ver mais": incrementa `pageByStage[stageId]` e refetcha via chamada a `getPipelineDataAction` (client-side wrapper ou via `router.refresh()` + URL state — PRD deixa aberto; **decisão:** client-side wrapper para não piscar toda a tela).

**Overflow horizontal:** `overflow-x-auto` + colunas `flex-shrink-0`. Scrollbar custom via `.kanban-scroll` (copiar das telas_prontas adaptado a tokens DS).

### `src/components/pipeline/KanbanColumn.tsx` (client)
- Header:
  - `h2` com `text-text-primary font-bold text-sm uppercase tracking-wide`.
  - Badge de role via `<Badge>`: `entry` → `variant="info"` + `LogIn`; `won` → `variant="success"` + `Trophy`; `lost` → `variant="danger"` + `XCircle`; neutro → sem badge.
  - Contador `leadsTotal` (`<Badge variant="secondary">`).
- Body: `<SortableContext items={leadIds} strategy={verticalListSortingStrategy}>` + `.map(KanbanCard)`.
- Footer (condicional `leads.length < leadsTotal`): `<Button variant="ghost" size="sm">Ver mais (N restantes)</Button>`.
- Empty state: texto `text-text-muted` "Nenhum lead neste estágio."
- Largura fixa: `w-[320px] 2xl:w-[340px]` + `flex-shrink-0`.
- Background: neutra `bg-surface-sunken/50`; **se role=won** `bg-feedback-success-bg/30 border border-feedback-success-border/30`; **se role=lost** `bg-feedback-danger-bg/30 border border-feedback-danger-border/30`.

### `src/components/pipeline/KanbanCard.tsx` (client)
- `useSortable({ id: lead.id })`.
- Layout (copiado das telas_prontas, mas com tokens):
  - Header: badge de status + timestamp relativo (via `Intl.RelativeTimeFormat` ou helper existente — manter simples; se não houver helper, badge de timestamp é opcional nesta sprint).
  - Nome (`h3 text-text-primary font-bold text-sm`).
  - Value BRL (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).
  - Tags (máx 2 chips via `<Badge>` + "+N").
  - Avatar assigned_to: `<Avatar>` (iniciais se `avatar_url` null).
- `cursor-grab`/`active:cursor-grabbing`.
- `opacity-50` + `rotate-2` durante drag (via CSS `.is-dragging` aplicada por `isDragging` do `useSortable`).
- **Sem clique / sem edição.** Nenhum handler em `onClick`.

### `src/components/pipeline/LossReasonModal.tsx` (client)
- Wrap em `<Dialog>` (reutilizar `src/components/ui/dialog.tsx`).
- Open controlado por prop `open: boolean` (vinculado a `pendingLoss !== null`).
- Form com `react-hook-form` + `zodResolver(LossModalSchema)`:
  ```typescript
  const LossModalSchema = z.object({
    lossReasonId: z.string().uuid('Motivo obrigatório'),
    lossNotes: z.string().max(500).optional().or(z.literal('').transform(() => undefined)),
  });
  ```
- Campos:
  - `Select` (Radix) com opções = `lossReasons`. Placeholder "Selecione o motivo da perda".
  - `Textarea` para `lossNotes`, com contador `N/500`.
- Botões:
  - `<Button variant="secondary">Cancelar</Button>` — chama `onCancel()` (board restaura estado pré-drag).
  - `<Button variant="danger" type="submit">Confirmar perda</Button>` — chama `onConfirm({ lossReasonId, lossNotes })`.
- Loading state no submit: `<Button disabled>` + spinner.
- Em erro: `toast` (reusar hook de toast existente).

### Navegação — Sidebar
- Adicionar item em `src/components/layout/Sidebar.tsx` (`primaryNav`), logo abaixo de "Funis":
  - `label: 'Pipeline'`, `href: '/pipeline'`, `icon: LayoutGrid` (Lucide).

### Semantic tokens — quick reference
- Surface: `bg-surface-base` (board bg), `bg-surface-sunken/50` (coluna), `bg-surface-raised` (card).
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`.
- Border: `border-border`, `border-border-subtle`.
- Action: `bg-action-primary`, `bg-action-primary-hover`, `text-action-primary-fg`, `bg-action-danger` (submit perda), `text-action-danger-fg`.
- Feedback: `bg-feedback-success-bg`, `text-feedback-success-fg`, `bg-feedback-info-bg`, `text-feedback-info-fg`, `bg-feedback-danger-bg`, `text-feedback-danger-fg`, `bg-feedback-warning-bg`.
- Focus: `focus-visible:shadow-focus focus-visible:outline-none` em todo elemento interativo.

---

## 6. Edge Cases

### Empty States
- [ ] **Org sem funis ativos:** page renderiza mensagem "Cadastre um funil em [/funnels](link)".
- [ ] **Funil selecionado sem stages:** mensagem "Este funil não tem estágios. Configure em /funnels/[id]".
- [ ] **Stage com 0 leads:** coluna mostra "Nenhum lead neste estágio." (`text-text-muted`).
- [ ] **Lead sem `stage_id`:** não aparece no board (filtrado em `getPipelineDataAction`).

### Validation Errors
- [ ] **Drop em `lost` sem motivo:** modal bloqueia submit (`zodResolver`). Se burlado, server retorna `error: 'LOSS_REASON_REQUIRED'` e client reabre modal com toast.
- [ ] **`lossReasonId` inválido / de outra org:** server retorna "Motivo de perda não encontrado." + rollback otimista.
- [ ] **`lossNotes > 500 chars`:** Zod bloqueia no client; server também valida.

### Network / Server Errors
- [ ] **`moveLeadAction` falha (rede ou server 500):** toast erro + rollback otimista para snapshot pré-drag.
- [ ] **Timeout na RPC:** mesmo tratamento (supabase client lança; catch genérico → "Erro interno, tente novamente").
- [ ] **Refetch do pipeline (Ver mais) falha:** toast erro; `pageByStage` **não** é incrementado.

### Authorization / Cross-org
- [ ] **User sem sessão:** `getSessionContext()` já redireciona para `/login` (comportamento herdado).
- [ ] **`leadId` de outra org:** RPC `SELECT` retorna 0 rows via RLS → exception `LEAD_NOT_FOUND` → "Lead não encontrado." (string genérica, não vaza existência cross-org).
- [ ] **`toStageId` pertence a funil de outra org:** RPC valida `v_funnel_org <> v_lead_org` → `CROSS_ORG_BLOCKED` → mapeado para "Lead não encontrado." no client (não vazar).

### Concurrent Operations
- [ ] **Dois usuários movem o mesmo lead:** last-write-wins. O UPDATE da RPC é atômico; quem chega por último grava o estado final. Documentar em APRENDIZADOS se observado em prod.
- [ ] **Stage deletada entre load e drop:** RPC retorna `STAGE_NOT_FOUND` → toast + rollback.
- [ ] **Lead deletado entre load e drop:** RPC retorna `LEAD_NOT_FOUND` → toast + rollback + remove card do estado otimista.

### Data Limits
- [ ] **Coluna com ≥100 leads:** apenas 50 primeiros renderizados; botão "Ver mais (N restantes)" incrementa `pageByStage[stageId]`. `leadsTotal` mostra o valor real.
- [ ] **Org com >100 funis ativos:** `getFunnelsAction({ pageSize: 100 })` limita; funis além de 100 não aparecem no Select (aceito como MVP; documentado em Risks se virar problema).
- [ ] **Funil com ≥20 stages:** board aceita scroll horizontal (`overflow-x-auto`, colunas `flex-shrink-0 w-[320px]`). Sem limite duro.
- [ ] **`lossNotes` atinge 500 chars:** contador UI mostra `500/500`; tentativa de submeter 501+ bloqueada por Zod (client e server).
- [ ] **`loss_reasons` ativos >50:** Radix Select aplica scroll interno automaticamente; nenhuma mudança de UI necessária.

### Browser / Environment
- [ ] **Drop no mesmo lugar (mesma stage + mesmo index):** RPC early-return (sem shift). Cliente também pode short-circuit, mas RPC é idempotente nesse caso.
- [ ] **Troca de funil durante drag em andamento:** `useEffect` dispara `onDragCancel` ao mudar `funnelId` via URL; board remonta com novo `initialData`.
- [ ] **`card_order` com valores não-sequenciais legados:** shift usa comparação `>`/`>=`/`<=` baseada em valores atuais do banco; não exige normalização.
- [ ] **Coluna destino parcialmente carregada (Ver mais não clicado):** `toIndex` é relativo à página carregada; **mas o shift server-side opera sobre `card_order` absoluto** — server é fonte de verdade; UI mostra o card na posição visual, e `card_order` real fica correto.
- [ ] **Dark mode:** toggle via `<html data-theme="dark">` deve manter todas as cores consistentes (tokens cobrem).
- [ ] **Keyboard sensor (@dnd-kit):** `KeyboardSensor` habilitado; usuário sem mouse pode mover cards via Tab + Space + arrows (acessibilidade básica).

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration `[ts]_move_lead_atomic_rpc.sql` aplicada; `supabase db push --dry-run` passa.
- [ ] Migration é idempotente (`CREATE OR REPLACE FUNCTION` + `CREATE INDEX IF NOT EXISTS`).
- [ ] Índice `idx_leads_stage_order (organization_id, stage_id, card_order)` existe.
- [ ] RPC `move_lead_atomic` existe com signature exata e `SECURITY INVOKER`.
- [ ] `docs/schema_snapshot.json` atualizado após aplicação.

### Backend
- [ ] `getPipelineDataAction` valida input com Zod e retorna `ActionResponse<PipelineData>`.
- [ ] `moveLeadAction` valida input com Zod, chama RPC, mapeia exceptions para `error` string amigável, e chama `revalidatePath('/pipeline')` em sucesso.
- [ ] Nenhuma chamada de `revalidatePath` em ações puramente de leitura.
- [ ] Log de erros via `console.error('[pipeline:*]', ...)`.
- [ ] `'converted'` **não** aparece em nenhum lugar do código (apenas `'won'`/`'lost'`).
- [ ] `getActiveLossReasonsAction` é **reutilizado**; nenhuma duplicata criada.

### Frontend (design system)
- [ ] Código passa em `agents/quality/guardian.md` §1a e §1b.
- [ ] `node scripts/verify-design.mjs --changed` retorna 0 violações.
- [ ] Componentes verificados com `data-theme="dark"` toggled.
- [ ] `LossReasonModal` tem loading state no submit, erro em toast, sucesso fecha modal + atualiza board.
- [ ] FunnelSelect reflete `?funnel=[id]` (URL como fonte de verdade).
- [ ] Nenhum `bg-[#...]`, `bg-blue-500`, hex literal em className, ou `any` TypeScript.
- [ ] Focus visible em todo elemento interativo.

### Business Rules
- [ ] Drop em coluna `stage_role='won'` → lead aparece com `status='won'` após reload.
- [ ] Drop em coluna `stage_role='lost'` sem preencher modal → board reverte ao estado original, nenhuma mutação persiste.
- [ ] Drop em coluna `stage_role='lost'` com motivo preenchido → `status='lost'`, `loss_reason_id` e `loss_notes` setados.
- [ ] Drag entre colunas neutras → apenas `stage_id` + `card_order` mudam; `status` permanece.
- [ ] Drag dentro da mesma coluna → apenas `card_order` muda; `stage_id` e `status` intactos.

### Tests (on-demand only)
Pulado (não ativado neste sprint).

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`) — ~10 min
1. Re-introspecção do banco (confirma `stage_role` em `funnel_stages`, valida `card_order` DEFAULT 0).
2. Atualiza `docs/schema_snapshot.json`.
3. Cria migration `[ts]_pipeline_index_and_rpc.sql` com:
   - `CREATE INDEX IF NOT EXISTS idx_leads_stage_order ...`
   - `CREATE OR REPLACE FUNCTION public.move_lead_atomic(...)` conforme §2.
4. `supabase db push --dry-run` → Tech Lead roda gate.

### Phase 2: Backend (`@backend`) — ~20 min
1. Estender `src/lib/actions/leads.ts`:
   - Adicionar types `PipelineLead`, `PipelineStage`, `PipelineData`.
   - Adicionar Zod schemas `GetPipelineInputSchema`, `MoveLeadInputSchema`.
   - Adicionar `getPipelineDataAction` + `moveLeadAction`.
2. **Não** criar novo arquivo — actions vivem juntas com os outros leads actions.
3. Verificar que `getActiveLossReasonsAction` existente é suficiente (já é).

### Phase 3: Frontend (`@frontend+`) — ~45 min
1. Criar `src/app/(app)/pipeline/layout.tsx` + `page.tsx`.
2. Criar `src/components/pipeline/` com `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `FunnelSelect`, `LossReasonModal`.
3. Atualizar `src/components/layout/Sidebar.tsx` com item "Pipeline".
4. Validar com `verify-design.mjs`.

### Phase 4: Guardian (`@guardian`) — ~5 min
1. Review de padrões (DS, segurança, RLS respeitada, ActionResponse).

### Phase 5: Design verification (manual) — ~5 min
1. Tela `/pipeline` em 375/1440; drag real; modal de perda; funnel switch.

**Total estimado:** ~85 min (sem QA).

---

## 9. Risks & Mitigations

### Risk 1: RPC `SECURITY INVOKER` + RLS bloqueia UPDATEs de shift em outros leads
**Impact:** High
**Probability:** Low-Medium
**Mitigation:** a policy UPDATE existente em `leads` já exige `organization_id = user_org`. Os UPDATEs de shift batem leads da mesma org (mesma coluna → mesmo funil → mesma org). Teste manual com 2 leads na mesma coluna; se bloqueado, escalar ao @db-admin para revisar policy (não o fix imediato: considerar `SECURITY DEFINER` com guard manual).

### Risk 2: `card_order` fica inconsistente sob racing
**Impact:** Medium (visual — leads trocam de ordem sem intenção)
**Probability:** Low (MVP single-user por org, drag lento)
**Mitigation:** aceito last-write-wins (fora de escopo do sprint). Registrar em APRENDIZADOS se observado.

### Risk 3: `@dnd-kit` com Server Components do Next 15
**Impact:** High (se não funcionar, bloqueio)
**Probability:** Low (biblioteca é estável; board é 100% client)
**Mitigation:** `KanbanBoard` é `"use client"` no topo. Page é Server Component. Props serializáveis (sem funções).

### Risk 4: `getPipelineDataAction` fica lento com 200+ leads em N colunas
**Impact:** Medium
**Probability:** Medium em contas ativas
**Mitigation:** paginação por coluna (50 default). Índice `idx_leads_stage_order` cobre a query. `LIMIT/RANGE` por stage. Monitorar em prod; se virar gargalo, adicionar virtualização (fora deste sprint).

### Risk 5: Schema snapshot desatualizado mascara bugs
**Impact:** Medium
**Probability:** High (já sabemos que está stale)
**Mitigation:** `@db-admin` re-introspecta como Phase 1 Step 1. Não prosseguir sem snapshot fresco.

---

## 10. Dependencies

### Internal
- [x] Sprint 10 (leads list) concluído — `src/lib/actions/leads.ts` existe com `getActiveLossReasonsAction`, helpers `loadLeadTags`, `loadProfileNames`.
- [x] Sprint 11 (funnels CRUD) concluído — `getFunnelsAction`, `funnels`, `funnel_stages` tables populadas.
- [x] Sprint 12-1 (stage_role) concluído — `funnel_stages.stage_role` existe no banco e no código (`StageRole` type).
- [x] `loss_reasons` table populada pela org.
- [x] `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` já em `package.json`.

### External
Nenhuma.

---

## 11. Rollback Plan

Se problemas em produção:

1. **Imediato:** `git revert [commit]` — reverte Server Action + UI.
2. **Banco:**
   - `DROP FUNCTION IF EXISTS public.move_lead_atomic(uuid, uuid, integer, uuid, text);`
   - `DROP INDEX IF EXISTS idx_leads_stage_order;`
   - Ambos seguros (não destroem dados).
3. **Cache:** Next cache é revalidado no próximo request de `/pipeline`. Não é necessária ação manual.
4. **Dados:** `card_order` / `stage_id` / `status` das rows movidas ficam como estão — são valores válidos, não causam corrupção se o board não existe mais. Se o usuário quer "desfazer o efeito", não é possível sem snapshot prévio (aceito — é MVP).

**Rollback commands:**
```bash
git revert [sprint-commit-hash]
supabase db push  # se a migration de rollback for criada
```

---

## Approval

**Created by:** @spec-writer (TPM persona)
**Reviewed by:** @sanity-checker ✅ APPROVED (iteração 2/3 — correção: adicionada categoria "Data Limits" + "Browser / Environment" separada para atingir 7 categorias distintas)
**Approved by:** _pendente — usuário_
**Date:** 2026-04-21
