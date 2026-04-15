'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { assertRole } from '@/lib/actions/_shared/assertRole';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  max_users: number;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
}

const SLUG_REGEX = /^[a-z0-9](-?[a-z0-9])*$/;

const UpdateOrgSchema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatório').max(100, 'Máximo 100 caracteres'),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug deve ter ao menos 3 caracteres')
    .max(40, 'Máximo 40 caracteres')
    .regex(SLUG_REGEX, 'Use apenas minúsculas, números e hífens (sem hífens consecutivos).'),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;

export async function getOrganizationAction(): Promise<ActionResponse<OrganizationRow>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, slug, plan, max_users, is_active, settings, created_at')
      .eq('id', ctx.organizationId)
      .single<OrganizationRow>();

    if (error || !data) {
      console.error('[organization:get]', error);
      return { success: false, error: 'Organização não encontrada.' };
    }

    return {
      success: true,
      data: { ...data, settings: (data.settings ?? {}) as Record<string, unknown> },
    };
  } catch (error) {
    console.error('[organization:get] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateOrganizationAction(
  input: UpdateOrgInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = UpdateOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const service = createServiceClient();

    const { data: existing, error: readError } = await service
      .from('organizations')
      .select('settings')
      .eq('id', ctx.organizationId)
      .single<{ settings: Record<string, unknown> | null }>();

    if (readError) {
      console.error('[organization:update] read failed', readError);
      return { success: false, error: 'Não foi possível atualizar a organização' };
    }

    const mergedSettings = {
      ...(existing?.settings ?? {}),
      ...(parsed.data.settings ?? {}),
    };

    const { error: updateError } = await service
      .from('organizations')
      .update({
        name: parsed.data.name,
        slug: parsed.data.slug,
        settings: mergedSettings,
      })
      .eq('id', ctx.organizationId);

    if (updateError) {
      if (updateError.code === '23505') {
        return { success: false, error: 'Slug já em uso. Tente um diferente.' };
      }
      console.error('[organization:update]', updateError);
      return { success: false, error: 'Não foi possível atualizar a organização' };
    }

    revalidatePath('/settings/organization');
    revalidatePath('/', 'layout');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[organization:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
