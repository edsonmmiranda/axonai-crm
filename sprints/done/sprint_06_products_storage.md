# Sprint 06: Products + Storage (STANDARD)

> **Nível:** STANDARD
> **Origem:** `docs/roadmap.md` — Sprint 06
> **Pré-requisito:** Sprint 05 (Categories) concluída — `category_id` FK precisa de catálogo populado para o filtro funcionar de ponta a ponta.

---

## 🎯 Objetivo de Negócio

Admin/usuário da organização precisa cadastrar e gerenciar o catálogo de produtos da empresa — o **catálogo é o que o lead vai comprar**. Sem produtos cadastrados, o módulo de Leads (Sprint 08+) não tem como vincular oportunidades a SKUs reais, e o pipeline fica abstrato. Esta sprint entrega o primeiro CRUD com **upload real para Supabase Storage** (galeria de imagens com primary + reorder, biblioteca de documentos), estabelecendo o padrão que será reutilizado em qualquer módulo futuro que precise de mídia (avatares de perfil, anexos de lead, comprovantes de WhatsApp, etc).

**Métrica de sucesso:** admin loga, cria 1 produto com 3 imagens (uma marcada como primary) e 2 documentos PDF, edita o produto, reordena imagens, deleta uma imagem sem perder o produto, e a galeria persiste após reload — tudo respeitando `organization_id` via RLS no banco e isolamento por org no Storage.

## 👤 User Stories

- Como **admin**, eu quero cadastrar um produto com SKU único, preço, estoque, categoria e descrição, para ter o catálogo refletindo o que a empresa vende.
- Como **admin**, eu quero subir até N imagens por produto e marcar uma como capa (primary), para que a galeria mostre a imagem certa em listas e cards.
- Como **admin**, eu quero reordenar as imagens via drag (ou setas), para controlar a ordem de exibição na galeria sem ter que re-uploadar.
- Como **admin**, eu quero anexar documentos (ficha técnica, certificado, manual em PDF) ao produto, para que vendedores tenham material de apoio acessível.
- Como **admin**, eu quero buscar produtos por nome ou SKU e filtrar por categoria, para encontrar rápido em catálogos grandes.
- Como **user de outra organização**, eu NÃO consigo ver, baixar nem editar produtos, imagens ou documentos da organização alheia (RLS no banco + RLS no Storage).

## 🎨 Referências Visuais

- **Layout — Lista:** [design_system/telas_prontas/leads_lista.html](design_system/telas_prontas/leads_lista.html)
- **Layout — Criar:** [design_system/telas_prontas/leads_criar.html](design_system/telas_prontas/leads_criar.html)
- **Layout — Editar:** [design_system/telas_prontas/leads_editar.html](design_system/telas_prontas/leads_editar.html)
- **Design system:** tokens semânticos apenas (`bg-surface-*`, `text-text-*`, `bg-action-*`, `bg-feedback-*`). Nada de hex, nada de `bg-blue-500`, nada de `p-[17px]`. Regras autoritativas em [design_system/enforcement/rules.md](design_system/enforcement/rules.md) e [design_system/components/CONTRACT.md](design_system/components/CONTRACT.md).
- **Componentes reutilizados:** `src/components/ui/*` (Button, Input, Textarea, Select, Switch, Table, Tabs, Dialog, Badge, etc).

## 🧬 Reference Module Compliance

- **Módulo de referência (CRUD):** `src/app/(app)/settings/catalog/categories/` + `src/lib/actions/categories.ts` — entregue na Sprint 05. Estabelece o padrão de Server Actions (`ActionResponse<T>`, validação Zod, `getSessionContext()`, soft-delete via flag de status), padrão de form (react-hook-form + zodResolver), e padrão de lista (paginação server-side + busca debounced).
- **O que copiar:**
  - Estrutura de arquivos (Server Actions em `src/lib/actions/products.ts`, componentes em `src/components/products/`)
  - Naming pattern (`get[Entities]Action`, `create[Entity]Action`, `update[Entity]Action`, `delete[Entity]Action`)
  - Padrão de error handling (`ActionResponse<T>` em todas as actions)
  - Padrão de UI (toolbar com busca + filtros + CTA "Novo", tabela com paginação, form com Zod, breadcrumbs)
  - Helper compartilhado existente: `src/lib/actions/_shared/slugify.ts` se útil para gerar SKU automático em fallback (decisão do `@backend`).
