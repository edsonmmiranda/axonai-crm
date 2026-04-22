# Server Actions — Quick Reference

> **Propósito:** este arquivo consolida os templates canônicos de **todas** as operações de Server Action em um único documento. Leia **este arquivo primeiro** antes de criar qualquer Server Action. Para regras invioláveis, consulte [`standards.md`](../conventions/standards.md).
>
> **Este arquivo elimina a necessidade de ler módulos existentes no projeto.** Não varra `src/lib/actions/` para descobrir padrões — tudo que o agente precisa está aqui.

---

## 1. Estrutura de um arquivo de actions

Todo módulo segue esta anatomia. **Copie esta estrutura e adapte.**

```
'use server'
imports
├── next/cache (revalidatePath)
├── zod
├── assertRole
├── constantes do módulo (SORT_KEYS, PAGE_SIZES, STATUS, etc.)
├── getSessionContext
├── createClient

interfaces
├── ActionResponse<T>
├── PaginationMeta
├── EntityRow (tipo da tabela)
├── EntityListRow (Row + campos de join, se houver)
├── EntityDetail (Row + dados relacionados, se houver)

schemas Zod
├── campos individuais (NameSchema, StatusSchema, etc.)
├── CreateEntitySchema
├── UpdateEntitySchema
├── ListParamsSchema (search, filtros, page, pageSize, sort)

tipos exportados
├── CreateEntityInput, UpdateEntityInput, ListEntityInput

constantes internas
├── ENTITY_SELECT (colunas da tabela para não repetir)

helpers internos (se necessário)
├── buildPayload() — normaliza nulls/defaults
├── normalizeJoin() — trata join que pode vir como array ou objeto

actions exportadas
├── getEntitiesAction (list)
├── getEntityByIdAction
├── createEntityAction
├── updateEntityAction
├── archiveEntityAction / deactivateEntityAction
├── restoreEntityAction
├── deleteEntityAction (hard delete)
├── getEntityStatsAction (se listagem tem stat cards)
```

---

## 2. Contrato de retorno (obrigatório em toda action)

```typescript
interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: PaginationMeta;
}

interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  itemsPerPage: number;
}
```

- `success: true` + `data` = operação bem-sucedida
- `success: false` + `error` = mensagem amigável ao usuário
- `metadata` apenas em list actions

---

## 3. Schemas Zod — padrões recorrentes

### Campos de texto

```typescript
const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(255, 'Nome deve ter no máximo 255 caracteres');
```

### Campo opcional que pode vir vazio do form

```typescript
const DescriptionSchema = z
  .string()
  .trim()
  .max(5000, 'Descrição deve ter no máximo 5000 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));
```

### UUID nullable (ex: foreign key opcional)

```typescript
const CategoryIdSchema = z
  .string()
  .uuid('Categoria inválida')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
```

### Enum

```typescript
const StatusSchema = z.enum(['active', 'archived']).optional();

// Com constante importada do módulo:
const ColorSchema = z.enum(TAG_COLORS, { message: 'Cor inválida' });
```

### Numéricos

```typescript
const PriceSchema = z.number().nonnegative('Preço não pode ser negativo').optional();
const StockSchema = z
  .number()
  .int('Estoque deve ser inteiro')
  .nonnegative('Estoque não pode ser negativo')
  .optional();
```

### Array de strings (tags)

```typescript
const TagsSchema = z
  .array(
    z.string().trim().min(1, 'Tag vazia não é permitida').max(30, 'Tag deve ter no máximo 30 caracteres')
  )
  .max(20, 'Máximo de 20 tags')
  .optional();
```

### Regex (SKU, telefone, etc.)

```typescript
const SkuSchema = z
  .string()
  .trim()
  .min(1, 'SKU é obrigatório')
  .max(100, 'SKU deve ter no máximo 100 caracteres')
  .regex(/^[A-Za-z0-9_-]+$/, 'SKU aceita apenas letras, números, hífen e underscore');
```

### Schema de sort (reutilizável entre módulos)

```typescript
const SortRuleSchema = z.object({
  key: z.enum(ENTITY_SORT_KEYS),  // importado de lib/[module]/constants
  dir: z.enum(['asc', 'desc']),
});
```

### Schema de list params (reutilizável entre módulos)

