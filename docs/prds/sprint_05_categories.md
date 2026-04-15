# PRD: Categories (CRUD — primeiro módulo de negócio)

**Template:** PRD_COMPLETE
**Complexity Score:** 12 points
**Sprint:** 05
**Created:** 2026-04-15
**Status:** Draft

---

## 1. Overview

### Business Goal
Permitir que o admin da organização classifique produtos por categoria. Sem categorias, Sprint 06 (Products) não tem como organizar catálogo. Esta sprint entrega o primeiro CRUD de negócio e estabelece o padrão (Server Actions + Zod + RLS + form + lista) que os próximos módulos vão copiar.

### User Stories
- Como **admin**, eu quero criar categorias com nome e descrição, para organizar o catálogo de produtos.
- Como **admin**, eu quero desativar uma categoria sem perdê-la (soft delete), para preservar histórico.
- Como **admin**, eu quero buscar categoria pelo nome (debounce 300ms), para achar rápido em listas longas.
- Como **usuário da org B**, eu NÃO consigo ler nem editar categorias da org A (RLS).

### Success Metrics
- Admin cria 5 categorias, edita 1, desativa 1, restaura 1 em < 2 minutos.
- Tentativa cross-org retorna 404 (não 403 — não vaza existência).
- Build + lint + Guardian verdes ao fim do sprint.

---

## 2. Database Requirements

### New Tables
Nenhuma.

### Modified Tables
Nenhuma.

### Existing Tables Used

#### Table: `categories`
**Status per `docs/schema_snapshot.json`:** já existe com RLS ativa e 4 policies (SELECT/INSERT/UPDATE/DELETE por `organization_id`).

**Fields accessed:** `id`, `organization_id`, `name`, `slug`, `description`, `active`, `created_at`, `updated_at`.

**Indexes relevantes:**
- `categories_organization_id_idx` (filtro por org)
- `categories_name_idx` (busca/ordenação por nome)
- `categories_slug_key` **UNIQUE (organization_id, slug)** — fonte do erro `23505` em colisão de slug

**RLS assumida correta via snapshot.** `@db-admin` deve verificar presença das 4 policies no passo 1. Se alguma faltar, criar migration idempotente (`DROP POLICY IF EXISTS` + `CREATE POLICY`) apenas para as policies faltantes. Nenhuma DDL de coluna esperada.

> **Nota registrada em APRENDIZADOS (2026-04-15 · [SUPABASE]):** `get_table_policies` não expõe `polwithcheck` — não auditar via probe; validar pelas 4 policies por nome/comando no snapshot.

---

## 3. API Contract

### Server Actions — arquivo: `src/lib/actions/categories.ts`

Todas retornam `ActionResponse<T>` (contrato canônico em [`docs/conventions/standards.md`](../conventions/standards.md)). Todas:
1. Validam input com Zod antes de qualquer lógica
2. Chamam `getSessionContext()` para obter `organizationId` e `userId`
3. Usam `createClient()` (anon, RLS-aware) por padrão — não usar service-role exceto onde RLS for insuficiente (não é o caso aqui)
4. Envolvem tudo em `try/catch`, logam `console.error('[categories:<op>]', err)` e retornam mensagem amigável
5. Chamam `revalidatePath('/settings/catalog/categories')` após mutação

### Zod schemas

```typescript
const NameSchema = z.string().trim().min(2, 'Nome precisa de ao menos 2 caracteres').max(80, 'Máximo 80 caracteres');
const DescriptionSchema = z.string().trim().max(500, 'Máximo 500 caracteres').optional();
const ActiveSchema = z.boolean().optional();

const CreateCategorySchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  active: ActiveSchema,
});

const UpdateCategorySchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  active: ActiveSchema,
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(80).optional(),
  activeOnly: z.boolean().optional().default(true),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});
```

### Row type

```typescript
export interface CategoryRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
```

### Actions

#### `getCategoriesAction(params)`
- Input: `{ search?, activeOnly? = true, page? = 1, pageSize? = 20 }`
- Query: `.from('categories').select('id, organization_id, name, slug, description, active, created_at, updated_at', { count: 'exact' })`
  - Se `search` presente: `.ilike('name', \`%${search}%\`)`
  - Se `activeOnly === true`: `.eq('active', true)`
  - `.order('name', { ascending: true })`
  - `.range((page-1)*pageSize, page*pageSize - 1)`
