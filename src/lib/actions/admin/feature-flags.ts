'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { FEATURE_FLAG_REGISTRY } from '@/lib/featureFlags/registry';
import { createClient } from '@/lib/supabase/server';

import {
  SetFeatureFlagSchema,
  type FeatureFlagView,
  type SetFeatureFlagInput,
} from './feature-flags.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const RPC_ERRORS: Record<string, string> = {
  unauthorized:                   'Acesso negado. Apenas owner pode alterar feature flags.',
  feature_flag_key_not_registered:'Feature flag não registrada no sistema.',
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

interface FlagRow {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
  updated_by: { id: string; full_name: string | null } | null;
}

export async function getFeatureFlagsAction(): Promise<ActionResponse<FeatureFlagView[]>> {
  try {
    await requirePlatformAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*, updated_by:profiles!feature_flags_updated_by_fkey(id, full_name)')
      .order('key');
    if (error) { console.error('[admin:flags:list]', error); return { success: false, error: 'Erro ao carregar feature flags.' }; }

    const persisted = new Map<string, FlagRow>((data as FlagRow[]).map((r) => [r.key, r]));

    const result: FeatureFlagView[] = FEATURE_FLAG_REGISTRY.map((spec) => {
      const p = persisted.get(spec.key);
      return {
        key:            spec.key,
        label:          spec.label,
        description:    spec.description,
        isPublic:       spec.isPublic,
        defaultEnabled: spec.defaultEnabled,
        enabled:        p?.enabled ?? spec.defaultEnabled,
        config:         p?.config ?? {},
        isInitialized:  !!p,
        updatedAt:      p?.updated_at ?? null,
        updatedBy:      p?.updated_by ? { id: p.updated_by.id, name: p.updated_by.full_name } : null,
      };
    });

    return { success: true, data: result };
  } catch (err) {
    console.error('[admin:flags:list]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function setFeatureFlagAction(
  input: SetFeatureFlagInput,
): Promise<ActionResponse<{ key: string; enabled: boolean }>> {
  const parsed = SetFeatureFlagSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();
    const { key, enabled, config } = parsed.data;

    const { error } = await supabase.rpc('admin_set_feature_flag', {
      p_key:         key,
      p_enabled:     enabled,
      p_config:      config,
      p_ip_address:  ip,
      p_user_agent:  ua,
    });
    if (error) { console.error('[admin:flags:set]', error); return { success: false, error: rpcError(error) }; }

    revalidatePath('/admin/settings/feature-flags');
    return { success: true, data: { key, enabled } };
  } catch (err) {
    console.error('[admin:flags:set]', err);
    return { success: false, error: 'Erro interno.' };
  }
}
