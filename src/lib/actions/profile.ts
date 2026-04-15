'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createClient } from '@/lib/supabase/server';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const ALLOWED_AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const UpdateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Nome obrigatório').max(100, 'Máximo 100 caracteres'),
  phone: z
    .string()
    .trim()
    .max(20, 'Máximo 20 caracteres')
    .optional()
    .or(z.literal('')),
  avatarUrl: z.string().url('URL inválida').nullable().optional(),
  preferences: z
    .object({
      emailNotifications: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export async function updateProfileAction(
  input: UpdateProfileInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = UpdateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data: existing, error: readError } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', ctx.userId)
      .single<{ preferences: Record<string, unknown> | null }>();

    if (readError) {
      console.error('[profile:update] read preferences failed', readError);
      return { success: false, error: 'Não foi possível atualizar perfil' };
    }

    const mergedPreferences = {
      ...(existing?.preferences ?? {}),
      ...(parsed.data.preferences ?? {}),
    };

    const phone = parsed.data.phone?.trim();
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: parsed.data.fullName,
        phone: phone ? phone : null,
        avatar_url: parsed.data.avatarUrl ?? null,
        preferences: mergedPreferences,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.userId);

    if (updateError) {
      console.error('[profile:update]', updateError);
      return { success: false, error: 'Não foi possível atualizar perfil' };
    }

    revalidatePath('/settings/profile');
    revalidatePath('/', 'layout');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[profile:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function uploadAvatarAction(
  formData: FormData
): Promise<ActionResponse<{ url: string }>> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo não recebido.' };
  }
  if (!(ALLOWED_AVATAR_MIME as readonly string[]).includes(file.type)) {
    return { success: false, error: 'Formato não suportado. Use PNG, JPG ou WEBP.' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { success: false, error: 'Arquivo maior que 2MB.' };
  }

  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const extFromMime: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const ext = extFromMime[file.type] ?? 'bin';
    const path = `${ctx.userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      console.error('[profile:uploadAvatar]', uploadError);
      return { success: false, error: 'Não foi possível enviar o avatar, tente novamente.' };
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    return { success: true, data: { url: publicUrlData.publicUrl } };
  } catch (error) {
    console.error('[profile:uploadAvatar] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