- **O que trocar:**
  - Domínio: products no lugar de categories
  - Schema Zod: 20 campos (vs 4 em categories), incluindo numéricos com decimal, ARRAY de tags, FK para categoria
  - **Padrão NOVO (não há em categories):** upload para Supabase Storage, galeria de imagens com primary toggle e reorder por position, biblioteca de documentos com tipo. **Este padrão vira referência para sprints futuras** — toda decisão de Storage deve ser documentada em código (comentários WHY) e em `docs/APRENDIZADOS.md` se algo não-óbvio aparecer.

## 📋 Funcionalidades (Escopo)

### Backend

- [ ] **Banco de Dados (tabelas — JÁ EXISTEM, não criar migration de tabela):**
  - `products` (20 colunas) — confirmadas via [docs/schema_snapshot.json](docs/schema_snapshot.json):
    - `id` uuid PK · `organization_id` uuid NOT NULL · `name` varchar(255) NOT NULL · `short_description` text · `description` text · `price` numeric · `sku` varchar(100) NOT NULL · `status` varchar(20) DEFAULT `'active'` · `stock` integer DEFAULT 0 · `weight` numeric · `height` numeric · `width` numeric · `depth` numeric · `brand` varchar(100) · `tags` text[] · `notes` text · `created_at` timestamptz · `updated_at` timestamptz · `created_by` uuid · `category_id` uuid (FK → categories.id)
    - UNIQUE: `(organization_id, sku)` (índice `unique_sku_per_org`)
    - Índices existentes: `category_id`, `created_at DESC`, `organization_id`, `sku`, `status`
  - `product_images` (10 colunas):
    - `id` uuid PK · `product_id` uuid NOT NULL · `url` text NOT NULL · `file_name` varchar(255) NOT NULL · `file_size` integer · `mime_type` varchar(50) · `position` integer DEFAULT 0 · `is_primary` boolean DEFAULT false · `created_at` timestamptz · `uploaded_by` uuid
    - Índices: `(product_id, position)`, partial `(product_id, is_primary) WHERE is_primary = true`, `product_id`
  - `product_documents` (9 colunas):
    - `id` uuid PK · `product_id` uuid NOT NULL · `url` text NOT NULL · `file_name` varchar(255) NOT NULL · `file_size` integer · `mime_type` varchar(50) · `document_type` varchar(50) · `created_at` timestamptz · `uploaded_by` uuid
    - Índices: `product_id`, `document_type`
  - **RLS:** as 3 tabelas têm 4 policies cada (SELECT/INSERT/UPDATE/DELETE) já criadas. **`@db-admin` deve confirmar no início da sprint** que as policies enforçam `organization_id = get_current_org()` em `products` e que as policies em `product_images`/`product_documents` enforçam acesso via JOIN com `products.organization_id`. Se faltar isolamento, criar migration idempotente só de policies.

- [ ] **Banco de Dados — MIGRATION NOVA: Storage buckets + Storage RLS**
  - **`@db-admin` é o owner.** Criar migration idempotente que:
    1. Cria 2 buckets via `storage.buckets`: `products` (público de leitura, escrita autenticada) e `product-documents` (privado, leitura assinada). Decisão final público vs privado fica com `@db-admin` justificando trade-off (URLs públicas → não dá pra revogar; URLs assinadas → mais código mas seguro). **Default sugerido:** `products` privado também — sempre via signed URL, mantém isolamento por org consistente. `@db-admin` decide.
    2. Cria policies de Storage (`storage.objects`) que enforçam: usuário só pode SELECT/INSERT/UPDATE/DELETE objetos cujo path comece com `{organization_id}/...`. Bloqueia leitura/escrita cross-org no nível Storage (defesa em profundidade — não confiar só em RLS de tabela).
  - **Convenção de path obrigatória:** `{organization_id}/{product_id}/{uuid}-{filename}`. Documentar em `docs/conventions/standards.md` (Tech Lead atualiza no closing) ou em `docs/APRENDIZADOS.md`.
  - Se buckets já existirem (probe via SQL), migration deve ser no-op para essa parte e apenas garantir policies.