- Output: `ActionResponse<CategoryRow[]>` com `metadata: { total, totalPages, currentPage, itemsPerPage }` via campo `metadata` do contrato.

#### `getCategoryByIdAction(id)`
- Input: `z.string().uuid()`
- Query: `.eq('id', id).single()` — RLS garante isolamento. Se `error` ou `!data`, retornar `{ success: false, error: 'Categoria não encontrada' }` (não distinguir "não existe" de "outra org" — 404 genérico).

#### `createCategoryAction(input)`
- Valida `CreateCategorySchema`
- Gera slug:
  1. `const base = slugify(input.name)` (helper em `src/lib/actions/_shared/slugify.ts`)
  2. Busca slugs existentes na org com prefixo `base`: `.select('slug').eq('organization_id', ctx.organizationId).like('slug', \`${base}%\`)`
  3. Se `base` não colide → usa `base`. Senão, acha o próximo sufixo livre (`base-2`, `base-3`, ...).
- Insere via `supabase.from('categories').insert({ organization_id: ctx.organizationId, name, slug, description, active: active ?? true })`.
- Captura erro `23505` (corrida de slug) → retry uma vez incrementando sufixo; se persistir, retornar erro amigável.
- Output: `ActionResponse<CategoryRow>`

#### `updateCategoryAction(id, input)`
- Valida `UpdateCategorySchema`
- Lê categoria atual (`getCategoryByIdAction` reaproveita; se 404, propaga)
- Se `input.name !== current.name`, regenera slug (mesma lógica do create)
- `update({ name, slug, description, active })` `.eq('id', id)` (RLS filtra cross-org)
- Captura `23505` igual ao create.

#### `deleteCategoryAction(id)` — soft delete
- `update({ active: false }).eq('id', id)` via RLS
- Comentário de uma linha: `// Sprint 06 (Products): decidir entre bloquear desativação com produtos vinculados OU filtrar órfãos na UI de produtos.`
- Output: `ActionResponse<{ ok: true }>`

#### `restoreCategoryAction(id)`
- `update({ active: true }).eq('id', id)`
- Output: `ActionResponse<{ ok: true }>`

### Helper compartilhado

`src/lib/actions/_shared/slugify.ts`:
```typescript
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
```
Função pura, reusável em Sprint 06+. Teste unitário não obrigatório neste sprint (framework não tem vitest). `@backend` pode adicionar se julgar pertinente.

---

## 4. External API Integration

**Não aplicável.** Esta sprint não consome nenhuma API externa.

---

## 5. Componentes de UI

Todos os componentes seguem [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). Tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Dark mode desde o primeiro commit. Focus visible obrigatório.

### Component Tree

```
/settings/catalog/categories (list)
└── CategoriesPage (Server Component)
    └── AppLayout
        └── CategoriesList (Client)
            ├── CategoriesToolbar (search input + active toggle + "Nova categoria" Button)
            ├── Table / Card grid (from src/components/ui)
            │   └── CategoryRow × N (com DropdownMenu de ações: Editar, Desativar/Restaurar)
            ├── EmptyState (quando total === 0)
            └── Pagination

/settings/catalog/categories/new (create)
└── NewCategoryPage (Server Component)
    └── AppLayout
        └── CategoryForm (Client, mode="create")

/settings/catalog/categories/[id] (edit)
└── EditCategoryPage (Server Component, carrega via getCategoryByIdAction)
    └── AppLayout
        └── CategoryForm (Client, mode="edit", initialData)
            └── DangerZone (desativar/restaurar via DeleteConfirmationDialog)
```

### CategoriesList
**File:** `src/components/categories/CategoriesList.tsx`

**Props:**
```typescript
interface Props {
  data: CategoryRow[];
  metadata: PaginationMeta;
  searchParams: { search?: string; activeOnly?: string; page?: string };
}
```

**DS components usados:** `Table`, `Badge`, `Button`, `DropdownMenu`, `Input` (busca), `Switch` (toggle "mostrar inativas"), `Skeleton` (loading), de `src/components/ui/`.

**Tokens:** `bg-surface-raised` (card/table), `text-text-primary`/`text-text-secondary`, `border-default`, `bg-feedback-success-bg`/`text-feedback-success-fg` (badge ativo), `bg-feedback-neutral-bg`/`text-feedback-neutral-fg` (badge inativo).

