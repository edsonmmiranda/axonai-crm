# PRD: Products + Storage

**Template:** PRD_COMPLETE
**Complexity Score:** 14 points (DB +5 · API +6 · UI +3 · Lógica +5 · Deps +1 — ajustado para evitar dupla contagem)
**Sprint:** 06
**Created:** 2026-04-16
**Status:** Draft

---

## 1. Overview

### Business Goal

O catálogo de produtos é o "o quê se vende" do CRM — sem ele, o módulo de Leads (Sprint 08+) não tem como vincular oportunidades a SKUs reais e o pipeline fica abstrato. Esta sprint entrega o primeiro CRUD com **upload real para Supabase Storage** (galeria de imagens com primary + reorder, biblioteca de documentos com tipo), estabelecendo padrões de Storage que serão reutilizados em qualquer módulo futuro com mídia.

### User Stories

- Como **admin**, eu quero cadastrar produtos com SKU único por organização, preço, estoque, categoria e descrições, para refletir o que a empresa vende.
- Como **admin**, eu quero subir até 20 imagens por produto, marcar uma como capa (primary) e reordenar, para controlar a apresentação do catálogo.
- Como **admin**, eu quero anexar documentos (PDF/DOCX/imagens, até 20MB) ao produto, para que vendedores tenham material de apoio.
- Como **admin**, eu quero buscar por nome ou SKU e filtrar por categoria/status, para encontrar rápido em catálogos grandes.
- Como **user de outra organização**, eu NÃO consigo ler/escrever/baixar nada do catálogo de outra org (RLS no banco + RLS no Storage).

### Success Metrics

- Admin cria 1 produto com 3 imagens (1 primary) e 2 documentos PDF, edita, reordena imagens, deleta uma imagem, e a galeria persiste após reload — sem erro de console e sem violação de RLS.
- Tentativa cross-org via URL direta de Storage retorna 403 do Supabase.
- `npm run build` + `npm run lint` + `node scripts/verify-design.mjs --changed` passam sem erros.

---

## 2. Database Requirements

### Existing Tables Used (NÃO criar migration de tabela)

#### Table: `products`
**Usage:** entidade principal do catálogo.
**Schema (confirmado em `docs/schema_snapshot.json`):** 20 colunas — `id` uuid PK · `organization_id` uuid NOT NULL · `name` varchar(255) NOT NULL · `short_description` text · `description` text · `price` numeric · `sku` varchar(100) NOT NULL · `status` varchar(20) DEFAULT `'active'` · `stock` integer DEFAULT 0 · `weight, height, width, depth` numeric · `brand` varchar(100) · `tags` text[] · `notes` text · `created_at, updated_at` timestamptz · `created_by` uuid · `category_id` uuid (FK → `categories.id`)
**Constraints existentes:** UNIQUE `(organization_id, sku)` (índice `unique_sku_per_org`); índices em `category_id`, `created_at DESC`, `organization_id`, `sku`, `status`.
**RLS existente:** 4 policies (SELECT/INSERT/UPDATE/DELETE) — `@db-admin` deve confirmar que enforçam `organization_id = get_current_org()` (assinatura do helper auth do projeto). Se faltar, criar migration idempotente só de policies.

#### Table: `product_images`
**Usage:** galeria de imagens do produto.
**Schema:** 10 colunas — `id` uuid PK · `product_id` uuid NOT NULL · `url` text NOT NULL · `file_name` varchar(255) NOT NULL · `file_size` integer · `mime_type` varchar(50) · `position` integer DEFAULT 0 · `is_primary` boolean DEFAULT false · `created_at` timestamptz · `uploaded_by` uuid
**Índices existentes:** `(product_id, position)`, partial `(product_id, is_primary) WHERE is_primary = true`, `product_id`.
**RLS existente:** 4 policies — `@db-admin` confirma que policies enforçam isolamento via JOIN com `products.organization_id`.
**Convenção storage path (definida neste PRD):** `url` armazena **apenas o path no bucket** (não a URL completa) — formato `{organization_id}/{product_id}/{uuid}-{sanitized-filename}`. URL pública/assinada é gerada on-demand no servidor. Justificativa: URLs assinadas expiram, então armazenar URL no banco vira lixo.

#### Table: `product_documents`
**Usage:** biblioteca de documentos do produto.
**Schema:** 9 colunas — `id` uuid PK · `product_id` uuid NOT NULL · `url` text NOT NULL · `file_name` varchar(255) NOT NULL · `file_size` integer · `mime_type` varchar(50) · `document_type` varchar(50) · `created_at` timestamptz · `uploaded_by` uuid
**Mesma convenção:** `url` = path no bucket, signed URL on-demand.

### New Migration: Storage buckets + Storage RLS

**Owner:** `@db-admin`. Migration idempotente que:

1. **Cria 2 buckets** via `INSERT INTO storage.buckets ... ON CONFLICT (id) DO NOTHING`:
   - `products` — **PRIVADO** (`public = false`). Decisão lockada: privado consistente com `product-documents`, evita URLs perpétuas e centraliza enforcement no Storage RLS. Trade-off aceito: leitura sempre via signed URL (custo de 1 chamada extra ao Supabase por carregamento de imagem na lista; mitigado por cache de signed URL por sessão se métricas pedirem).
   - `product-documents` — PRIVADO.
   - Limites por bucket (via `file_size_limit`): `products` = 5MB; `product-documents` = 20MB.
   - `allowed_mime_types`: `products` = `['image/jpeg', 'image/png', 'image/webp']`; `product-documents` = `['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']`.

