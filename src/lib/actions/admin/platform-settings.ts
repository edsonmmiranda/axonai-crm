'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requirePlatformAdmin, requirePlatformAdminRole } from '@/lib/auth/platformAdmin';
import { createClient } from '@/lib/supabase/server';

import {
  UpdatePlatformSettingSchema,
  type PlatformSetting,
  type SettingValue,
  type UpdatePlatformSettingInput,
} from './platform-settings.schemas';

interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const RPC_ERRORS: Record<string, string> = {
  unauthorized:        'Acesso negado. Apenas owner pode alterar configurações.',
  value_type_mismatch: 'Tipo de valor incompatível com o campo.',
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

interface SettingRow {
  key: string;
  value_type: string;
  value_text: string | null;
  value_int: number | null;
  value_bool: boolean | null;
  value_jsonb: unknown;
  description: string;
  updated_at: string;
  updated_by: { id: string; full_name: string | null } | null;
}

function mapRow(row: SettingRow): PlatformSetting {
  let value: SettingValue;
  switch (row.value_type) {
    case 'text':  value = { type: 'text',  value: row.value_text! }; break;
    case 'int':   value = { type: 'int',   value: row.value_int! };  break;
    case 'bool':  value = { type: 'bool',  value: row.value_bool! }; break;
    default:      value = { type: 'jsonb', value: row.value_jsonb };  break;
  }
  return {
    key: row.key,
    description: row.description,
    value,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ? { id: row.updated_by.id, name: row.updated_by.full_name } : null,
  };
}

export async function getPlatformSettingsAction(): Promise<ActionResponse<PlatformSetting[]>> {
  try {
    await requirePlatformAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*, updated_by:profiles!platform_settings_updated_by_fkey(id, full_name)')
      .order('key');
    if (error) { console.error('[admin:settings:list]', error); return { success: false, error: 'Erro ao carregar configurações.' }; }
    return { success: true, data: (data as SettingRow[]).map(mapRow) };
  } catch (err) {
    console.error('[admin:settings:list]', err);
    return { success: false, error: 'Erro interno.' };
  }
}

export async function updatePlatformSettingAction(
  input: UpdatePlatformSettingInput,
): Promise<ActionResponse<{ key: string }>> {
  const parsed = UpdatePlatformSettingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Entrada inválida.' };
  }

  try {
    await requirePlatformAdminRole(['owner']);
    const supabase = await createClient();
    const { ip, ua } = await getRequestMeta();
    const { key, valueType, value } = parsed.data;

    const params = {
      p_key:        key,
      p_value_type: valueType,
      p_value_text:  valueType === 'text'  ? (value as string)  : null,
      p_value_int:   valueType === 'int'   ? (value as number)  : null,
      p_value_bool:  valueType === 'bool'  ? (value as boolean) : null,
      p_value_jsonb: valueType === 'jsonb' ? value              : null,
      p_ip_address: ip,
      p_user_agent: ua,
    };

    const { error } = await supabase.rpc('admin_set_setting', params);
    if (error) { console.error('[admin:settings:update]', error); return { success: false, error: rpcError(error) }; }

    revalidatePath('/admin/settings/trial');
    revalidatePath('/admin/dashboard');
    return { success: true, data: { key } };
  } catch (err) {
    console.error('[admin:settings:update]', err);
    return { success: false, error: 'Erro interno.' };
  }
}