- [ ] **Server Actions de Products (`src/lib/actions/products.ts`):**
  - `getProductsAction({ search?, categoryId?, status?, page?, pageSize? })` — lista paginada (default 20/página). Busca por `name` OU `sku` (ILIKE). Filtros: `category_id`, `status`. Default: ordena por `created_at DESC`. Retorna `ActionResponse<{ data: Product[]; total; page; pageSize }>`. JOIN com `categories` para retornar `category_name` (evita N+1 no frontend) e LEFT JOIN com `product_images WHERE is_primary` para retornar `primary_image_url` (1 por produto na lista).
  - `getProductByIdAction(id)` — retorna produto completo + arrays de imagens (ordenadas por `position`) + documentos. 404 se não pertence à org (via RLS, sem vazar existência).
  - `createProductAction(input)` — valida via Zod, seta `organization_id` + `created_by` via `getSessionContext()`. Captura erro Postgres `23505` (unique_sku_per_org) e retorna mensagem legível "SKU já existe nesta organização".
  - `updateProductAction(id, input)` — bloqueia update cross-org (RLS + validação explícita). Atualiza `updated_at` automaticamente (trigger ou manual conforme padrão do schema).
  - `deleteProductAction(id)` — **soft delete:** seta `status = 'archived'`. Não deleta imagens/documentos do Storage no soft delete (preserva histórico). **`@backend` decide** se cria também `hardDeleteProductAction(id)` para hard delete (purga DB + Storage) — recomendado para edge case de erro de cadastro nos primeiros minutos. Se criar, exigir confirmação dupla na UI.
  - `restoreProductAction(id)` — seta `status = 'active'`.
  - **Validação Zod:** `name` 2-255 · `sku` 1-100 (alfanumérico + hífen + underscore) · `price` numeric ≥ 0 · `stock` integer ≥ 0 · `status` enum ['active', 'archived'] · dimensões (`weight`, `height`, `width`, `depth`) opcional ≥ 0 · `brand` max 100 · `tags` array de string max 30 chars cada (max 20 tags) · `category_id` uuid opcional · `notes` max 2000.

- [ ] **Server Actions de Imagens (`src/lib/actions/product-images.ts`):**
  - `uploadProductImageAction(productId, formData)` — recebe `File` via FormData (Server Action com FormData, não JSON). Valida no servidor: mime_type ∈ `['image/jpeg', 'image/png', 'image/webp']`, file_size ≤ 5MB. Faz upload para bucket `products` no path `{organization_id}/{product_id}/{uuid}-{filename}`. Insere row em `product_images` com `position = MAX(position) + 1`, `is_primary = true` se for a primeira imagem do produto, `false` caso contrário. Retorna `ActionResponse<ProductImage>`.
  - `deleteProductImageAction(imageId)` — deleta row do banco + objeto do Storage. Se a imagem deletada era `is_primary` e ainda existem outras imagens, promove a próxima (menor `position`) a primary atomicamente.
  - `setPrimaryImageAction(imageId)` — em transação: marca a imagem alvo como `is_primary = true` e todas as outras imagens do mesmo produto como `false`. **Atomic** (UPDATE em uma única query usando CASE WHEN, ou transação explícita).
  - `reorderProductImagesAction(productId, orderedIds: string[])` — recebe array ordenado de IDs. Valida que todas pertencem ao produto (e produto pertence à org). Atualiza `position` em bulk (UPDATE com CASE WHEN ou múltiplos UPDATEs em transação). Operação atômica — se falhar no meio, rollback total.
  - **Signed URL helper:** `getProductImageSignedUrl(path: string, expiresIn = 3600)` — wrapper que pede signed URL ao Supabase. Reutilizado pela lista e galeria. Cache opcional por sessão se padrão emerge de performance.

