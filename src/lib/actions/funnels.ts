'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import { FUNNEL_SORT_KEYS } from '@/lib/funnels/constants';
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

export interface FunnelStageRow {
  id: string;
  funnel_id: string;
  name: string;
  order_index: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface FunnelRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  stage_count: number;
}

export interface FunnelWithStages extends Omit<FunnelRow, 'stage_count'> {
  stages: FunnelStageRow[];
}

// ─── Zod Schemas ───────────────────────────────────────────────────────────────

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

const StageInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, 'Nome do estágio deve ter ao menos 2 caracteres')
    .max(100, 'Nome do estágio deve ter no máximo 100 caracteres'),
  order_index: z.number().int().min(0),
});

const CreateFunnelSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  is_active: z.boolean().optional(),
  stages: z
    .array(StageInputSchema)
    .min(1, 'O funil deve ter ao menos 1 estágio'),
});

const UpdateFunnelSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  is_active: z.boolean().optional(),
});

const SortRuleSchema = z.object({
  key: z.enum(FUNNEL_SORT_KEYS),
  dir: z.enum(['asc', 'desc']),
});

const ListParamsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  sort: z.array(SortRuleSchema).max(3).optional().default([]),
});

export type CreateFunnelInput = z.infer<typeof CreateFunnelSchema>;
export type UpdateFunnelInput = z.infer<typeof UpdateFunnelSchema>;
export type ListFunnelsInput = z.input<typeof ListParamsSchema>;

// ─── Raw DB row from list query ────────────────────────────────────────────────

interface FunnelListDbRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  funnel_stages: [{ count: number }] | null;
}

function mapListRow(row: FunnelListDbRow): FunnelRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    description: row.description,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stage_count: row.funnel_stages?.[0]?.count ?? 0,
  };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getFunnelsAction(
  input: ListFunnelsInput = {}
): Promise<ActionResponse<FunnelRow[]>> {
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
      .from('funnels')
      .select(
        'id, organization_id, name, description, is_active, created_at, updated_at, funnel_stages(count)',
        { count: 'exact' }
      )
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

    const { data, error, count } = await query.returns<FunnelListDbRow[]>();

    if (error) {
      console.error('[funnels:list]', error);
      return { success: false, error: 'Não foi possível carregar os funis.' };
    }

    const total = count ?? 0;
    return {
      success: true,
      data: (data ?? []).map(mapListRow),
      metadata: {
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        currentPage: page,
        itemsPerPage: pageSize,
      },
    };
  } catch (error) {
    console.error('[funnels:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getFunnelByIdAction(
  id: string
): Promise<ActionResponse<FunnelWithStages>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Funil não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('funnels')
      .select(
        'id, organization_id, name, description, is_active, created_at, updated_at, funnel_stages(id, funnel_id, name, order_index, created_at, updated_at)'
      )
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .order('order_index', { referencedTable: 'funnel_stages', ascending: true })
      .maybeSingle<{
        id: string;
        organization_id: string;
        name: string;
        description: string | null;
        is_active: boolean;
        created_at: string | null;
        updated_at: string | null;
        funnel_stages: FunnelStageRow[];
      }>();

    if (error) {
      console.error('[funnels:get]', error);
      return { success: false, error: 'Não foi possível carregar o funil.' };
    }
    if (!data) {
      return { success: false, error: 'Funil não encontrado.' };
    }

    const { funnel_stages, ...rest } = data;
    return {
      success: true,
      data: { ...rest, stages: funnel_stages ?? [] },
    };
  } catch (error) {
    console.error('[funnels:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createFunnelAction(
  input: CreateFunnelInput
): Promise<ActionResponse<FunnelWithStages>> {
  const parsed = CreateFunnelSchema.safeParse(input);
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

    const { data: funnel, error: funnelErr } = await supabase
      .from('funnels')
      .insert({
        organization_id: ctx.organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_active: parsed.data.is_active ?? true,
      })
      .select('id, organization_id, name, description, is_active, created_at, updated_at')
      .single<Omit<FunnelWithStages, 'stages'>>();

    if (funnelErr) {
      console.error('[funnels:create]', funnelErr);
      return { success: false, error: 'Não foi possível criar o funil.' };
    }

    const stagesPayload = parsed.data.stages.map((s, i) => ({
      funnel_id: funnel.id,
      name: s.name,
      order_index: i,
    }));

    const { data: stages, error: stagesErr } = await supabase
      .from('funnel_stages')
      .insert(stagesPayload)
      .select('id, funnel_id, name, order_index, created_at, updated_at')
      .returns<FunnelStageRow[]>();

    if (stagesErr) {
      console.error('[funnels:create:stages]', stagesErr);
      // Attempt to clean up the orphaned funnel
      await supabase.from('funnels').delete().eq('id', funnel.id);
      return { success: false, error: 'Não foi possível criar os estágios do funil.' };
    }

    revalidatePath('/funnels');
    return {
      success: true,
      data: { ...funnel, stages: stages ?? [] },
    };
  } catch (error) {
    console.error('[funnels:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateFunnelAction(
  id: string,
  input: UpdateFunnelInput
): Promise<ActionResponse<Omit<FunnelRow, 'stage_count'>>> {
  const idParsed = z.string().uuid('ID inválido').safeParse(id);
  if (!idParsed.success) {
    return { success: false, error: 'Funil não encontrado.' };
  }

  const parsed = UpdateFunnelSchema.safeParse(input);
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
      .from('funnels')
      .update({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_active: parsed.data.is_active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', idParsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id, organization_id, name, description, is_active, created_at, updated_at')
      .single<Omit<FunnelRow, 'stage_count'>>();

    if (error) {
      console.error('[funnels:update]', error);
      return { success: false, error: 'Não foi possível atualizar o funil.' };
    }

    revalidatePath('/funnels');
    revalidatePath(`/funnels/${idParsed.data}`);
    return { success: true, data };
  } catch (error) {
    console.error('[funnels:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deleteFunnelAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Funil não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    // Delete stages first (cascade not guaranteed at DB level in current schema)
    await supabase.from('funnel_stages').delete().eq('funnel_id', parsed.data);

    const { error } = await supabase
      .from('funnels')
      .delete()
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId);

    if (error) {
      console.error('[funnels:delete]', error);
      return { success: false, error: 'Não foi possível excluir o funil.' };
    }

    revalidatePath('/funnels');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[funnels:delete] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function deactivateFunnelAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Funil não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('funnels')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[funnels:deactivate]', error);
      return { success: false, error: 'Não foi possível desativar o funil.' };
    }
    if (!data) {
      return { success: false, error: 'Funil não encontrado.' };
    }

    revalidatePath('/funnels');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[funnels:deactivate] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function restoreFunnelAction(
  id: string
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = z.string().uuid('ID inválido').safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Funil não encontrado.' };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('funnels')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[funnels:restore]', error);
      return { success: false, error: 'Não foi possível restaurar o funil.' };
    }
    if (!data) {
      return { success: false, error: 'Funil não encontrado.' };
    }

    revalidatePath('/funnels');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[funnels:restore] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
