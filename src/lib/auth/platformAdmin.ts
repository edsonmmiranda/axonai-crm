import 'server-only';

import { cache } from 'react';
import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type PlatformAdminRole = 'owner' | 'support' | 'billing';
export type AdminThemePreference = 'light' | 'dark' | 'system';

const VALID_ADMIN_THEMES: readonly AdminThemePreference[] = ['light', 'dark', 'system'] as const;

function normalizeAdminTheme(raw: unknown): AdminThemePreference {
  if (typeof raw === 'string' && (VALID_ADMIN_THEMES as readonly string[]).includes(raw)) {
    return raw as AdminThemePreference;
  }
  return 'light';
}

export interface PlatformAdminSnapshot {
  id: string;
  profileId: string;
  role: PlatformAdminRole;
  isActive: boolean;
  createdAt: string;
  email: string;
  adminTheme: AdminThemePreference;
}

export const getPlatformAdmin = cache(async (): Promise<PlatformAdminSnapshot | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ data, error }, { data: profileRow }] = await Promise.all([
    supabase.rpc('is_platform_admin', { target_profile_id: user.id }),
    supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .maybeSingle<{ preferences: Record<string, unknown> | null }>(),
  ]);

  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    role: row.role as PlatformAdminRole,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    email: user.email ?? '',
    adminTheme: normalizeAdminTheme(profileRow?.preferences?.adminTheme),
  };
});

export async function requirePlatformAdmin(): Promise<PlatformAdminSnapshot> {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  return admin;
}

export async function requirePlatformAdminRole(
  allowed: readonly PlatformAdminRole[],
): Promise<PlatformAdminSnapshot> {
  const admin = await requirePlatformAdmin();
  if (!allowed.includes(admin.role)) notFound();
  return admin;
}
