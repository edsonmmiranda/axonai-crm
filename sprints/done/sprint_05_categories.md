# Sprint 05: Categories (STANDARD)

> **Nível:** STANDARD
> **Origem:** `docs/roadmap.md` — Sprint 05
> **Pré-requisito:** Sprint 04 (auth + tenancy) concluída — `getSessionContext()` disponível.

---

## 🎯 Objetivo de Negócio

Admin da organização precisa classificar produtos por categoria (eletrônicos, moda, serviços, etc). Sem categorias, a Sprint 06 (Products) não tem como filtrar nem organizar o catálogo. Esta sprint entrega o primeiro CRUD de negócio do app: simples, escopo pequeno, mas cobre o caminho completo (RLS + Server Action + Zod + form + lista + design system) que os próximos CRUDs vão reusar.

**Métrica de sucesso:** admin loga, cria 5 categorias, edita 1, desativa 1, lista volta com filtro de ativas — tudo respeitando `organization_id` via RLS.

## 👤 User Stories

- Como **admin**, eu quero criar categorias com nome e descrição, para organizar o catálogo de produtos.
- Como **admin**, eu quero desativar uma categoria sem perdê-la, para preservar histórico de produtos já vinculados (mesmo que Products venha só na Sprint 06).
- Como **admin**, eu quero buscar categoria pelo nome, para encontrar rapidamente em listas longas.
- Como **user de outra organização**, eu NÃO consigo ver nem editar categorias da organização alheia (RLS).

## 🎨 Referências Visuais

- **Layout — Lista:** [design_system/telas_prontas/leads_lista.html](design_system/telas_prontas/leads_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/leads_criar.html](design_system/telas_prontas/leads_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/leads_editar.html](design_system/telas_prontas/leads_editar.html)
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Textarea, Switch, Table, etc).

## 🧬 Reference Module Compliance

**Não aplicável.** Este é o primeiro módulo CRUD de negócio do app. Não há módulo existente para copiar. O `@backend` deve estabelecer o padrão de Server Actions (naming, `ActionResponse`, validação Zod, uso de `getSessionContext()`) conforme [docs/conventions/standards.md](docs/conventions/standards.md) e [docs/conventions/crud.md](docs/conventions/crud.md) — sem inventar padrão novo.

> ⚠️ Esta sprint **não é Gold Standard**. É warm-up. A referência estrutural autoritativa continua sendo o que estiver documentado em `docs/conventions/`.

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados:**
  - Tabela: `categories` — **já existe, RLS já ativa, não criar migration.**
  - Colunas confirmadas via [docs/schema_snapshot.json](docs/schema_snapshot.json):
    - `id` uuid PK · `organization_id` uuid NOT NULL · `name` text NOT NULL · `slug` text NOT NULL · `description` text NULL · `active` boolean DEFAULT true · `created_at` timestamptz · `updated_at` timestamptz
  - Índices existentes: `name`, `organization_id`, `slug`, **UNIQUE (`organization_id`, `slug`)**
  - RLS: assumida ativa por `organization_id`. **`@db-admin` deve confirmar políticas no início da sprint** — se faltar alguma política (SELECT/INSERT/UPDATE/DELETE por `organization_id = get_current_org()`), criar migration idempotente só para as policies.
  - Nenhuma DDL esperada. Se `@db-admin` detectar divergência entre snapshot e banco, parar e reportar.

- [ ] **Server Actions (`src/lib/actions/categories.ts`):**
  - `getCategoriesAction({ search?, activeOnly?, page?, pageSize? })` — lista paginada (default 20/página), busca por `name` (ILIKE), filtro `active` (default: só ativas). Retorna `{ data, total, page, pageSize }`.
  - `getCategoryByIdAction(id)` — retorna categoria ou erro 404 se não pertence à org.
  - `createCategoryAction({ name, description?, active? })` — valida via Zod, gera `slug` a partir de `name` (kebab-case, unaccent, fallback numérico se colidir com slug existente na org), seta `organization_id` via `getSessionContext()`.
  - `updateCategoryAction(id, { name, description?, active? })` — se `name` mudou, regenera `slug`. Bloqueia update cross-org via RLS + validação explícita.
  - `deleteCategoryAction(id)` — **soft delete:** seta `active = false`. Não executa `DELETE` físico.
  - `restoreCategoryAction(id)` — seta `active = true`.
  - Todas as actions retornam `ActionResponse<T>` conforme contrato em [docs/conventions/standards.md](docs/conventions/standards.md).
  - Validação Zod: `name` min 2 / max 80 · `description` max 500 · `active` boolean.

- [ ] **Helper compartilhado:**
  - `src/lib/actions/_shared/slugify.ts` — função pura `slugify(input: string): string` (lowercase + unaccent + kebab). Reutilizável por Products (Sprint 06) e outros módulos. Cobrir com teste unitário simples se `@backend` achar pertinente.