2. **Cria 8 policies em `storage.objects`** (4 por bucket — SELECT/INSERT/UPDATE/DELETE), todas idempotentes via `DROP POLICY IF EXISTS ... ; CREATE POLICY ...`. Padrão da policy:
   ```sql
   CREATE POLICY "products_select_org" ON storage.objects FOR SELECT
   USING (
     bucket_id = 'products'
     AND (storage.foldername(name))[1]::uuid = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
   );
   ```
   Ou seja: o **primeiro segmento do path é `organization_id`**, e a policy compara com a org do usuário autenticado. Defesa em profundidade — bloqueia leitura/escrita cross-org no nível Storage mesmo se o code-path do app falhar.

3. **Idempotência:** rodar a migration 2x não duplica buckets nem quebra policies.

**Naming:** `supabase/migrations/[timestamp]_storage_products_buckets.sql`.

---

## 3. API Contract

### Server Actions de Products (`src/lib/actions/products.ts`)

Todas seguem [`docs/conventions/standards.md`](../docs/conventions/standards.md): Zod input · `getSessionContext()` · `assertRole(['owner', 'admin'])` em mutações (read pode ser qualquer membro da org) · try/catch · `ActionResponse<T>` · `revalidatePath` após mutação · log interno + mensagem amigável.

#### `getProductsAction(input)`
**Input Zod:**
```typescript
const ListParamsSchema = z.object({
  search: z.string().trim().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});
```
**Lógica:** `.range(from, to)` server-side · busca `name ILIKE %s% OR sku ILIKE %s%` · filtros `category_id`, `status` · ordena `created_at DESC` · JOIN com `categories(id, name)` para retornar `category_name` · LEFT JOIN com `product_images WHERE is_primary = true LIMIT 1` para retornar `primary_image_path`.
**Output:** `ActionResponse<ProductListRow[]>` com `metadata: { total, totalPages, currentPage, itemsPerPage }`.
**Nota:** `primary_image_path` é o path no bucket, NÃO a signed URL. A página gera signed URLs em batch (helper `getSignedUrlsBatch(paths[])`) para evitar 1 round-trip por linha.

#### `getProductByIdAction(id)`
Retorna produto + arrays `images: ProductImageRow[]` (ordenadas por `position ASC`) e `documents: ProductDocumentRow[]` (ordenadas por `created_at DESC`). 404 amigável se não pertence à org.

#### `createProductAction(input)`
**Input Zod:**
```typescript
const CreateProductSchema = z.object({
  name: z.string().trim().min(2).max(255),
  sku: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, 'SKU aceita letras, números, hífen e underscore'),
  category_id: z.string().uuid().nullable().optional(),
  short_description: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  brand: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  price: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional().default(0),
  status: z.enum(['active', 'archived']).optional().default('active'),
  weight: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  width: z.number().nonnegative().optional(),
  depth: z.number().nonnegative().optional(),
  notes: z.string().trim().max(2000).optional(),
});
```
**Lógica:** `assertRole(['owner', 'admin'])` · seta `organization_id` + `created_by` via `getSessionContext()` · captura `23505` (unique_sku_per_org) → erro "SKU 'XXX' já existe nesta organização" · `revalidatePath('/products')` · retorna o row criado para que a UI navegue direto para `/products/[id]` e habilite a aba de mídia.

#### `updateProductAction(id, input)`
Mesmo schema do create. Validação de UUID. RLS + `eq('organization_id', ctx.organizationId)` explícito (defesa em profundidade). `revalidatePath('/products')` + `revalidatePath('/products/${id}')`.

#### `archiveProductAction(id)` / `restoreProductAction(id)`
**Soft delete único nesta sprint** — seta `status = 'archived'` ou `'active'`. **Hard delete fica fora de escopo** (decisão lockada — adia complexidade de cleanup de Storage para sprint futura se realmente necessário). Imagens e documentos permanecem intactos no Storage.

### Server Actions de Imagens (`src/lib/actions/product-images.ts`)

#### `uploadProductImageAction(productId, formData)`
**Input:** `productId: string` (UUID) + `FormData` contendo `file: File`. Server Action com FormData (não JSON) — necessário para upload binário.
**Validação server-side (autoritativa, não confiar só no client):**
- `mime_type ∈ ['image/jpeg', 'image/png', 'image/webp']`
- `file_size ≤ 5 * 1024 * 1024` (5MB)
- Produto pertence à org do usuário (SELECT em `products WHERE id AND organization_id`)
- Limite de 20 imagens por produto (SELECT count) — bloqueia upload se já tem 20
**Lógica (ordem importa para cleanup correto):**
1. Sanitiza filename (remove acentos, espaços → `-`, lowercase) via helper `sanitizeFilename()`
2. Gera path: `{organization_id}/{product_id}/{uuid}-{sanitizedName}`
3. Upload para bucket `products` via `supabase.storage.from('products').upload(path, file)`
4. Se upload falha → retorna erro, NÃO insere row
5. Se upload OK → calcula `position = (SELECT COALESCE(MAX(position), -1) + 1 FROM product_images WHERE product_id)` e `is_primary = (SELECT COUNT(*) = 0 FROM product_images WHERE product_id)` (true se primeira imagem)
6. Insere row em `product_images` com `url = path`, `position`, `is_primary`, `uploaded_by = ctx.userId`
7. Se insert falha → **cleanup obrigatório:** `supabase.storage.from('products').remove([path])` e retorna erro
8. `revalidatePath('/products/${productId}')` + retorna `ActionResponse<ProductImageRow>`