**Estado:** busca controlada por query param `?search=` (URL = fonte da verdade, conforme CRUD regra 2). Debounce 300ms antes de `router.push`.

**Comportamento:**
- On mount: lê `searchParams`, dispara `getCategoriesAction` (via Server Component parent)
- On search: atualiza URL → RSC re-renderiza
- On toggle "Mostrar inativas": flip `activeOnly` no URL
- On click "Editar": `router.push(/settings/catalog/categories/${id})`
- On click "Desativar"/"Restaurar": dispara action correspondente + toast

### CategoryForm
**File:** `src/components/categories/CategoryForm.tsx`

**Props:**
```typescript
interface Props {
  mode: 'create' | 'edit';
  initialData?: CategoryRow;
}
```

**DS components usados:** `Input`, `Textarea`, `Switch`, `Button`, `Label`, wrapper de `FormField` existente (se houver, senão replicar padrão de `OrganizationForm` da Sprint 04).

**Libraries:** `react-hook-form` + `zodResolver` (mesmo padrão do ProfileForm da Sprint 04).

**Campos:**
- `name` (Input, obrigatório, min 2/max 80)
- `slug` (Input, readonly, preview auto-gerado via `slugify(watch('name'))`)
- `description` (Textarea, opcional, max 500)
- `active` (Switch, default `true` no create; edit exibe estado atual)

**Estados:**
- `isSubmitting` (botão mostra spinner)
- `fieldErrors` (inline, limpam no onChange)
- `formError` (genérico do server, toast)

**Comportamento:**
- Client-side: `zodResolver` bloqueia submit se inválido
- On submit: chama `createCategoryAction` ou `updateCategoryAction`
- On success: toast success + `router.push('/settings/catalog/categories')`
- On error: toast error + mantém dados do form
- DangerZone (só em `mode='edit'`): botão "Desativar categoria" abre `DeleteConfirmationDialog` (digitar "desativar"). Se já inativa, mostra "Restaurar categoria" sem confirmação extra.

### Navegação
**File:** atualizar `src/components/settings/SettingsSidebar.tsx` (ou equivalente).

- Adicionar grupo/link "Catálogo → Categorias" apontando para `/settings/catalog/categories`.
- Breadcrumbs via componente existente (se houver) ou heading simples: "Configurações / Catálogo / Categorias / [Nova | Nome]".

### Páginas (Server Components)

- `src/app/(app)/settings/catalog/categories/page.tsx` — recebe `searchParams`, chama `getCategoriesAction`, passa para `CategoriesList`.
- `src/app/(app)/settings/catalog/categories/new/page.tsx` — renderiza `<CategoryForm mode="create" />`.
- `src/app/(app)/settings/catalog/categories/[id]/page.tsx` — chama `getCategoryByIdAction`, se 404 `notFound()`, renderiza `<CategoryForm mode="edit" initialData={data} />`.

`src/app/(app)/layout.tsx` já envelopa em `AppLayout` (herdado de Sprint 03/04) — não precisa novo `layout.tsx` por módulo.

---

## 6. Edge Cases (CRITICAL)

### Empty States
- [ ] **Org sem nenhuma categoria:** `CategoriesList` exibe `EmptyState` com CTA "Criar primeira categoria" → `/settings/catalog/categories/new`.
- [ ] **Busca sem resultados:** "Nenhuma categoria encontrada para '<termo>'" + botão "Limpar busca".

### Validation Errors
- [ ] **Nome vazio ou < 2 chars:** Zod bloqueia, feedback inline "Nome precisa de ao menos 2 caracteres".
- [ ] **Nome > 80 chars:** Zod bloqueia, feedback inline.
- [ ] **Descrição > 500 chars:** Zod bloqueia, feedback inline.
- [ ] **Slug colidindo:** gerador adiciona sufixo numérico. Se erro `23505` escapar (race), capturar e retornar "Slug já em uso, tente outro nome".

### Network Errors
- [ ] **Server Action falha por rede:** toast "Erro de conexão, tente novamente"; form mantém estado.
- [ ] **Timeout:** mesmo tratamento; action retorna `{ success: false, error: 'Erro interno, tente novamente' }`.

