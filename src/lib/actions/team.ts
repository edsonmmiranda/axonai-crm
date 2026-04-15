'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getSessionContext } from '@/lib/supabase/getSessionContext';
import { createServiceClient } from '@/lib/supabase/service';
import { assertRole } from '@/lib/actions/_shared/assertRole';
import type { TeamMember } from '@/lib/actions/invitations';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

type MemberRole = 'owner' | 'admin' | 'member';

const MemberIdSchema = z.string().uuid('ID inválido');

const UpdateMemberSchema = z.object({
  memberId: MemberIdSchema,
  role: z.enum(['admin', 'member']),
  active: z.boolean(),
});

export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

function normalizeRole(raw: unknown): MemberRole {
  return raw === 'owner' || raw === 'admin' ? raw : 'member';
}

async function loadTargetMember(
  memberId: string,
  organizationId: string
): Promise<{ id: string; role: MemberRole } | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .select('id, role')
    .eq('id', memberId)
    .eq('organization_id', organizationId)
    .maybeSingle<{ id: string; role: string | null }>();

  if (error || !data) return null;
  return { id: data.id, role: normalizeRole(data.role) };
}

export async function getTeamMemberByIdAction(
  memberId: string
): Promise<ActionResponse<TeamMember>> {
  const parsed = MemberIdSchema.safeParse(memberId);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) return { success: false, error: gate.error };

    const service = createServiceClient();
    const { data, error } = await service
      .from('profiles')
      .select('id, full_name, email, role, avatar_url, is_active, created_at')
      .eq('id', parsed.data)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (error) {
      console.error('[team:getById]', error);
      return { success: false, error: 'Não foi possível carregar o membro.' };
    }
    if (!data) {
      return { success: false, error: 'Membro não encontrado.' };
    }

    const member: TeamMember = {
      id: data.id as string,
      full_name: (data.full_name as string) ?? '',
      email: (data.email as string | null) ?? null,
      role: normalizeRole(data.role),
      avatar_url: (data.avatar_url as string | null) ?? null,
      is_active: Boolean(data.is_active),
      created_at: data.created_at as string,
    };
    return { success: true, data: member };
  } catch (error) {
    console.error('[team:getById] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function updateMemberAction(
  input: UpdateMemberInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = UpdateMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) return { success: false, error: gate.error };

    const { memberId, role, active } = parsed.data;

    if (memberId === ctx.userId) {
      return { success: false, error: 'Você não pode editar a própria conta.' };
    }

    const target = await loadTargetMember(memberId, ctx.organizationId);
    if (!target) {
      return { success: false, error: 'Membro não encontrado.' };
    }

    if (target.role === 'owner') {
      return { success: false, error: 'O owner não pode ser editado pela UI.' };
    }

    if (target.role === 'admin' && ctx.role !== 'owner') {
      return { success: false, error: 'Apenas o owner pode editar um admin.' };
    }

    const service = createServiceClient();
    const { error } = await service
      .from('profiles')
      .update({ role, is_active: active })
      .eq('id', memberId)
      .eq('organization_id', ctx.organizationId);

    if (error) {
      console.error('[team:update]', error);
      return { success: false, error: 'Não foi possível atualizar o membro.' };
    }

    revalidatePath('/settings/team');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[team:update] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
