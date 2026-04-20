import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import type { TagColor } from '@/lib/tags/constants';

const tagBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border',
  {
    variants: {
      color: {
        gray: 'bg-surface-sunken text-text-secondary border-border-subtle',
        red: 'bg-feedback-danger-bg text-feedback-danger-fg border-feedback-danger-border',
        orange: 'bg-feedback-warning-bg text-feedback-warning-fg border-feedback-warning-border',
        yellow: 'bg-feedback-warning-solid-bg text-feedback-warning-solid-fg border-feedback-warning-border',
        green: 'bg-feedback-success-bg text-feedback-success-fg border-feedback-success-border',
        teal: 'bg-feedback-success-solid-bg text-feedback-success-solid-fg border-feedback-success-border',
        blue: 'bg-feedback-info-bg text-feedback-info-fg border-feedback-info-border',
        indigo: 'bg-feedback-info-solid-bg text-feedback-info-solid-fg border-feedback-info-border',
        purple: 'bg-feedback-accent-bg text-feedback-accent-fg border-feedback-accent-border',
        pink: 'bg-feedback-accent-solid-bg text-feedback-accent-solid-fg border-feedback-accent-border',
      },
    },
    defaultVariants: { color: 'gray' },
  }
);

export interface TagBadgeProps extends VariantProps<typeof tagBadgeVariants> {
  name: string;
  color: TagColor;
  className?: string;
}

export function TagBadge({ name, color, className }: TagBadgeProps) {
  return (
    <span className={cn(tagBadgeVariants({ color }), className)}>
      {name}
    </span>
  );
}