### Authentication / Authorization
- [ ] **Usuário não logado:** middleware de auth (Sprint 03) redireciona para `/login`.
- [ ] **Sessão expirada:** `getSessionContext()` lança → `catch` retorna erro amigável, UI mostra toast e redireciona.
- [ ] **User da org A tentando `GET /settings/catalog/categories/<id-da-org-B>`:** `getCategoryByIdAction` retorna 404 (RLS + single() vira `no rows`) → página chama `notFound()`.

### Concurrent Operations
- [ ] **Dois tabs editando mesma categoria:** last-write-wins, documentado. Não implementar lock otimista.
- [ ] **Desativar categoria enquanto outro user edita:** último write vence; sem erro explícito.

### Data Limits
- [ ] **Paginação:** `pageSize` clamp a 100 na Zod. Default 20.
- [ ] **Página fora do range:** se `page > totalPages`, UI mostra página vazia com link "Voltar ao início".

### Produtos vinculados (futuro — não implementar)
- [ ] Comentário em `deleteCategoryAction` registra decisão pendente para Sprint 06.

### Browser / Ambiente
- [ ] **JS desabilitado:** Server Components renderizam lista inicial via SSR; busca com debounce degrada para submit não-reativo (não é bloqueante nesta sprint — framework inteiro assume JS).
- [ ] **Mobile (<640px):** tabela vira card list empilhada via breakpoint Tailwind `md:`. Form ocupa largura total, botões full-width.
- [ ] **Safari < 15 / navegadores sem `Intl.Segmenter`:** `slugify` usa apenas `normalize('NFD')` + regex ASCII, não depende de APIs modernas.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Snapshot confirma as 4 policies RLS presentes em `categories`. Nenhuma migration nova esperada.
- [ ] Se `@db-admin` detectar divergência, migration idempotente criada apenas para policies faltantes. Build `supabase db push --dry-run` passa.

### Backend
- [ ] Arquivo `src/lib/actions/categories.ts` criado com 6 actions.
- [ ] Helper `src/lib/actions/_shared/slugify.ts` criado.
- [ ] Todas as actions validam input com Zod (usando `.safeParse` e `.issues[0].message`).
- [ ] Todas as actions chamam `getSessionContext()` antes de qualquer query.
- [ ] Todas as actions retornam `ActionResponse<T>`.
- [ ] Erros logados como `console.error('[categories:<op>]', err)`; usuário recebe mensagem amigável.
- [ ] `revalidatePath('/settings/catalog/categories')` após create/update/delete/restore.
- [ ] Nenhum `any`.

### Frontend (design system compliance)
- [ ] **Código passa em todas as checagens do [`agents/quality/guardian.md`](../../agents/quality/guardian.md) § 1a e § 1b.** Regras autoritativas em [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md).
- [ ] Dark mode verificado com `data-theme="dark"` no `<html>`.
- [ ] Formulário tem loading + error + success feedback.
- [ ] URL é fonte da verdade em listagem (search, page, activeOnly via query params).
- [ ] Debounce de 300ms na busca.
- [ ] Empty state + no-results state implementados.
- [ ] Breadcrumb/sidebar inclui "Configurações / Catálogo / Categorias".

### Integração
- [ ] `npm run build` passa sem erros (GATE 2).
- [ ] `npm run lint` passa sem novos warnings (GATE 2).
- [ ] `node scripts/verify-design.mjs --changed` sai com 0 violações (GATE 5 estático).
- [ ] `@guardian` aprova (GATE 4).

### Validação manual (usuário roda ao fim)
- [ ] Logar como admin, criar 5 categorias.
- [ ] Editar 1, verificar slug regenerado quando nome muda.
- [ ] Desativar 1, confirmar que some da lista default.
- [ ] Toggle "mostrar inativas" traz a desativada de volta, botão "Restaurar" funciona.
- [ ] Trocar de org (via segunda conta se disponível) e tentar acessar `/settings/catalog/categories/<id>` da primeira org → 404.

---

## 8. Implementation Plan

### Phase 1: Database (DB Admin)
1. Rodar introspecção leve — confirmar que as 4 policies de `categories` constam no banco (não apenas no snapshot).
2. Se tudo presente, reportar "No DDL needed" ao Tech Lead.
3. Se faltar policy, criar migration idempotente `supabase/migrations/<ts>_categories_rls_patch.sql` com `DROP POLICY IF EXISTS` + `CREATE POLICY` apenas para as faltantes. Rodar `supabase db push --dry-run`.

