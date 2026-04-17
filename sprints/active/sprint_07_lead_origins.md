# Sprint 07: Lead Origins

> **Nivel:** LIGHT
> **Origem:** `docs/roadmap.md` — Sprint 07
> **Pre-requisito:** Sprint 06 (Products + Storage) concluida.

---

## Objetivo de Negocio

Admin precisa cadastrar e gerenciar as **origens dos leads** (ex.: site, indicacao, Google Ads, WhatsApp, Instagram, evento) para que, ao criar um lead (Sprint 10), seja possivel vincular de onde ele veio. Sem origens cadastradas, o modulo de Leads nao tem como rastrear a fonte de captacao — metrica essencial para ROI de marketing.

Alem do CRUD, esta sprint **cria o menu "Leads" no sidebar** com 4 submenus (Todos os Leads, Origens, Tags, Motivos de Perda). Apenas "Origens" estara funcional — os demais ficam visiveis mas apontam para paginas placeholder. Isso prepara a navegacao para as sprints 08-10.

**Metrica de sucesso:** admin loga, acessa Leads > Origens, cria 3 origens com tipos diferentes (ex.: `online`/`offline`/`referral`), edita uma, desativa outra, e a lista mostra apenas origens da propria org via RLS.

## User Stories

- Como **admin**, eu quero cadastrar origens de lead com nome, tipo e plataforma, para categorizar de onde os leads vem.
- Como **admin**, eu quero ativar/desativar origens sem excluir, para manter historico mas impedir uso em novos leads.
- Como **admin**, eu quero buscar origens por nome, para encontrar rapido em listas grandes.
- Como **user de outra organizacao**, eu NAO consigo ver nem editar origens alheias (RLS por `organization_id`).
- Como **qualquer usuario**, eu quero ver o menu "Leads" no sidebar com submenus, para navegar facilmente entre os modulos de leads.

## Referencias Visuais

- **Layout — Lista:** [design_system/telas_prontas/leads_lista.html](../../design_system/telas_prontas/leads_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/leads_criar.html](../../design_system/telas_prontas/leads_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/leads_editar.html](../../design_system/telas_prontas/leads_editar.html)
- **Design system:** tokens semanticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](../../design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](../../design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Select, Switch, Table, Dialog, Badge, etc).

## Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabela JA EXISTE, nao criar migration de tabela):**
  - `lead_origins` (8 colunas) — confirmadas via `docs/schema_snapshot.json`:
    - `id` uuid PK (gen_random_uuid()) · `organization_id` uuid NOT NULL · `name` text NOT NULL · `type` text NOT NULL · `platform` text nullable · `is_active` boolean DEFAULT true · `created_at` timestamptz DEFAULT now() · `updated_at` timestamptz DEFAULT now()
    - UNIQUE: `(organization_id, name)` (indice `lead_origins_name_org_unique`)
  - **RLS:** 4 policies ja existem (SELECT/INSERT/UPDATE/DELETE por org). `@db-admin` deve confirmar no inicio da sprint que as policies enforcam `organization_id` corretamente. Se estiver OK, **nenhuma migration e necessaria**.

- [ ] **Server Actions (`src/lib/actions/lead-origins.ts`):**
  - Seguir os templates de `docs/templates/server_actions.md` e o contrato `ActionResponse<T>` de `docs/conventions/standards.md`.
  - `getLeadOriginsAction({ search?, type?, isActive?, page?, pageSize? })` — lista paginada (default 20/pagina). Busca por `name` (ILIKE). Filtros: `type`, `is_active`. Ordena por `created_at DESC`. Retorna `ActionResponse<{ data: LeadOrigin[]; metadata: PaginationMeta }>`.
  - `getLeadOriginByIdAction(id)` — retorna origem por ID. 404 se nao pertence a org (via RLS).
  - `createLeadOriginAction(input)` — valida via Zod, seta `organization_id` via `getSessionContext()`. Captura erro Postgres `23505` (name_org_unique) e retorna mensagem legivel "Ja existe uma origem com esse nome nesta organizacao".
  - `updateLeadOriginAction(id, input)` — mesma captura de duplicata.
  - `deleteLeadOriginAction(id)` — **soft delete:** seta `is_active = false`. Nao exclui do banco.
  - `restoreLeadOriginAction(id)` — seta `is_active = true`.
  - **Validacao Zod:** `name` 2-100 chars · `type` string 1-50 chars · `platform` opcional, max 100 chars · `is_active` boolean.

### Frontend

