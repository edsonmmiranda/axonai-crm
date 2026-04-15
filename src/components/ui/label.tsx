import { forwardRef, type LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium text-text-primary', className)}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-action-danger">*</span>}
    </label>
  )
);
Label.displayName = 'Label';
