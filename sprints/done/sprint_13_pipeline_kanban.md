# Sprint 13: Pipeline — Kanban com Drag-and-Drop (STANDARD)

> **Nível:** STANDARD
> **Origem:** solicitação do usuário — 2026-04-21 (baseado em `docs/roadmap.md` linha 217-231)
> **Pré-requisito:** Sprint 10 (Leads Lista), Sprint 11 (Funnels CRUD) e Sprint 12-1 (Funnel Stage Roles) concluídas.

---

## 🎯 Objetivo de Negócio

O admin/user precisa visualizar seus leads em um quadro Kanban onde cada coluna é um estágio do funil selecionado, e pode mover leads entre colunas por arrastar-e-soltar para refletir a evolução do pipeline de vendas. Sem o Kanban, a gestão diária de pipeline fica presa na lista tabular do Sprint 10 — pouco eficiente para operações visuais de mudança de estágio.

**Métrica de sucesso:** usuário acessa `/pipeline`, escolhe um funil, vê suas colunas (estágios ordenados por `order_index`) com os leads respectivos, arrasta 5 leads entre colunas e dentro da mesma coluna, os movimentos persistem após reload, e ao arrastar um lead para a coluna de `stage_role = 'lost'` o sistema exige motivo de perda antes de confirmar.

---

## 👤 User Stories

- Como **user**, eu quero um quadro Kanban por funil, para visualizar meu pipeline em colunas de estágio.
- Como **user**, eu quero arrastar um lead de uma coluna para outra, para mudar seu `stage_id` sem abrir o formulário de edição.
- Como **user**, eu quero reordenar leads dentro da mesma coluna (arrastar pra cima/baixo), para organizar prioridade visual (`card_order`).
- Como **user**, ao arrastar um lead para a coluna "Perdido", quero que o sistema me peça motivo de perda (obrigatório) antes de concluir, para não perder informação comercial.
- Como **user**, eu quero trocar de funil pelo seletor no topo, para ver o pipeline de outro funil da minha organização.
- Como **user de outra organização**, eu NÃO devo ver nem conseguir mover leads de outra org (RLS por `organization_id`).

---

## 🎨 Referências Visuais

- **Tela de exemplo (fonte visual primária):** [`design_system/telas_prontas/_conteudo/pipeline.html`](../../design_system/telas_prontas/_conteudo/pipeline.html) — referência **autoritativa** para estrutura visual do board, cabeçalhos de coluna, card de lead, badges de role, scroll-x e espaçamentos. O `@frontend+` **deve abrir e inspecionar esse arquivo** antes de começar o Kanban e manter a paridade visual. Pixel-to-pixel não é obrigatório, mas a hierarquia visual, densidade, tipografia e ordem dos elementos no card devem seguir o exemplo.
  - ⚠️ **Ressalva:** o HTML de exemplo pode usar cores/tokens estáticos. Na implementação React, traduza tudo para tokens semânticos do design system — **nunca copie hex literais do HTML**.
- **Layout base:** quadro Kanban horizontal com scroll-x, colunas fixas no topo com nome do estágio + contador de leads, cards empilhados por coluna com altura fluida, drag-overlay durante o arraste.
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, `bg-blue-500` ou `p-[17px]`. Regras em [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) e contrato em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md).
- **Destaque visual de role:** colunas com `stage_role` ganham badge/ícone na header (herdado do padrão de Sprint 12-1):
  - Entrada (`entry`): ícone `LogIn`/`ArrowRightToLine` — `text-feedback-info-fg`
  - Ganho (`won`): ícone `Trophy`/`CheckCircle2` — `text-feedback-success-fg`
  - Perdido (`lost`): ícone `XCircle` — `text-feedback-danger-fg`
- **Card de lead:** nome, value formatado em BRL, badge de status, chips de tags (máx 2 + "+N"), avatar do assigned_to (iniciais se sem foto). Compacto (~80–96px altura).
- **Componentes reutilizados:** `Button`, `Select`, `Dialog`, `Badge`, `Avatar` de `src/components/ui/*`. Modal de perda reusa o padrão de `src/components/ui/dialog.tsx` já usado no projeto.