#### `deleteProductImageAction(imageId)`
**Lógica em transação lógica (não Postgres TX, pois Storage é externo):**
1. SELECT row (com `product_id`, `url`, `is_primary`) garantindo isolamento de org via JOIN com `products`
2. DELETE row em `product_images`
3. Se a deletada era `is_primary` E ainda existem outras imagens → UPDATE `product_images SET is_primary = true WHERE id = (SELECT id FROM product_images WHERE product_id = ? ORDER BY position ASC LIMIT 1)`. Promove a próxima.
4. Remove objeto do Storage: `supabase.storage.from('products').remove([url])`. Se Storage falha aqui (objeto órfão), **logar `[product-image:cleanup-failed] {imageId, path}`** e ainda retornar success — row já foi deletada e a UI deve refletir isso. Operador pode reconciliar via job/cron se padrão emergir (registrar follow-up em APRENDIZADOS se acontecer).
5. `revalidatePath('/products/${productId}')`.

#### `setPrimaryImageAction(imageId)`
**Atomicidade obrigatória (corre risco de 2 admins clicando ao mesmo tempo).**
**Implementação:** uma única query SQL via RPC ou via PATCH com CASE WHEN:
```sql
UPDATE product_images
SET is_primary = (id = $imageId)
WHERE product_id = (SELECT product_id FROM product_images WHERE id = $imageId)
  AND product_id IN (SELECT id FROM products WHERE organization_id = $orgId);
```
Garantia: ao final, exatamente 1 imagem com `is_primary = true` por produto. `@backend` decide se cria RPC nomeada ou se faz inline na Server Action — preferência por inline (uma query, mais simples).

#### `reorderProductImagesAction(productId, orderedIds: string[])`
**Atomicidade obrigatória.**
**Validação:**
- `orderedIds` é array de UUIDs (Zod)
- Todos os IDs pertencem ao produto (SELECT count check) — se discrepância, erro e abort sem update
- Produto pertence à org
**Implementação:** uma query com CASE WHEN:
```sql
UPDATE product_images
SET position = CASE id
  WHEN $id1 THEN 0
  WHEN $id2 THEN 1
  ...
END
WHERE product_id = $productId AND id = ANY($orderedIds);
```
`@backend` constrói dinamicamente. Se número de imagens > ~50, pode usar RPC; mas escopo desta sprint é até 20 imagens, then inline está ok.

### Server Actions de Documentos (`src/lib/actions/product-documents.ts`)

#### `uploadProductDocumentAction(productId, formData, documentType?)`
**Input:** `productId: string`, `FormData` com `file: File`, `documentType?: string` (max 50 chars — sugestões UI: 'manual', 'ficha-tecnica', 'certificado', 'outro' — string livre, não enum no banco para flexibilidade).
**Validação:** mime ∈ allowed list (PDF, DOC, DOCX, JPEG, PNG); size ≤ 20MB; produto da org; limite de 50 documentos por produto.
**Lógica:** mesma ordem do upload de imagem (sanitize → path → upload → insert → cleanup em falha). Bucket `product-documents`.

#### `deleteProductDocumentAction(documentId)`
Mesmo padrão de delete de imagem (sem promoção de primary, pois documentos não têm primary).

### Helper compartilhado: signed URL batch

**Arquivo:** `src/lib/storage/signed-urls.ts`
**Função pura (Server-only):**
```typescript
export async function getSignedUrlsBatch(
  bucket: 'products' | 'product-documents',
  paths: string[],
  expiresIn = 3600
): Promise<Record<string, string | null>>;
```
Wrapper sobre `supabase.storage.from(bucket).createSignedUrls(paths, expiresIn)`. Retorna `{ path: signedUrl }` map. Usado em `getProductsAction` (lista) e `getProductByIdAction` (detalhe). Documentos usam `expiresIn = 600` (10 min, link de download curto).

### Helper compartilhado: sanitização de filename

**Arquivo:** `src/lib/storage/paths.ts`
```typescript
export function sanitizeFilename(name: string): string;       // lowercase, sem acento, espaços → -
export function buildStoragePath(p: { orgId: string; productId: string; fileName: string }): string;
```

---

## 4. External API Integration

**Não aplicável.** Supabase Storage é interno (mesmo cluster do Postgres). Sem `@api-integrator` nesta sprint.

---

## 4.5 Reference Module Compliance

**Módulo de referência:** [`src/app/(app)/settings/catalog/categories/`](../src/app/(app)/settings/catalog/categories/) + [`src/lib/actions/categories.ts`](../src/lib/actions/categories.ts) (entregue na Sprint 05).

### Arquivos a copiar (estrutura)

| Categories (origem) | Products (destino) | Tipo de cópia |
|---|---|---|
| `src/app/(app)/settings/catalog/categories/page.tsx` | `src/app/(app)/products/page.tsx` | Estrutural |
| `src/app/(app)/settings/catalog/categories/new/page.tsx` | `src/app/(app)/products/new/page.tsx` | Estrutural |
| `src/app/(app)/settings/catalog/categories/[id]/page.tsx` | `src/app/(app)/products/[id]/page.tsx` | Estrutural |
| `src/lib/actions/categories.ts` | `src/lib/actions/products.ts` | Estrutural (skeleton: imports, ActionResponse, padrão de try/catch + getSessionContext + assertRole + revalidatePath) |
| `src/components/categories/CategoriesList.tsx` | `src/components/products/ProductsList.tsx` | Estrutural (Table + paginação + empty state) |
| `src/components/categories/CategoriesToolbar.tsx` | `src/components/products/ProductsToolbar.tsx` | Estrutural (busca debounced + filtros via URL) |
| `src/components/categories/CategoryForm.tsx` | `src/components/products/ProductForm.tsx` | Estrutural (RHF + zodResolver + toast) — **mas estendido** com tabs e seção Mídia |
| `src/components/categories/CategoryRowActions.tsx` | `src/components/products/ProductRowActions.tsx` | Estrutural (menu Editar/Arquivar/Restaurar) |