### Frontend

- [ ] **Rotas:**
  - `src/app/(app)/settings/catalog/categories/page.tsx` — listagem (Server Component + Client Table).
  - `src/app/(app)/settings/catalog/categories/new/page.tsx` — criação.
  - `src/app/(app)/settings/catalog/categories/[id]/page.tsx` — edição.

- [ ] **Componentes (`src/components/categories/`):**
  - `CategoriesList` — tabela com colunas: Nome · Slug · Descrição (truncada) · Status (badge ativo/inativo) · Criado em · Ações (editar, desativar/restaurar). Baseada em `leads_lista.html`.
  - `CategoryForm` — campos: `name` (input), `slug` (input read-only, exibe preview auto-gerado), `description` (textarea), `active` (switch). Usa react-hook-form + zodResolver. Compartilhado entre `new` e `[id]`.
  - Estados: loading skeleton, empty state ("Nenhuma categoria ainda — crie a primeira"), error state.
  - Toolbar da lista: busca por texto (debounce 300ms) + toggle "Mostrar inativas".

- [ ] **Navegação:**
  - Adicionar item "Configurações > Catálogo > Categorias" no menu lateral existente (`src/components/layout/Sidebar.tsx` ou equivalente).
  - Breadcrumbs: `Configurações / Catálogo / Categorias / [Novo | Nome da categoria]`.

## 🧪 Edge Cases

- [ ] **Estado vazio (org sem categorias):** lista exibe empty state com CTA "Criar primeira categoria".
- [ ] **Slug duplicado na mesma org:** gerador adiciona sufixo numérico (`eletronicos-2`, `eletronicos-3`). Erro Postgres `23505` (unique violation) capturado com mensagem legível.
- [ ] **Nome vazio ou < 2 chars:** validação Zod bloqueia antes de submit, feedback inline por campo.
- [ ] **RLS cross-org:** usuário da org A não consegue `SELECT`/`UPDATE`/`DELETE` categoria da org B. Tentativa retorna 404 (não 403, para não vazar existência).
- [ ] **Desativar categoria com produtos vinculados:** por ora **não há** tabela `products` ligada (Sprint 06 virá depois). Documentar no código (comentário de uma linha em `deleteCategoryAction`) que quando Products existir, decidir entre: bloquear desativação **ou** permitir e filtrar produtos órfãos na UI de produtos. **Não implementar guarda agora.**
- [ ] **Dois tabs editando a mesma categoria:** last-write-wins (aceitável para escopo atual). Não implementar lock otimista.
- [ ] **Erro de rede no form:** exibir toast de erro, manter dados do form preenchidos.

## 🚫 Fora de escopo

- **Hard delete** (DELETE físico da linha). Delete sempre é `active = false`.
- **Migrations de schema** — tabela já existe.
- **Vínculo com produtos** — Sprint 06.
- **Bulk actions** (desativar em massa, import CSV, export). Se surgir demanda, sprint separada.
- **Hierarquia de categorias** (parent/child). Tabela não tem `parent_id`, não criar.
- **Reordenação manual / `position`.** Não há coluna na tabela.
- **Histórico/auditoria de quem alterou.** Pós-MVP.
- **i18n.** Labels em pt-BR hardcoded (padrão do app hoje).

## ⚠️ Critérios de Aceite

- [ ] CRUD completo funcional: criar, listar (com busca + filtro active), editar, desativar (soft), restaurar.
- [ ] Validação Zod em todas as 6 Server Actions.
- [ ] RLS testada: criar categoria logado como user da org A, tentar acessar pelo id como user da org B → 404.
- [ ] Slug auto-gerado é único por org (sufixo numérico em colisão).
- [ ] Todos os edge cases acima tratados.
- [ ] Design alinhado com `leads_lista.html` / `leads_criar.html` / `leads_editar.html` via tokens semânticos.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único para compliance de design system conforme [agents/quality/guardian.md](agents/quality/guardian.md).

---

## 🧭 Notas para o Tech Lead

Sprint STANDARD segue **Workflow A (Sprint Execution)** completo:

1. Preflight checks (git limpo, `.env.local` OK, snapshot fresco).
2. `@db-admin` — confirma RLS de `categories` antes de qualquer código. Se faltar policy, migration idempotente só de policies.
3. `@spec-writer` gera PRD em `docs/prds/sprint_05_categories.md`.
4. `@sanity-checker` valida PRD.
5. **STOP & WAIT** pela aprovação do usuário.
6. Execução: `@backend` (actions + slugify helper) → `@frontend` (rotas + componentes + sidebar) → `@guardian`.
7. Design verification manual contra as 3 refs HTML.
8. Closing: registrar em `docs/APRENDIZADOS.md` **apenas** se algo não-óbvio aparecer (ex: comportamento de RLS inesperado, pegadinha no slug).
9. `@git-master` para commit.