---

## 🧬 Reference Module Compliance

- **Módulo de referência estrutural (layout e actions):** `src/app/(app)/leads/` + `src/lib/actions/leads.ts`
- **O que reutilizar:**
  - Padrão de `ActionResponse<T>` e `getSessionContext()` do módulo de leads
  - Listagem/query de leads (filtro por `organization_id`, join com `funnel_stages`, `lead_origins`, `tags`)
  - Select de funil: reusar lógica de listagem já presente em `src/lib/actions/funnels.ts`
- **O que adicionar (novo, sem referência direta):**
  - `KanbanBoard` com `@dnd-kit` (já instalado: `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2`)
  - Server Action `moveLeadAction` — mudança transacional de `stage_id` + recomputo de `card_order` na origem e destino
  - Modal condicional de perda que intercepta o drop em coluna `lost`
- **Biblioteca DnD:** já declarada no `package.json` — **não adicionar** nova dependência.

---

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados:**
  - **Nenhuma migration de tabela nova.** Tudo que o Kanban precisa já existe: `leads.stage_id` (FK → `funnel_stages.id`), `leads.card_order` (integer), `funnel_stages.stage_role` (enum via CHECK do Sprint 12-1), `funnels`, `funnel_stages`.
  - `@db-admin` deve **confirmar** via introspecção ao vivo (veja `agents/ops/db-admin.md`):
    1. Que `leads.card_order` tem `DEFAULT 0` (ou adicionar migration idempotente se estiver `NULL`).
    2. Que existe índice em `(organization_id, stage_id, card_order)` para ordenação por coluna — se não existir, criar via migration idempotente: `CREATE INDEX IF NOT EXISTS idx_leads_stage_order ON leads (organization_id, stage_id, card_order)`.
    3. Que RLS das tabelas envolvidas (leads, funnel_stages, funnels) está vigente e protege cross-org.

