# Sprint 11: Funnels (STANDARD)

> **Nivel:** STANDARD
> **Origem:** solicitacao do usuario — 2026-04-20
> **Pre-requisito:** Sprint 10 (Leads Lista) concluida.

---

## Objetivo de Negocio

O sistema precisa de um cadastro de **funis de vendas** para que o admin configure os pipelines do CRM. Cada funil possui estagios ordenados (ex.: "Novo Lead", "Qualificacao", "Proposta", "Negociacao", "Fechado Ganho"). Sem funis cadastrados, o pipeline Kanban (sprint futura) nao tera estrutura para organizar leads.

**Metrica de sucesso:** admin loga, acessa o menu "Funis", cria um funil com 3-5 estagios, edita a ordem dos estagios, desativa um funil, e a lista mostra apenas funis da propria org via RLS.

## User Stories

- Como **admin**, eu quero cadastrar funis com nome, descricao e estagios ordenados, para definir os pipelines de vendas da minha organizacao.
- Como **admin**, eu quero adicionar, remover e reordenar estagios dentro de um funil, para personalizar o fluxo de vendas.
- Como **admin**, eu quero ativar/desativar funis sem excluir, para manter historico mas impedir uso em novos leads.
- Como **admin**, eu quero buscar funis por nome, para encontrar rapido em listas grandes.
- Como **user de outra organizacao**, eu NAO consigo ver nem editar funis alheios (RLS por `organization_id`).

## Referencias Visuais

- **Layout — Lista:** [design_system/telas_prontas/_conteudo/entidade_lista.html](../../design_system/telas_prontas/_conteudo/entidade_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/_conteudo/entidade_criar.html](../../design_system/telas_prontas/_conteudo/entidade_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/_conteudo/entidade_editar.html](../../design_system/telas_prontas/_conteudo/entidade_editar.html)
- **Modulo de referencia estrutural:** Lead Origins (`src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts`) — mesmo padrao de CRUD para a entidade pai. Adaptar para incluir gestao inline de stages.
- **Design system:** tokens semanticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Switch, Table, Dialog, Badge, etc).

## Reference Module Compliance

- **Modulo de referencia:** `src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts`
- **O que copiar:** estrutura de arquivos, padrao de Server Actions, padrao de error handling, padrao de UI (lista + form + row actions)
- **O que trocar:** nomes de tabela (`funnels` / `funnel_stages`), schemas Zod, campos especificos do dominio
- **O que adicionar (nao existe no reference):** gestao inline de `funnel_stages` dentro do form de funil (adicionar/remover/reordenar estagios)

## Discrepancia Roadmap x Schema

Nenhuma. As tabelas `funnels` e `funnel_stages` ja existem no banco conforme `docs/schema_snapshot.json`:

- **funnels:** `id`, `organization_id`, `name`, `description` (nullable), `is_active` (default true), `created_at`, `updated_at`
  - Indices: `funnels_pkey`, `idx_funnels_org`
  - RLS: "Admins can manage funnels" (ALL), "Users can view funnels of their organization" (SELECT)

- **funnel_stages:** `id`, `funnel_id`, `name`, `order_index` (default 0), `created_at`, `updated_at`
  - Indices: `funnel_stages_pkey`, `idx_funnel_stages_funnel`, `idx_funnel_stages_order`
  - RLS: "Admins can manage stages" (ALL), "Users can view stages of their organization funnels" (SELECT)

**Nota sobre RLS:** diferente dos outros modulos (onde todos os users da org podem CRUD), aqui somente admins podem gerenciar funis/estagios. Users comuns so tem SELECT. Isso e intencional — funis sao configuracao do pipeline, nao dados operacionais.

## Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabelas JA EXISTEM, nao criar migration de tabela):**
  - `funnels` (7 colunas) — confirmadas via `docs/schema_snapshot.json`
  - `funnel_stages` (6 colunas) — confirmadas via `docs/schema_snapshot.json`
  - **RLS:** policies ja existem para ambas as tabelas. `@db-admin` deve confirmar no inicio da sprint que as policies enforcam corretamente. Se OK, **nenhuma migration e necessaria**.