- [ ] **Server Actions de Documentos (`src/lib/actions/product-documents.ts`):**
  - `uploadProductDocumentAction(productId, formData, documentType?)` — valida mime_type ∈ `['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']`, file_size ≤ 20MB. Upload para bucket `product-documents` no path `{organization_id}/{product_id}/{uuid}-{filename}`. Insere row com `document_type` opcional (string livre, sugestão de UI: 'manual', 'ficha-tecnica', 'certificado', 'outro').
  - `deleteProductDocumentAction(documentId)` — deleta row + objeto do Storage.
  - `getProductDocumentSignedUrl(path, expiresIn = 600)` — signed URL curta (10 min) para download. Documentos sempre privados.

- [ ] **Helpers compartilhados:**
  - `src/lib/storage/upload.ts` — função pura `uploadToBucket({ bucket, path, file })` que encapsula a chamada do client de Storage e trata erros de forma consistente. Reutilizável por avatares (Sprint 04 já tocou nisso? checar) e futuros uploads.
  - `src/lib/storage/paths.ts` — função `buildStoragePath({ orgId, productId, fileName })` retorna `{orgId}/{productId}/{uuid}-{sanitized-filename}`. Sanitização do filename (remove acentos, espaços → `-`, lowercase).

### Frontend

- [ ] **Rotas:**
  - `src/app/(app)/products/page.tsx` — listagem (Server Component que consome `getProductsAction`, passa para Client Table).
  - `src/app/(app)/products/new/page.tsx` — criação.
  - `src/app/(app)/products/[id]/page.tsx` — edição (carrega via `getProductByIdAction`).

- [ ] **Componentes (`src/components/products/`):**
  - `ProductsList` — tabela com colunas: **Imagem (thumbnail primary)** · Nome · SKU · Categoria · Preço · Estoque · Status (badge) · Criado em · Ações (editar, arquivar/restaurar). Baseada em `leads_lista.html`. Empty state ("Nenhum produto cadastrado — crie o primeiro"), loading skeleton, error state. Toolbar: busca debounced 300ms (nome ou SKU) + select de categoria + select de status + CTA "Novo Produto".
  - `ProductForm` — campos distribuídos em **tabs ou seções colapsáveis** dado o volume (20 campos):
    - **Básico:** name, sku, category_id (Select com categorias da org), short_description, description (textarea), brand, tags (multi-input, comma-separated ou chip input)
    - **Comercial:** price (input com máscara R$), stock (number), status (switch active/archived)
    - **Dimensões:** weight, height, width, depth (todos opcionais)
    - **Notas:** notes (textarea longa)
    - **Mídia:** seções de imagens e documentos (renderizadas só em modo edit, depois que o produto tem ID)
  - `ProductImageGallery` — grid de thumbnails. Cada thumbnail: badge "Primary" se aplicável, botão de menu (Definir como primary, Deletar). Drag handle ou setas ↑↓ para reorder (`@dnd-kit/sortable` opcional — alternativa simples: 2 botões por imagem). Botão "Adicionar imagem" com input file (multi-select) + preview antes do upload + barra de progresso durante upload. Confirma deleção via Dialog.
  - `ProductDocumentList` — lista vertical de documentos. Cada item: ícone por mime_type, file_name, document_type (badge), file_size formatado, link de download (signed URL gerada on-demand), botão deletar. Botão "Adicionar documento" com input file + select de document_type.
  - `UploadDropzone` (compartilhado, em `src/components/ui/` se útil para o futuro) — área de drag-and-drop + click para abrir file picker. Aceita props `accept`, `maxSize`, `multiple`. Apenas UX — a chamada de upload é responsabilidade do componente pai.
  - Estados: loading skeleton para grid de imagens, empty state ("Nenhuma imagem ainda"), upload progress, error state com retry.

- [ ] **Navegação:**
  - Adicionar item "Produtos" no menu lateral principal (`src/components/layout/Sidebar.tsx` ou equivalente — `@frontend` confirma o path), com ícone apropriado. Posição: depois de Dashboard, antes de Leads (módulo principal, não settings).
  - Breadcrumbs: `Produtos / [Novo | Nome do produto]`.

## 🧪 Edge Cases

