'use server';

import { headers } from 'next/headers';
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

export interface TeamMember {
  id: string;
  full_name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'user';
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: 'admin' | 'user';
  token: string;
  invited_by: string;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
}

const CreateInviteSchema = z.object({
  email: z.string().email('Email inválido').transform((v) => v.trim().toLowerCase()),
  role: z.enum(['admin', 'user']),
});

const InvitationIdSchema = z.object({
  invitationId: z.string().uuid('ID inválido'),
});

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;
export type InvitationIdInput = z.infer<typeof InvitationIdSchema>;

function normalizeRole(raw: unknown): TeamMember['role'] {
  return raw === 'owner' || raw === 'admin' ? raw : 'user';
}

async function buildInviteUrl(token: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (base) return `${base}/accept-invite/${token}`;
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return `${origin}/accept-invite/${token}`;
  const host = h.get('host');
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}/accept-invite/${token}`;
  }
  return `/accept-invite/${token}`;
}

export async function getTeamMembersAction(): Promise<ActionResponse<TeamMember[]>> {
  try {
    const ctx = await getSessionContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, avatar_url, is_active, created_at')
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[invitations:getMembers]', error);
      return { success: false, error: 'Não foi possível listar membros.' };
    }

    const members: TeamMember[] = (data ?? []).map((row) => ({
      id: row.id as string,
      full_name: (row.full_name as string) ?? '',
      email: (row.email as string | null) ?? null,
      role: normalizeRole(row.role),
      avatar_url: (row.avatar_url as string | null) ?? null,
      is_active: Boolean(row.is_active),
      created_at: row.created_at as string,
    }));

    return { success: true, data: members };
  } catch (error) {
    console.error('[invitations:getMembers] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function getPendingInvitationsAction(): Promise<
  ActionResponse<PendingInvitation[]>
> {
  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from('invitations')
      .select('id, email, role, token, invited_by, expires_at, created_at')
      .eq('organization_id', ctx.organizationId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[invitations:getPending]', error);
      return { success: false, error: 'Não foi possível listar convites.' };
    }

    const inviterIds = Array.from(new Set((data ?? []).map((r) => r.invited_by as string)));
    const nameById = new Map<string, string>();
    if (inviterIds.length > 0) {
      const { data: inviters } = await service
        .from('profiles')
        .select('id, full_name')
        .in('id', inviterIds);
      for (const p of inviters ?? []) {
        nameById.set(p.id as string, ((p.full_name as string | null) ?? '') || '');
      }
    }

    const invites: PendingInvitation[] = (data ?? []).map((row) => {
      const role = row.role === 'admin' ? 'admin' : 'user';
      return {
        id: row.id as string,
        email: row.email as string,
        role,
        token: row.token as string,
        invited_by: row.invited_by as string,
        invited_by_name: nameById.get(row.invited_by as string) ?? null,
        expires_at: row.expires_at as string,
        created_at: row.created_at as string,
      };
    });

    return { success: true, data: invites };
  } catch (error) {
    console.error('[invitations:getPending] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function createInvitationAction(
  input: CreateInviteInput
): Promise<ActionResponse<{ token: string; inviteUrl: string }>> {
  const parsed = CreateInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const ctx = await getSessionContext();
    const gate = assertRole(ctx, ['owner', 'admin']);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const { email, role } = parsed.data;
    const service = createServiceClient();

    const { data: existingMember } = await service
      .from('profiles')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (existingMember) {
      return { success: false, error: 'Este email já faz parte da sua organização.' };
    }

    const nowIso = new Date().toISOString();
    const { data: pendingInvite } = await service
      .from('invitations')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .ilike('email', email)
      .is('accepted_at', null)
      .gt('expires_at', nowIso)
      .limit(1)
      .maybeSingle();

    if (pendingInvite) {
      return {
        success: false,
        error: 'Já existe convite pendente para este email. Reenvie ou revogue o anterior.',
      };
    }

    const { data: org, error: orgError } = await service
      .from('organizations')
      .select('max_users')
      .eq('id', ctx.organizationId)
      .single<{ max_users: number }>();

    if (orgError || !org) {
      console.error('[invitations:create] read org', orgError);
      return { success: false, error: 'Não foi possível validar o limite do plano.' };
    }

    const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
      service
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', ctx.organizationId),
      service
        .from('invitations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', ctx.organizationId)
        .is('accepted_at', null)
        .gt('expires_at', nowIso),
    ]);

    const totalSeats = (memberCount ?? 0) + (pendingCount ?? 0);
    if (totalSeats >= org.max_users) {
      return {
        success: false,
        error: `Limite de usuários (${org.max_users}) atingido para o plano atual.`,
      };
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inserted, error: insertError } = await service
      .from('invitations')
      .insert({
        organization_id: ctx.organizationId,
        email,
        role,
        invited_by: ctx.userId,
        expires_at: expiresAt,
      })
      .select('token')
      .single<{ token: string }>();

    if (insertError || !inserted) {
      console.error('[invitations:create] insert', insertError);
      return { success: false, error: 'Não foi possível criar o convite.' };
    }

    const inviteUrl = await buildInviteUrl(inserted.token);
    revalidatePath('/settings/team');
    return { success: true, data: { token: inserted.token, inviteUrl } };
  } catch (error) {
    console.error('[invitations:create] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function revokeInvitationAction(
  input: InvitationIdInput
): Promise<ActionResponse<{ ok: true }>> {
  const parsed = InvitationIdSchema.safeParse(input);
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
    const { error } = await service
      .from('invitations')
      .delete()
      .eq('id', parsed.data.invitationId)
      .eq('organization_id', ctx.organizationId)
      .is('accepted_at', null);

    if (error) {
      console.error('[invitations:revoke]', error);
      return { success: false, error: 'Não foi possível revogar o convite.' };
    }

    revalidatePath('/settings/team');
    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error('[invitations:revoke] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}

export async function resendInvitationAction(
  input: InvitationIdInput
): Promise<ActionResponse<{ inviteUrl: string }>> {
  const parsed = InvitationIdSchema.safeParse(input);
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
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const newToken = crypto.randomUUID();
    const { data, error } = await service
      .from('invitations')
      .update({ expires_at: expiresAt, token: newToken })
      .eq('id', parsed.data.invitationId)
      .eq('organization_id', ctx.organizationId)
      .is('accepted_at', null)
      .select('token')
      .maybeSingle<{ token: string }>();

    if (error) {
      console.error('[invitations:resend]', error);
      return { success: false, error: 'Não foi possível reenviar o convite.' };
    }
    if (!data) {
      return { success: false, error: 'Convite não encontrado ou já aceito.' };
    }

    const inviteUrl = await buildInviteUrl(data.token);
    revalidatePath('/settings/team');
    return { success: true, data: { inviteUrl } };
  } catch (error) {
    console.error('[invitations:resend] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente' };
  }
}