```typescript
const ListParamsSchema = z.object({
  search: z.string().trim().max(255).optional(),
  // filtros específicos da entidade:
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  categoryId: z.string().uuid().optional(),
  // paginação:
  page: z.number().int().min(1).optional().default(1),
  pageSize: z
    .number()
    .int()
    .refine((v) => (ENTITY_PAGE_SIZES as readonly number[]).includes(v), {
      message: 'Tamanho de página inválido',
    })
    .optional()
    .default(20),
  sort: z.array(SortRuleSchema).max(6).optional().default([]),
});
```

---

## 4. Templates por operação

### 4.1 List (com paginação, filtros, sort)

```typescript
export async function getEntitiesAction(
  input: ListEntitiesInput = {}
): Promise<ActionResponse<EntityRow[]>> {
  const parsed = ListParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, status, page, pageSize, sort } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('entities')
      .select(ENTITY_COLUMNS, { count: 'exact' })
      .eq('organization_id', ctx.organizationId);

    // Sort
    if (sort.length > 0) {
      for (const rule of sort) {
        query = query.order(rule.key, { ascending: rule.dir === 'asc' });
      }
    } else {
      query = query.order('created_at', { ascending: false });
    }

    // Paginação
    query = query.range(from, to);

    // Filtros
    if (status !== 'all') {
      query = query.eq('status', status);
    }
    if (search && search.length > 0) {
      const term = search.replace(/[%_]/g, '\\$&');
      query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
    }

    const { data, error, count } = await query.returns<EntityRow[]>();

    if (error) {
      console.error('[entities:list]', error);
      return { success: false, error: 'Não foi possível carregar os registros.' };
    }

    const total = count ?? 0;
    return {
      success: true,
      data: data ?? [],
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        currentPage: page,
        itemsPerPage: pageSize,
      },
    };
  } catch (error) {
    console.error('[entities:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

**Se a listagem precisa de dados de join** (ex: nome da categoria), adicione o join no select e normalize:

```typescript
// Select com join
.select(`${ENTITY_COLUMNS}, category:categories(id, name)`, { count: 'exact' })

// Tipo para o retorno bruto do Supabase (join pode vir como array ou objeto)
type RawEntityWithJoin = EntityRow & {
  category: { id: string; name: string } | { id: string; name: string }[] | null;
};

