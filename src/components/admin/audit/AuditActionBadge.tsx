import { Badge } from '@/components/ui/badge';
import { paletteFor, type AuditPaletteVariant } from '@/lib/audit/actionRegistry';

const PALETTE_TO_BADGE: Record<AuditPaletteVariant, 'role-owner' | 'role-admin' | 'status-pending' | 'status-expired' | 'neutral'> = {
  success: 'role-owner',
  info:    'role-admin',
  warning: 'status-pending',
  danger:  'status-expired',
  neutral: 'neutral',
};

interface Props {
  action: string;
}

export function AuditActionBadge({ action }: Props) {
  const variant = PALETTE_TO_BADGE[paletteFor(action)];
  return (
    <Badge variant={variant} className="font-mono">
      {action}
    </Badge>
  );
}
