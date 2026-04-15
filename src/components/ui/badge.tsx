import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-sunken text-text-secondary border border-subtle',
        'role-owner':
          'bg-feedback-success-bg text-feedback-success-fg border border-feedback-success-border',
        'role-admin':
          'bg-feedback-info-bg text-feedback-info-fg border border-feedback-info-border',
        'role-member':
          'bg-surface-sunken text-text-secondary border border-subtle',
        'status-pending':
          'bg-feedback-warning-bg text-feedback-warning-fg border border-feedback-warning-border',
        'status-expired':
          'bg-feedback-danger-bg text-feedback-danger-fg border border-feedback-danger-border',
        'status-inactive':
          'bg-surface-sunken text-text-muted border border-subtle',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';

export { badgeVariants };
