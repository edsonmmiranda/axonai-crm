import { Badge } from '@/components/ui/badge';

import type { GrantStatus } from '@/lib/actions/admin/grants';

const STATUS_CONFIG: Record<GrantStatus, { label: string; variant: 'role-owner' | 'status-inactive' | 'status-expired' }> = {
  active:  { label: 'Ativo',    variant: 'role-owner'      },
  expired: { label: 'Expirado', variant: 'status-inactive' },
  revoked: { label: 'Revogado', variant: 'status-expired'  },
};

interface Props { status: GrantStatus }

export function GrantStatusBadge({ status }: Props) {
  const cfg = STATUS_CONFIG[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
