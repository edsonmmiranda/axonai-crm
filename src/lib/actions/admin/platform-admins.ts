'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { sendEmail } from '@/lib/email/sender';
import {
  adminInvitationHtml,
  adminInvitationText,
} from '@/lib/email/templates/admin-invitation';
import { createServiceClient } from '@/lib/supabase/service';

import {
  ApproveMfaResetSchema,
  ChangeRoleSchema,
  ConsumeInvitationSchema,
  CreateInvitationSchema,
  DeactivateAdminSchema,
  ListInvitationsFilterSchema,
  ListMfaResetFilterSchema,
  RequestMfaResetSchema,
  RevokeInvitationSchema,
  RevokeMfaResetSchema,
  type ApproveMfaResetInput,
  type ChangeRoleInput,
  type ConsumeInvitationInput,
  type ConsumeInvitationResult,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type DeactivateAdminInput,
  type InvitationByToken,
  type InvitationRow,
  type InvitationStatus,
  type ListInvitationsFilter,
  type ListMfaResetFilter,
  type MfaResetRequestRow,
  type PlatformAdminListRow,
  type RequestMfaResetInput,
  type RevokeInvitationInput,
  type RevokeMfaResetInput,
} from './platform-admins.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const RPC_ERRORS: Record<string, string> = {
  unauthorized:                     'Acesso negado. Apenas owner pode executar esta ação.',
  invalid_email_format:             'Email com formato inválido.',
  invalid_role:                     'Papel inválido.',
  email_already_active_admin:       'Este email já é admin ativo da plataforma.',
  invitation_already_pending:       'Já existe convite pendente para este email. Revogue antes de criar novo.',
  invitation_already_consumed:      'Convite já foi utilizado.',
  invitation_revoked:               'Convite foi revogado.',
  invitation_expired:               'Convite expirou. Peça novo ao admin que te convidou.',
  // ⚠️ Ordem importa: chaves mais específicas devem vir ANTES de chaves que são
  // substring delas (rpcErrorMessage usa msg.includes, primeiro match vence).
  invitation_not_found_or_terminal: 'Convite não encontrado ou já em estado terminal.',
  invitation_not_found:             'Convite não encontrado.',
  invitation_consume_failed:        'Falha ao consumir convite.',
  email_mismatch:                   'O email do link não bate com a conta logada.',
  profile_not_in_internal_org:      'Profile precisa estar na organização interna axon.',
  profile_org_mismatch:             'Conta já existe em outra organização. Use outro email ou contate o admin.',
  last_owner_protected:             'Não é possível desativar/rebaixar o último owner ativo.',
  confirm_email_mismatch:           'Confirmação de email não bate com o admin selecionado.',
  admin_not_found_or_inactive:      'Administrador não encontrado ou inativo.',
  invalid_reason_length:            'Motivo deve ter entre 5 e 500 caracteres.',
  self_request_forbidden:           'Você não pode solicitar reset de MFA para si mesmo.',
  target_admin_not_found_or_inactive: 'Administrador alvo não encontrado ou inativo.',
  mfa_reset_already_pending:        'Já existe pedido de reset MFA pendente para este admin.',
  self_approve_forbidden:           'Você não pode aprovar um pedido que você mesmo abriu.',
  target_approve_forbidden:         'Você não pode aprovar um pedido cujo alvo é você.',
  mfa_reset_request_expired:        'Pedido expirou (mais de 24h sem aprovação).',
  mfa_reset_request_not_pending:    'Pedido não está pendente.',
  mfa_reset_request_not_found:      'Pedido não encontrado.',
  mfa_reset_already_approved:       'Pedido já foi aprovado.',
  invalid_filter:                   'Filtro inválido.',
};

function rpcErrorMessage(error: unknown): string {
  let msg = '';
  if (
    error !== null
    && typeof error === 'object'
    && 'message' in error
    && typeof (error as { message: unknown }).message === 'string'
  ) {
    msg = (error as { message: string }).message;
  } else {
    msg = String(error);
  }
  for (const [code, label] of Object.entries(RPC_ERRORS)) {
    if (msg.includes(code)) return label;
  }
  return 'Erro interno. Tente novamente.';
}