- [ ] **Server Actions — Funnels (`src/lib/actions/funnels.ts`):**
  - Seguir templates de `docs/templates/server_actions.md` e contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - Usar Lead Origins (`src/lib/actions/lead-origins.ts`) como referencia direta — adaptar nomes e campos.
  - `getFunnelsAction({ search?, isActive?, page?, pageSize? })` — lista paginada (default 20/pagina). Busca por `name` (ILIKE). Filtro: `is_active`. Ordena por `created_at DESC`. Incluir count de stages por funil. Retorna `ActionResponse<{ data: Funnel[]; metadata: PaginationMeta }>`.
  - `getFunnelByIdAction(id)` — retorna funil por ID **com seus stages ordenados por `order_index`**. 404 se nao pertence a org (via RLS).
  - `createFunnelAction(input)` — valida via Zod, seta `organization_id` via `getSessionContext()`. Recebe nome, descricao e array de stages (nome + ordem). Cria funil e stages em uma unica operacao.
  - `updateFunnelAction(id, input)` — atualiza nome, descricao e/ou is_active do funil. Gestao de stages e separada.
  - `deleteFunnelAction(id)` — **hard delete** do funil (cascade deleta stages via FK). Manter tambem soft delete.
  - `toggleFunnelActiveAction(id)` — alterna `is_active`.

- [ ] **Server Actions — Funnel Stages (`src/lib/actions/funnel-stages.ts`):**
  - `updateFunnelStagesAction(funnelId, stages[])` — recebe array completo de stages (com id opcional para existentes, nome, order_index). Faz upsert: cria novos, atualiza existentes, deleta os que nao estao no array. Operacao atomica.
  - **Validacao Zod:** funil: `name` 2-100 chars, `description` 0-500 chars (opcional), `is_active` boolean. Stage: `name` 2-100 chars, `order_index` integer >= 0.

### Frontend