- [ ] **Server Actions — estender `src/lib/actions/leads.ts`:**
  - `getPipelineDataAction({ funnelId, pageByStage? })` — retorna estrutura pronta para o board:
    ```ts
    {
      funnel: { id, name },
      stages: Array<{
        id, name, order_index, stage_role,
        leadsTotal: number,            // COUNT total da coluna
        leads: Array<{
          id, name, value, status, card_order,
          tags: Array<{ id, name, color }>,
          assignedTo: { id, full_name, avatar_url } | null
        }>
      }>
    }
    ```
    - **Paginação por coluna:** default 50 leads por stage, ordenados por `card_order ASC, created_at DESC`. Se `pageByStage[stageId] = N`, retorna `N*50` primeiros (clique em "Ver mais" incrementa).
    - Filtra: `leads.organization_id = ctx.organizationId`, `stage_id IN (stages do funil)`, `status NOT IN ('converted','lost')` **OU** inclui todos e deixa visualização honesta? → **Inclui todos com `stage_id` no funil, incluindo status `lost`**, para o usuário enxergar histórico completo no board. (Se quiser ocultar depois, vira filtro opcional em sprint futura.)
    - **Leads sem `stage_id` não aparecem** (decisão do usuário em 2026-04-21). Se o funil não tem stages, retorna estrutura vazia com mensagem.

  - `moveLeadAction({ leadId, toStageId, toIndex, lossReasonId?, lossNotes? })` — **única Server Action de mutação** do board. Operação atômica:
    1. Valida via Zod: `leadId uuid`, `toStageId uuid`, `toIndex int ≥ 0`, `lossReasonId uuid | null`, `lossNotes string | null`.
    2. Busca o lead e garante `lead.organization_id = ctx.organizationId` (RLS + double-check).
    3. Busca `toStage` e garante `toStage.funnel_id` pertence a um funil da mesma org.
    4. **Se `toStage.stage_role = 'lost'`:** exigir `lossReasonId` não-nulo. Retornar `ActionResponse` com `error: 'LOSS_REASON_REQUIRED'` (código, não string traduzida) se faltar. `lossNotes` é opcional mas recomendado (max 500 chars).
    5. **Se `toStage.stage_role = 'won'`:** setar `leads.status = 'converted'` (direto, sem confirmação adicional nesta sprint).
    6. **Se `toStage.stage_role = 'lost'`:** setar `leads.status = 'lost'`, `loss_reason_id = lossReasonId`, `loss_notes = lossNotes || null`.
    7. **Se mudou de coluna (`fromStageId != toStageId`):**
       - Decrementar `card_order` dos leads restantes na coluna de origem com `card_order > oldOrder` (shift-left).
       - Incrementar `card_order` dos leads na coluna destino com `card_order >= toIndex` (shift-right).
       - Atualizar o lead: `stage_id = toStageId`, `card_order = toIndex` (+ campos de won/lost se aplicável).
    8. **Se reordenou dentro da mesma coluna (`fromStageId == toStageId`):**
       - Shift dos leads entre `oldOrder` e `newOrder` (up se subiu, down se desceu).
       - Atualizar `card_order` do lead movido para `toIndex`.
    9. Executar **tudo em 1 RPC do Postgres** (função `move_lead_atomic(lead_id, to_stage_id, to_index, loss_reason_id, loss_notes)`) ou em `BEGIN ... COMMIT` explícito via Supabase. **Preferência: RPC** — garante atomicidade real e evita round-trips. Se `@backend` optar por RPC, `@db-admin` cria a function via migration; se optar por múltiplas queries sequenciais, documentar risco de race em APRENDIZADOS.
    10. `revalidatePath('/pipeline')` e retornar `ActionResponse<{ leadId, newStageId, newOrder }>`.

  - **Zod schema** para o input de `moveLeadAction`:
    ```ts
    const MoveLeadInputSchema = z.object({
      leadId: z.string().uuid(),
      toStageId: z.string().uuid(),
      toIndex: z.number().int().min(0),
      lossReasonId: z.string().uuid().nullable().optional(),
      lossNotes: z.string().max(500).nullable().optional()
    })
    ```

  - `getLossReasonsForSelectAction()` — lista simples (id, name) de `loss_reasons` ativas da org, ordenados por nome. Para popular o Select do modal de perda. (Se já existir action equivalente, reusar.)

- [ ] **RPC do Postgres (via `@db-admin`, se `@backend` escolher esse caminho):**
  - Nome: `move_lead_atomic(p_lead_id uuid, p_to_stage_id uuid, p_to_index int, p_loss_reason_id uuid, p_loss_notes text)`
  - `SECURITY DEFINER` **não** — queremos que a RLS proteja. Portanto `SECURITY INVOKER` com validações explícitas.
  - Migration idempotente (`CREATE OR REPLACE FUNCTION`), em arquivo novo `supabase/migrations/[ts]_move_lead_atomic_rpc.sql`.

### Frontend

- [ ] **Rotas (seguir `docs/conventions/crud.md`):**
  - `src/app/(app)/pipeline/layout.tsx` — layout com `DashboardShell`.
  - `src/app/(app)/pipeline/page.tsx` — Server Component que:
    1. Lê `?funnel=[id]` da URL. Se ausente, busca o funil `is_default=true` da org; se também não há, o primeiro por `created_at`.
    2. Chama `getFunnelsAction` para popular o Select de funis.
    3. Chama `getPipelineDataAction({ funnelId })`.
    4. Passa tudo para `<KanbanBoard />` client component.

