import { Badge } from '@/components/ui/badge';

type SubscriptionStatus = 'trial' | 'ativa' | 'past_due' | 'trial_expired' | 'cancelada' | 'suspensa';

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial:         'Trial',
  ativa:         'Ativa',
  past_due:      'Atrasada',
  trial_expired: 'Trial expirado',
  cancelada:     'Cancelada',
  suspensa:      'Suspensa',
};

const STATUS_VARIANTS: Record<SubscriptionStatus, Parameters<typeof Badge>[0]['variant']> = {
  trial:         'status-pending',
  ativa:         'role-owner',
  past_due:      'status-expired',
  trial_expired: 'status-inactive',
  cancelada:     'status-inactive',
  suspensa:      'status-expired',
};

interface Props {
  status: string | null;
}

export function OrganizationStatusBadge({ status }: Props) {
  const s = (status ?? '') as SubscriptionStatus;
  const label   = STATUS_LABELS[s]   ?? status ?? '—';
  const variant = STATUS_VARIANTS[s] ?? 'neutral';
  return <Badge variant={variant}>{label}</Badge>;
}
