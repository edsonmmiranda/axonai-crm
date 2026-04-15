import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:
          'bg-action-primary text-action-primary-fg hover:bg-action-primary-hover active:bg-action-primary-active disabled:bg-action-disabled disabled:text-action-disabled-fg',
        secondary:
          'bg-action-secondary text-action-secondary-fg border border-action-secondary-border hover:bg-action-secondary-hover active:bg-action-secondary-active disabled:bg-action-disabled disabled:text-action-disabled-fg',
        ghost:
          'bg-transparent text-action-ghost-fg hover:bg-action-ghost-hover active:bg-action-ghost-active disabled:text-action-disabled-fg',
        danger:
          'bg-action-danger text-action-danger-fg hover:bg-action-danger-hover active:bg-action-danger-active disabled:bg-action-disabled disabled:text-action-disabled-fg',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
