# Sprint 15: WhatsApp Groups (STANDARD)

> **Nível:** STANDARD
> **Origem:** solicitação do usuário — 2026-04-21
> **Pré-requisito:** Sprint 13 (Pipeline Kanban) concluída.

---

## 🎯 Objetivo de Negócio

O sistema precisa de um cadastro de **grupos de WhatsApp** para que o admin registre e organize os grupos da organização. Cada grupo armazena o nome, descrição e o ID externo do grupo no WhatsApp (`whatsapp_id`), servindo de base para as sprints 16 (escolha de provider e mapping grupo→origem) e 17 (inbox de mensagens com webhook).

**Métrica de sucesso:** admin loga, acessa o menu "WhatsApp > Grupos", cria um grupo, edita, desativa, e a lista mostra apenas grupos da própria org via RLS.

## 👤 User Stories

- Como **admin**, eu quero cadastrar grupos de WhatsApp com nome, descrição e ID externo, para organizar os grupos que a organização usa no CRM.
- Como **admin**, eu quero ativar/desativar grupos sem excluir, para manter histórico mas sinalizar grupos que não são mais usados.
- Como **admin**, eu quero buscar grupos por nome, para encontrar rapidamente em listas grandes.
- Como **user de outra organização**, eu NÃO consigo ver nem editar grupos alheios (RLS por `organization_id`).

## 🎨 Referências Visuais

- **Layout — Lista:** [design_system/telas_prontas/_conteudo/entidade_lista.html](../../design_system/telas_prontas/_conteudo/entidade_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/_conteudo/entidade_criar.html](../../design_system/telas_prontas/_conteudo/entidade_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/_conteudo/entidade_editar.html](../../design_system/telas_prontas/_conteudo/entidade_editar.html)
- **Módulo de referência estrutural:** Lead Origins (`src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts`) — mesmo padrão de CRUD simples com toggle `is_active`. Adaptar para os campos do domínio WhatsApp.
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Textarea, Switch, Table, Dialog, Badge, etc). Usar `<Button variant="...">` do DS — **nunca** `<button className="...">` inline quando a variante já existe.

## 🧬 Reference Module Compliance

- **Módulo de referência:** `src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts`
- **O que copiar:** estrutura de arquivos, padrão de Server Actions, padrão de error handling, padrão de UI (toolbar, lista com sortable headers, form, row actions, sort-utils)
- **O que trocar:** nomes de tabela (`whatsapp_groups`), schemas Zod, campos específicos do domínio (`name`, `description`, `whatsapp_id`, `is_active`)
- **O que omitir (não existe no módulo):** campos `type` e `platform` do lead-origins — não existem em `whatsapp_groups`

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabela JÁ EXISTE, não criar migration de tabela):**
  - `whatsapp_groups` (9 colunas) — confirmadas via `docs/schema_snapshot.json`
    - `id` uuid PK, `organization_id` uuid NOT NULL, `name` text NOT NULL
    - `description` text nullable, `whatsapp_id` text nullable
    - `is_active` boolean NOT NULL default true
    - `created_at`, `updated_at` timestamptz NOT NULL, `created_by` uuid nullable
  - **Índices:** `whatsapp_groups_pkey`, `idx_whatsapp_groups_organization_id`
  - **RLS:** 4 policies já existem:
    - SELECT — "Users can view whatsapp groups of their organization"
    - INSERT — "Users can create whatsapp groups in their organization"
    - UPDATE — "Users can update whatsapp groups in their organization"
    - DELETE — "Admins can delete whatsapp groups" (só admin)
  - `@db-admin` deve confirmar no início da sprint que as policies estão corretas. Se OK, **nenhuma migration é necessária**.

