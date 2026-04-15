import { forwardRef, type HTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex gap-3 p-4 rounded-md border',
  {
    variants: {
      intent: {
        success:
          'bg-feedback-success-bg border-feedback-success-border text-feedback-success-fg',
        warning:
          'bg-feedback-warning-bg border-feedback-warning-border text-feedback-warning-fg',
        danger:
          'bg-feedback-danger-bg border-feedback-danger-border text-feedback-danger-fg',
        info: 'bg-feedback-info-bg border-feedback-info-border text-feedback-info-fg',
      },
    },
    defaultVariants: { intent: 'info' },
  }
);

const ICONS: Record<NonNullable<VariantProps<typeof alertVariants>['intent']>, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
  info: Info,
};

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, intent = 'info', title, children, ...props }, ref) => {
    const Icon = ICONS[intent ?? 'info'];
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ intent }), className)}
        {...props}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          {title && <p className="font-semibold">{title}</p>}
          <div className="text-sm">{children}</div>
        </div>
      </div>
    );
  }
);
Alert.displayName = 'Alert';
