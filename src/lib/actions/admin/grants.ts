'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

import {
  CreateGrantSchema,
  ListGrantsFiltersSchema,
  RevokeGrantSchema,
  type CreateGrantInput,
  type LimitKey,
  type ListGrantsFiltersInput,
  type RevokeGrantInput,
} from './grants.schemas';

export type { LimitKey } from './grants.schemas';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type GrantStatus = 'active' | 'expired' | 'revoked';

export interface GrantListItem {
  id: string;
  organizationId: string;
  limitKey: LimitKey;
  valueOverride: number | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  status: GrantStatus;
}

interface GrantRow {
  id: string;
  organization_id: string;
  limit_key: LimitKey;
  value_override: number | null;
  reason: string;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  created_by: { id: string; full_name: string | null } | null;
  revoked_by: { id: string; full_name: string | null } | null;
}

/* ------------------------------------------------------------------ */
/*  Error mapping                                                      */
/* ------------------------------------------------------------------ */

const RPC_ERROR_MESSAGES: Record<string, string> = {
  insufficient_privilege:  'Permissão insuficiente para esta ação.',
  org_not_found:           'Organização não encontrada.',
  invalid_limit_key:       'Tipo de limite inválido.',
  invalid_value_override:  'Valor de override inválido.',
  invalid_reason:          'Razão inválida (5–500 caracteres).',
  invalid_expires_at:      'Expiração inválida (deve ser futura).',
  grant_not_found:         'Grant não encontrado.',
  grant_already_revoked:   'Esse grant já foi revogado.',
};

function rpcErrorMessage(error: unknown): string {
  let msg = '';
  if (error instanceof Error) {
    msg = error.message;
  } else if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    msg = (error as { message: string }).message;
  } else {
    msg = String(error);
  }
  for (const [code, label] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (msg.includes(code)) return label;
  }
  return 'Erro interno. Tente novamente.';
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getRequestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip');
  const ua = hdrs.get('user-agent');
  return { ip, ua };
}

function computeStatus(row: { revoked_at: string | null; expires_at: string | null }): GrantStatus {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function mapGrantRow(row: GrantRow): GrantListItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    limitKey: row.limit_key,
    valueOverride: row.value_override,
    reason: row.reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdByName: row.created_by?.full_name ?? null,
    revokedAt: row.revoked_at,
    revokedByName: row.revoked_by?.full_name ?? null,
    status: computeStatus(row),
  };
}

const GRANT_SELECT = `
  id, organization_id, limit_key, value_override, reason, expires_at,
  created_at, revoked_at,
  created_by:profiles!plan_grants_created_by_fkey ( id, full_name ),
  revoked_by:profiles!plan_grants_revoked_by_fkey ( id, full_name )
`;

/* ------------------------------------------------------------------ */
/*  Server Actions                                                     */
/* ------------------------------------------------------------------ */

export async function getGrantsAction(
  input: ListGrantsFiltersInput,
): Promise<ActionResponse<{ items: GrantListItem[] }>> {
  const parsed = ListGrantsFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    let query = supabase
      .from('plan_grants')
      .select(GRANT_SELECT)
      .eq('organization_id', parsed.data.organizationId)
      .order('created_at', { ascending: false });

    if (!parsed.data.includeRevoked) {
      query = query.is('revoked_at', null);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[grants:list]', error);
      return { success: false, error: 'Não foi possível listar os grants.' };
    }

    const rows = (data ?? []) as unknown as GrantRow[];
    const now = Date.now();
    const filtered = parsed.data.includeExpired
      ? rows
      : rows.filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now);

    return { success: true, data: { items: filtered.map(mapGrantRow) } };
  } catch (error) {
    console.error('[grants:list] unexpected', error);
    return { success: false, error: 'Erro interno, tente novamente.' };
  }
}

export async function createGrantAction(
  input: CreateGrantInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = CreateGrantSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { data, error } = await supabase.rpc('admin_grant_limit', {
      p_org_id:         parsed.data.organizationId,
      p_limit_key:      parsed.data.limitKey,
      p_value_override: parsed.data.valueOverride,
      p_reason:         parsed.data.reason,
      p_expires_at:     parsed.data.expiresAt ? parsed.data.expiresAt.toISOString() : null,
      p_ip_address:     ip,
      p_user_agent:     ua,
    });

    if (error) {
      console.error('[grants:create]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath(`/admin/organizations/${parsed.data.organizationId}/grants`);
    revalidatePath(`/admin/organizations/${parsed.data.organizationId}`);

    return { success: true, data: { id: data as string } };
  } catch (error) {
    console.error('[grants:create] unexpected', error);
    return { success: false, error: 'Não foi possível criar o grant. Tente novamente.' };
  }
}

export async function revokeGrantAction(
  input: RevokeGrantInput,
): Promise<ActionResponse<void>> {
  const parsed = RevokeGrantSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();

    const { data: grant, error: lookupError } = await supabase
      .from('plan_grants')
      .select('id, organization_id, limit_key, revoked_at')
      .eq('id', parsed.data.grantId)
      .maybeSingle<{
        id: string;
        organization_id: string;
        limit_key: LimitKey;
        revoked_at: string | null;
      }>();

    if (lookupError) {
      console.error('[grants:revoke:lookup]', lookupError);
      return { success: false, error: 'Não foi possível localizar o grant.' };
    }

    if (!grant) {
      return { success: false, error: RPC_ERROR_MESSAGES.grant_not_found };
    }

    if (grant.limit_key !== parsed.data.limitKeyConfirmation) {
      return { success: false, error: 'A confirmação não corresponde ao tipo do grant.' };
    }

    const { error } = await supabase.rpc('admin_revoke_grant', {
      p_grant_id:    parsed.data.grantId,
      p_ip_address:  ip,
      p_user_agent:  ua,
    });

    if (error) {
      console.error('[grants:revoke]', error);
      return { success: false, error: rpcErrorMessage(error) };
    }

    revalidatePath(`/admin/organizations/${grant.organization_id}/grants`);
    revalidatePath(`/admin/organizations/${grant.organization_id}`);

    return { success: true };
  } catch (error) {
    console.error('[grants:revoke] unexpected', error);
    return { success: false, error: 'Não foi possível revogar o grant. Tente novamente.' };
  }
}
