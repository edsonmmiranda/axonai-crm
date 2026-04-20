'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { assertRole } from '@/lib/actions/_shared/assertRole';
import type { FunnelStageRow } from '@/lib/actions/funnels';
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
});

const UpdateStagesSchema = z.object({
  funnelId: z.string().uuid('ID do funil inválido'),
  stages: z
    .array(StageUpsertSchema)
    .min(1, 'O funil deve ter ao menos 1 estágio'),
});

export type StageUpsertInput = z.infer<typeof StageUpsertSchema>;

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
      const { error: deleteErr } = await supabase
        .from('funnel_stages')
        .delete()
        .in('id', toDeleteIds);

      if (deleteErr) {
        console.error('[funnel-stages:update:delete]', deleteErr);
        return { success: false, error: 'Não foi possível atualizar os estágios.' };
      }
    }

    // Normalize order_index sequentially (0, 1, 2, ...)
    const normalizedStages = parsed.data.stages.map((s, i) => ({
      ...s,
      order_index: i,
    }));

    // Upsert all stages (insert new, update existing)
    const upsertPayload = normalizedStages.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      funnel_id: parsed.data.funnelId,
      name: s.name,
      order_index: s.order_index,
      updated_at: new Date().toISOString(),
    }));

    const { data: upserted, error: upsertErr } = await supabase
      .from('funnel_stages')
      .upsert(upsertPayload, { onConflict: 'id' })
      .select('id, funnel_id, name, order_index, created_at, updated_at')
      .order('order_index', { ascending: true })
      .returns<FunnelStageRow[]>();

    if (upsertErr) {
      console.error('[funnel-stages:update:upsert]', upsertErr);
      return { success: false, error: 'Não foi possível salvar os estágios.' };
    }

    revalidatePath('/funnels');
    revalidatePath(`/funnels/${parsed.data.funnelId}`);
    return { success: true, data: upserted ?? [] };
  } catch (error) {
    console.error('[funnel-stages:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