- [ ] **Rotas (seguir paths canonicos de `docs/conventions/crud.md`):**
  - `src/app/(app)/leads/layout.tsx` — layout obrigatorio do modulo (regra dura #1 de crud.md).
  - `src/app/(app)/leads/origins/page.tsx` — listagem (Server Component).
  - `src/app/(app)/leads/origins/new/page.tsx` — criacao.
  - `src/app/(app)/leads/origins/[id]/page.tsx` — edicao.
  - `src/app/(app)/leads/page.tsx` — placeholder "Todos os Leads" (pagina simples com mensagem "Em breve").
  - `src/app/(app)/leads/tags/page.tsx` — placeholder "Tags".
  - `src/app/(app)/leads/loss-reasons/page.tsx` — placeholder "Motivos de Perda".

- [ ] **Componentes (`src/components/lead-origins/`):**
  - `LeadOriginsList` — tabela com colunas: Nome · Tipo · Plataforma · Status (badge ativo/inativo) · Criado em · Acoes (editar, desativar/ativar). Empty state ("Nenhuma origem cadastrada — crie a primeira"). Toolbar: busca debounced 300ms + select de tipo + CTA "Nova Origem".
  - `LeadOriginForm` — campos: name (Input), type (Select ou Input com sugestoes — ex: online, offline, referral, social, evento, outro), platform (Input — ex: Google Ads, Instagram, WhatsApp, Site), is_active (Switch). Validacao client-side antes do submit (regra dura #6 de crud.md).
  - `LeadOriginRowActions` — menu de acoes por linha (editar, ativar/desativar).
  - **Regras de UI obrigatorias (de crud.md):** URL como fonte de verdade para paginacao/filtros/busca (regra #2), paginacao server-side (regra #3), toast em toda operacao com side-effect (regra #4), danger zone na edicao (regra #5), sem `router.refresh()` (regra #7).

- [ ] **Navegacao — Sidebar com submenus:**
  - Reestruturar `src/components/layout/Sidebar.tsx` para suportar **itens com filhos (submenus colapsaveis)**.
  - Item "Leads" (icone `Users`) passa a ter 4 filhos:
    1. Todos os Leads (`/leads`) — placeholder
    2. Origens (`/leads/origins`) — funcional
    3. Tags (`/leads/tags`) — placeholder
    4. Motivos de Perda (`/leads/loss-reasons`) — placeholder
  - O item "Leads" no nivel pai **nao tem href proprio** — clicar expande/colapsa os filhos. O highlight ativo segue a rota filha.
  - Breadcrumbs: `Leads / Origens / [Nova | Nome da origem]`.

## Edge Cases

- [ ] **Estado vazio (org sem origens):** lista exibe empty state com CTA "Cadastrar primeira origem".
- [ ] **Nome duplicado na mesma org:** validacao Zod client-side basica + captura de erro `23505` no servidor -> toast "Ja existe uma origem com esse nome" e foco no campo nome.
- [ ] **Origem sem plataforma:** permitido (`platform` e nullable). Lista mostra "—" na coluna.
- [ ] **RLS cross-org:** user da org A tenta acessar `/leads/origins/{id-da-org-B}` -> 404.
- [ ] **Desativar origem que ja esta vinculada a leads (futuro):** permitido — a origem continua no historico do lead, apenas nao aparece como opcao para novos leads. Essa logica sera implementada na Sprint 10 (Leads), nao nesta.
- [ ] **Erro de rede no form:** toast de erro, mantem dados preenchidos.
- [ ] **Dois tabs editando a mesma origem:** last-write-wins (sem lock otimista). Aceitavel.
- [ ] **Placeholder pages (Leads, Tags, Motivos de Perda):** devem renderizar dentro do AppLayout com sidebar e breadcrumbs. Nao devem dar 404.

## Fora de escopo

- **CRUD de Leads** — Sprint 10.
- **CRUD de Tags** — Sprint 09.
- **CRUD de Motivos de Perda** — Sprint 08.
- **Vinculacao origem <-> lead** — Sprint 10 (FK `origin_id` em `leads`).
- **Bulk import de origens** — nao previsto.
- **Icones ou logos por origem/plataforma** — fora. Apenas texto.
- **i18n.** Labels em pt-BR hardcoded (padrao do app hoje).
- **Enum rigido para `type`** — o banco e `text`; nao criar enum SQL. Sugestoes na UI, mas aceita valor livre.

## Criterios de Aceite

- [ ] CRUD completo de Lead Origins funcional: criar, listar (com busca + filtro por tipo + paginacao), editar, desativar (soft), restaurar.
- [ ] Validacao Zod em todas as Server Actions.
- [ ] RLS testada cross-org: user da org A nao ve origens da org B.
- [ ] Nome unico por org enforcado (erro `23505` capturado e exibido legivelmente).
- [ ] Menu "Leads" no sidebar com 4 submenus colapsaveis. "Origens" funcional, demais placeholder.
- [ ] Paginas placeholder renderizam corretamente dentro do AppLayout.
- [ ] Design alinhado com `leads_lista.html` / `leads_criar.html` / `leads_editar.html` via tokens semanticos. Nenhum hex/arbitrary class.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] Guardian aprova o codigo.

---

## Recomendacao de Execucao

**Analise:**
- Nivel: LIGHT
- Complexity Score: **6** (DB +1: tabela ja existe, apenas confirmar RLS; API +2: 6 Server Actions seguindo templates do framework; UI +2: form simples + lista padrao; Logica +0: sem regra de negocio nova; Dependencias +1: sidebar reestruturado com submenus)
- Integracao com API externa: **nao**
- Logica de negocio nova/ambigua: **nao** — CRUD puro com soft-delete

**Opcao 1 forçada** (LIGHT). Fluxo: Tech Lead -> @db-admin (confirmacao RLS) -> @backend (seguindo templates do framework) -> @frontend (seguindo crud.md + design system) -> @guardian -> gates -> @git-master
