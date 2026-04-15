'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const SLUG_REGEX = /^[a-z0-9-]+$/;

const SignupWithOrgSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(72, 'Máximo 72 caracteres'),
  fullName: z.string().min(2, 'Nome obrigatório').max(100, 'Máximo 100 caracteres'),
  orgName: z.string().min(2, 'Nome da organização obrigatório').max(100),
  orgSlug: z
    .string()
    .min(3, 'Slug deve ter ao menos 3 caracteres')
    .max(40, 'Máximo 40 caracteres')
    .regex(SLUG_REGEX, 'Use apenas letras minúsculas, números e hífens'),
});

const SignupWithInviteSchema = z.object({
  password: z.string().min(8, 'Mínimo 8 caracteres').max(72, 'Máximo 72 caracteres'),
  fullName: z.string().min(2, 'Nome obrigatório').max(100, 'Máximo 100 caracteres'),
  inviteToken: z.string().uuid('Token inválido'),
});

const LoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

const MagicLinkSchema = z.object({
  email: z.string().email('Email inválido'),
});

export type SignupWithOrgInput = z.infer<typeof SignupWithOrgSchema>;
export type SignupWithInviteInput = z.infer<typeof SignupWithInviteSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type MagicLinkInput = z.infer<typeof MagicLinkSchema>;

async function getOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('host');
  if (!host) return '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signupWithOrgAction(
  input: SignupWithOrgInput
): Promise<ActionResponse<{ userId: string; organizationId: string }>> {
  const parsed = SignupWithOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { email, password, fullName, orgName, orgSlug } = parsed.data;
  const service = createServiceClient();
  let createdOrgId: string | null = null;

  try {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: orgName, slug: orgSlug })
      .select('id')
      .single();

    if (orgError || !org) {
      if (orgError?.code === '23505') {
        return { success: false, error: 'Slug já em uso' };
      }
      console.error('[auth:signupWithOrg] org insert failed', orgError);
      return { success: false, error: 'Não foi possível criar organização' };
    }
    createdOrgId = org.id;

    const supabase = await createClient();
    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          organization_id: createdOrgId,
          role: 'owner',
        },
      },
    });

    if (signupError || !signupData.user) {
      console.error('[auth:signupWithOrg] signUp failed', signupError);
      await service.from('organizations').delete().eq('id', createdOrgId);
      const msg = signupError?.message?.toLowerCase() ?? '';
      if (msg.includes('already') || msg.includes('registered')) {
        return {
          success: false,
          error: 'Email já cadastrado. Faça login ou recupere sua senha.',
        };
      }
      return { success: false, error: 'Não foi possível criar conta. Tente novamente.' };
    }

    revalidatePath('/', 'layout');
    return {
      success: true,
      data: { userId: signupData.user.id, organizationId: org.id },
    };
  } catch (error) {
    console.error('[auth:signupWithOrg] unexpected', error);
    if (createdOrgId) {
      await service.from('organizations').delete().eq('id', createdOrgId);
    }
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function signupWithInviteAction(
  input: SignupWithInviteInput
): Promise<ActionResponse<{ userId: string; organizationId: string }>> {
  const parsed = SignupWithInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { password, fullName, inviteToken } = parsed.data;
  const service = createServiceClient();

  try {
    const { data: invite, error: inviteError } = await service
      .from('invitations')
      .select('id, email, organization_id, role, expires_at, accepted_at')
      .eq('token', inviteToken)
      .single();

    if (inviteError || !invite) {
      return { success: false, error: 'Convite inválido.' };
    }
    if (invite.accepted_at) {
      return { success: false, error: 'Este convite já foi usado. Faça login.' };
    }
    if (new Date(invite.expires_at) <= new Date()) {
      return { success: false, error: 'Este convite expirou. Peça um novo.' };
    }

    const supabase = await createClient();
    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: {
        data: {
          full_name: fullName,
          organization_id: invite.organization_id,
          role: invite.role,
        },
      },
    });

    if (signupError || !signupData.user) {
      console.error('[auth:signupWithInvite] signUp failed', signupError);
      const msg = signupError?.message?.toLowerCase() ?? '';
      if (msg.includes('already') || msg.includes('registered')) {
        return { success: false, error: 'Email já cadastrado. Faça login.' };
      }
      return { success: false, error: 'Não foi possível criar conta. Tente novamente.' };
    }

    const { error: updateError } = await service
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    if (updateError) {
      console.error('[auth:signupWithInvite] mark accepted failed', updateError);
    }

    revalidatePath('/', 'layout');
    return {
      success: true,
      data: { userId: signupData.user.id, organizationId: invite.organization_id },
    };
  } catch (error) {
    console.error('[auth:signupWithInvite] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function loginWithPasswordAction(
  input: LoginInput
): Promise<ActionResponse<{ userId: string }>> {
  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      console.error('[auth:login]', error);
      return { success: false, error: 'Email ou senha inválidos' };
    }
    revalidatePath('/', 'layout');
    return { success: true, data: { userId: data.user.id } };
  } catch (error) {
    console.error('[auth:login] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function sendMagicLinkAction(
  input: MagicLinkInput
): Promise<ActionResponse<{ email: string }>> {
  const parsed = MagicLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const origin = await getOrigin();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
      },
    });
    if (error) {
      console.error('[auth:magicLink]', error);
      if (error.status === 429) {
        return {
          success: false,
          error: 'Aguarde alguns segundos antes de pedir novo link.',
        };
      }
    }
    return { success: true, data: { email: parsed.data.email } };
  } catch (error) {
    console.error('[auth:magicLink] unexpected', error);
    return { success: true, data: { email: parsed.data.email } };
  }
}

export async function logoutAction(): Promise<never> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('[auth:logout]', error);
  }
  revalidatePath('/', 'layout');
  redirect('/login');
}
