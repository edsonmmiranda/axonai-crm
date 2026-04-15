import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-10 w-full rounded-md px-3 text-sm',
        'bg-field text-field-fg placeholder:text-field-placeholder',
        'border border-field-border hover:border-field-border-hover',
        'focus-visible:outline-none focus-visible:border-field-border-focus focus-visible:shadow-focus',
        'disabled:bg-field-disabled disabled:text-text-disabled disabled:cursor-not-allowed',
        'aria-[invalid=true]:border-field-border-error',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
