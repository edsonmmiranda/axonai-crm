'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { LOSS_REASON_SORT_KEYS } from '@/lib/loss-reasons/constants';
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

export interface LossReasonRow {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

const NameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(100, 'Nome deve ter no máximo 100 caracteres');

const IsActiveSchema = z.boolean().optional();

const CreateLossReasonSchema = z.object({
  name: NameSchema,
  is_active: IsActiveSchema,
});

const UpdateLossReasonSchema = z.object({
  name: NameSchema,
  is_active: IsActiveSchema,
});

const SortRuleSchema = z.object({
  key: z.enum(LOSS_REASON_SORT_KEYS),
  dir: z.enum(['asc', 'desc']),
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sort: z.array(SortRuleSchema).max(6).optional().default([]),
});

export type CreateLossReasonInput = z.infer<typeof CreateLossReasonSchema>;
export type UpdateLossReasonInput = z.infer<typeof UpdateLossReasonSchema>;
export type ListLossReasonsInput = z.input<typeof ListParamsSchema>;

const LOSS_REASONS_COLUMNS =
  'id, organization_id, name, is_active, created_at' as const;

export async function getLossReasonsAction(
  input: ListLossReasonsInput = {}
): Promise<ActionResponse<LossReasonRow[]>> {
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
      .from('loss_reasons')
      .select(LOSS_REASONS_COLUMNS, { count: 'exact' })
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

    const { data, error, count } = await query.returns<LossReasonRow[]>();

    if (error) {
      console.error('[loss-reasons:list]', error);
      return { success: false, error: 'Não foi possível carregar os motivos de perda.' };
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
    console.error('[loss-reasons:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getLossReasonByIdAction(
  id: string
): Promise<ActionResponse<LossReasonRow>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Motivo de perda não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('loss_reasons')
      .select(LOSS_REASONS_COLUMNS)
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle<LossReasonRow>();

    if (error) {
      console.error('[loss-reasons:get]', error);
      return { success: false, error: 'Não foi possível carregar o motivo de perda.' };
    }
    if (!data) {
      return { success: false, error: 'Motivo de perda não encontrado.' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[loss-reasons:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createLossReasonAction(
  input: CreateLossReasonInput
): Promise<ActionResponse<LossReasonRow>> {
  const parsed = CreateLossReasonSchema.safeParse(input);
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
      .from('loss_reasons')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        is_active: parsed.data.is_active ?? true,
      })
      .select(LOSS_REASONS_COLUMNS)
      .single<LossReasonRow>();

    if (error) {
      console.error('[loss-reasons:create]', error);
      return { success: false, error: 'Não foi possível criar o motivo de perda.' };
    }

    revalidatePath('/leads-loss-reasons');
    return { success: true, data };
  } catch (error) {
    console.error('[loss-reasons:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateLossReasonAction(
  id: string,
  input: UpdateLossReasonInput
): Promise<ActionResponse<LossReasonRow>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Motivo de perda não encontrado.' };
  }

  const parsed = UpdateLossReasonSchema.safeParse(input);
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
      .from('loss_reasons')
      .update({
        name: parsed.data.name,
        is_active: parsed.data.is_active ?? true,
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select(LOSS_REASONS_COLUMNS)
      .single<LossReasonRow>();

    if (error) {
      console.error('[loss-reasons:update]', error);
      return { success: false, error: 'Não foi possível atualizar o motivo de perda.' };
    }

    revalidatePath('/leads-loss-reasons');
    revalidatePath(`/leads-loss-reasons/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[loss-reasons:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteLossReasonAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Motivo de perda não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('loss_reasons')
      .update({ is_active: false })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[loss-reasons:delete]', error);
      return { success: false, error: 'Não foi possível desativar o motivo de perda.' };
    }
    if (!data) {
      return { success: false, error: 'Motivo de perda não encontrado.' };
    }

    revalidatePath('/leads-loss-reasons');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[loss-reasons:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreLossReasonAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Motivo de perda não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('loss_reasons')
      .update({ is_active: true })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[loss-reasons:restore]', error);
      return { success: false, error: 'Não foi possível restaurar o motivo de perda.' };
    }
    if (!data) {
      return { success: false, error: 'Motivo de perda não encontrado.' };
    }

    revalidatePath('/leads-loss-reasons');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[loss-reasons:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
