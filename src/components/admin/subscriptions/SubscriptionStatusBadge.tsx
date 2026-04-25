import { Badge } from '@/components/ui/badge';

const STATUS_CONFIG: Record<string, { label: string; variant: 'role-owner' | 'status-pending' | 'status-expired' | 'status-inactive' | 'neutral' }> = {
  trial:        { label: 'Trial',        variant: 'status-pending'  },
  ativa:        { label: 'Ativa',        variant: 'role-owner'      },
  past_due:     { label: 'Inadimplente', variant: 'status-pending'  },
  trial_expired:{ label: 'Trial expirado',variant: 'status-expired' },
  cancelada:    { label: 'Cancelada',    variant: 'status-expired'  },
  suspensa:     { label: 'Suspensa',     variant: 'status-inactive' },
};

interface Props { status: string }

export function SubscriptionStatusBadge({ status }: Props) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
