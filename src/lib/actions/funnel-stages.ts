'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import type { FunnelStageRow, StageRole } from '@/lib/actions/funnels';
import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const StageUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, 'Nome do estágio deve ter ao menos 2 caracteres')
    .max(100, 'Nome do estágio deve ter no máximo 100 caracteres'),
  order_index: z.number().int().min(0),
  stage_role: z.enum(['entry', 'won', 'lost']).nullable().optional(),
});

const UpdateStagesSchema = z.object({
  funnelId: z.string().uuid('ID do funil inválido'),
  stages: z
    .array(StageUpsertSchema)
    .min(1, 'O funil deve ter ao menos 1 estágio'),
});

export type StageUpsertInput = z.infer<typeof StageUpsertSchema>;

function validateStageRoles(stages: { stage_role?: StageRole | null | undefined }[]): string | null {
  const roles = stages.map((s) => s.stage_role ?? null);
  for (const role of ['entry', 'won', 'lost'] as const) {
    const count = roles.filter((r) => r === role).length;
    if (count === 0) {
      const label = role === 'entry' ? 'Entrada' : role === 'won' ? 'Ganho' : 'Perdido';
      return `O funil deve ter exatamente um estágio de "${label}".`;
    }
    if (count > 1) {
      const label = role === 'entry' ? 'Entrada' : role === 'won' ? 'Ganho' : 'Perdido';
      return `O funil tem mais de um estágio de "${label}". Cada papel deve ser único.`;
    }
  }
  return null;
}

/**
 * Replaces all stages for a funnel with the provided list.
 * Existing stages (with id) are updated; stages without id are inserted;
 * stages present in DB but absent from the list are deleted.
 */
export async function updateFunnelStagesAction(
  funnelId: string,
  stages: StageUpsertInput[]
): Promise<ActionResponse<FunnelStageRow[]>> {
  const parsed = UpdateStagesSchema.safeParse({ funnelId, stages });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const roleError = validateStageRoles(parsed.data.stages);
  if (roleError) {
    return { success: false, error: roleError };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const supabase = await createClient();

    // Verify the funnel belongs to this org
    const { data: funnel, error: funnelErr } = await supabase
      .from('funnels')
      .select('id')
      .eq('id', parsed.data.funnelId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (funnelErr || !funnel) {
      return { success: false, error: 'Funil não encontrado.' };
    }

    // Fetch current stage IDs from DB
    const { data: currentStages, error: fetchErr } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', parsed.data.funnelId)
      .returns<{ id: string }[]>();

    if (fetchErr) {
      console.error('[funnel-stages:update:fetch]', fetchErr);
      return { success: false, error: 'Não foi possível atualizar os estágios.' };
    }

    const currentIds = new Set((currentStages ?? []).map((s) => s.id));
    const incomingIds = new Set(
      parsed.data.stages.filter((s) => s.id).map((s) => s.id!)
    );

    // IDs to delete: in DB but not in incoming list
    const toDeleteIds = [...currentIds].filter((id) => !incomingIds.has(id));

    if (toDeleteIds.length > 0) {
      // Block deletion of stages that have active leads
      const { data: occupiedLeads } = await supabase
        .from('leads')
        .select('stage_id, name')
        .in('stage_id', toDeleteIds)
        .eq('is_active', true)
        .limit(1);

      if (occupiedLeads && occupiedLeads.length > 0) {
        const { data: blockedStages } = await supabase
          .from('funnel_stages')
          .select('name')
          .in('id', toDeleteIds);
        const stageNames = (blockedStages ?? []).map((s) => `"${s.name}"`).join(', ');
        return {
          success: false,
          error: `Não é possível remover o estágio ${stageNames} pois existem leads ativos nele. Mova os leads antes de excluir.`,
        };
      }

      const { error: deleteErr } = await supabase
        .from('funnel_stages')
        .delete()
        .in('id', toDeleteIds);

      if (deleteErr) {
        console.error('[funnel-stages:update:delete]', deleteErr);
        return { success: false, error: 'Não foi possível atualizar os estágios.' };
      }
    }

    // Normalize order_index sequentially and split by new vs existing
    const newStages = parsed.data.stages
      .filter((s) => !s.id)
      .map((s, i) => ({
        funnel_id: parsed.data.funnelId,
        name: s.name,
        order_index: parsed.data.stages.findIndex((x) => x === s),
        stage_role: s.stage_role ?? null,
      }));

    const existingStages = parsed.data.stages
      .filter((s) => !!s.id)
      .map((s, _i) => ({
        id: s.id!,
        funnel_id: parsed.data.funnelId,
        name: s.name,
        order_index: parsed.data.stages.findIndex((x) => x === s),
        stage_role: s.stage_role ?? null,
        updated_at: new Date().toISOString(),
      }));

    // Re-normalize order_index using final position in original array
    const allWithIndex = parsed.data.stages.map((s, i) => ({ ...s, _idx: i }));

    const insertPayload = allWithIndex
      .filter((s) => !s.id)
      .map((s) => ({
        funnel_id: parsed.data.funnelId,
        name: s.name,
        order_index: s._idx,
        stage_role: s.stage_role ?? null,
      }));

    const updatePayload = allWithIndex
      .filter((s) => !!s.id)
      .map((s) => ({
        id: s.id!,
        funnel_id: parsed.data.funnelId,
        name: s.name,
        order_index: s._idx,
        stage_role: s.stage_role ?? null,
        updated_at: new Date().toISOString(),
      }));

    // INSERT new stages
    if (insertPayload.length > 0) {
      const { error: insertErr } = await supabase
        .from('funnel_stages')
        .insert(insertPayload);

      if (insertErr) {
        console.error('[funnel-stages:update:insert]', insertErr);
        if (insertErr.code === '23505') {
          return { success: false, error: 'Cada papel (Entrada, Ganho, Perdido) deve ser único por funil.' };
        }
        return { success: false, error: 'Não foi possível salvar os estágios.' };
      }
    }

    // UPDATE existing stages
    if (updatePayload.length > 0) {
      const { error: updateErr } = await supabase
        .from('funnel_stages')
        .upsert(updatePayload, { onConflict: 'id' });

      if (updateErr) {
        console.error('[funnel-stages:update:update]', updateErr);
        if (updateErr.code === '23505') {
          return { success: false, error: 'Cada papel (Entrada, Ganho, Perdido) deve ser único por funil.' };
        }
        return { success: false, error: 'Não foi possível salvar os estágios.' };
      }
    }

    // Fetch final ordered result
    const { data: upserted, error: fetchFinalErr } = await supabase
      .from('funnel_stages')
      .select('id, funnel_id, name, order_index, stage_role, created_at, updated_at')
      .eq('funnel_id', parsed.data.funnelId)
      .order('order_index', { ascending: true })
      .returns<FunnelStageRow[]>();

    if (fetchFinalErr) {
      console.error('[funnel-stages:update:fetch-final]', fetchFinalErr);
      return { success: false, error: 'Não foi possível carregar os estágios atualizados.' };
    }

    revalidatePath('/funnels');
    revalidatePath(`/funnels/${parsed.data.funnelId}`);
    return { success: true, data: upserted ?? [] };
  } catch (error) {
    console.error('[funnel-stages:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