- [ ] **Rotas (seguir paths canonicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/funnels/layout.tsx` — layout com `DashboardShell` (obrigatorio).
  - `src/app/(app)/funnels/page.tsx` — listagem (Server Component).
  - `src/app/(app)/funnels/new/page.tsx` — criacao.
  - `src/app/(app)/funnels/[id]/page.tsx` — edicao.

- [ ] **Componentes (`src/components/funnels/`):**
  - `FunnelsList` — tabela com colunas: Nome, Descricao (truncada), Qtd Estagios, Status (badge ativo/inativo), Criado em, Acoes. Empty state ("Nenhum funil cadastrado — crie o primeiro"). Toolbar: busca debounced 300ms + CTA "Novo Funil".
  - `FunnelForm` — campos do funil: name (Input), description (Textarea), is_active (Switch). Secao de stages inline abaixo do form principal.
  - `FunnelStagesEditor` — componente para gestao de stages dentro do form: lista de stages com nome editavel, botoes para adicionar/remover stage, drag-and-drop ou botoes up/down para reordenar. Minimo 1 stage obrigatorio ao criar funil.
  - `FunnelRowActions` — menu de acoes por linha (editar, ativar/desativar, excluir).
  - **Regras de UI obrigatorias (de crud.md):** URL como fonte de verdade para paginacao/filtros/busca (regra #2), paginacao server-side (regra #3), toast em toda operacao com side-effect (regra #4), danger zone na edicao (regra #5), sem `router.refresh()` (regra #7).

- [ ] **Navegacao:**
  - Adicionar item "Funis" no `primaryNav` do Sidebar (`src/components/layout/Sidebar.tsx`) com icone `GitBranch` ou `Workflow` do Lucide.
  - Posicao: entre "Leads" e "Pipeline" (faz sentido semantico — funis configuram o pipeline).
  - Breadcrumbs: `Funis / [Novo | Nome do funil]`.

## Edge Cases

- [ ] **Estado vazio (org sem funis):** lista exibe empty state com CTA "Cadastrar primeiro funil".
- [ ] **Funil sem stages:** nao permitir — minimo 1 stage obrigatorio na criacao. Form valida antes de submeter.
- [ ] **Remover ultimo stage de um funil existente:** bloquear — manter minimo 1 stage sempre.
- [ ] **Nome de stage duplicado no mesmo funil:** permitir (ex.: dois "Follow-up").
- [ ] **RLS cross-org:** user da org A tenta acessar `/funnels/{id-da-org-B}` -> 404.
- [ ] **User nao-admin tenta criar/editar funil:** RLS bloqueia (somente admins tem INSERT/UPDATE/DELETE). UI deve esconder botoes de acao para nao-admins (melhoria futura — nesta sprint, RLS e o guardrail).
- [ ] **Desativar funil que tem leads vinculados (futuro):** permitido — o funil continua no historico do lead, apenas nao aparece como opcao para novos leads. Logica sera da sprint de Pipeline.
- [ ] **Erro de rede no form:** toast de erro, mantém dados preenchidos.
- [ ] **Dois tabs editando o mesmo funil:** last-write-wins (sem lock otimista). Aceitavel.
- [ ] **Reordenar stages:** order_index e recalculado sequencialmente (0, 1, 2...) ao salvar.

## Fora de escopo

- **Pipeline Kanban** — sprint futura. Este sprint so cria o cadastro de funis.
- **Vinculacao funil -> lead** — o campo `stage_id` em leads ja existe, mas a UI de atribuicao e da sprint de Pipeline.
- **Permissoes granulares por role na UI** — RLS ja protege, mas esconder/mostrar botoes por role e melhoria futura.
- **Drag-and-drop de stages** — usar botoes up/down para reordenar (mais simples, mais acessivel). DnD e melhoria futura se necessario.
- **Bulk import de funis** — nao previsto.
- **i18n.** Labels em pt-BR hardcoded (padrao do app hoje).

## Criterios de Aceite

- [ ] CRUD completo de Funnels funcional: criar (com stages), listar (com busca + paginacao + count de stages), editar (incluindo stages), desativar (soft), excluir (hard), restaurar.
- [ ] Gestao inline de stages: adicionar, remover, reordenar, renomear.
- [ ] Validacao Zod em todas as Server Actions.
- [ ] RLS testada cross-org: user da org A nao ve funis da org B.
- [ ] Menu "Funis" aparece no sidebar entre "Leads" e "Pipeline".
- [ ] Design alinhado com telas prontas genericas e com Lead Origins como referencia estrutural. Nenhum hex/arbitrary class.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o codigo.

---

## Recomendacao de Execucao

**Analise:**
- Nivel: STANDARD
- Complexity Score: **8** (DB +0: tabelas ja existem com RLS; API +4: Server Actions para funnels + stages; UI +2: novo modulo com lista + form + stages editor; Logica +2: reordenacao de stages, operacao atomica de upsert; Dependencias +0)
- Reference Module: **sim** — `src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts` (para estrutura base; stages editor e adicao)
- Integracao com API externa: **nao**
- Logica de negocio nova/ambigua: **moderada** — upsert atomico de stages com reordenacao
- Ambiguity Risk: **baixo** — schema claro, padrao CRUD estabelecido

---

### Opcao 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead -> @db-admin -> @backend -> @frontend+ -> @guardian -> gates -> @git-master
- **PRD:** pulado; o proprio sprint file e o contrato
- **Modelo sugerido:** Sonnet 4.6 — Reference Module existe, padroes estabelecidos
- **Quando faz sentido:** schema ja existe, CRUD segue padrao do projeto, stages editor e o unico componente novo (nao justifica PRD)

### Opcao 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead -> @spec-writer -> @sanity-checker (loop ate 3x) -> STOP & WAIT -> execucao identica a Opcao 1
- **PRD:** gerado em `prds/prd_funnels.md` e validado
- **Modelo sugerido:** Opus
- **Quando faz sentido:** se houver duvida sobre o UX do stages editor ou se o time quiser documentacao formal antes de implementar

---

**Recomendacao do @sprint-creator:** Opcao 1 — Sonnet 4.6

**Justificativa:**
Score 8 com Reference Module presente encaixa na regra 6 (Opcao 1 sugerida). O schema ja existe, o padrao CRUD esta bem estabelecido no projeto, e o unico componente verdadeiramente novo (FunnelStagesEditor) e um sub-form de adicionar/remover/reordenar itens — complexidade moderada mas sem ambiguidade. PRD nao agrega valor aqui.

**Aguardando escolha do usuario:** responda ao Tech Lead com `"execute opcao 1"` ou `"execute opcao 2"` (ou aceite a recomendacao dizendo apenas `"execute"`).

---

## Execucao

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | Concluido | Tabelas + RLS ja existem, sem migration |
| Server Actions | `@backend` | Concluido | `src/lib/actions/funnels.ts`, `src/lib/actions/funnel-stages.ts`, `src/lib/funnels/constants.ts` |
| Frontend | `@frontend+` | Concluido | `src/app/(app)/funnels/page.tsx`, `src/app/(app)/funnels/new/page.tsx`, `src/app/(app)/funnels/[id]/page.tsx`, `src/components/funnels/FunnelsList.tsx`, `src/components/funnels/FunnelForm.tsx`, `src/components/funnels/FunnelStagesEditor.tsx`, `src/components/funnels/FunnelRowActions.tsx`, `src/components/funnels/FunnelsToolbar.tsx`, `src/components/funnels/FunnelsSortableHeader.tsx`, `src/components/funnels/sort-utils.ts`, `src/components/layout/Sidebar.tsx` |
| Guardian | `@guardian` | Concluido | APPROVED — todas as regras automaticas e semanticas passam |
| Git | `@git-master` | Concluido | commit `6554bf7` feat: add Funnels CRUD module (Sprint 11) |

**Legenda:** Pendente - Em andamento - Concluido - Aguarda review
