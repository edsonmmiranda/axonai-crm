import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

import { FEATURE_FLAG_REGISTRY } from './registry';

/** Per-request cache. Returns only flags with isPublic=true. */
export const getPublicFlags = cache(async (): Promise<Record<string, boolean>> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_active_feature_flags');

  const persisted = new Map<string, boolean>(
    (data ?? []).map((r: { key: string; enabled: boolean }) => [r.key, r.enabled]),
  );

  const result: Record<string, boolean> = {};
  for (const spec of FEATURE_FLAG_REGISTRY) {
    if (!spec.isPublic) continue;
    result[spec.key] = persisted.get(spec.key) ?? spec.defaultEnabled;
  }
  return result;
});
