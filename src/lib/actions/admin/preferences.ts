'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePlatformAdmin } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?:    T;
  error?:   string;
}

const AdminThemeSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
});

export type UpdateAdminThemePreferenceInput = z.infer<typeof AdminThemeSchema>;

export async function updateAdminThemePreferenceAction(
  input: UpdateAdminThemePreferenceInput,
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = AdminThemeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    const admin = await requirePlatformAdmin();
    const supabase = await createClient();

    const { data: existing, error: readError } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', admin.profileId)
      .single<{ preferences: Record<string, unknown> | null }>();

    if (readError) {
      console.error('[admin:preferences:updateTheme:read]', readError);
      return { success: false, error: 'Não foi possível atualizar tema.' };
    }

    const mergedPreferences = {
      ...(existing?.preferences ?? {}),
      adminTheme: parsed.data.theme,
    };

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        preferences: mergedPreferences,
        updated_at: new Date().toISOString(),
      })
      .eq('id', admin.profileId);

    if (updateError) {
      console.error('[admin:preferences:updateTheme]', updateError);
      return { success: false, error: 'Não foi possível atualizar tema.' };
    }

    revalidatePath('/admin', 'layout');
    return { success: true, data: { ok: true } };
  } catch (err) {
    console.error('[admin:preferences:updateTheme] unexpected', err);
    return { success: false, error: 'Erro interno, tente novamente.' };
  }
}
