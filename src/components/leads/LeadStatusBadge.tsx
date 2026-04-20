import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import type { LeadStatus } from '@/lib/actions/leads';

const statusBadgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border',
  {
    variants: {
      status: {
        new: 'bg-feedback-info-bg text-feedback-info-fg border-feedback-info-border',
        contacted: 'bg-feedback-warning-bg text-feedback-warning-fg border-feedback-warning-border',
        qualified: 'bg-feedback-success-bg text-feedback-success-fg border-feedback-success-border',
        proposal: 'bg-feedback-accent-bg text-feedback-accent-fg border-feedback-accent-border',
        negotiation: 'bg-feedback-warning-solid-bg text-feedback-warning-solid-fg border-feedback-warning-border',
        won: 'bg-feedback-success-solid-bg text-feedback-success-solid-fg border-feedback-success-border',
        lost: 'bg-feedback-danger-bg text-feedback-danger-fg border-feedback-danger-border',
      },
    },
    defaultVariants: { status: 'new' },
  }
);

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Contactado',
  qualified: 'Qualificado',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganho',
  lost: 'Perdido',
};

export interface LeadStatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  status: LeadStatus;
  className?: string;
}

export function LeadStatusBadge({ status, className }: LeadStatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export { STATUS_LABELS };
