'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { TAG_COLORS, TAG_SORT_KEYS } from '@/lib/tags/constants';
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

export interface TagRow {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(50, 'Nome deve ter no máximo 50 caracteres');

const ColorSchema = z.enum(TAG_COLORS, {
  message: 'Cor inválida',
});

const IsActiveSchema = z.boolean().optional();

const CreateTagSchema = z.object({
  name: NameSchema,
  color: ColorSchema.default('gray'),
});

const UpdateTagSchema = z.object({
  name: NameSchema,
  color: ColorSchema,
  is_active: IsActiveSchema,
});

const SortRuleSchema = z.object({
  key: z.enum(TAG_SORT_KEYS),
  dir: z.enum(['asc', 'desc']),
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sort: z.array(SortRuleSchema).max(6).optional().default([]),
});

export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
export type ListTagsInput = z.input<typeof ListParamsSchema>;

const TAGS_COLUMNS =
  'id, organization_id, name, color, is_active, created_at, updated_at' as const;

export async function getTagsAction(
  input: ListTagsInput = {}
): Promise<ActionResponse<TagRow[]>> {
  const parsed = ListParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, isActive, page, pageSize, sort } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('tags')
      .select(TAGS_COLUMNS, { count: 'exact' })
      .eq('organization_id', ctx.organizationId);

    if (sort.length > 0) {
      for (const rule of sort) {
        query = query.order(rule.key, { ascending: rule.dir === 'asc' });
      }
    } else {
      query = query.order('name', { ascending: true });
    }

    query = query.range(from, to);

    if (typeof isActive === 'boolean') {
      query = query.eq('is_active', isActive);
    }
    if (search && search.length > 0) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error, count } = await query.returns<TagRow[]>();

    if (error) {
      console.error('[tags:list]', error);
      return { success: false, error: 'Não foi possível carregar as tags.' };
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
    console.error('[tags:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getTagByIdAction(
  id: string
): Promise<ActionResponse<TagRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Tag não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('tags')
      .select(TAGS_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<TagRow>();

    if (error) {
      console.error('[tags:get]', error);
      return { success: false, error: 'Não foi possível carregar a tag.' };
    }
    if (!data) {
      return { success: false, error: 'Tag não encontrada.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[tags:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createTagAction(
  input: CreateTagInput
): Promise<ActionResponse<TagRow>> {
  const parsed = CreateTagSchema.safeParse(input);
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

    const { data, error } = await supabase
      .from('tags')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        color: parsed.data.color,
      })
      .select(TAGS_COLUMNS)
      .single<TagRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma tag com este nome.' };
      }
      console.error('[tags:create]', error);
      return { success: false, error: 'Não foi possível criar a tag.' };
    }

    revalidatePath('/leads-tags');
    return { success: true, data };
  } catch (error) {
    console.error('[tags:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateTagAction(
  id: string,
  input: UpdateTagInput
): Promise<ActionResponse<TagRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Tag não encontrada.' };
  }

  const parsed = UpdateTagSchema.safeParse(input);
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

    const { data, error } = await supabase
      .from('tags')
      .update({
        name: parsed.data.name,
        color: parsed.data.color,
        is_active: parsed.data.is_active ?? true,
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(TAGS_COLUMNS)
      .single<TagRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma tag com este nome.' };
      }
      console.error('[tags:update]', error);
      return { success: false, error: 'Não foi possível atualizar a tag.' };
    }

    revalidatePath('/leads-tags');
    revalidatePath(`/leads-tags/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[tags:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deactivateTagAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Tag não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tags')
      .update({ is_active: false })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[tags:deactivate]', error);
      return { success: false, error: 'Não foi possível desativar a tag.' };
    }
    if (!data) {
      return { success: false, error: 'Tag não encontrada.' };
    }

    revalidatePath('/leads-tags');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[tags:deactivate] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreTagAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Tag não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tags')
      .update({ is_active: true })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[tags:restore]', error);
      return { success: false, error: 'Não foi possível restaurar a tag.' };
    }
    if (!data) {
      return { success: false, error: 'Tag não encontrada.' };
    }

    revalidatePath('/leads-tags');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[tags:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteTagAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Tag não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    // Check if tag has linked leads
    const { count, error: countError } = await supabase
      .from('lead_tags')
      .select('*', { count: 'exact', head: true })
      .eq('tag_id', parsed.data);

    if (countError) {
      console.error('[tags:delete:check]', countError);
      return { success: false, error: 'Não foi possível verificar vínculos da tag.' };
    }

    if (count && count > 0) {
      return {
        success: false,
        error: `Esta tag está vinculada a ${count} lead(s) e não pode ser excluída. Desative-a em vez disso.`,
      };
    }

    const { data, error } = await supabase
      .from('tags')
      .delete()
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[tags:delete]', error);
      return { success: false, error: 'Não foi possível excluir a tag.' };
    }
    if (!data) {
      return { success: false, error: 'Tag não encontrada.' };
    }

    revalidatePath('/leads-tags');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[tags:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