### Substituições de naming (entity-level)

| Categories | Products |
|---|---|
| `CategoryRow` (type) | `ProductRow` |
| `CreateCategoryInput` | `CreateProductInput` |
| `UpdateCategoryInput` | `UpdateProductInput` |
| `ListCategoriesInput` | `ListProductsInput` |
| `getCategoriesAction` | `getProductsAction` |
| `getCategoryByIdAction` | `getProductByIdAction` |
| `createCategoryAction` | `createProductAction` |
| `updateCategoryAction` | `updateProductAction` |
| `deleteCategoryAction` (soft) | `archiveProductAction` (soft, mesmo padrão) |
| `restoreCategoryAction` | `restoreProductAction` |
| `'/settings/catalog/categories'` (revalidatePath) | `'/products'` |
| Tabela `categories` | Tabela `products` |

### Padrões a PRESERVAR (não inventar variação)

- **Contrato `ActionResponse<T>`:** definido inline no arquivo (igual a categories.ts:11-23) — não importar de lib externa nesta sprint.
- **Validação Zod:** schemas separados por operação (`CreateProductSchema`, `UpdateProductSchema`, `ListParamsSchema`) — espelho exato do padrão em categories.ts:36-72.
- **Error handling:** try/catch envolvendo tudo · `console.error('[products:operation]', error)` · retorno `error: 'mensagem amigável'` (nunca `error.message` direto). Captura específica de `error.code === '23505'` para unique violation (categories.ts:230-232 é o template literal).
- **Auth:** `getSessionContext()` no início · `assertRole(['owner', 'admin'])` em mutações (não em reads). Idêntico a categories.ts:208-213.
- **Paginação:** `.range(from, to)` com `count: 'exact'` + `metadata` (PaginationMeta) — categories.ts:121-158 é o template.
- **Revalidation:** `revalidatePath('/products')` após mutação · `revalidatePath('/products/${id}')` adicional em update. Sem `router.refresh()` no client.
- **UUID validation:** `z.string().uuid('ID inválido').safeParse(id)` em qualquer action que recebe ID — categories.ts:168, 249, 328 mostram o padrão.
- **Soft delete:** mantém o registro, muda flag (`active = false` em categories → `status = 'archived'` em products). Não criar `hardDelete*` nesta sprint.

### O que é NOVO (sem precedente em categories — atenção redobrada do `@backend`)

1. **Server Actions com FormData** (`uploadProductImageAction`, `uploadProductDocumentAction`) — categories só usa JSON/objeto. Padrão Next.js: `formData: FormData` como parâmetro, extrair `file: File` via `formData.get('file') as File`. Validar mime + size no servidor antes de qualquer outra lógica.
2. **Cleanup pós-falha** — categories não tem efeito colateral externo; products tem upload para Storage. Padrão obrigatório: upload primeiro → insert no banco → se insert falhar, remover objeto do Storage com try/catch (cleanup nunca pode propagar erro novo).
3. **Atomicidade SQL** — categories não tem operações que precisem ser atômicas além de single-row. Products precisa de:
   - `setPrimaryImageAction`: 1 query com `is_primary = (id = $imageId)` aplicado a todas as imagens do produto
   - `reorderProductImagesAction`: 1 query com `UPDATE ... SET position = CASE id WHEN ... END`
4. **Signed URL batch** — categories não acessa Storage. Products precisa de helper `getSignedUrlsBatch(bucket, paths[])` para evitar N+1 na lista.
5. **Form com tabs** — `CategoryForm` é flat (4 campos). `ProductForm` tem 20 campos em 5 tabs (`Tabs` do DS). Estrutura nova; padrão mantido (RHF + zodResolver + toast + Danger Zone).
6. **Galeria/biblioteca de mídia** — `ProductImageGallery` e `ProductDocumentList` são componentes inteiramente novos sem precedente.

### Exemplo before/after (1 action completa)

**Before — `categories.ts:199-243`** (createCategoryAction):
```typescript
const CreateCategorySchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  active: ActiveSchema,
});

export async function createCategoryAction(input: CreateCategoryInput) {
  const parsed = CreateCategorySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) return { success: false, error: gate.error };
    const supabase = await createClient();
    const slug = await generateUniqueSlug(supabase, ctx.organizationId, parsed.data.name);
    const { data, error } = await supabase.from('categories').insert({...}).select(...).single();
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Já existe...' };
      console.error('[categories:create]', error);
      return { success: false, error: 'Não foi possível criar a categoria.' };
    }
    revalidatePath('/settings/catalog/categories');
    return { success: true, data };
  } catch (error) {
    console.error('[categories:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

**After — `products.ts` (createProductAction)** — mesma estrutura, novos campos, sem `slugify` (products usa SKU validado por regex em vez de slug auto-gerado):
```typescript
const CreateProductSchema = z.object({
  name: z.string().trim().min(2).max(255),
  sku: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, '...'),
  category_id: z.string().uuid().nullable().optional(),
  // ... 17 outros campos
});

