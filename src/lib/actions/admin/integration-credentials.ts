'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createServiceClient } from '@/lib/supabase/service';

import {
  CreateIntegrationCredentialSchema,
  RevokeIntegrationCredentialSchema,
  RotateIntegrationCredentialSchema,
  type CreateIntegrationCredentialInput,
  type IntegrationCredentialView,
  type RevokeIntegrationCredentialInput,
  type RotateIntegrationCredentialInput,
  type SmtpMetadata,
} from './integration-credentials.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?:    T;
  error?:   string;
}

const RPC_ERRORS: Record<string, string> = {
  unauthorized:                   'Acesso negado. Apenas owner pode gerenciar credenciais.',
  credential_kind_already_active: 'Já existe credencial ativa deste tipo. Revogue antes de criar nova.',
  credential_not_found:           'Credencial não encontrada ou já revogada.',
  confirm_kind_mismatch:          'Confirmação não bate com o tipo da credencial.',
  vault_secret_missing:           'Erro de Vault — credencial inconsistente. Revogue e recadastre.',
};

function rpcError(error: unknown): string {
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

interface CredentialRow {
  id:              string;
  kind:            'email_smtp';
  label:           string;
  metadata_jsonb:  SmtpMetadata;
  hint:            string | null;
  created_at:      string;
  created_by:      string | null;
  last_used_at:    string | null;
  rotated_at:      string | null;
  revoked_at:      string | null;
}

function mapRow(row: CredentialRow): IntegrationCredentialView {
  return {
    id:         row.id,
    kind:       row.kind,
    label:      row.label,
    metadata:   row.metadata_jsonb,
    hint:       row.hint,
    createdAt:  row.created_at,
    createdBy:  row.created_by,
    lastUsedAt: row.last_used_at,
    rotatedAt:  row.rotated_at,
    revokedAt:  row.revoked_at,
  };
}

function revalidateAll() {
  revalidatePath('/admin/settings/integrations/email');
  revalidatePath('/admin', 'layout');
}

export async function listIntegrationCredentialsAction(): Promise<ActionResponse<IntegrationCredentialView[]>> {
  try {
    await requirePlatformAdmin();
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('admin_list_integration_credentials');
    if (error) {
      console.error('[admin:integration-credentials:list]', error);
      return { success: false, error: rpcError(error) };
    }
    const rows = (data as CredentialRow[] | null) ?? [];
    return { success: true, data: rows.map(mapRow) };
  } catch (err) {
    console.error('[admin:integration-credentials:list]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function createIntegrationCredentialAction(
  input: CreateIntegrationCredentialInput,
): Promise<ActionResponse<IntegrationCredentialView>> {
  const parsed = CreateIntegrationCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();
    const { kind, label, metadata, secretPlaintext } = parsed.data;

    const { data, error } = await supabase
      .rpc('admin_create_integration_credential', {
        p_kind:             kind,
        p_label:            label,
        p_metadata:         metadata,
        p_secret_plaintext: secretPlaintext,
        p_ip_address:       ip,
        p_user_agent:       ua,
      });

    if (error) {
      console.error('[admin:integration-credentials:create]', error);
      return { success: false, error: rpcError(error) };
    }

    const row = (Array.isArray(data) ? data[0] : data) as CredentialRow | null;
    if (!row) {
      return { success: false, error: 'Erro interno.' };
    }
    revalidateAll();
    return { success: true, data: mapRow(row) };
  } catch (err) {
    console.error('[admin:integration-credentials:create]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function rotateIntegrationCredentialAction(
  input: RotateIntegrationCredentialInput,
): Promise<ActionResponse<IntegrationCredentialView>> {
  const parsed = RotateIntegrationCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();
    const { id, newSecretPlaintext, newMetadata } = parsed.data;

    const { data, error } = await supabase
      .rpc('admin_rotate_integration_credential', {
        p_id:                  id,
        p_new_secret_plaintext: newSecretPlaintext,
        p_new_metadata:        newMetadata,
        p_ip_address:          ip,
        p_user_agent:          ua,
      });

    if (error) {
      console.error('[admin:integration-credentials:rotate]', error);
      return { success: false, error: rpcError(error) };
    }

    const row = (Array.isArray(data) ? data[0] : data) as CredentialRow | null;
    if (!row) {
      return { success: false, error: 'Erro interno.' };
    }
    revalidateAll();
    return { success: true, data: mapRow(row) };
  } catch (err) {
    console.error('[admin:integration-credentials:rotate]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function revokeIntegrationCredentialAction(
  input: RevokeIntegrationCredentialInput,
): Promise<ActionResponse<{ id: string }>> {
  const parsed = RevokeIntegrationCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = createServiceClient();
    const { ip, ua } = await getRequestMeta();
    const { id, confirmKind } = parsed.data;

    // Server-side check: confirmKind precisa bater com o kind real do registro.
    const { data: existing, error: fetchError } = await supabase
      .from('platform_integration_credentials')
      .select('kind, revoked_at')
      .eq('id', id)
      .maybeSingle<{ kind: string; revoked_at: string | null }>();

    if (fetchError) {
      console.error('[admin:integration-credentials:revoke:fetch]', fetchError);
      return { success: false, error: 'Erro interno.' };
    }
    if (!existing || existing.revoked_at !== null) {
      return { success: false, error: RPC_ERRORS.credential_not_found };
    }
    if (existing.kind !== confirmKind) {
      return { success: false, error: RPC_ERRORS.confirm_kind_mismatch };
    }

    const { error } = await supabase
      .rpc('admin_revoke_integration_credential', {
        p_id:         id,
        p_ip_address: ip,
        p_user_agent: ua,
      });

    if (error) {
      console.error('[admin:integration-credentials:revoke]', error);
      return { success: false, error: rpcError(error) };
    }

    revalidateAll();
    return { success: true, data: { id } };
  } catch (err) {
    console.error('[admin:integration-credentials:revoke]', err);
    return { success: false, error: 'Erro interno.' };
  }
}