// Normalização (Supabase pode retornar array ou objeto dependendo da relação)
function normalizeJoin<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// Mapeamento para o tipo de lista
const listRows: EntityListRow[] = rows.map((r) => {
  const category = normalizeJoin(r.category);
  const { category: _omit, ...rest } = r;
  void _omit;
  return { ...rest, category_name: category?.name ?? null };
});
```

### 4.2 GetById — entidade simples

```typescript
export async function getEntityByIdAction(
  id: string
): Promise<ActionResponse<EntityRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('entities')
      .select(ENTITY_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<EntityRow>();

    if (error) {
      console.error('[entities:get]', error);
      return { success: false, error: 'Não foi possível carregar o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[entities:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

### 4.3 GetById — com dados relacionados (imagens, documentos, etc.)

```typescript
export async function getEntityByIdAction(
  id: string
): Promise<ActionResponse<EntityDetail>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Busca principal
    const { data, error } = await supabase
      .from('entities')
      .select(`${ENTITY_COLUMNS}, category:categories(id, name)`)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<RawEntityWithJoin>();

    if (error) {
      console.error('[entities:get]', error);
      return { success: false, error: 'Não foi possível carregar o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    // Dados relacionados em paralelo
    const [imagesResult, documentsResult] = await Promise.all([
      supabase
        .from('entity_images')
        .select('id, entity_id, url, file_name, position, is_primary, created_at')
        .eq('entity_id', parsed.data)
        .order('position', { ascending: true })
        .returns<EntityImageDetail[]>(),
      supabase
        .from('entity_documents')
        .select('id, entity_id, url, file_name, file_size, mime_type, created_at')
        .eq('entity_id', parsed.data)
        .order('created_at', { ascending: false })
        .returns<EntityDocumentDetail[]>(),
    ]);

    if (imagesResult.error) console.error('[entities:get:images]', imagesResult.error);
    if (documentsResult.error) console.error('[entities:get:documents]', documentsResult.error);

    const category = normalizeJoin(data.category);
    const { category: _omit, ...rest } = data;
    void _omit;

    return {
      success: true,
      data: {
        ...rest,
        category_name: category?.name ?? null,
        images: imagesResult.data ?? [],
        documents: documentsResult.data ?? [],
      },
    };
  } catch (error) {
    console.error('[entities:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

### 4.4 Create

```typescript
export async function createEntityAction(
  input: CreateEntityInput
): Promise<ActionResponse<EntityRow>> {
  const parsed = CreateEntitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const payload = buildPayload(parsed.data);

    const { data, error } = await supabase
      .from('entities')
      .insert({
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
        ...payload,
      })
      .select(ENTITY_COLUMNS)
      .single<EntityRow>();

    if (error) {
      // Unique constraint violation
      if (error.code === '23505') {
        return { success: false, error: 'Já existe um registro com este nome/código.' };
      }
      console.error('[entities:create]', error);
      return { success: false, error: 'Não foi possível criar o registro.' };
    }

    revalidatePath('/entities');
    return { success: true, data };
  } catch (error) {
    console.error('[entities:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

**Helper `buildPayload`** — normaliza campos opcionais para null:

```typescript
function buildPayload(input: z.infer<typeof EntityPayloadSchema>) {
  return {
    name: input.name,
    sku: input.sku,
    category_id: input.category_id ?? null,
    description: input.description ?? null,
    price: input.price ?? null,
    stock: input.stock ?? 0,
    status: (input.status ?? 'active') as EntityStatus,
    tags: input.tags && input.tags.length > 0 ? input.tags : null,
    notes: input.notes ?? null,
  };
}
```

### 4.5 Update

```typescript
export async function updateEntityAction(
  id: string,
  input: UpdateEntityInput
): Promise<ActionResponse<EntityRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  const parsed = UpdateEntitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const payload = buildPayload(parsed.data);

    const { data, error } = await supabase
      .from('entities')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(ENTITY_COLUMNS)
      .maybeSingle<EntityRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe um registro com este nome/código.' };
      }
      console.error('[entities:update]', error);
      return { success: false, error: 'Não foi possível atualizar o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    revalidatePath('/entities');
    revalidatePath(`/entities/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[entities:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

### 4.6 Soft delete — archive/restore

**Opção A: helper reutilizável** (quando archive e restore são simétricos)

```typescript
async function setStatus(
  id: string,
  status: EntityStatus,
  logScope: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('entities')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) {
      console.error(`[entities:${logScope}]`, error);
      return { success: false, error: 'Não foi possível atualizar o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    revalidatePath('/entities');
    revalidatePath(`/entities/${parsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error(`[entities:${logScope}] unexpected`, error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function archiveEntityAction(id: string) {
  return setStatus(id, 'archived', 'archive');
}

export async function restoreEntityAction(id: string) {
  return setStatus(id, 'active', 'restore');
}
```

**Opção B: actions separadas** (quando deactivate/restore têm lógica diferente)

```typescript
export async function deactivateEntityAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('entities')
      .update({ is_active: false })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[entities:deactivate]', error);
      return { success: false, error: 'Não foi possível desativar o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    revalidatePath('/entities');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[entities:deactivate] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

### 4.7 Hard delete (com verificação de vínculos)

```typescript
export async function deleteEntityAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Registro não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    // Verificar vínculos antes de excluir
    const { count, error: countError } = await supabase
      .from('related_entities')         // tabela de junção ou FK
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', parsed.data);

    if (countError) {
      console.error('[entities:delete:check]', countError);
      return { success: false, error: 'Não foi possível verificar vínculos.' };
    }

    if (count && count > 0) {
      return {
        success: false,
        error: `Este registro está vinculado a ${count} item(ns) e não pode ser excluído. Desative-o em vez disso.`,
      };
    }

    // Exclusão
    const { data, error } = await supabase
      .from('entities')
      .delete()
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[entities:delete]', error);
      return { success: false, error: 'Não foi possível excluir o registro.' };
    }
    if (!data) {
      return { success: false, error: 'Registro não encontrado.' };
    }

    revalidatePath('/entities');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[entities:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

### 4.8 Stats (para stat cards na listagem)

```typescript
export interface EntityStats {
  total: number;
  active: number;
  archived: number;
  // adicione contadores específicos da entidade
}

export async function getEntityStatsAction(): Promise<ActionResponse<EntityStats>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    // Helper para não repetir o base select
    const baseCount = () =>
      supabase
        .from('entities')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', ctx.organizationId);

    const [totalRes, activeRes, archivedRes] = await Promise.all([
      baseCount(),
      baseCount().eq('status', 'active'),
      baseCount().eq('status', 'archived'),
    ]);

    if (totalRes.error || activeRes.error || archivedRes.error) {
      console.error('[entities:stats]', {
        total: totalRes.error,
        active: activeRes.error,
        archived: archivedRes.error,
      });
      return { success: false, error: 'Não foi possível carregar as estatísticas.' };
    }

    return {
      success: true,
      data: {
        total: totalRes.count ?? 0,
        active: activeRes.count ?? 0,
        archived: archivedRes.count ?? 0,
      },
    };
  } catch (error) {
    console.error('[entities:stats] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
```

---

## 5. Utilities comuns

### assertRole

```typescript
import { assertRole } from '@/lib/actions/_shared/assertRole';

// Uso: antes de qualquer mutação (create, update, delete)
const gate = assertRole(ctx, ['owner', 'admin']);
if (!gate.ok) {
  return { success: false, error: gate.error };
}
```

- **List e GetById** não precisam de assertRole — RLS do Supabase já filtra por organization
- **Create, Update, Delete, Archive/Restore** sempre precisam

### getSessionContext

```typescript
import { getSessionContext } from '@/lib/supabase/getSessionContext';

const ctx = await getSessionContext();
// ctx.userId — ID do usuário autenticado
// ctx.organizationId — ID da organização do usuário
// ctx.role — role do usuário na organização
```

### Constante de colunas (evita repetição)

```typescript
const ENTITY_COLUMNS =
  'id, organization_id, name, status, created_at, updated_at' as const;
```

### Constantes do módulo (importadas de `lib/[module]/constants.ts`)

```typescript
// lib/[module]/constants.ts
export const ENTITY_SORT_KEYS = ['name', 'created_at', 'updated_at', 'status'] as const;
export const ENTITY_PAGE_SIZES = [10, 20, 50, 100] as const;
export type EntityStatus = 'active' | 'archived';
```

---

## 6. Revalidação de cache

```typescript
import { revalidatePath } from 'next/cache';

// Após create/delete/archive:
revalidatePath('/entities');

// Após update (revalidar lista + detalhe):
revalidatePath('/entities');
revalidatePath(`/entities/${id}`);
```

---

## 7. Tratamento de erros — padrão único

```typescript
// Toda action segue este esqueleto de try/catch:
try {
  // ... lógica
  if (error) {
    // Unique constraint
    if (error.code === '23505') {
      return { success: false, error: 'Já existe um registro com este valor.' };
    }
    console.error('[module:operation]', error);
    return { success: false, error: 'Mensagem amigável genérica.' };
  }
} catch (error) {
  // Erro de validação Zod (quando usando .parse() em vez de .safeParse())
  if (error instanceof z.ZodError) {
    return { success: false, error: error.issues[0].message };
  }
  console.error('[module:operation] unexpected', error);
  return { success: false, error: 'Erro interno, tente novamente' };
}
```

**Regras de erro:**
- `console.error` internamente — **nunca** `error.message` no retorno
- Prefixo de log: `[module:operation]` (ex: `[products:create]`, `[tags:list]`)
- Zod 4 usa `.issues[0].message`, não `.errors`
- Nunca `catch {}` silencioso

---

## 8. Guia de decisão rápido

| Preciso de | Use o template |
|---|---|
| Listagem paginada com filtros | §4.1 List |
| Detalhe simples (poucos campos) | §4.2 GetById simples |
| Detalhe com imagens/docs/relações | §4.3 GetById com relacionados |
| Criar registro | §4.4 Create |
| Atualizar registro | §4.5 Update |
| Inativar/restaurar (campo status ou is_active) | §4.6 Soft delete |
| Excluir permanentemente | §4.7 Hard delete |
| Contadores para stat cards | §4.8 Stats |
| Entidade simples (poucos campos, sem joins) | Use §4.1 + §4.2 + §4.4 + §4.5 na versão mínima |
| Entidade complexa (joins, imagens, muitos campos) | Use versões completas com buildPayload e normalizeJoin |

---

## 9. Referências

- Contrato `ActionResponse<T>` e regras invioláveis: [`standards.md`](../conventions/standards.md)
- Error handling detalhado: [`agents/skills/error-handling/SKILL.md`](../../agents/skills/error-handling/SKILL.md)
- Clonagem de módulo existente: [`agents/skills/reference-module-copy/SKILL.md`](../../agents/skills/reference-module-copy/SKILL.md)
- Paths canônicos e regras de CRUD: [`crud.md`](../conventions/crud.md)