export async function createProductAction(input: CreateProductInput) {
  const parsed = CreateProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) return { success: false, error: gate.error };
    const supabase = await createClient();
    const { data, error } = await supabase.from('products').insert({
      organization_id: ctx.organizationId,
      created_by: ctx.userId,
      ...parsed.data,
    }).select(...).single();
    if (error) {
      if (error.code === '23505') return { success: false, error: 'SKU já existe nesta organização' };
      console.error('[products:create]', error);
      return { success: false, error: 'Não foi possível criar o produto.' };
    }
    revalidatePath('/products');
    return { success: true, data };
  } catch (error) {
    console.error('[products:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

Estrutura idêntica. Diferenças: schema (mais campos), tabela alvo, message de erro 23505, path de revalidação. **Nenhuma invenção de padrão** — variação fica nos campos e mensagens.

---

## 5. Componentes de UI

Componentes seguem [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md): wrappers sobre Radix Primitives, tokens semânticos, variantes via `cva`, ícones Lucide. Refs visuais: `design_system/telas_prontas/leads_lista.html`, `leads_criar.html`, `leads_editar.html`.

### Component Tree

```
/products (page.tsx — Server Component)
├── ProductsToolbar (client) — busca + select categoria + select status + CTA "Novo"
└── ProductsList (server) — Table com colunas: Imagem · Nome · SKU · Categoria · Preço · Estoque · Status · Criado em · Ações
    └── ProductRowActions (client) — menu Editar/Arquivar/Restaurar

/products/new (page.tsx)
└── ProductForm (client) — modo "create", sem aba Mídia

/products/[id] (page.tsx — Server Component fetcha dados)
└── ProductForm (client) — modo "edit", com tabs Básico/Comercial/Dimensões/Notas/Mídia
    ├── ProductImageGallery (client) — grid + upload + reorder + primary toggle + delete
    └── ProductDocumentList (client) — list + upload + download (signed URL on click) + delete
```

### Componentes-chave

#### `ProductsList` (`src/components/products/ProductsList.tsx`)
- Tabela usando `Table` de `src/components/ui/`
- Coluna "Imagem": thumbnail 40×40 da `primary_image_path` via signed URL (gerada no Server Component pai e passada como prop). Fallback: ícone Lucide `Package` em `bg-surface-muted`.
- Empty state: "Nenhum produto cadastrado — Cadastrar primeiro produto" (botão CTA).
- Loading skeleton via `Skeleton` do DS.
- Paginação via `Pagination` do DS, navegando por query params (`?page=N` — URL é fonte da verdade conforme [`docs/conventions/crud.md`](../docs/conventions/crud.md)).

#### `ProductsToolbar` (`src/components/products/ProductsToolbar.tsx`)
- Client Component
- `Input` de busca com debounce 300ms → atualiza `?search=` via `useRouter().push()`
- `Select` de categoria (carrega via `getCategoriesAction({ activeOnly: true, pageSize: 100 })`)
- `Select` de status: Ativos / Arquivados / Todos
- `Button` "Novo Produto" → link para `/products/new`
- Estado vive em URL (sem `useState` para filtros)

#### `ProductForm` (`src/components/products/ProductForm.tsx`)
- Client Component, react-hook-form + `zodResolver` com o mesmo schema do servidor (importar `CreateProductSchema` se exportado, OU duplicar — `@backend` decide se exporta o schema ou se cria espelho client-side dado que Server Actions tendem a não importar de "use client")
- Tabs (`Tabs` do DS — Radix-based) — só visíveis em modo `edit`:
  - **Básico:** name, sku, category_id, short_description, description, brand, tags
  - **Comercial:** price (R$ formatado), stock, status (`Switch` ativo/arquivado)
  - **Dimensões:** weight (kg), height/width/depth (cm)
  - **Notas:** notes (textarea)
  - **Mídia:** `ProductImageGallery` + `ProductDocumentList` (só após product existir, para ter `productId`)
- Em modo `create`: só Básico/Comercial/Dimensões/Notas. Mídia aparece após salvar (redireciona para `/products/[id]`).
- Botão "Salvar" → action client-side → toast de sucesso/erro
- Danger Zone (só edit): `Button` destrutivo "Arquivar" abre `Dialog` de confirmação ([`docs/conventions/crud.md`](../docs/conventions/crud.md) regra 5)

#### `ProductImageGallery` (`src/components/products/ProductImageGallery.tsx`)
- Grid responsivo (3 cols mobile, 5 desktop) de cards de imagem
- Cada card: thumbnail (signed URL) · badge "Capa" se `is_primary` · overlay com botões: ⭐ Definir como capa · ↑ ↓ Mover · 🗑 Deletar
- "Adicionar imagens": `Button` abre `<input type="file" multiple accept="image/jpeg,image/png,image/webp">`. Valida client-side (mime + size + max 20 total) e mostra preview + barra de progresso por arquivo durante upload. Upload sequencial (não paralelo) para simplicidade desta sprint.
- Confirmação de delete via `Dialog`
- Reorder por botões ↑/↓ (decisão lockada: **sem `@dnd-kit` nesta sprint** — escopo enxuto, escolha drag-free; pode ser adicionado em sprint futura sem mudar contrato)
- Após cada operação: toast + revalidação automática via `revalidatePath` no servidor

#### `ProductDocumentList` (`src/components/products/ProductDocumentList.tsx`)
- Lista vertical com `<li>` cards
- Cada item: ícone por mime (Lucide `FileText` para PDF, `FileImage` para imagem, `File` fallback) · file_name · badge `document_type` (se houver) · file_size formatado (KB/MB) · botão "Baixar" (gera signed URL on click via Server Action `getProductDocumentSignedUrl(id)` e abre em nova aba) · botão deletar
- "Adicionar documento": botão abre `Dialog` com `<input type="file">` + `Select` de tipo (manual/ficha-tecnica/certificado/outro). Upload sequencial.

#### `UploadDropzone` (opcional, em `src/components/ui/`)
- Apenas se `@frontend` julgar útil reutilizar entre imagens e documentos. Caso contrário, inputs `<input type="file">` simples bastam. **Decisão delegada ao `@frontend`** — recomendado começar simples e extrair se houver duplicação real.

### Tokens semânticos a usar

- Surface: `bg-surface-base`, `bg-surface-raised` (cards), `bg-surface-muted` (placeholder de imagem)
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- Border: `border-default`
- Action: `bg-action-primary` + `text-action-primary-fg` (botões primários), `bg-action-secondary`
- Feedback: `bg-feedback-success-bg` / `text-feedback-success-fg` (badge "Ativo"); `bg-feedback-warning-bg` (badge "Arquivado"); `bg-feedback-danger-bg` (Danger Zone)

**Proibido:** hex literais, `bg-blue-500`, `p-[17px]`, `bg-background`, `text-foreground` (não existem no nosso DS).

### Navegação

- **Sidebar:** adicionar item "Produtos" em `src/components/layout/` (sidebar component a confirmar via Glob no momento da execução do `@frontend`). Ícone Lucide `Package`. Posição: depois de Dashboard, antes de Leads (módulo principal, não settings).
- **Breadcrumbs:** `Produtos / [Novo | <Nome do produto>]`.
- **Layout do módulo:** `src/app/(app)/products/layout.tsx` — se padrão do projeto exige layout próprio por módulo conforme [`docs/conventions/crud.md`](../docs/conventions/crud.md) regra 1, criar. Caso o `(app)/layout.tsx` já forneça shell global, pode ser omitido — `@frontend` confirma via inspeção.

---

## 6. Edge Cases (CRITICAL)

### Empty / Initial States
- [ ] **Org sem produtos:** lista exibe empty state com CTA "Cadastrar primeiro produto"
- [ ] **Busca sem resultado:** mostra "Nenhum produto encontrado para 'XXX'"
- [ ] **Produto sem imagens:** galeria mostra empty state "Nenhuma imagem ainda — Adicionar primeira"
- [ ] **Produto sem documentos:** lista mostra empty state "Nenhum documento anexado"

### Validation Errors
- [ ] **SKU duplicado na org (`23505`):** toast "SKU 'XXX' já existe nesta organização" + foco no campo SKU
- [ ] **SKU com caracteres inválidos:** Zod bloqueia client + server, erro inline "SKU aceita letras, números, hífen e underscore"
- [ ] **Nome < 2 chars ou > 255:** Zod inline
- [ ] **Price/stock/dimensão negativa:** Zod bloqueia
- [ ] **Mais de 20 tags ou tag > 30 chars:** Zod bloqueia client + server

### Storage Errors
- [ ] **Upload acima do limite (5MB img / 20MB doc):** validação client (UX) + server (verdade) → toast "Arquivo excede tamanho máximo de XMB"
- [ ] **Mime type não permitido:** mesma estratégia → toast "Apenas JPEG/PNG/WebP são aceitos para imagens"
- [ ] **Limite de imagens (20) atingido:** server retorna erro, client mostra "Limite de 20 imagens por produto atingido"
- [ ] **Upload falha no meio (rede caiu / Storage erro):** row NÃO é criada (upload primeiro). Se upload OK mas insert falhou → cleanup do objeto. Toast "Falha ao salvar imagem, tente novamente"
- [ ] **Cleanup pós-falha falha (raríssimo):** apenas loga e retorna erro original; objeto órfão fica para reconciliação manual

### Galeria Edge Cases
- [ ] **Deletar única imagem primary:** próxima por `position ASC` é promovida automaticamente
- [ ] **Deletar última imagem do produto:** produto fica sem imagem (válido). Lista mostra placeholder.
- [ ] **2 admins clicando "Definir capa" simultaneamente:** atomic SET garante exatamente 1 primary; last-write-wins
- [ ] **Reorder com 0 ou 1 imagem:** no-op silencioso
- [ ] **Reorder com IDs que não pertencem ao produto:** Zod + check de pertencimento → bloqueia operação inteira

### Auth & RLS Cross-Org
- [ ] **User não logado acessa /products:** middleware redireciona para `/login` (já implementado em Sprint 03)
- [ ] **User da org A acessa `/products/{id-da-org-B}`:** RLS retorna nada → page mostra 404 amigável (não 403, evita vazar existência)
- [ ] **User da org A tenta baixar imagem da org B via URL direta de Storage:** Storage RLS retorna 403 do Supabase (defesa em profundidade — mesmo se signed URL vazasse de outra forma)
- [ ] **User com role 'member' tenta create/update/archive:** `assertRole(['owner', 'admin'])` retorna erro "Você não tem permissão para esta ação"

### Concurrent / Stale State
- [ ] **2 tabs editando o mesmo produto:** last-write-wins (sem lock otimista nesta sprint — aceitável)
- [ ] **Categoria foi arquivada após cadastro do produto:** lista mostra a categoria com indicação visual sutil "(arquivada)"; form de edição permite manter ou trocar
- [ ] **Produto foi arquivado por outro user durante minha edição:** próximo save retorna o registro atualizado (status pode ter mudado); UI mostra status atual após save

### Display / Performance
- [ ] **Tags array null vs vazia:** UI normaliza para array vazia ao exibir
- [ ] **Produto com price/stock null:** lista exibe "—"
- [ ] **Lista com 100+ produtos:** paginação server-side com pageSize 20 garante performance
- [ ] **Galeria com 20 imagens:** signed URLs geradas em batch (1 round-trip para todas) evita N+1

### Network
- [ ] **Erro de rede no form principal:** toast "Sem conexão com o servidor"; dados do form preservados; permite retry
- [ ] **Server error genérico:** "Erro interno, tente novamente"

### Browser / Ambiente
- [ ] **Mobile (375px viewport):** lista vira card stack ou tabela horizontal-scroll (decisão `@frontend` durante execução); `ProductForm` mantém usabilidade com tabs (cada tab vira uma seção empilhada se necessário); galeria adapta para 2 colunas; toolbar de filtros colapsa em drawer/accordion
- [ ] **Desktop (≥ 1440px):** layout não estica indefinidamente — `max-w-screen-xl` ou container similar do DS; galeria mantém 5 colunas máximo
- [ ] **iOS Safari (file picker):** `<input type="file" accept="image/jpeg,image/png,image/webp">` deve abrir picker nativo; em iOS, pode aparecer também opção "Tirar foto" — comportamento esperado, não bloquear
- [ ] **Touch (mobile):** botões de ↑↓ no reorder de imagens precisam ter área de toque ≥ 40×40px (acessibilidade); confirmação de delete via `Dialog` (não hover-only menu) para não depender de hover
- [ ] **JS desabilitado:** Server Components renderizam lista e detalhes em modo read-only (não há fallback `<form>` HTML nesta sprint — formulários e uploads exigem JS); aceitável e documentado como degradação esperada
- [ ] **Navegador antigo sem suporte a `<input type="file" multiple>`:** raro em 2026, mas se acontecer, upload sequencial 1-a-1 funciona via picker repetido. Não bloqueante.

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration de Storage buckets + Storage RLS criada e roda sem erro (`supabase db push --dry-run` passa)
- [ ] Migration é idempotente (rodar 2x não duplica)
- [ ] Buckets `products` e `product-documents` existem no Supabase, ambos privados, com `file_size_limit` e `allowed_mime_types` corretos
- [ ] 8 policies em `storage.objects` (4 por bucket) ativas e testadas
- [ ] Snapshot atualizado via `node scripts/introspect-schema.mjs` após migration aplicar

### Backend
- [ ] `src/lib/actions/products.ts` com 6 actions: `getProductsAction`, `getProductByIdAction`, `createProductAction`, `updateProductAction`, `archiveProductAction`, `restoreProductAction`
- [ ] `src/lib/actions/product-images.ts` com 4 actions: `uploadProductImageAction`, `deleteProductImageAction`, `setPrimaryImageAction`, `reorderProductImagesAction`
- [ ] `src/lib/actions/product-documents.ts` com 3 actions: `uploadProductDocumentAction`, `deleteProductDocumentAction`, `getProductDocumentSignedUrl`
- [ ] `src/lib/storage/paths.ts` (sanitizeFilename + buildStoragePath) e `src/lib/storage/signed-urls.ts` (getSignedUrlsBatch) criados
- [ ] Todas as Server Actions: Zod input · `getSessionContext()` · `assertRole(['owner', 'admin'])` em mutações · try/catch · `ActionResponse<T>` · log interno + msg amigável · `revalidatePath` após mutação
- [ ] Erro Postgres `23505` capturado no create/update e exibido como "SKU já existe nesta organização"
- [ ] Cleanup de objeto órfão implementado (upload OK + insert FAIL → remove objeto)
- [ ] `setPrimaryImageAction` é atômico (1 query SQL, não 2)
- [ ] `reorderProductImagesAction` é atômico (1 query CASE WHEN)

### Frontend
- [ ] Rotas: `/products`, `/products/new`, `/products/[id]` funcionais
- [ ] `ProductsToolbar` com estado de filtros em URL params (não `useState`)
- [ ] `ProductForm` com tabs (em modo edit) e validação client + server
- [ ] `ProductImageGallery` com upload (multi-file), preview, primary toggle, reorder ↑↓, delete com confirmação
- [ ] `ProductDocumentList` com upload + select de tipo + download via signed URL on-click + delete
- [ ] Item "Produtos" no Sidebar
- [ ] Toast em toda mutação ([`docs/conventions/crud.md`](../docs/conventions/crud.md) regra 4)
- [ ] Danger Zone com `Dialog` de confirmação no archive (regra 5)
- [ ] Sem `router.refresh()` (regra 7) — `revalidatePath` no servidor cuida

### Design System Compliance
- [ ] **O código passa em todas as checagens do [`agents/quality/guardian.md`](../agents/quality/guardian.md) § 1a + § 1b.** Fonte normativa: [`design_system/enforcement/rules.md`](../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../design_system/components/CONTRACT.md). Este item é o único gate frontend.
- [ ] `node scripts/verify-design.mjs --changed` retorna 0 violações
- [ ] Componentes verificados com `data-theme="dark"` togglado no `<html>`
- [ ] Todos os formulários têm estados loading/erro/sucesso

### Build / Lint
- [ ] `npm run build` passa sem erro
- [ ] `npm run lint` passa sem novos warnings

### Testing (on-demand only)
> QA não é obrigatório nesta sprint. Pular esta seção.

---

## 8. Implementation Plan

### Phase 1: Database (`@db-admin`) — ~10 min
1. Probe live: confirmar RLS atual em `products`, `product_images`, `product_documents`. Se enforcement por `organization_id` está OK, sem migration de policies.
2. Probe live: confirmar se buckets `products`/`product-documents` já existem (provavelmente não).
3. Criar migration `[timestamp]_storage_products_buckets.sql` com buckets + 8 policies em `storage.objects` (idempotente).
4. Validar com `supabase db push --dry-run`.
5. Após gate, aplicar via `supabase db push` e atualizar snapshot.

### Phase 2: Backend (`@backend`) — ~25 min
1. Criar `src/lib/storage/paths.ts` e `src/lib/storage/signed-urls.ts`
2. Criar `src/lib/actions/products.ts` (6 actions) — usar `categories.ts` como template estrutural
3. Criar `src/lib/actions/product-images.ts` (4 actions) — atenção especial à atomicidade de primary/reorder e ao cleanup pós-falha
4. Criar `src/lib/actions/product-documents.ts` (3 actions)
5. Auto-validação local com `npm run build`

### Phase 3: Frontend (`@frontend`) — ~40 min
1. Criar rotas `src/app/(app)/products/{page.tsx,layout.tsx,new/page.tsx,[id]/page.tsx}`
2. Criar `src/components/products/{ProductsList,ProductsToolbar,ProductForm,ProductImageGallery,ProductDocumentList,ProductRowActions}.tsx`
3. Adicionar item "Produtos" no Sidebar
4. Auto-validação local: `npm run build` + `npm run lint` + `node scripts/verify-design.mjs --changed`

### Phase 4: Review (`@guardian`) — ~5 min
1. Validar `agents/quality/guardian.md` § 1a + § 1b
2. Aprovar ou rejeitar com lista específica de violações

### Phase 5: Closing (Tech Lead)
1. Mover sprint file para `sprints/done/`
2. Registrar em `docs/APRENDIZADOS.md` se algo não-óbvio aconteceu (ex: quirk de Storage, Server Action com FormData)
3. `@git-master` para commit

**Total estimado:** ~80 min de execução

---

## 9. Risks & Mitigations

### Risk 1: Storage RLS policies erradas vazam dados cross-org
**Impact:** High (incident de segurança)
**Probability:** Medium (primeira vez do projeto com Storage RLS — fácil errar a sintaxe de `storage.foldername`)
**Mitigation:** `@db-admin` testa policies com 2 users de orgs diferentes antes de marcar gate como pass. Critério de aceite explícito: tentativa cross-org via URL direta retorna 403.

### Risk 2: Cleanup de objeto órfão falha silenciosamente em produção
**Impact:** Medium (lixo acumulado no Storage, custo + auditoria difícil)
**Probability:** Low (rede + Storage Supabase são estáveis)
**Mitigation:** logar `[product-image:cleanup-failed]` com payload suficiente para reconciliação manual. Se padrão emergir nos primeiros sprints, criar job de cleanup (out of scope agora).

### Risk 3: Server Action com FormData tem quirk de tipagem em Next.js + RHF
**Impact:** Medium (bloqueia frontend)
**Probability:** Medium (padrão menos usado — categories só usa JSON)
**Mitigation:** `@backend` valida o padrão isoladamente antes de avançar. Se erro de tipagem, registrar em APRENDIZADOS para sprints futuras.

### Risk 4: `setPrimaryImage` ou `reorder` não-atômicos causam estado inconsistente em corrida
**Impact:** High (galeria com 0 ou 2 primary; ordem corrompida)
**Probability:** Low (raro 2 admins clicarem ao mesmo tempo)
**Mitigation:** PRD obriga implementação em 1 query SQL (CASE WHEN). Guardian deve verificar.

### Risk 5: Tamanho do `ProductForm` (5 tabs, 20 campos) gera componente monolítico difícil de manter
**Impact:** Low (manutenibilidade)
**Probability:** Medium
**Mitigation:** `@frontend` pode quebrar em `ProductFormBasicTab.tsx`, `ProductFormCommercialTab.tsx`, etc. se ficar > 400 linhas. Decisão delegada.

---

## 10. Dependencies

### Internal
- [x] Sprint 03 (Auth & Tenancy) — `getSessionContext()`, `assertRole`, RLS por org já operacionais
- [x] Sprint 05 (Categories) — `getCategoriesAction` usado no Select de categoria + reference module estrutural
- [x] Tabelas `products`, `product_images`, `product_documents` já existem com RLS
- [x] `src/components/ui/*` (Button, Input, Textarea, Select, Switch, Table, Tabs, Dialog, Badge, Skeleton, Pagination) — confirmar disponibilidade no momento da execução

### External
- [x] Supabase Storage habilitado no projeto (default em todo projeto Supabase)
- [ ] Buckets criados via migration (Phase 1)

---

## 11. Rollback Plan

Se issues forem encontrados após deploy:

1. **Imediato:** revert do commit final via `@git-master` (`git revert <hash>`).
2. **Database (Storage migration):** rollback manual via SQL — `DROP POLICY ...` × 8 + opcional `DELETE FROM storage.buckets WHERE id IN ('products', 'product-documents')` (cuidado: deleta buckets vazios; se já tem objetos uploadados, **não deletar**, só remover policies). `@db-admin` executa.
3. **Storage objects:** soft — não deletar objetos uploadados durante teste; deixar para limpeza manual posterior.
4. **Cache:** Next.js revalida automaticamente; se preciso forçar, redeploy.
5. **Monitoring:** checar logs do Supabase + console do browser por 24h após deploy.

**Rollback Command:**
```bash
git revert <commit-hash>
# Storage rollback (manual via supabase studio SQL editor):
# DROP POLICY IF EXISTS "products_select_org" ON storage.objects;
# (... × 8)
```

---

## Approval

**Created by:** @spec-writer (Tech Lead in spec-writer persona)
**Reviewed by:** @sanity-checker (pending)
**Approved by:** [user — pending]
**Date:** 2026-04-16