- [ ] **Server Actions (`src/lib/actions/whatsapp-groups.ts`):**
  - Seguir templates de `docs/templates/server_actions.md` e contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - Usar Lead Origins (`src/lib/actions/lead-origins.ts`) como referência direta — adaptar nomes e campos.
  - `getWhatsappGroupsAction({ search?, isActive?, page?, pageSize? })` — lista paginada (default 20/página). Busca por `name` (ILIKE). Filtro: `is_active`. Ordena por `created_at DESC`. Retorna `ActionResponse<{ data: WhatsappGroupRow[]; metadata: PaginationMeta }>`.
  - `getWhatsappGroupByIdAction(id)` — retorna grupo por ID. 404 se não pertence à org (via RLS).
  - `createWhatsappGroupAction(input)` — valida via Zod, seta `organization_id` via `getSessionContext()`.
  - `updateWhatsappGroupAction(id, input)` — atualiza campos editáveis.
  - `deleteWhatsappGroupAction(id)` — **hard delete** (RLS restringe a admins no banco).
  - `toggleWhatsappGroupActiveAction(id)` — alterna `is_active`.
  - **Validação Zod:** `name` 2-100 chars, `description` ≤500 chars opcional, `whatsapp_id` ≤100 chars opcional, `is_active` boolean opcional.

### Frontend

