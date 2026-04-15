'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { slugify } from '@/lib/actions/_shared/slugify';
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

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(80, 'Nome deve ter no máximo 80 caracteres');

const DescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Descrição deve ter no máximo 500 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

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

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type ListCategoriesInput = z.input<typeof ListParamsSchema>;

const MAX_SLUG_ATTEMPTS = 50;

async function generateUniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  base: string,
  excludeId?: string
): Promise<string> {
  const baseSlug = slugify(base) || 'categoria';

  for (let i = 0; i < MAX_SLUG_ATTEMPTS; i++) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    let query = supabase
      .from('categories')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('slug', candidate)
      .limit(1);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) {
      return candidate;
    }
  }

  return `${baseSlug}-${Date.now()}`;
}

export async function getCategoriesAction(
  input: ListCategoriesInput = {}
): Promise<ActionResponse<CategoryRow[]>> {
  const parsed = ListParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, activeOnly, page, pageSize } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('categories')
      .select('id, organization_id, name, slug, description, active, created_at, updated_at', {
        count: 'exact',
      })
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (activeOnly) {
      query = query.eq('active', true);
    }
    if (search && search.length > 0) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error, count } = await query.returns<CategoryRow[]>();

    if (error) {
      console.error('[categories:list]', error);
      return { success: false, error: 'Não foi possível carregar as categorias.' };
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
    console.error('[categories:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getCategoryByIdAction(
  id: string
): Promise<ActionResponse<CategoryRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Categoria não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('categories')
      .select('id, organization_id, name, slug, description, active, created_at, updated_at')
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<CategoryRow>();

    if (error) {
      console.error('[categories:get]', error);
      return { success: false, error: 'Não foi possível carregar a categoria.' };
    }
    if (!data) {
      return { success: false, error: 'Categoria não encontrada.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[categories:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createCategoryAction(
  input: CreateCategoryInput
): Promise<ActionResponse<CategoryRow>> {
  const parsed = CreateCategorySchema.safeParse(input);
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
    const slug = await generateUniqueSlug(supabase, ctx.organizationId, parsed.data.name);

    const { data, error } = await supabase
      .from('categories')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? null,
        active: parsed.data.active ?? true,
      })
      .select('id, organization_id, name, slug, description, active, created_at, updated_at')
      .single<CategoryRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma categoria com esse slug.' };
      }
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

export async function updateCategoryAction(
  id: string,
  input: UpdateCategoryInput
): Promise<ActionResponse<CategoryRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Categoria não encontrada.' };
  }

  const parsed = UpdateCategorySchema.safeParse(input);
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

    const { data: existing, error: readError } = await supabase
      .from('categories')
      .select('id, name, slug')
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<{ id: string; name: string; slug: string }>();

    if (readError) {
      console.error('[categories:update] read', readError);
      return { success: false, error: 'Não foi possível atualizar a categoria.' };
    }
    if (!existing) {
      return { success: false, error: 'Categoria não encontrada.' };
    }

    let slug = existing.slug;
    if (parsed.data.name !== existing.name) {
      slug = await generateUniqueSlug(
        supabase,
        ctx.organizationId,
        parsed.data.name,
        existing.id
      );
    }

    const { data, error } = await supabase
      .from('categories')
      .update({
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? null,
        active: parsed.data.active ?? true,
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id, organization_id, name, slug, description, active, created_at, updated_at')
      .single<CategoryRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma categoria com esse slug.' };
      }
      console.error('[categories:update]', error);
      return { success: false, error: 'Não foi possível atualizar a categoria.' };
    }

    revalidatePath('/settings/catalog/categories');
    revalidatePath(`/settings/catalog/categories/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[categories:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteCategoryAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  // Soft delete (active = false). When products (Sprint 06) linka categories,
  // decidir entre bloquear desativação OU permitir e filtrar na UI de produtos.
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Categoria não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('categories')
      .update({ active: false })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[categories:delete]', error);
      return { success: false, error: 'Não foi possível desativar a categoria.' };
    }
    if (!data) {
      return { success: false, error: 'Categoria não encontrada.' };
    }

    revalidatePath('/settings/catalog/categories');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[categories:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreCategoryAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Categoria não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('categories')
      .update({ active: true })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[categories:restore]', error);
      return { success: false, error: 'Não foi possível restaurar a categoria.' };
    }
    if (!data) {
      return { success: false, error: 'Categoria não encontrada.' };
    }

    revalidatePath('/settings/catalog/categories');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[categories:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
