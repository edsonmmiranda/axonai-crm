import 'server-only';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type SessionRole = 'owner' | 'admin' | 'member';

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: SessionRole;
  fullName: string;
  avatarUrl: string | null;
  organizationName: string;
};

const VALID_ROLES: readonly SessionRole[] = ['owner', 'admin', 'member'] as const;

function normalizeRole(raw: unknown): SessionRole {
  if (typeof raw === 'string' && (VALID_ROLES as readonly string[]).includes(raw)) {
    return raw as SessionRole;
  }
  return 'member';
}

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role, full_name, avatar_url, organizations(name)')
    .eq('id', user.id)
    .single<{
      id: string;
      organization_id: string | null;
      role: string | null;
      full_name: string | null;
      avatar_url: string | null;
      organizations: { name: string } | { name: string }[] | null;
    }>();

  const organizationId = profile?.organization_id;
  if (error || !profile || !organizationId) {
    console.error('[auth:getSessionContext] inconsistent profile', {
      userId: user.id,
      error,
    });
    await supabase.auth.signOut();
    redirect('/login?error=inconsistent');
  }

  const orgRel = profile.organizations;
  const organizationName = Array.isArray(orgRel) ? orgRel[0]?.name ?? '' : orgRel?.name ?? '';

  return {
    userId: profile.id,
    organizationId,
    role: normalizeRole(profile.role),
    fullName: profile.full_name ?? '',
    avatarUrl: profile.avatar_url,
    organizationName,
  };
}
