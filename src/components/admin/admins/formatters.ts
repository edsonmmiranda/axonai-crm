import type { PlatformAdminListRow } from '@/lib/actions/admin/platform-admins.schemas';

const ROLE_LABEL: Record<PlatformAdminListRow['role'], string> = {
  owner:   'Owner',
  support: 'Suporte',
  billing: 'Faturamento',
};

const ROLE_BADGE: Record<
  PlatformAdminListRow['role'],
  'role-owner' | 'role-admin' | 'role-member'
> = {
  owner:   'role-owner',
  support: 'role-admin',
  billing: 'role-member',
};

export function roleLabel(role: PlatformAdminListRow['role']): string {
  return ROLE_LABEL[role];
}

export function roleBadgeVariant(
  role: PlatformAdminListRow['role'],
): 'role-owner' | 'role-admin' | 'role-member' {
  return ROLE_BADGE[role];
}

export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
  });
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const target  = new Date(iso).getTime();
  const diffSec = Math.floor((target - now) / 1000);
  const isPast  = diffSec < 0;
  const sec     = Math.abs(diffSec);
  if (sec < 60)        return isPast ? 'agora há pouco' : 'em instantes';
  const min = Math.floor(sec / 60);
  if (min < 60)        return isPast ? `há ${min}min`   : `em ${min}min`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)         return isPast ? `há ${hr}h`      : `em ${hr}h`;
  const days = Math.floor(hr / 24);
  return isPast ? `há ${days}d` : `em ${days}d`;
}
