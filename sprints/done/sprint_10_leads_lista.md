# Sprint 10: Leads — Lista & CRUD (STANDARD)

> **Nivel:** STANDARD
> **Origem:** `docs/roadmap.md` — Sprint 10
> **Pre-requisito:** Sprints 07-09 concluidos (origens, motivos de perda, tags ja cadastraveis).

---

## Objetivo de Negocio

O modulo de Leads e o **core do produto**. O usuario precisa cadastrar, visualizar, filtrar e gerenciar leads da sua organizacao. Sem esta tela, o CRM nao tem funcao principal.

A pagina placeholder em `/leads` (criada na Sprint 07) sera substituida pelo CRUD funcional completo. Os sub-modulos de suporte (origens, motivos de perda, tags) ja estao prontos e serao consumidos aqui.

**Metrica de sucesso:** usuario loga, acessa Leads > Todos os Leads, ve lista paginada dos leads da org. Cria um lead com dados basicos + UTM + tags. Filtra por status, origem, responsavel e tag. Edita um lead, atribui a outro membro da equipe, marca como "perdido" com motivo obrigatorio. Lista atualiza corretamente apos cada operacao. RLS impede acesso cross-org.

## User Stories

- Como **vendedor**, eu quero ver todos os leads da minha organizacao em uma tabela paginada, para acompanhar o pipeline de vendas.
- Como **vendedor**, eu quero buscar leads por nome, email, telefone ou empresa, para encontrar rapidamente um contato especifico.
- Como **vendedor**, eu quero filtrar leads por status, origem, responsavel e tag, para focar nos leads relevantes.
- Como **vendedor**, eu quero cadastrar um novo lead com dados de contato, UTM, empresa e notas, para registrar oportunidades.
- Como **vendedor**, eu quero editar os dados de um lead existente, para manter as informacoes atualizadas.
- Como **vendedor**, eu quero atribuir tags a um lead (multi-select), para categorizar visualmente.
- Como **vendedor**, eu quero atribuir um lead a outro membro da equipe, para distribuir o trabalho.
- Como **vendedor**, eu quero marcar um lead como "perdido" informando o motivo de perda e notas, para registrar o historico.
- Como **admin**, eu quero excluir leads permanentemente, para manter a base limpa.
- Como **usuario de outra org**, eu NAO consigo ver nem editar leads alheios (RLS por `organization_id`).

## Referencias Visuais

- **Layout — Lista:** [design_system/telas_prontas/_conteudo/entidade_lista.html](../../design_system/telas_prontas/_conteudo/entidade_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/_conteudo/entidade_criar.html](../../design_system/telas_prontas/_conteudo/entidade_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/_conteudo/entidade_editar.html](../../design_system/telas_prontas/_conteudo/entidade_editar.html)
- **Modulo de referencia estrutural:** Tags (`src/app/(app)/leads/tags/` + `src/lib/actions/tags.ts`) — mesmo padrao de CRUD, mesma area do menu. Copiar estrutura de actions, componentes e pages.
- **Design system:** tokens semanticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Table, Dialog, Badge, Select, Switch, Tabs, etc).
- **TagBadge:** reutilizar `src/components/tags/TagBadge.tsx` (criado na Sprint 09) para exibir tags nos leads.

## Reference Module Compliance

- **Modulo de referencia:** `src/app/(app)/leads/tags/` + `src/lib/actions/tags.ts`
- **O que copiar:** estrutura de arquivos, padrao de Server Actions (ActionResponse, Zod, getSessionContext, assertRole, revalidatePath), padrao de componentes (List, Form, RowActions, Toolbar)
- **O que trocar:** nomes de tabela (`leads` em vez de `tags`), schemas Zod (27 campos), campos especificos do dominio, adicionar tabs no form, adicionar filtros compostos na lista

## Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabela `leads` JA EXISTE — sem migration necessaria para colunas base):**
  - `leads` (27 colunas) — confirmadas via `docs/schema_snapshot.json`:
    - `id` uuid PK · `organization_id` uuid NOT NULL · `name` text NOT NULL · `email` text · `phone` text · `medium` text · `campaign` text · `utm_source` text · `utm_medium` text · `utm_campaign` text · `utm_content` text · `utm_term` text · `company` text · `position` text · `notes` text · `status` text DEFAULT 'new' · `score` integer DEFAULT 0 · `created_at` timestamptz · `updated_at` timestamptz · `created_by` uuid · `assigned_to` uuid · `stage_id` uuid · `card_order` integer DEFAULT 0 · `value` numeric DEFAULT 0 · `origin_id` uuid · `loss_reason_id` uuid · `loss_notes` text
  - Indices: `idx_leads_organization`, `idx_leads_status`, `idx_leads_email`, `idx_leads_assigned_to`, `idx_leads_stage_id`, `idx_leads_created_at`, `idx_leads_loss_reason`, `idx_leads_card_order`
  - **RLS:** 4 policies ja existem (SELECT/INSERT/UPDATE/DELETE por org).
  - **Tabela `lead_tags` (M2M):** ja existe com PK composta `(lead_id, tag_id)`, indices em ambas FKs, 3 policies (SELECT/INSERT/DELETE por org).
  - **FKs relevantes:** `leads.origin_id` → `lead_origins.id`, `leads.loss_reason_id` → `loss_reasons.id`, `leads.assigned_to` → `profiles.id`, `leads.created_by` → `profiles.id`, `leads.stage_id` → `funnel_stages.id`, `lead_tags.tag_id` → `tags.id`, `lead_tags.lead_id` → `leads.id`.
  - **`@db-admin` deve confirmar:** comportamento ON DELETE das FKs (especialmente `lead_tags` → `leads` e `leads` → `lead_origins`/`loss_reasons`). Se CASCADE, hard delete de lead remove automaticamente registros em `lead_tags`. Se RESTRICT, precisa tratar no codigo.

- [ ] **Server Actions (`src/lib/actions/leads.ts`):**
  - Seguir os templates de `docs/templates/server_actions.md` e o contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - Usar Tags (`src/lib/actions/tags.ts`) como referencia de padrao — adaptar para o dominio leads.

  **Actions de CRUD:**
  - `getLeadsAction({ search?, status?, originId?, assignedTo?, tagId?, page?, pageSize?, sortBy?, sortOrder? })` — lista paginada (default 20/pagina). Busca por `name`, `email`, `phone`, `company` (ILIKE). Filtros compostos: `status`, `origin_id`, `assigned_to`, tag (via subquery em `lead_tags`). Ordena por campo configuravel (default `created_at` DESC). Retorna leads com joins: `lead_origins.name` (como origin_name), `profiles.full_name` (como assigned_to_name), tags associadas (via `lead_tags` + `tags`). Retorna `ActionResponse<{ data: LeadRow[]; metadata: PaginationMeta }>`.
  - `getLeadByIdAction(id)` — retorna lead por ID com todos os campos + tags associadas + origin name + assigned_to name. 404 se nao pertence a org (via RLS).
  - `createLeadAction(input)` — valida via Zod, seta `organization_id` e `created_by` via `getSessionContext()`. Campo obrigatorio: `name`. Demais opcionais. Se `tagIds` fornecido, insere em `lead_tags` apos criar o lead. Tratar erro de constraint se houver.
  - `updateLeadAction(id, input)` — atualiza campos do lead. Se `tagIds` fornecido, faz sync (delete existing + insert new em `lead_tags`). Seta `updated_at`. Tratar atribuicao de `assigned_to` (uuid valido de profile da mesma org).
  - `deleteLeadAction(id)` — hard delete do lead. Confirmacao obrigatoria no frontend. `lead_tags` deve ser limpo automaticamente (FK CASCADE) ou manualmente antes do delete.

  **Actions auxiliares:**
  - `markLeadAsLostAction(id, { lossReasonId, lossNotes })` — seta `status = 'lost'`, `loss_reason_id`, `loss_notes`. `lossReasonId` obrigatorio. Valida que o loss_reason pertence a mesma org.
  - `updateLeadStatusAction(id, { status })` — atualiza status do lead. Valores aceitos: `new`, `contacted`, `qualified`, `proposal`, `negotiation`, `won`, `lost`. Se `status != 'lost'`, limpa `loss_reason_id` e `loss_notes`.
  - `assignLeadAction(id, { assignedTo })` — atribui lead a um membro da equipe. Valida que o profile pertence a mesma org e esta ativo.
  - `syncLeadTagsAction(leadId, tagIds[])` — sincronia de tags: remove todas as tags atuais do lead em `lead_tags`, insere as novas. Pode ser chamada standalone ou como parte do update.

  **Validacao Zod:**
  - `name` 2-100 chars (obrigatorio)
  - `email` formato email valido (opcional)
  - `phone` 8-20 chars (opcional)
  - `company` max 100 chars (opcional)
  - `position` max 100 chars (opcional)
  - `notes` max 2000 chars (opcional)
  - `status` enum: `new`, `contacted`, `qualified`, `proposal`, `negotiation`, `won`, `lost`
  - `score` integer 0-100 (opcional, default 0)
  - `value` numeric >= 0 (opcional, default 0)
  - `medium`, `campaign` max 100 chars (opcional)
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` max 200 chars cada (opcional)
  - `origin_id` uuid (opcional)
  - `assigned_to` uuid (opcional)
  - `loss_reason_id` uuid (obrigatorio quando status = 'lost')
  - `loss_notes` max 500 chars (opcional)
  - `tagIds` array de uuids (opcional)

### Frontend

- [ ] **Rotas (seguir paths canonicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/leads/page.tsx` — **substituir placeholder** pela listagem real (Server Component). Recebe searchParams para paginacao, filtros, busca e sort.
  - `src/app/(app)/leads/new/page.tsx` — criacao de lead.
  - `src/app/(app)/leads/[id]/page.tsx` — edicao de lead.

