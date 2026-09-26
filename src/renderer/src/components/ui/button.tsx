import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(15,118,110,0.3)] hover:bg-primary-hover',
        secondary: 'border border-border-strong/80 bg-card text-foreground shadow-xs hover:bg-muted hover:border-border-strong',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        soft: 'bg-primary-soft text-primary-soft-foreground hover:brightness-95 dark:hover:brightness-125',
        danger: 'bg-danger text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:brightness-110',
        'danger-soft': 'bg-danger-soft text-danger hover:brightness-95 dark:hover:brightness-125',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-4',
        md: 'h-9 px-3.5 text-[13.5px] [&_svg]:size-4',
        lg: 'h-11 px-5 text-[15px] [&_svg]:size-[18px]',
        xl: 'h-14 px-6 text-base font-semibold [&_svg]:size-5',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-8 [&_svg]:size-4',
        'icon-xs': 'size-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  shortcut?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, icon, shortcut, children, disabled, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="animate-spin" /> : icon}
            {children}
            {shortcut && (
              <kbd className={cn('ms-1 rounded border px-1 font-mono text-[10px] font-medium leading-4', variant === 'primary' || variant === 'danger' ? 'border-white/25 text-white/80' : 'border-border text-muted-foreground')}>
                {shortcut}
              </kbd>
            )}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