- [ ] **Estado vazio (org sem produtos):** lista exibe empty state com CTA "Cadastrar primeiro produto".
- [ ] **SKU duplicado na mesma org:** validação Zod client-side básica + captura de erro `23505` no servidor → toast "SKU 'XXX' já está em uso nesta organização" e foco no campo SKU.
- [ ] **Produto sem categoria:** permitido (`category_id` é nullable). Lista mostra "—" na coluna de categoria.
- [ ] **Categoria do produto foi arquivada/excluída depois do cadastro:** lista mostra a categoria mesmo arquivada (com indicação visual sutil "(arquivada)"). Form de edição permite manter ou trocar.
- [ ] **RLS cross-org:** usuário da org A tenta acessar `/products/{id-da-org-B}` → 404. Tenta baixar imagem/documento via URL direta do Storage → 403 do Supabase Storage policies.
- [ ] **Upload acima de 5MB (imagem) ou 20MB (documento):** validação no client (UX rápida) E no server (verdade autoritativa). Erro legível.
- [ ] **Mime type não permitido:** mesma estratégia (client + server). Exibir lista do que é aceito no toast de erro.
- [ ] **Upload falha no meio (rede caiu, Storage retornou erro):** row no banco NÃO é criada (upload primeiro, insert depois). Se o insert falhar mas o objeto subiu, deletar o objeto (cleanup). Toast de erro claro.
- [ ] **Deletar a única imagem primary:** automaticamente promove a próxima (por menor `position`) a primary. Se era a última, produto fica sem imagem (válido).
- [ ] **Definir primary em corrida (dois admins clicando ao mesmo tempo):** transação atômica garante que apenas uma imagem fica como primary por produto. Last-write-wins é aceitável.
- [ ] **Reorder com 0 ou 1 imagem:** no-op silencioso, sem erro.
- [ ] **Reorder com IDs inválidos (ID não pertence ao produto):** bloqueia toda a operação e retorna erro. Não atualiza nada (transação).
- [ ] **Tags array vazia ou null:** ambos válidos. UI normaliza para array vazia ao exibir.
- [ ] **Soft-delete (arquivar) produto com imagens/documentos:** mantém arquivos no Storage. Decisão consciente — produto pode ser restaurado.
- [ ] **Hard-delete (se implementado) com falha parcial:** se DB delete passou mas Storage cleanup falhou, logar para reconciliação manual. Não ressuscitar a row.
- [ ] **Erro de rede no form principal:** toast de erro, mantém dados preenchidos. Uploads em progresso mostram retry.
- [ ] **Dois tabs editando o mesmo produto:** last-write-wins (sem lock otimista nesta sprint). Aceitável para escopo atual.
- [ ] **Produto com 50+ imagens:** galeria deve manter performance (lazy loading de thumbnails, signed URLs em batch).

## 🚫 Fora de escopo

- **Variantes de produto** (cor, tamanho, voltagem) — pós-MVP, exigirá tabela `product_variants`.
- **Estoque por variante / movimentação de estoque** — fora. `stock` é um inteiro simples por produto.
- **Histórico de preços / promoções / descontos** — fora.
- **Integração com gateway de pagamento ou marketplace** — fora.
- **Bulk import via CSV / planilha** — sprint separada se houver demanda.
- **Bulk actions** (arquivar em massa, mudar categoria em massa) — sprint separada.
- **Crop / edição de imagem no client** — fora. Upload é do arquivo original (limitado a 5MB).
- **Reconhecimento de imagem / IA para tags automáticas** — fora.
- **Versionamento de documentos** (v1, v2 do manual) — fora. Re-upload substitui via deleção + novo upload manual.
- **Auditoria de quem fez upload/delete** — campos `uploaded_by` e `created_by` ficam preenchidos, mas não há tela de log nesta sprint.
- **i18n.** Labels em pt-BR hardcoded (padrão do app hoje).
- **CDN próprio / otimização de imagem (Next/Image com remotePatterns)** — começar com signed URL direta. Otimização vira sprint própria se métricas pedirem.

## ⚠️ Critérios de Aceite

