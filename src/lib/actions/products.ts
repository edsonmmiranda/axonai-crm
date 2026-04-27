'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { enforceLimit } from '@/lib/limits/enforceLimit';
import {
  PRODUCT_PAGE_SIZES,
  PRODUCT_SORT_KEYS,
  type ProductStatus,
} from '@/lib/products/constants';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

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

export interface ProductRow {
  id: string;
  organization_id: string;
  name: string;
  short_description: string | null;
  description: string | null;
  price: number | null;
  sku: string;
  status: ProductStatus;
  stock: number | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  brand: string | null;
  tags: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  category_id: string | null;
}

export interface ProductListRow extends ProductRow {
  category_name: string | null;
  primary_image_path: string | null;
}

const SKU_REGEX = /^[A-Za-z0-9_-]+$/;

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(255, 'Nome deve ter no máximo 255 caracteres');

const SkuSchema = z
  .string()
  .trim()
  .min(1, 'SKU é obrigatório')
  .max(100, 'SKU deve ter no máximo 100 caracteres')
  .regex(SKU_REGEX, 'SKU aceita apenas letras, números, hífen e underscore');

const CategoryIdSchema = z
  .string()
  .uuid('Categoria inválida')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

const ShortDescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Resumo deve ter no máximo 500 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const DescriptionSchema = z
  .string()
  .trim()
  .max(5000, 'Descrição deve ter no máximo 5000 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const BrandSchema = z
  .string()
  .trim()
  .max(100, 'Marca deve ter no máximo 100 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const NotesSchema = z
  .string()
  .trim()
  .max(2000, 'Notas devem ter no máximo 2000 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const TagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Tag vazia não é permitida')
      .max(30, 'Tag deve ter no máximo 30 caracteres')
  )
  .max(20, 'Máximo de 20 tags por produto')
  .optional();

const PriceSchema = z.number().nonnegative('Preço não pode ser negativo').optional();
const StockSchema = z
  .number()
  .int('Estoque deve ser inteiro')
  .nonnegative('Estoque não pode ser negativo')
  .optional();
const DimensionSchema = z.number().nonnegative('Valor não pode ser negativo').optional();
const StatusSchema = z.enum(['active', 'archived']).optional();

const ProductPayloadSchema = z.object({
  name: NameSchema,
  sku: SkuSchema,
  category_id: CategoryIdSchema,
  short_description: ShortDescriptionSchema,
  description: DescriptionSchema,
  brand: BrandSchema,
  tags: TagsSchema,
  price: PriceSchema,
  stock: StockSchema,
  status: StatusSchema,
  weight: DimensionSchema,
  height: DimensionSchema,
  width: DimensionSchema,
  depth: DimensionSchema,
  notes: NotesSchema,
});

const CreateProductSchema = ProductPayloadSchema;
const UpdateProductSchema = ProductPayloadSchema;

const SortRuleSchema = z.object({
  key: z.enum(PRODUCT_SORT_KEYS),
  dir: z.enum(['asc', 'desc']),
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z
    .number()
    .int()
    .refine((v) => (PRODUCT_PAGE_SIZES as readonly number[]).includes(v), {
      message: 'Tamanho de página inválido',
    })
    .optional()
    .default(20),
  sort: z.array(SortRuleSchema).max(6).optional().default([]),
});

export type CreateProductInput = z.input<typeof CreateProductSchema>;
export type UpdateProductInput = z.input<typeof UpdateProductSchema>;
export type ListProductsInput = z.input<typeof ListParamsSchema>;

const PRODUCT_SELECT =
  'id, organization_id, name, short_description, description, price, sku, status, stock, weight, height, width, depth, brand, tags, notes, created_at, updated_at, created_by, category_id';

type RawProductRowWithCategory = ProductRow & {
  category: { id: string; name: string } | { id: string; name: string }[] | null;
};

function normalizeCategory(
  value: RawProductRowWithCategory['category']
): { id: string; name: string } | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function buildPayload(input: z.infer<typeof ProductPayloadSchema>) {
  return {
    name: input.name,
    sku: input.sku,
    category_id: input.category_id ?? null,
    short_description: input.short_description ?? null,
    description: input.description ?? null,
    brand: input.brand ?? null,
    tags: input.tags && input.tags.length > 0 ? input.tags : null,
    price: input.price ?? null,
    stock: input.stock ?? 0,
    status: (input.status ?? 'active') as ProductStatus,
    weight: input.weight ?? null,
    height: input.height ?? null,
    width: input.width ?? null,
    depth: input.depth ?? null,
    notes: input.notes ?? null,
  };
}

export async function getProductsAction(
  input: ListProductsInput = {}
): Promise<ActionResponse<ProductListRow[]>> {
  const parsed = ListParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, categoryId, status, page, pageSize, sort } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('products')
      .select(`${PRODUCT_SELECT}, category:categories(id, name)`, { count: 'exact' })
      .eq('organization_id', ctx.organizationId);

    if (sort.length > 0) {
      for (const rule of sort) {
        query = query.order(rule.key, { ascending: rule.dir === 'asc' });
      }
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(from, to);

    if (status !== 'all') {
      query = query.eq('status', status);
    }
    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }
    if (search && search.length > 0) {
      const term = search.replace(/[%_]/g, '\\$&');
      query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
    }

    const { data, error, count } = await query.returns<RawProductRowWithCategory[]>();

    if (error) {
      console.error('[products:list]', error);
      return { success: false, error: 'Não foi possível carregar os produtos.' };
    }

    const rows = data ?? [];
    const productIds = rows.map((r) => r.id);

    const primaryByProduct: Record<string, string> = {};
    if (productIds.length > 0) {
      const { data: primaryImages, error: imgError } = await supabase
        .from('product_images')
        .select('product_id, url')
        .in('product_id', productIds)
        .eq('is_primary', true);

      if (imgError) {
        console.error('[products:list:primary-images]', imgError);
      } else if (primaryImages) {
        for (const img of primaryImages) {
          primaryByProduct[img.product_id] = img.url;
        }
      }
    }

    const listRows: ProductListRow[] = rows.map((r) => {
      const category = normalizeCategory(r.category);
      const { category: _omit, ...rest } = r;
      void _omit;
      return {
        ...rest,
        category_name: category?.name ?? null,
        primary_image_path: primaryByProduct[r.id] ?? null,
      };
    });

    const total = count ?? 0;
    return {
      success: true,
      data: listRows,
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        currentPage: page,
        itemsPerPage: pageSize,
      },
    };
  } catch (error) {
    console.error('[products:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export interface ProductImageDetail {
  id: string;
  product_id: string;
  url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  position: number | null;
  is_primary: boolean | null;
  created_at: string | null;
}

export interface ProductDocumentDetail {
  id: string;
  product_id: string;
  url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  document_type: string | null;
  created_at: string | null;
}

export interface ProductDetail extends ProductRow {
  category_name: string | null;
  images: ProductImageDetail[];
  documents: ProductDocumentDetail[];
}

export async function getProductByIdAction(
  id: string
): Promise<ActionResponse<ProductDetail>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Produto não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('products')
      .select(`${PRODUCT_SELECT}, category:categories(id, name)`)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<RawProductRowWithCategory>();

    if (error) {
      console.error('[products:get]', error);
      return { success: false, error: 'Não foi possível carregar o produto.' };
    }
    if (!data) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    const [imagesResult, documentsResult] = await Promise.all([
      supabase
        .from('product_images')
        .select(
          'id, product_id, url, file_name, file_size, mime_type, position, is_primary, created_at'
        )
        .eq('product_id', parsed.data)
        .order('position', { ascending: true })
        .returns<ProductImageDetail[]>(),
      supabase
        .from('product_documents')
        .select(
          'id, product_id, url, file_name, file_size, mime_type, document_type, created_at'
        )
        .eq('product_id', parsed.data)
        .order('created_at', { ascending: false })
        .returns<ProductDocumentDetail[]>(),
    ]);

    if (imagesResult.error) {
      console.error('[products:get:images]', imagesResult.error);
    }
    if (documentsResult.error) {
      console.error('[products:get:documents]', documentsResult.error);
    }

    const category = normalizeCategory(data.category);
    const { category: _omit, ...rest } = data;
    void _omit;

    const detail: ProductDetail = {
      ...rest,
      category_name: category?.name ?? null,
      images: imagesResult.data ?? [],
      documents: documentsResult.data ?? [],
    };

    return { success: true, data: detail };
  } catch (error) {
    console.error('[products:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createProductAction(
  input: CreateProductInput
): Promise<ActionResponse<ProductRow>> {
  const parsed = CreateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const enforced = await enforceLimit({
      organizationId: ctx.organizationId,
      limitKey: 'products',
      delta: 1,
    });
    if (!enforced.ok) {
      return { success: false, error: enforced.error };
    }

    const supabase = await createClient();
    const payload = buildPayload(parsed.data);

    const { data, error } = await supabase
      .from('products')
      .insert({
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
        ...payload,
      })
      .select(PRODUCT_SELECT)
      .single<ProductRow>();

    if (error) {
      if (error.code === '23505') {
        return {
          success: false,
          error: `SKU "${parsed.data.sku}" já existe nesta organização.`,
        };
      }
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

export async function updateProductAction(
  id: string,
  input: UpdateProductInput
): Promise<ActionResponse<ProductRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Produto não encontrado.' };
  }

  const parsed = UpdateProductSchema.safeParse(input);
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
      .from('products')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(PRODUCT_SELECT)
      .maybeSingle<ProductRow>();

    if (error) {
      if (error.code === '23505') {
        return {
          success: false,
          error: `SKU "${parsed.data.sku}" já existe nesta organização.`,
        };
      }
      console.error('[products:update]', error);
      return { success: false, error: 'Não foi possível atualizar o produto.' };
    }
    if (!data) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    revalidatePath('/products');
    revalidatePath(`/products/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[products:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

async function setStatus(
  id: string,
  status: ProductStatus,
  logScope: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Produto não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('products')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) {
      console.error(`[products:${logScope}]`, error);
      return { success: false, error: 'Não foi possível atualizar o produto.' };
    }
    if (!data) {
      return { success: false, error: 'Produto não encontrado.' };
    }

    revalidatePath('/products');
    revalidatePath(`/products/${parsed.data}`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error(`[products:${logScope}] unexpected`, error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function archiveProductAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  return setStatus(id, 'archived', 'archive');
}

export async function restoreProductAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  return setStatus(id, 'active', 'restore');
}

export interface ProductStats {
  total: number;
  active: number;
  archived: number;
  noStock: number;
}

export async function getProductsStatsAction(): Promise<ActionResponse<ProductStats>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const baseSelect = () =>
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', ctx.organizationId);

    const [totalRes, activeRes, archivedRes, noStockRes] = await Promise.all([
      baseSelect(),
      baseSelect().eq('status', 'active'),
      baseSelect().eq('status', 'archived'),
      baseSelect().eq('status', 'active').or('stock.is.null,stock.eq.0'),
    ]);

    if (totalRes.error || activeRes.error || archivedRes.error || noStockRes.error) {
      console.error('[products:stats]', {
        total: totalRes.error,
        active: activeRes.error,
        archived: archivedRes.error,
        noStock: noStockRes.error,
      });
      return { success: false, error: 'Não foi possível carregar as estatísticas.' };
    }

    return {
      success: true,
      data: {
        total: totalRes.count ?? 0,
        active: activeRes.count ?? 0,
        archived: archivedRes.count ?? 0,
        noStock: noStockRes.count ?? 0,
      },
    };
  } catch (error) {
    console.error('[products:stats] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
