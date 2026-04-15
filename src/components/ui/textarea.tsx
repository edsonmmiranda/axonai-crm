import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-md px-3 py-2 text-sm',
        'bg-field text-field-fg placeholder:text-field-placeholder',
        'border border-field-border hover:border-field-border-hover',
        'focus-visible:outline-none focus-visible:border-field-border-focus focus-visible:shadow-focus',
        'disabled:bg-field-disabled disabled:text-text-disabled disabled:cursor-not-allowed',
        'aria-[invalid=true]:border-field-border-error',
        'resize-y',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