**Estimated Time:** 5 minutos (provavelmente 0 DDL).

### Phase 2: Backend (Backend Dev)
1. Criar `src/lib/actions/_shared/slugify.ts`.
2. Criar `src/lib/actions/categories.ts` com as 6 actions + Zod schemas + `CategoryRow` type.
3. Rodar `npm run build` localmente para checar tipos.

**Estimated Time:** 20 minutos.

### Phase 3: Frontend (Frontend Dev)
1. Criar componentes em `src/components/categories/` (`CategoriesList`, `CategoryForm`, `CategoriesToolbar`, `CategoryEmptyState`).
2. Criar 3 páginas em `src/app/(app)/settings/catalog/categories/`.
3. Atualizar `SettingsSidebar` com link "Catálogo → Categorias".
4. Rodar `npm run build` + `npm run lint` + `node scripts/verify-design.mjs --changed`.

**Estimated Time:** 30 minutos.

### Phase 4: Review (Guardian)
1. Validar compliance do design system.
2. Validar contrato de Server Actions.
3. Validar segurança (auth check, RLS, sem vazamento de info cross-org).

**Estimated Time:** 3 minutos.

### Phase 5: Testing (on-demand)
Não requisitado. Pulado.

**Total Estimated Time:** 58 minutos (5 + 20 + 30 + 3, QA skipped).

---

## 9. Risks & Mitigations

### Risk 1: Race condition no slug (dois creates simultâneos com mesmo nome)
**Impact:** Medium
**Probability:** Low
**Mitigation:** Retry uma vez ao capturar erro `23505`; se persistir, retornar erro amigável. Unique index no banco impede duplicata silenciosa.

### Risk 2: `@frontend` usar hex hard-coded ou `bg-blue-500` (violação design system)
**Impact:** Medium (Guardian rejeita, custo de retry)
**Probability:** Medium (primeira sprint de CRUD, pegadinha clássica)
**Mitigation:** Delegação já cita [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) + [`CONTRACT.md`](../../design_system/components/CONTRACT.md). `verify-design.mjs` pega ANTES do Guardian.

### Risk 3: Regenerar slug no update sem checar se usuário já tem URL/link externo para a categoria
**Impact:** Low (não há integração externa ainda)
**Probability:** N/A
**Mitigation:** Slug é interno, não é URL pública nesta sprint. Se virar pública no futuro, considerar congelar slug ou migrar. Documentar no comentário da função.

### Risk 4: URL = fonte da verdade quebrada por `useState` local (violação CRUD regra 2)
**Impact:** Medium (quebra deep link, back button)
**Probability:** Medium
**Mitigation:** PRD explícito sobre usar `useSearchParams` + `router.push`. `@guardian` checa.

---

## 10. Dependencies

### Internal
- [x] Sprint 03 concluída — `getSessionContext()` disponível em `src/lib/supabase/getSessionContext.ts`.
- [x] Sprint 04 concluída — `AppLayout` e `SettingsSidebar` existem; padrão de `react-hook-form` + `zodResolver` em `OrganizationForm`/`ProfileForm`.
- [x] Tabela `categories` existe no banco com RLS.
- [x] Componentes DS base (`Button`, `Input`, `Textarea`, `Switch`, `Table`, `Badge`, `DropdownMenu`, `DeleteConfirmationDialog`) em `src/components/ui/`.

### External
Nenhuma.

---

## 11. Rollback Plan

Se bugs forem detectados após o commit:

1. **Imediato:** `git revert <sprint-commit-hash>` (via `@git-master`).
2. **Banco:** nenhuma migration nova esperada. Se policy patch foi aplicado e precisa reverter, criar migration inversa via `@db-admin` (não usar `supabase migration down` em produção).
3. **Cache:** `revalidatePath('/settings/catalog/categories')` é granular — clear cache acontece no próximo request.
4. **Monitoring:** console logs no server mostram `[categories:<op>]`.

---

## Approval

**Created by:** @spec-writer (via Tech Lead orchestration)
**Reviewed by:** @sanity-checker (pending)
**Approved by:** User (pending — STOP & WAIT)
**Date:** 2026-04-15
