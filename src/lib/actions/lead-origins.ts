'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
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

export interface LeadOriginRow {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  platform: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(100, 'Nome deve ter no máximo 100 caracteres');

const TypeSchema = z
  .string()
  .trim()
  .min(1, 'Tipo é obrigatório')
  .max(50, 'Tipo deve ter no máximo 50 caracteres');

const PlatformSchema = z
  .string()
  .trim()
  .max(100, 'Plataforma deve ter no máximo 100 caracteres')
  .optional()
  .or(z.literal('').transform(() => undefined));

const IsActiveSchema = z.boolean().optional();

const CreateLeadOriginSchema = z.object({
  name: NameSchema,
  type: TypeSchema,
  platform: PlatformSchema,
  is_active: IsActiveSchema,
});

const UpdateLeadOriginSchema = z.object({
  name: NameSchema,
  type: TypeSchema,
  platform: PlatformSchema,
  is_active: IsActiveSchema,
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  type: z.string().trim().max(50).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export type CreateLeadOriginInput = z.infer<typeof CreateLeadOriginSchema>;
export type UpdateLeadOriginInput = z.infer<typeof UpdateLeadOriginSchema>;
export type ListLeadOriginsInput = z.input<typeof ListParamsSchema>;

const LEAD_ORIGINS_COLUMNS =
  'id, organization_id, name, type, platform, is_active, created_at, updated_at' as const;

export async function getLeadOriginsAction(
  input: ListLeadOriginsInput = {}
): Promise<ActionResponse<LeadOriginRow[]>> {
  const parsed = ListParamsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { search, type, isActive, page, pageSize } = parsed.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('lead_origins')
      .select(LEAD_ORIGINS_COLUMNS, { count: 'exact' })
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (typeof isActive === 'boolean') {
      query = query.eq('is_active', isActive);
    }
    if (type && type.length > 0) {
      query = query.eq('type', type);
    }
    if (search && search.length > 0) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error, count } = await query.returns<LeadOriginRow[]>();

    if (error) {
      console.error('[lead-origins:list]', error);
      return { success: false, error: 'Não foi possível carregar as origens.' };
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
    console.error('[lead-origins:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getLeadOriginByIdAction(
  id: string
): Promise<ActionResponse<LeadOriginRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Origem não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('lead_origins')
      .select(LEAD_ORIGINS_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<LeadOriginRow>();

    if (error) {
      console.error('[lead-origins:get]', error);
      return { success: false, error: 'Não foi possível carregar a origem.' };
    }
    if (!data) {
      return { success: false, error: 'Origem não encontrada.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[lead-origins:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createLeadOriginAction(
  input: CreateLeadOriginInput
): Promise<ActionResponse<LeadOriginRow>> {
  const parsed = CreateLeadOriginSchema.safeParse(input);
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
      .from('lead_origins')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        type: parsed.data.type,
        platform: parsed.data.platform ?? null,
        is_active: parsed.data.is_active ?? true,
      })
      .select(LEAD_ORIGINS_COLUMNS)
      .single<LeadOriginRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma origem com esse nome nesta organização.' };
      }
      console.error('[lead-origins:create]', error);
      return { success: false, error: 'Não foi possível criar a origem.' };
    }

    revalidatePath('/leads/origins');
    return { success: true, data };
  } catch (error) {
    console.error('[lead-origins:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateLeadOriginAction(
  id: string,
  input: UpdateLeadOriginInput
): Promise<ActionResponse<LeadOriginRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Origem não encontrada.' };
  }

  const parsed = UpdateLeadOriginSchema.safeParse(input);
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
      .from('lead_origins')
      .update({
        name: parsed.data.name,
        type: parsed.data.type,
        platform: parsed.data.platform ?? null,
        is_active: parsed.data.is_active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(LEAD_ORIGINS_COLUMNS)
      .single<LeadOriginRow>();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Já existe uma origem com esse nome nesta organização.' };
      }
      console.error('[lead-origins:update]', error);
      return { success: false, error: 'Não foi possível atualizar a origem.' };
    }

    revalidatePath('/leads/origins');
    revalidatePath(`/leads/origins/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[lead-origins:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteLeadOriginAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Origem não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('lead_origins')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[lead-origins:delete]', error);
      return { success: false, error: 'Não foi possível desativar a origem.' };
    }
    if (!data) {
      return { success: false, error: 'Origem não encontrada.' };
    }

    revalidatePath('/leads/origins');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[lead-origins:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreLeadOriginAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Origem não encontrada.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('lead_origins')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[lead-origins:restore]', error);
      return { success: false, error: 'Não foi possível restaurar a origem.' };
    }
    if (!data) {
      return { success: false, error: 'Origem não encontrada.' };
    }

    revalidatePath('/leads/origins');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[lead-origins:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