async function getRequestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip');
  return { ip, ua: hdrs.get('user-agent') };
}

function revalidateAll(): void {
  revalidatePath('/admin/admins');
  revalidatePath('/admin/admins', 'layout');
}

interface RawAdminListRow {
  id: string;
  profile_id: string;
  role: 'owner' | 'support' | 'billing';
  is_active: boolean;
  created_at: string;
  deactivated_at: string | null;
  created_by: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  last_sign_in_at: string | null;
  mfa_configured: boolean;
  mfa_reset_required: boolean;
}

function mapAdminRow(row: RawAdminListRow): PlatformAdminListRow {
  return {
    id:                row.id,
    profileId:         row.profile_id,
    role:              row.role,
    isActive:          row.is_active,
    createdAt:         row.created_at,
    deactivatedAt:     row.deactivated_at,
    createdBy:         row.created_by,
    email:             row.email,
    fullName:          row.full_name,
    avatarUrl:         row.avatar_url,
    lastSignInAt:      row.last_sign_in_at,
    mfaConfigured:     row.mfa_configured,
    mfaResetRequired:  row.mfa_reset_required,
  };
}

interface RawInvitationRow {
  id: string;
  email: string;
  role: 'owner' | 'support' | 'billing';
  token: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_profile_id: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  email_delivery_log_id: string | null;
  created_by: string;
  created_at: string;
}

function mapInvitationRow(row: RawInvitationRow): InvitationRow {
  return {
    id:                  row.id,
    email:               row.email,
    role:                row.role,
    token:               row.token,
    expiresAt:           row.expires_at,
    consumedAt:          row.consumed_at,
    consumedByProfileId: row.consumed_by_profile_id,
    revokedAt:           row.revoked_at,
    revokedBy:           row.revoked_by,
    emailDeliveryLogId:  row.email_delivery_log_id,
    createdBy:           row.created_by,
    createdAt:           row.created_at,
  };
}

