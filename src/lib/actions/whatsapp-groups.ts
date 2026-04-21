'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { WHATSAPP_GROUP_SORT_KEYS } from '@/lib/whatsapp-groups/constants';
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

export interface WhatsappGroupRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  whatsapp_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(100, 'Nome deve ter no máximo 100 caracteres');

const DescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Descrição deve ter no máximo 500 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const WhatsappIdSchema = z
  .string()
  .trim()
  .max(100, 'ID do grupo deve ter no máximo 100 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const IsActiveSchema = z.boolean().optional();

const CreateWhatsappGroupSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  whatsapp_id: WhatsappIdSchema,
  is_active: IsActiveSchema,
});

const UpdateWhatsappGroupSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  whatsapp_id: WhatsappIdSchema,
  is_active: IsActiveSchema,
});

const SortRuleSchema = z.object({
  key: z.enum(WHATSAPP_GROUP_SORT_KEYS),
  dir: z.enum(['asc', 'desc']),
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sort: z.array(SortRuleSchema).max(6).optional().default([]),
});

export type CreateWhatsappGroupInput = z.infer<typeof CreateWhatsappGroupSchema>;
export type UpdateWhatsappGroupInput = z.infer<typeof UpdateWhatsappGroupSchema>;
export type ListWhatsappGroupsInput = z.input<typeof ListParamsSchema>;

const WHATSAPP_GROUPS_COLUMNS =
  'id, organization_id, name, description, whatsapp_id, is_active, created_at, updated_at, created_by' as const;

export async function getWhatsappGroupsAction(
  input: ListWhatsappGroupsInput = {}
): Promise<ActionResponse<WhatsappGroupRow[]>> {
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
      .from('whatsapp_groups')
      .select(WHATSAPP_GROUPS_COLUMNS, { count: 'exact' })
      .eq('organization_id', ctx.organizationId);

    if (sort.length > 0) {
      for (const rule of sort) {
        query = query.order(rule.key, { ascending: rule.dir === 'asc' });
      }
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(from, to);

    if (typeof isActive === 'boolean') {
      query = query.eq('is_active', isActive);
    }
    if (search && search.length > 0) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error, count } = await query.returns<WhatsappGroupRow[]>();

    if (error) {
      console.error('[whatsapp-groups:list]', error);
      return { success: false, error: 'Não foi possível carregar os grupos.' };
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
    console.error('[whatsapp-groups:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getWhatsappGroupByIdAction(
  id: string
): Promise<ActionResponse<WhatsappGroupRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Grupo não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('whatsapp_groups')
      .select(WHATSAPP_GROUPS_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<WhatsappGroupRow>();

    if (error) {
      console.error('[whatsapp-groups:get]', error);
      return { success: false, error: 'Não foi possível carregar o grupo.' };
    }
    if (!data) {
      return { success: false, error: 'Grupo não encontrado.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[whatsapp-groups:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createWhatsappGroupAction(
  input: CreateWhatsappGroupInput
): Promise<ActionResponse<WhatsappGroupRow>> {
  const parsed = CreateWhatsappGroupSchema.safeParse(input);
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
      .from('whatsapp_groups')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        whatsapp_id: parsed.data.whatsapp_id ?? null,
        is_active: parsed.data.is_active ?? true,
        created_by: ctx.userId,
      })
      .select(WHATSAPP_GROUPS_COLUMNS)
      .single<WhatsappGroupRow>();

    if (error) {
      console.error('[whatsapp-groups:create]', error);
      return { success: false, error: 'Não foi possível criar o grupo.' };
    }

    revalidatePath('/whatsapp-groups');
    return { success: true, data };
  } catch (error) {
    console.error('[whatsapp-groups:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateWhatsappGroupAction(
  id: string,
  input: UpdateWhatsappGroupInput
): Promise<ActionResponse<WhatsappGroupRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Grupo não encontrado.' };
  }

  const parsed = UpdateWhatsappGroupSchema.safeParse(input);
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
      .from('whatsapp_groups')
      .update({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        whatsapp_id: parsed.data.whatsapp_id ?? null,
        is_active: parsed.data.is_active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(WHATSAPP_GROUPS_COLUMNS)
      .single<WhatsappGroupRow>();

    if (error) {
      console.error('[whatsapp-groups:update]', error);
      return { success: false, error: 'Não foi possível atualizar o grupo.' };
    }

    revalidatePath('/whatsapp-groups');
    revalidatePath(`/whatsapp-groups/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[whatsapp-groups:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteWhatsappGroupAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Grupo não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('whatsapp_groups')
      .delete()
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId);

    if (error) {
      if (error.code === '42501') {
        return { success: false, error: 'Sem permissão para excluir este grupo.' };
      }
      console.error('[whatsapp-groups:delete]', error);
      return { success: false, error: 'Não foi possível excluir o grupo.' };
    }

    revalidatePath('/whatsapp-groups');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[whatsapp-groups:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function toggleWhatsappGroupActiveAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Grupo não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    const { data: current, error: fetchError } = await supabase
      .from('whatsapp_groups')
      .select('is_active')
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (fetchError) {
      console.error('[whatsapp-groups:toggle] fetch', fetchError);
      return { success: false, error: 'Não foi possível alterar o status do grupo.' };
    }
    if (!current) {
      return { success: false, error: 'Grupo não encontrado.' };
    }

    const { error } = await supabase
      .from('whatsapp_groups')
      .update({ is_active: !current.is_active, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId);

    if (error) {
      console.error('[whatsapp-groups:toggle] update', error);
      return { success: false, error: 'Não foi possível alterar o status do grupo.' };
    }

    revalidatePath('/whatsapp-groups');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[whatsapp-groups:toggle] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