- [ ] CRUD completo de Products funcional: criar, listar (com busca + filtros categoria/status + paginação), editar, arquivar (soft), restaurar.
- [ ] Upload de imagem funciona end-to-end: arquivo vai para bucket no path `{org}/{product}/{uuid}-{name}`, row criada em `product_images`, thumbnail aparece na galeria via signed URL.
- [ ] Upload de documento funciona end-to-end com mesma garantia, no bucket de documentos.
- [ ] Galeria de imagens: marcar primary funciona atomicamente, reorder persiste após reload, deletar imagem promove nova primary se necessário.
- [ ] Validação Zod em todas as Server Actions de products, images, documents.
- [ ] RLS testada cross-org no banco: user da org A não vê produtos/imagens/documentos da org B.
- [ ] RLS de Storage testada cross-org: user da org A não consegue baixar arquivo de path da org B nem mesmo com URL direta tentada.
- [ ] SKU único por org enforçado (erro `23505` capturado e exibido legivelmente).
- [ ] Limites de tamanho (5MB imagens, 20MB documentos) e mime types validados client + server.
- [ ] Todos os edge cases acima tratados.
- [ ] Design alinhado com `leads_lista.html` / `leads_criar.html` / `leads_editar.html` via tokens semânticos. Nenhum hex/arbitrary class.
- [ ] `npm run build` passa sem erros.
- [ ] `npm run lint` passa sem novos warnings.
- [ ] **Guardian aprova o código** — gate único para compliance de design system conforme [agents/quality/guardian.md](agents/quality/guardian.md).

---

## 🤖 Recomendação de Execução

**Análise:**
- Nível: STANDARD
- Complexity Score: **~14** (DB +5: 3 tabelas tocadas + Storage migration + RLS Storage; API +6: ~10 Server Actions, FormData, signed URLs; UI +3: form com 20 campos em tabs + galeria com reorder; Lógica +5: padrão Storage novo, atomicidade de primary/reorder, cleanup em falha; Dependências +1: Storage)
- Reference Module: **sim** — `src/app/(app)/settings/catalog/categories/` (parcial: cobre CRUD, NÃO cobre Storage)
- Integração com API externa: **não** (Supabase Storage é interno)
- Lógica de negócio nova/ambígua: **sim** — primeira sprint tocando Storage; convenções de path, política público vs privado, atomicidade de primary, cleanup de objetos órfãos em falha de upload são decisões que **viram padrão** para sprints futuras
- Ambiguity Risk: **alto** (Storage permite múltiplas interpretações em cada decisão; PRD reduz drift)

---

### Opção 1 — SIMPLES (sem PRD)
- **Fluxo:** Tech Lead → @db-admin → @backend → @frontend → @guardian → gates → @git-master
- **PRD:** pulado; o próprio sprint file é o contrato
- **Modelo sugerido:** Sonnet — não recomendado para esta sprint
- **Quando faz sentido:** **NÃO faz sentido aqui.** Score 14 (>9), lógica nova com decisões que viram padrão, e ambiguidade alta nos pontos de Storage. Cold review do `@spec-writer` paga o próprio custo evitando retrabalho de 1-2 ciclos no `@backend`.

### Opção 2 — COMPLETA (com PRD)
- **Fluxo:** Tech Lead → @spec-writer → @sanity-checker (loop até 3×) → STOP & WAIT → @db-admin → @backend → @frontend → @guardian → gates → @git-master
- **PRD:** gerado em `prds/prd_sprint_06_products_storage.md` e validado
- **Modelo sugerido:** **Opus** — cold review + loop de sanity-checker só pagam o custo em Opus; em Sonnet drifta
- **Quando faz sentido:** **AGORA.** Sprint complexa, primeira a tocar Storage, decisões viram padrão. Roadmap explicitamente recomenda Opus para esta sprint pelo mesmo motivo.

---

**Recomendação do @sprint-creator:** **Opção 2 — Opus**

**Justificativa:**
Score 14 (acima do limiar 9 que força Opção 2). Lógica de Storage é nova no projeto e as decisões aqui viram padrão para qualquer módulo futuro com mídia (avatares, anexos, comprovantes). Ambiguity risk alto em 4 pontos: política bucket público/privado, convenção de path, atomicidade de primary toggle, cleanup de objetos órfãos em falha. PRD + sanity-checker antecipam essas decisões antes do `@backend` codar, evitando retrabalho. Roadmap explicitamente marca esta sprint como Opus pelo mesmo motivo.

**Aguardando escolha do usuário:** responda ao Tech Lead com `"execute opção 1"` ou `"execute opção 2"` (ou aceite a recomendação dizendo apenas `"execute"`).
