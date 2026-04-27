'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

import {
  CreateLegalPolicySchema,
  GetLegalPolicyVersionsSchema,
  LEGAL_POLICY_KINDS,
  type ActiveLegalPolicyEntry,
  type CreateLegalPolicyInput,
  type GetLegalPolicyVersionsInput,
  type LegalPolicyKind,
  type LegalPolicyVersion,
} from './legal-policies.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const RPC_ERRORS: Record<string, string> = {
  unauthorized: 'Acesso negado. Apenas owner pode criar políticas legais.',
};

function rpcError(error: unknown): string {
  let msg = '';
  if (error !== null && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
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

interface PolicyRow {
  id: string;
  kind: LegalPolicyKind;
  version: number;
  effective_at: string;
  summary: string;
  content_md: string;
  created_at: string;
  created_by: { id: string; full_name: string | null };
}

function mapRow(row: PolicyRow): LegalPolicyVersion {
  return {
    id:          row.id,
    kind:        row.kind,
    version:     row.version,
    effectiveAt: row.effective_at,
    summary:     row.summary,
    contentMd:   row.content_md,
    createdAt:   row.created_at,
    createdBy:   { id: row.created_by.id, name: row.created_by.full_name },
  };
}

export async function getLegalPolicyVersionsAction(
  input: GetLegalPolicyVersionsInput,
): Promise<ActionResponse<LegalPolicyVersion[]>> {
  const parsed = GetLegalPolicyVersionsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Tipo de política inválido.' };

  try {
    await requirePlatformAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('legal_policies')
      .select('*, created_by:profiles!legal_policies_created_by_fkey(id, full_name)')
      .eq('kind', parsed.data.kind)
      .order('version', { ascending: false });
    if (error) { console.error('[admin:legal:versions]', error); return { success: false, error: 'Erro ao carregar versões.' }; }
    return { success: true, data: (data as PolicyRow[]).map(mapRow) };
  } catch (err) {
    console.error('[admin:legal:versions]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function getActiveLegalPoliciesAction(): Promise<ActionResponse<ActiveLegalPolicyEntry[]>> {
  try {
    await requirePlatformAdmin();
    const supabase = await createClient();

    const results = await Promise.all(
      LEGAL_POLICY_KINDS.map(async (kind) => {
        const { data } = await supabase.rpc('get_active_legal_policy', { p_kind: kind });
        const row = data?.[0] as PolicyRow | undefined;
        const entry: ActiveLegalPolicyEntry = {
          kind,
          activeVersion: row
            ? { id: row.id, kind: row.kind, version: row.version, effectiveAt: row.effective_at, summary: row.summary, createdAt: row.created_at, createdBy: { id: row.created_by?.id ?? '', name: row.created_by?.full_name ?? null } }
            : null,
        };
        return entry;
      }),
    );
    return { success: true, data: results };
  } catch (err) {
    console.error('[admin:legal:active]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function createLegalPolicyAction(
  input: CreateLegalPolicyInput,
): Promise<ActionResponse<{ id: string; kind: LegalPolicyKind; version: number }>> {
  const parsed = CreateLegalPolicySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();
    const { kind, effectiveAt, contentMd, summary } = parsed.data;

    const { data: newId, error } = await supabase.rpc('admin_create_legal_policy', {
      p_kind:         kind,
      p_effective_at: effectiveAt.toISOString(),
      p_content_md:   contentMd,
      p_summary:      summary,
      p_ip_address:   ip,
      p_user_agent:   ua,
    });
    if (error) { console.error('[admin:legal:create]', error); return { success: false, error: rpcError(error) }; }

    // Fetch the created version number
    const { data: row } = await supabase
      .from('legal_policies')
      .select('version')
      .eq('id', newId as string)
      .single();

    revalidatePath('/admin/settings/legal');
    return { success: true, data: { id: newId as string, kind, version: (row as { version: number }).version } };
  } catch (err) {
    console.error('[admin:legal:create]', err);
    return { success: false, error: 'Erro interno.' };
  }
}