- [ ] **Componentes (`src/components/pipeline/`):**
  - `KanbanBoard.tsx` (client) — orquestrador:
    - Estado local otimista dos stages e leads (inicializado do server data).
    - `DndContext` do `@dnd-kit/core` com `sensors` (Pointer + Keyboard), `collisionDetection={closestCorners}`.
    - `onDragStart`: armazena lead em arraste no estado (para o DragOverlay).
    - `onDragOver`: ajusta posição otimista entre colunas.
    - `onDragEnd`:
      - Se o drop é na mesma posição: noop.
      - Se `toStage.stage_role === 'lost'`: abre `<LossReasonModal />` com os dados (`leadId`, `toStageId`, `toIndex`) pendentes. Não chama `moveLeadAction` ainda.
      - Caso contrário: chama `moveLeadAction(...)` direto, atualiza otimisticamente, em erro faz rollback do estado.
    - Scroll-x horizontal quando o número de colunas excede a viewport.

  - `KanbanColumn.tsx` — uma coluna:
    - Header: nome do stage, badge/ícone de role (entry/won/lost/neutro), contador `leadsTotal`.
    - Corpo: `<SortableContext items={leadIds} strategy={verticalListSortingStrategy}>` com lista de `<KanbanCard />`.
    - Footer: botão "Ver mais (X restantes)" quando `leads.length < leadsTotal`. Clique atualiza `pageByStage[stageId]` e re-fetcha via `getPipelineDataAction`.
    - Empty state: "Nenhum lead neste estágio."

  - `KanbanCard.tsx` — card individual:
    - Hook `useSortable({ id: lead.id })`.
    - Exibe: nome, value (formato BRL via `Intl.NumberFormat`), badge de status (novo/contatado/qualificado/proposta/negociação/convertido/perdido), tags (máx 2 chips + "+N"), avatar do assigned_to.
    - Cursor `grab` default, `grabbing` durante drag.
    - **Sem clique / sem edição nesta sprint** (decisão do usuário 2026-04-21).

  - `FunnelSelect.tsx` — Select de funis no header da página. Mudança atualiza `?funnel=[id]` via `router.push` (URL como fonte de verdade — regra #2 de `crud.md`).

  - `LossReasonModal.tsx` — modal:
    - Abre quando drop em coluna `lost`. Form com:
      - `Select loss_reason_id` (obrigatório) — populado por `getLossReasonsForSelectAction()`.
      - `Textarea loss_notes` (opcional, max 500 chars, contador).
    - Botões: "Cancelar" (aborta o drop, faz rollback visual) e "Confirmar perda" (chama `moveLeadAction` com os dados de perda).
    - Validação via `react-hook-form + zodResolver`.

- [ ] **Navegação:**
  - Adicionar item "Pipeline" no `primaryNav` do Sidebar (`src/components/layout/Sidebar.tsx`) com ícone `LayoutGrid`/`KanbanSquare` (Lucide).
  - Posição: logo abaixo de "Funis" (faz sentido semântico — funis configuram, pipeline opera).
  - Breadcrumbs: `Pipeline` (raiz).

---

## 🧪 Edge Cases

- [ ] **Org sem funis:** página exibe empty state com CTA "Cadastre um funil em /funnels".
- [ ] **Funil sem stages:** página exibe mensagem "Este funil não tem estágios. Configure em /funnels/[id]".
- [ ] **Funil sem stage `entry`:** board carrega normalmente (roles são do Sprint 12-1, mas não são pré-requisito para visualização). Drop em `won`/`lost` segue regras; colunas neutras seguem regras padrão.
- [ ] **Funil sem stage `lost`:** modal de perda nunca abre — board opera sem a lógica condicional. Isso é esperado.
- [ ] **Lead sem `stage_id` no funil selecionado:** não aparece no board (decisão explícita do usuário).
- [ ] **Coluna com 200+ leads:** carrega os 50 primeiros + "Ver mais". Performance: query com `LIMIT 50 OFFSET page*50`. Paginação é **por coluna**, não global.
- [ ] **Drop no mesmo lugar:** noop, nenhuma Server Action é disparada.
- [ ] **Drop em coluna `lost` + usuário cancela no modal:** estado otimista reverte, lead volta para origem visualmente. Nenhuma mutação no banco.
- [ ] **Drop em coluna `lost` sem `loss_reason_id`:** modal não deixa submeter (validação client). Se burlado, Server Action retorna erro `LOSS_REASON_REQUIRED` e client reverte.
- [ ] **Race condition: dois usuários movem o mesmo lead:** last-write-wins. O segundo usuário vê o valor dele. Aceitável. (Sprint futura pode adicionar optimistic lock via `updated_at`.)
- [ ] **RLS cross-org:** user da org A tenta `moveLeadAction` com `leadId` da org B → Server Action nega (busca do lead retorna `null` por RLS, action retorna erro "Lead não encontrado").
- [ ] **Erro de rede em `moveLeadAction`:** toast de erro + rollback do estado otimista para a posição original.
- [ ] **Mudar de funil durante um drag em andamento:** cancelar o drag (limpar estado local) antes de re-fetch dos dados.
- [ ] **card_order com valores não-sequenciais legados:** a operação de move re-computa shift com base nos valores atuais; não exige normalização prévia. (Se bugs aparecerem em produção, normalizar em sprint dedicada.)
- [ ] **Coluna de destino carregada parcialmente (Ver mais não clicado):** `toIndex` pode se referir a uma posição fora da página visível. Shift é feito com base em `card_order` absoluto no banco, não no array client — server é fonte de verdade.

---

## 🚫 Fora de escopo

- **Edição inline de lead no card** — decisão explícita do usuário (2026-04-21). Card é visual apenas; edição permanece em `/leads/[id]` (Sprint 10).
- **Drawer lateral de preview** — idem acima.
- **Filtros no board** (busca, assigned_to, tags) — MVP sem filtros. Sprint futura.
- **Modal de confirmação em drop de `won`** — decisão do usuário: só `lost` tem modal.
- **Bulk move (selecionar múltiplos leads e mover)** — fora de escopo.
- **Colunas virtuais para leads órfãos (sem stage_id)** — decisão do usuário: ficam invisíveis no board.
- **Ocultação de leads com `status='converted'` ou `status='lost'`** — todos aparecem, sem filtro nesta sprint.
- **Drag-and-drop de colunas (reordenar stages no board)** — configuração de stages é do Sprint 12 (`/funnels/[id]/stages`).
- **Otimistic lock contra race conditions** — aceito last-write-wins nesta sprint.
- **Virtualização de listas (react-window)** — "Ver mais" cobre o caso médio; virtualização é otimização futura se necessário.

---

## ⚠️ Critérios de Aceite

- [ ] `/pipeline` acessível com `DashboardShell` e seletor de funil funcional (URL reflete `?funnel=[id]`).
- [ ] Board exibe colunas = stages ordenados por `order_index`, com badge/ícone correto para roles.
- [ ] Cards mostram nome, value BRL, status, tags (máx 2 + "+N"), avatar do assigned_to.
- [ ] Drag entre colunas atualiza `stage_id` e `card_order` com shift correto em ambas as colunas (origem e destino).
- [ ] Drag dentro da mesma coluna reordena `card_order` corretamente.
- [ ] Drop em coluna `stage_role = 'lost'` abre modal com `loss_reason_id` obrigatório e `loss_notes` opcional. Cancelar reverte visualmente.
- [ ] Drop em coluna `stage_role = 'won'` seta `leads.status = 'converted'` sem modal.
- [ ] Operação de move é **atômica** (RPC ou transação) — inconsistência no meio do shift não corrompe `card_order`.
- [ ] Paginação por coluna: 50 leads inicial + "Ver mais" carrega próximos 50.
- [ ] Ordem persiste após reload (`card_order` no banco é fonte de verdade).
- [ ] RLS cross-org testada: user da org A não vê nem move leads da org B.
- [ ] Menu "Pipeline" aparece no sidebar abaixo de "Funis".
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único de design system.

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **11**
  - DB: confirmação de índice + possível migration de RPC atômico = +2
  - API: Server Action nova (`moveLeadAction`) com lógica transacional complexa + `getPipelineDataAction` com shape específico + reuso de `getLossReasonsForSelectAction` = +4
  - UI: novo módulo Kanban com `@dnd-kit` (board + column + card + modal + select) = +2
  - Lógica: regra nova de shift atômico + modal condicional em `lost` + auto-status em `won`/`lost` = +3
- Reference Module: **parcial** — `src/lib/actions/leads.ts` serve de base para actions, mas não há módulo Kanban de referência no projeto (primeiro DnD)
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **alta** — shift atômico com ordem otimista + fallback client, regra de `lost` com modal condicional, interação entre `stage_role` e `leads.status`
- Ambiguity Risk: **médio** — requisitos foram alinhados explicitamente na conversa, mas o desenho da operação atômica (RPC vs. queries sequenciais) e o modelo de estado otimista são decisões arquiteturais não-triviais que se beneficiam de um Implementation Plan prévio

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @frontend+ → @guardian → gates → @git-master
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** Opus 4.7 (complexidade alta, mesmo sem PRD)
- **Quando faz sentido:** se o usuário prefere velocidade e aceita que o `@backend` decida RPC vs queries no momento da implementação, documentando a escolha em APRENDIZADOS

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `prds/prd_pipeline_kanban.md` e validado
- **Modelo sugerido:** Opus 4.7
- **Quando faz sentido:** a decisão "RPC atômica vs. transação explícita via client Supabase", o shape de `getPipelineDataAction`, e a sincronização entre estado otimista do client e resposta do server merecem desenho formal antes do código ser escrito. PRD + sanity-checker pagam o custo ao evitar retrabalho no `@backend`.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus 4.7**

**Justificativa:**
Score **11 ≥ 9** dispara **Opção 2 forçada** pela regra 1 da rubrica. Além disso: lógica de negócio nova e não-trivial (shift atômico de `card_order` em duas colunas + modal condicional em `lost` + auto-status em `won`/`lost`), primeiro uso de `@dnd-kit` no projeto (sem Reference Module de DnD), e decisão arquitetural aberta (RPC Postgres vs. transação via Supabase client) que se beneficia de validação pelo `@sanity-checker` antes da execução. O PRD também força o desenho explícito do shape de `getPipelineDataAction` e do protocolo de rollback otimista em caso de erro — reduzindo drift durante `@backend`/`@frontend+`.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead. O Tech Lead atualiza as linhas de `@guardian` e `@git-master`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Spec técnico *(Opção 2 apenas)* | `@spec-writer` | ✅ Concluído | `prds/prd_pipeline_kanban.md` |
| Sanity check *(Opção 2 apenas)* | `@sanity-checker` | ✅ APPROVED (iter 2/3) | PRD ajustado: +categoria Data Limits |
| Banco de dados (índice + RPC atômica) | `@db-admin` | ✅ Concluído | `supabase/migrations/20260421143107_pipeline_index_and_rpc.sql` (aplicado); `docs/schema_snapshot.json` atualizado; GATE 1 passou (smoke-test `LEAD_NOT_FOUND`) |
| Server Actions (`moveLeadAction`, `getPipelineDataAction`) | `@backend` | ✅ Concluído | `src/lib/actions/leads.ts` (+ tipos `PipelineData`, `PipelineStage`, `PipelineLead`); lint ok; build ok |
| Frontend (board + modal + select) | `@frontend+` | ✅ Concluído | `src/app/(app)/pipeline/{layout,page}.tsx`; `src/components/pipeline/{PipelineHeader,KanbanBoard,KanbanColumn,KanbanCard,LossReasonModal}.tsx`; Sidebar href atualizado; verify-design ✅ 9/0; lint ok; build ok (/pipeline 7kB) |
| Guardian | `@guardian` | ✅ APPROVED | DS auto-checks 0 violações; semantic review ok (tokens semânticos, composição sobre DS, `variant="danger"` reusado no modal); security ok (`SECURITY INVOKER` + cross-org guard no RPC, Zod strict, `ctx.organizationId` nunca do cliente); GATE 2 build+lint ✅; GATE 5 static ✅ 9/0 |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
