import { Shield } from 'lucide-react';

import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

const ROLE_LABEL: Record<PlatformAdminRole, string> = {
  owner: 'Owner',
  support: 'Suporte',
  billing: 'Faturamento',
};

interface Props {
  adminName: string;
  adminRole: PlatformAdminRole;
}

export function AdminContextBanner({ adminName, adminRole }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface-sunken border-b border-border text-sm">
      <Shield className="size-4 text-text-secondary shrink-0" />
      <span className="font-semibold text-text-primary">Axon Admin</span>
      <span className="text-text-muted">·</span>
      <span className="text-text-secondary">{adminName}</span>
      <span className="ml-auto text-xs font-medium text-text-muted uppercase tracking-wider">
        {ROLE_LABEL[adminRole]}
      </span>
    </div>
  );
}