interface RawMfaResetRow {
  id: string;
  target_platform_admin_id: string;
  target_profile_id: string;
  requested_by: string;
  reason: string;
  requested_at: string;
  expires_at: string;
  approved_by: string | null;
  approved_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

function mapMfaResetRow(row: RawMfaResetRow): MfaResetRequestRow {
  return {
    id:                     row.id,
    targetPlatformAdminId:  row.target_platform_admin_id,
    targetProfileId:        row.target_profile_id,
    requestedBy:            row.requested_by,
    reason:                 row.reason,
    requestedAt:            row.requested_at,
    expiresAt:              row.expires_at,
    approvedBy:             row.approved_by,
    approvedAt:             row.approved_at,
    consumedAt:             row.consumed_at,
    revokedAt:              row.revoked_at,
    revokedBy:              row.revoked_by,
  };
}

// =============================================================================
// READ actions — qualquer platform admin
// =============================================================================

export async function listPlatformAdminsAction(): Promise<ActionResponse<PlatformAdminListRow[]>> {
  try {
    await requirePlatformAdmin();
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('admin_list_platform_admins');
    if (error) {
      console.error('[admin:platform-admins:list]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }
    const rows = (data as RawAdminListRow[] | null) ?? [];
    return { success: true, data: rows.map(mapAdminRow) };
  } catch (err) {
    console.error('[admin:platform-admins:list] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function listInvitationsAction(
  filter: ListInvitationsFilter = 'pending',
): Promise<ActionResponse<InvitationRow[]>> {
  const parsed = ListInvitationsFilterSchema.safeParse(filter);
  if (!parsed.success) {
    return { success: false, error: 'Filtro inválido.' };
  }
  try {
    await requirePlatformAdmin();
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .rpc('admin_list_platform_admin_invitations', { p_filter: parsed.data });
    if (error) {
      console.error('[admin:invitations:list]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }
    const rows = (data as RawInvitationRow[] | null) ?? [];
    return { success: true, data: rows.map(mapInvitationRow) };
  } catch (err) {
    console.error('[admin:invitations:list] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function listMfaResetRequestsAction(
  filter: ListMfaResetFilter = 'pending',
): Promise<ActionResponse<MfaResetRequestRow[]>> {
  const parsed = ListMfaResetFilterSchema.safeParse(filter);
  if (!parsed.success) {
    return { success: false, error: 'Filtro inválido.' };
  }
  try {
    await requirePlatformAdmin();
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .rpc('admin_list_mfa_reset_requests', { p_filter: parsed.data });
    if (error) {
      console.error('[admin:mfa-reset:list]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }
    const rows = (data as RawMfaResetRow[] | null) ?? [];
    return { success: true, data: rows.map(mapMfaResetRow) };
  } catch (err) {
    console.error('[admin:mfa-reset:list] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

// =============================================================================
// MUTATIONS — owner-only
// =============================================================================

export async function createInvitationAction(
  input: CreateInvitationInput,
): Promise<ActionResponse<CreateInvitationResult>> {
  const parsed = CreateInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();
    const { email, role } = parsed.data;

    const { data: rpcData, error: rpcErr } = await supabase
      .rpc('admin_create_platform_admin_invitation', {
        p_email:            email,
        p_role:             role,
        p_actor_profile_id: caller.profileId,
        p_ip_address:       ip,
        p_user_agent:       ua,
      });

    if (rpcErr) {
      console.error('[admin:invitations:create]', rpcErr);
      return { success: false, error: rpcErrorMessage(rpcErr) };
    }

    const rawRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as RawInvitationRow | null;
    if (!rawRow) {
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    const invitation = mapInvitationRow(rawRow);

    // Build accept URL — caller passes pre-built link to sender (Sprint 10 contract).
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const acceptUrl = `${appUrl}/admin/accept-invite/${invitation.token}`;
    const expiresAt = new Date(invitation.expiresAt);
    const inviterName = caller.email || 'Equipe Axon';

    const deliveryResult = await sendEmail({
      kind:        'invitation',
      to:          invitation.email,
      subject:     'Convite para acessar a Área Admin Axon',
      html:        adminInvitationHtml({ inviterName, role: invitation.role, acceptUrl, expiresAt }),
      text:        adminInvitationText({ inviterName, role: invitation.role, acceptUrl, expiresAt }),
      related:     { type: 'platform_admin_invitation', id: invitation.id },
      offlineLink: acceptUrl,
      sentBy:      caller.profileId,
    });

    // Update invitation with delivery log id (best-effort; doesn't block success).
    if (deliveryResult.deliveryLogId) {
      const { error: updateErr } = await supabase
        .from('platform_admin_invitations')
        .update({ email_delivery_log_id: deliveryResult.deliveryLogId })
        .eq('id', invitation.id);
      if (updateErr) {
        console.error('[admin:invitations:create:link-delivery]', updateErr);
      }
    }

    revalidateAll();

    if (deliveryResult.status === 'sent') {
      return { success: true, data: { invitation, deliveryStatus: 'sent' } };
    }
    if (deliveryResult.status === 'fallback_offline') {
      return {
        success: true,
        data: {
          invitation,
          deliveryStatus: 'fallback_offline',
          offlineLink:    deliveryResult.offlineLink,
        },
      };
    }
    return {
      success: true,
      data: {
        invitation,
        deliveryStatus: 'error',
        errorMessage:   deliveryResult.errorMessage,
      },
    };
  } catch (err) {
    console.error('[admin:invitations:create] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function revokeInvitationAction(
  input: RevokeInvitationInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = RevokeInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'ID inválido.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    const { error } = await supabase.rpc('admin_revoke_platform_admin_invitation', {
      p_id:               parsed.data.id,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:invitations:revoke]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateAll();
    return { success: true, data: { id: parsed.data.id } };
  } catch (err) {
    console.error('[admin:invitations:revoke] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function changePlatformAdminRoleAction(
  input: ChangeRoleInput,
): Promise<ActionResponse<{ id: string; role: 'owner' | 'support' | 'billing' }>> {
  const parsed = ChangeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    const { data, error } = await supabase.rpc('admin_change_platform_admin_role', {
      p_target_id:        parsed.data.id,
      p_new_role:         parsed.data.newRole,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:role-change]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    const row = (Array.isArray(data) ? data[0] : data) as { id: string; role: 'owner' | 'support' | 'billing' } | null;
    if (!row) {
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }

    revalidateAll();
    return { success: true, data: { id: row.id, role: row.role } };
  } catch (err) {
    console.error('[admin:role-change] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function deactivatePlatformAdminAction(
  input: DeactivateAdminInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = DeactivateAdminSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    // Server-side confirm email check (defense in depth on top of UI confirmation).
    const { data: target, error: fetchErr } = await supabase
      .from('platform_admins')
      .select('profile_id')
      .eq('id', parsed.data.id)
      .maybeSingle<{ profile_id: string }>();

    if (fetchErr) {
      console.error('[admin:deactivate:fetch]', fetchErr);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    if (!target) {
      return { success: false, error: RPC_ERRORS.admin_not_found_or_inactive };
    }

    const { data: targetProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', target.profile_id)
      .maybeSingle<{ email: string | null }>();

    if (profileErr) {
      console.error('[admin:deactivate:profile-fetch]', profileErr);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    if (!targetProfile?.email
        || targetProfile.email.toLowerCase() !== parsed.data.confirmEmail.toLowerCase()) {
      return { success: false, error: RPC_ERRORS.confirm_email_mismatch };
    }

    const { error } = await supabase.rpc('admin_deactivate_platform_admin', {
      p_target_id:        parsed.data.id,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:deactivate]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateAll();
    return { success: true, data: { id: parsed.data.id } };
  } catch (err) {
    console.error('[admin:deactivate] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function requestMfaResetAction(
  input: RequestMfaResetInput,
): Promise<ActionResponse<MfaResetRequestRow>> {
  const parsed = RequestMfaResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    const { data, error } = await supabase.rpc('admin_request_mfa_reset', {
      p_target_admin_id:  parsed.data.targetAdminId,
      p_reason:           parsed.data.reason,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:mfa-reset:request]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    const row = (Array.isArray(data) ? data[0] : data) as RawMfaResetRow | null;
    if (!row) {
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }

    revalidateAll();
    return { success: true, data: mapMfaResetRow(row) };
  } catch (err) {
    console.error('[admin:mfa-reset:request] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function approveMfaResetAction(
  input: ApproveMfaResetInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = ApproveMfaResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'ID inválido.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    const { error } = await supabase.rpc('admin_approve_mfa_reset', {
      p_request_id:       parsed.data.requestId,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:mfa-reset:approve]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateAll();
    return { success: true, data: { id: parsed.data.requestId } };
  } catch (err) {
    console.error('[admin:mfa-reset:approve] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

export async function revokeMfaResetRequestAction(
  input: RevokeMfaResetInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = RevokeMfaResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'ID inválido.' };
  }
  try {
    const caller = await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();

    const { error } = await supabase.rpc('admin_revoke_mfa_reset_request', {
      p_request_id:       parsed.data.requestId,
      p_actor_profile_id: caller.profileId,
      p_ip_address:       ip,
      p_user_agent:       ua,
    });

    if (error) {
      console.error('[admin:mfa-reset:revoke]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidateAll();
    return { success: true, data: { id: parsed.data.requestId } };
  } catch (err) {
    console.error('[admin:mfa-reset:revoke] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

// =============================================================================
// PUBLIC actions — invitation accept flow (sem auth de admin)
// =============================================================================

export async function getInvitationByTokenAction(
  token: string,
): Promise<ActionResponse<InvitationByToken>> {
  const parsed = ConsumeInvitationSchema.shape.token.safeParse(token);
  if (!parsed.success) {
    return { success: false, error: 'Token inválido.' };
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: parsed.data });
    if (error) {
      console.error('[admin:invitation:by-token]', error);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { email: string; role: 'owner' | 'support' | 'billing'; expires_at: string;
          consumed_at: string | null; revoked_at: string | null }
      | null;

    if (!row) {
      return { success: false, error: RPC_ERRORS.invitation_not_found };
    }

    let status: InvitationStatus = 'valid';
    if (row.consumed_at) status = 'consumed';
    else if (row.revoked_at) status = 'revoked';
    else if (new Date(row.expires_at) <= new Date()) status = 'expired';

    return {
      success: true,
      data: {
        email:     row.email,
        role:      row.role,
        expiresAt: row.expires_at,
        status,
      },
    };
  } catch (err) {
    console.error('[admin:invitation:by-token] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}

const AXON_ORG_SLUG = 'axon';

interface OrgRow { id: string }
interface ProfileRow { id: string; organization_id: string; email: string | null }

export async function consumeInvitationAction(
  input: ConsumeInvitationInput,
): Promise<ActionResponse<ConsumeInvitationResult>> {
  const parsed = ConsumeInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();
    const { token, password } = parsed.data;

    // 1. Validate invitation.
    const { data: invData, error: invErr } = await supabase
      .rpc('get_invitation_by_token', { p_token: token });
    if (invErr) {
      console.error('[admin:invitation:consume:read]', invErr);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    const inv = (Array.isArray(invData) ? invData[0] : invData) as
      | { email: string; role: string; expires_at: string;
          consumed_at: string | null; revoked_at: string | null }
      | null;
    if (!inv) return { success: false, error: RPC_ERRORS.invitation_not_found };
    if (inv.consumed_at) return { success: false, error: RPC_ERRORS.invitation_already_consumed };
    if (inv.revoked_at) return { success: false, error: RPC_ERRORS.invitation_revoked };
    if (new Date(inv.expires_at) <= new Date()) {
      return { success: false, error: RPC_ERRORS.invitation_expired };
    }

    const inviteEmail = inv.email.toLowerCase();

    // 2. Resolve axon org id.
    const { data: orgRow, error: orgErr } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', AXON_ORG_SLUG)
      .maybeSingle<OrgRow>();
    if (orgErr || !orgRow) {
      console.error('[admin:invitation:consume:org]', orgErr);
      return { success: false, error: 'Organização interna não encontrada.' };
    }
    const axonOrgId = orgRow.id;

    // 3. Find or create auth user for the invited email.
    const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers({
      page:    1,
      perPage: 200,
    });
    if (listErr) {
      console.error('[admin:invitation:consume:list-users]', listErr);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }
    const existing = (existingUsers?.users ?? []).find(
      (u) => (u.email ?? '').toLowerCase() === inviteEmail,
    );

    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email:         inviteEmail,
        password,
        email_confirm: true,
      });
      if (createErr || !created.user) {
        console.error('[admin:invitation:consume:create-user]', createErr);
        return { success: false, error: 'Não foi possível criar a conta.' };
      }
      userId = created.user.id;
    }

    // 4. Ensure profile exists in axon org.
    const { data: existingProfile, error: profileFetchErr } = await supabase
      .from('profiles')
      .select('id, organization_id, email')
      .eq('id', userId)
      .maybeSingle<ProfileRow>();
    if (profileFetchErr) {
      console.error('[admin:invitation:consume:profile-fetch]', profileFetchErr);
      return { success: false, error: 'Erro interno. Tente novamente.' };
    }

    if (existingProfile) {
      if (existingProfile.organization_id !== axonOrgId) {
        return { success: false, error: RPC_ERRORS.profile_org_mismatch };
      }
    } else {
      const { error: profileInsertErr } = await supabase
        .from('profiles')
        .insert({
          id:              userId,
          organization_id: axonOrgId,
          email:           inviteEmail,
          full_name:       inviteEmail.split('@')[0],
          role:            'admin',
        });
      if (profileInsertErr) {
        console.error('[admin:invitation:consume:profile-insert]', profileInsertErr);
        return { success: false, error: 'Erro ao criar perfil.' };
      }
    }

    // 5. Atomic consume — RPC returns the new platform_admins row.
    const { error: consumeErr } = await supabase
      .rpc('admin_consume_platform_admin_invitation', {
        p_token:                token,
        p_consumer_profile_id:  userId,
        p_ip_address:           ip,
        p_user_agent:           ua,
      });

    if (consumeErr) {
      console.error('[admin:invitation:consume:rpc]', consumeErr);
      return { success: false, error: rpcErrorMessage(consumeErr) };
    }

    revalidateAll();
    return {
      success: true,
      data: {
        profileId:  userId,
        redirectTo: '/admin/mfa-enroll?firstEnroll=true',
      },
    };
  } catch (err) {
    console.error('[admin:invitation:consume] unexpected', err);
    return { success: false, error: 'Erro interno. Tente novamente.' };
  }
}
