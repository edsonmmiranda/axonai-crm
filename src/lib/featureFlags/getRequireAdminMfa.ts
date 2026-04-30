import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { FEATURE_FLAG_REGISTRY } from './registry';

const FLAG_KEY = 'require_admin_mfa';
const TTL_MS = 30_000;

const DEFAULT_ENABLED =
  FEATURE_FLAG_REGISTRY.find((f) => f.key === FLAG_KEY)?.defaultEnabled ?? true;

let cached: { value: boolean; expiresAt: number } | null = null;

export async function getRequireAdminMfaCached(
  supabase: SupabaseClient,
): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', FLAG_KEY)
      .maybeSingle<{ enabled: boolean }>();

    if (error) {
      console.error('[mw:require_admin_mfa]', error);
      return true;
    }

    const value = data?.enabled ?? DEFAULT_ENABLED;
    cached = { value, expiresAt: now + TTL_MS };
    return value;
  } catch (err) {
    console.error('[mw:require_admin_mfa]', err);
    return true;
  }
}