- [ ] **Rotas (seguir paths canônicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/whatsapp-groups/layout.tsx` — layout com `DashboardShell` (obrigatório, criar primeiro).
  - `src/app/(app)/whatsapp-groups/page.tsx` — listagem (Server Component).
  - `src/app/(app)/whatsapp-groups/new/page.tsx` — criação.
  - `src/app/(app)/whatsapp-groups/[id]/page.tsx` — edição.

- [ ] **Componentes (`src/components/whatsapp-groups/`):**
  - `WhatsappGroupsList` — tabela com colunas: Nome, Descrição (truncada), WhatsApp ID, Status (badge ativo/inativo), Criado em, Ações. Empty state ("Nenhum grupo cadastrado — crie o primeiro"). Toolbar: busca debounced 300ms + CTA "Novo Grupo".
  - `WhatsappGroupForm` — campos: name (Input), description (Textarea), whatsapp_id (Input, label "ID do Grupo no WhatsApp"), is_active (Switch). Danger zone na página de edição com botão de excluir.
  - `WhatsappGroupRowActions` — menu de ações por linha (editar, ativar/desativar, excluir com confirmação).
  - `WhatsappGroupsToolbar` — busca + filtro is_active + CTA.
  - `WhatsappGroupsSortableHeader` — headers clicáveis com indicador de direção.
  - `sort-utils.ts` — helpers de ordenação (seguir padrão de `src/components/lead-origins/sort-utils.ts`).
  - **Regras de UI obrigatórias (de `docs/conventions/crud.md`):** URL como fonte de verdade para paginação/filtros/busca (regra #2), paginação server-side (regra #3), toast em toda operação com side-effect (regra #4), danger zone na edição (regra #5), sem `router.refresh()` (regra #7).

- [ ] **Navegação (`src/components/layout/Sidebar.tsx`):**
  - Transformar o item "WhatsApp" (hoje `{ href: '#', label: 'WhatsApp', icon: MessageCircle, badge: '3' }`) em item com children, seguindo o mesmo padrão do grupo "Leads".
  - Remover `href: '#'` e `badge: '3'`.
  - Adicionar `children: [{ href: '/whatsapp-groups', label: 'Grupos' }]`.
  - O ícone `MessageCircle` já está importado — manter.
  - Resultado esperado: grupo expansível "WhatsApp" com submenu "Grupos".

## 🧪 Edge Cases (obrigatório listar)

- [ ] **Estado vazio (org sem grupos):** lista exibe empty state com CTA "Cadastrar primeiro grupo".
- [ ] **RLS cross-org:** user da org A tenta acessar `/whatsapp-groups/{id-da-org-B}` → 404 via RLS.
- [ ] **Nome duplicado:** permitido — não há constraint UNIQUE em `name`. UI não precisa bloquear.
- [ ] **`whatsapp_id` vazio:** coluna nullable, campo opcional no form. Salva `null` quando não preenchido.
- [ ] **Não-admin tenta deletar:** RLS bloqueia no banco. Server Action retorna `success: false` com mensagem amigável. UI não precisa esconder o botão — o guardião é o banco.
- [ ] **Erro de rede no form:** toast de erro, mantém dados preenchidos.
- [ ] **Dois tabs editando o mesmo grupo:** last-write-wins (sem lock otimista). Aceitável.
- [ ] **Reativar grupo desativado:** funciona via `toggleWhatsappGroupActiveAction` — mesmo fluxo do desativar.

## 🚫 Fora de escopo

- **Integração com provider WhatsApp** (Evolution API, Z-API, Cloud API) — Sprint 16.
- **Mapping grupo ↔ lead_origin** — removido por decisão no roadmap (diff de 2026-04-21).
- **Inbox de mensagens / webhook** — Sprint 17.
- **Sincronização automática de membros do grupo** — depende de provider (Sprint 16+).
- **Permissões granulares por role na UI** — RLS já protege DELETE. Esconder botão por role é melhoria futura.
- **Soft delete via `deleted_at`** — coluna não existe na tabela. Desativar = `is_active = false`.
- **i18n.** Labels em pt-BR hardcoded (padrão do app hoje).

## ⚠️ Critérios de Aceite

- [ ] CRUD completo funcional: criar, listar (com busca + paginação + filtro is_active), editar, desativar (toggle), excluir (hard delete).
- [ ] Validação Zod em todas as Server Actions.
- [ ] RLS testada cross-org: user da org A não vê grupos da org B.
- [ ] Menu "WhatsApp" aparece no sidebar como grupo expansível com submenu "Grupos" apontando para `/whatsapp-groups`.
- [ ] Design alinhado com telas prontas genéricas e com Lead Origins como referência estrutural. Nenhum hex/arbitrary class/botão inline.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o código.

---

## 🤖 Recomendação de Execução

> Esta seção foi preenchida pelo `@sprint-creator` com base em rubrica objetiva. O Tech Lead lê ela antes de executar e pede sua escolha binária (Opção 1 ou 2).

**Análise:**
- Nível: STANDARD
- Complexity Score: **4** (DB +0: tabela já existe com RLS; API +2: Server Actions CRUD padrão; UI +2: novo módulo lista + form; Lógica +0: sem regra de negócio nova; Dependências +0)
- Reference Module: **sim** — `src/app/(app)/leads-origins/` + `src/lib/actions/lead-origins.ts`
- Integração com API externa: **não**
- Lógica de negócio nova/ambígua: **não** — CRUD puro com toggle is_active
- Ambiguity Risk: **baixo** — schema claro, 9 colunas diretas, padrão CRUD estabelecido

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @frontend+ → @guardian → gates → @git-master
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** Sonnet 4.6 — Reference Module presente, padrões estabelecidos
- **Quando faz sentido:** tabela já existe com RLS, CRUD segue exatamente o padrão do projeto, sem componente novo relevante além de lista + form básicos

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → execução idêntica à Opção 1
- **PRD:** gerado em `prds/prd_whatsapp_groups.md` e validado
- **Modelo sugerido:** Opus
- **Quando faz sentido:** se houver dúvida sobre UX do formulário ou se o time quiser documentação formal antes de implementar

---

**Recomendação do @sprint-creator:** Opção 1 — Sonnet 4.6

**Justificativa:**
Score 4 com Reference Module presente encaixa na regra 5 da rubrica (score ≤5 AND sem lógica nova → Opção 1 sugerida). A tabela já existe com RLS validada, todos os campos são tipos primitivos simples, e o padrão de CRUD está estabelecido em pelo menos 4 módulos anteriores (origens, tags, motivos de perda, funnels). A única adição fora do padrão é a mudança de navegação no Sidebar — mecânica e clara. PRD não agrega valor aqui.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).

---

## 🔄 Execução

> Esta seção é preenchida durante a execução. Cada agente atualiza sua linha antes de reportar conclusão ao Tech Lead.

| Etapa | Agente | Status | Artefatos |
|---|---|---|---|
| Banco de dados | `@db-admin` | ⬜ Pendente | — |
| Server Actions | `@backend` | ⬜ Pendente | — |
| Frontend | `@frontend+` | ⬜ Pendente | — |
| Guardian | `@guardian` | ⬜ Pendente | — |
| Git | `@git-master` | ⬜ Pendente | — |

**Legenda:** ⬜ Pendente · ▶️ Em andamento · ✅ Concluído · ⏸️ Aguarda review