- [ ] **Componentes (`src/components/leads/`):**

  **Lista:**
  - `LeadsList` — tabela com colunas: Nome · Email · Telefone · Origem · Status (badge colorido por status) · Score · Valor (formatado BRL) · Responsavel (avatar + nome) · Tags (badges via TagBadge) · Criado em · Acoes. Empty state ("Nenhum lead cadastrado — crie o primeiro"). Skeleton loading.
  - `LeadsToolbar` — busca debounced 300ms + filtros (status, origem, responsavel, tag) + CTA "Novo Lead". Filtros como dropdowns/selects. Busca e filtros persistidos na URL (query params).
  - `LeadsSortableHeader` — headers clicaveis para ordenacao (nome, email, status, score, value, created_at). Direcao asc/desc via query param.
  - `LeadRowActions` — menu de acoes por linha: editar, atribuir responsavel, marcar como perdido (abre dialog), excluir (com confirmacao).
  - `LeadStatusBadge` — badge colorido por status (new=info, contacted=warning, qualified=action, proposal=action, negotiation=warning, won=success, lost=error). Usa tokens semanticos.
  - `LeadFilters` — componente de filtros compostos: Select de status (multi ou single), Select de origem (carrega lead_origins ativos da org), Select de responsavel (carrega profiles ativos da org), Select de tag (carrega tags ativas da org). Cada filtro atualiza query params.

  **Form:**
  - `LeadForm` — form com tabs (Dados Basicos / UTM / Comercial / Notas). Validacao client-side antes do submit. Usado para criar e editar (props: `lead?` para modo edicao).
    - **Tab Dados Basicos:** name (obrigatorio), email, phone, company, position, origin_id (Select carregando origens ativas), assigned_to (Select carregando profiles ativos).
    - **Tab UTM:** utm_source, utm_medium, utm_campaign, utm_content, utm_term, medium, campaign.
    - **Tab Comercial:** status (Select), score (Input number), value (Input currency BRL), tags (multi-select com TagBadge preview).
    - **Tab Notas:** notes (Textarea).
  - `LeadTagsSelect` — multi-select de tags com preview visual (TagBadge). Carrega tags ativas da org. Permite selecionar/remover multiplas tags.
  - `MarkAsLostDialog` — dialog modal que aparece ao marcar lead como "perdido". Campos: loss_reason_id (Select obrigatorio, carrega loss_reasons ativos), loss_notes (Textarea opcional). Botao confirmar executa `markLeadAsLostAction`.
  - `AssignLeadDialog` — dialog para atribuir lead a um membro da equipe. Select com profiles ativos da org.

  **Danger Zone (na pagina de edicao):**
  - Secao visual destacada com botao "Excluir Lead" + `DeleteConfirmationDialog` (padrao crud.md regra #5).

- [ ] **Navegacao:**
  - Link "Todos os Leads" no sidebar **ja existe** (Sprint 07). Apenas garantir que aponta para `/leads` corretamente (ja confirmado).
  - Breadcrumbs: `Leads / Todos os Leads`, `Leads / Novo Lead`, `Leads / [Nome do Lead]`.

## Edge Cases

- [ ] **Estado vazio (org sem leads):** lista exibe empty state com CTA "Cadastrar primeiro lead".
- [ ] **Busca sem resultados:** tabela exibe mensagem "Nenhum lead encontrado para os filtros aplicados" com opcao de limpar filtros.
- [ ] **Lead com dados minimos (apenas nome):** form permite salvar so com nome. Colunas opcionais aparecem vazias na lista (dash ou vazio).
- [ ] **Lead com dados maximos (todos os 27 campos):** form distribui campos em tabs para nao ficar gigante. Tudo salva corretamente.
- [ ] **RLS cross-org:** user da org A tenta acessar `/leads/[id-da-org-B]` -> 404.
- [ ] **Marcar como perdido sem motivo:** dialog obriga `loss_reason_id`. Botao confirmar desabilitado ate selecionar motivo.
- [ ] **Mudar status de "lost" para outro:** limpa `loss_reason_id` e `loss_notes` automaticamente.
- [ ] **Atribuir a usuario inativo:** Select de responsavel so mostra profiles com `is_active = true`.
- [ ] **Tag desativada:** Select de tags so mostra tags com `is_active = true`. Tags ja vinculadas ao lead continuam visiveis (historico) mas nao podem ser adicionadas novamente.
- [ ] **Excluir lead com tags vinculadas:** `lead_tags` deve ser limpo (CASCADE ou manual) antes do DELETE.
- [ ] **Email duplicado na mesma org:** nao ha unique constraint no email (aceito pelo schema). Permitir duplicatas.
- [ ] **Filtros compostos:** aplicar multiplos filtros simultaneamente (status + origem + responsavel + tag + busca). Todos via query params.
- [ ] **Paginacao com filtros:** ao aplicar filtro, resetar para pagina 1.
- [ ] **Erro de rede no form:** toast de erro, manter dados preenchidos.
- [ ] **Dois tabs editando o mesmo lead:** last-write-wins (sem lock otimista). Aceitavel para MVP.
- [ ] **Valor monetario:** formatar como BRL (R$ 1.234,56) na lista. Input aceita numeros com decimais.

## Fora de escopo

- **Pipeline / Kanban** — Sprint 13 (usa `stage_id` e `card_order`, mas a tela kanban nao faz parte desta sprint).
- **Timeline / Atividades do lead** (`lead_activities`) — pos-MVP.
- **Export CSV** — roadmap marca como opcional; adiar para sprint futura.
- **Import de leads (bulk)** — nao previsto.
- **Notificacoes de atribuicao** — nao previsto.
- **i18n.** Labels em pt-BR hardcoded (padrao do app hoje).
- **Campos `stage_id` e `card_order`** — existem na tabela mas so serao manipulados na Sprint 13 (Pipeline). O form NAO exibe esses campos.

## Criterios de Aceite

- [ ] Placeholder de `/leads` substituido pela listagem real com tabela paginada.
- [ ] CRUD completo de Leads funcional: criar, listar (com busca + paginacao + filtros + sort), editar, excluir.
- [ ] Busca por nome/email/telefone/empresa funcionando com debounce.
- [ ] Filtros compostos (status, origem, responsavel, tag) funcionando via query params.
- [ ] Form com tabs (Dados / UTM / Comercial / Notas) funcional para criacao e edicao.
- [ ] Atribuicao de tags via multi-select gravando em `lead_tags` (M2M).
- [ ] Marcar como perdido com motivo obrigatorio (`loss_reason_id` + `loss_notes`).
- [ ] Atribuicao de responsavel funcional.
- [ ] Status badge colorido por tipo de status.
- [ ] Validacao Zod em todas as Server Actions.
- [ ] RLS testada cross-org: user da org A nao ve leads da org B.
- [ ] `TagBadge` reutilizado da Sprint 09 para exibir tags nos leads.
- [ ] Danger Zone na edicao com confirmacao de exclusao.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o codigo.

---

## Recomendacao de Execucao

> Esta secao e preenchida pelo `@sprint-creator` com base em rubrica objetiva. O Tech Lead le ela antes de executar e pede sua escolha binaria (Opcao 1 ou 2).

**Analise:**
- Nivel: STANDARD
- Complexity Score: **10** (DB +1: sem tabela nova mas confirmacao de FKs/CASCADE; API +4: 8 Server Actions com filtros compostos e joins multiplos + sync de tags M2M; UI +2: form com tabs, multi-select, dialogs, status badges, filtros compostos; Logica +3: filtros compostos com subquery em lead_tags, sync M2M, regra de perda com motivo obrigatorio, limpeza de loss_reason ao mudar status; Dependencias +0: tudo interno)
- Reference Module: **sim** — `src/app/(app)/leads/tags/` + `src/lib/actions/tags.ts` (padrao de CRUD)
- Integracao com API externa: **nao**
- Logica de negocio nova/ambigua: **sim** — filtros compostos com join em M2M, regra de perda obrigatoria, sync de tags, status machine
- Ambiguity Risk: **medio** — estrutura clara via Reference Module mas logica de filtros/M2M/status e nova

---

### Opcao 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead -> @db-admin (confirmacao FK/CASCADE) -> @backend (Server Actions) -> @frontend+ (UI) -> @guardian -> gates -> @git-master
- **PRD:** pulado; o proprio sprint file e o contrato
- **Modelo sugerido:** Sonnet — fluxo direto com Reference Module
- **Quando faz sentido:** se o usuario confia que o sprint file e suficientemente detalhado e quer economizar uma rodada de PRD

### Opcao 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead -> @spec-writer -> @sanity-checker (loop ate 3x) -> STOP & WAIT -> execucao identica a Opcao 1
- **PRD:** gerado em `prds/prd_leads_lista.md` e validado
- **Modelo sugerido:** Opus — cold review paga o custo pela complexidade dos filtros M2M e regras de status
- **Quando faz sentido:** logica de filtros compostos com subquery M2M e status machine sao novos no projeto; PRD pode catch ambiguidades antes da implementacao

---

**Recomendacao do @sprint-creator:** Opcao 2 — Opus

**Justificativa:**
Score 10 (>= 9) forca Opcao 2 pela rubrica. Alem disso, ha logica de negocio nova (filtros M2M via subquery, sync de tags, status machine com regra de perda obrigatoria) que nao existia em nenhum modulo anterior. Este e o modulo mais complexo do projeto ate agora — cold review do @spec-writer e @sanity-checker valem o custo para catch ambiguidades nos joins e na interacao entre status/loss_reason/tags antes de codificar.

**Aguardando escolha do usuario:** responda ao Tech Lead com `"execute opcao 1"` ou `"execute opcao 2"` (ou aceite a recomendacao dizendo apenas `"execute"`).

---

## Execucao

> Esta secao e preenchida durante a execucao. Cada agente atualiza sua linha antes de reportar conclusao ao Tech Lead. O Tech Lead atualiza as linhas de `@guardian` e `@git-master`.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ✅ Concluido | Sem migration — FKs verificadas (abordagem conservadora: delete lead_tags antes de leads) |
| Server Actions | `@backend` | ✅ Concluido | `src/lib/actions/leads.ts` (8 CRUD actions + 4 lookups + syncTags) |
| Frontend | `@frontend+` | ✅ Concluido | 11 componentes em `src/components/leads/`, 3 páginas em `src/app/(app)/leads/`, `src/components/ui/dropdown-menu.tsx` |
| Guardian | `@guardian` | ✅ Concluido | 2 violações encontradas e corrigidas (dropdown hand-rolled → Radix, botões inline → Button variant) |
| Git | `@git-master` | ▶️ Em andamento | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluido · ⏸️ Aguarda review
