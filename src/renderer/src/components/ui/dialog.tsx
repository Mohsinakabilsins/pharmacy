import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const SIZES = { sm: 'w-[420px]', md: 'w-[560px]', lg: 'w-[760px]', xl: 'w-[980px]', full: 'w-[min(1280px,calc(100vw-48px))]' };

export function DialogContent({
  children,
  size = 'md',
  className,
  onOpenAutoFocus,
  hideClose,
  ...props
}: DialogPrimitive.DialogContentProps & { size?: keyof typeof SIZES; hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/40 backdrop-blur-[2px] animate-in dark:bg-black/60" />
      <DialogPrimitive.Content
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn('fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-dialog outline-none animate-pop', SIZES[size], className)}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute end-3.5 top-3.5 rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description, icon, tone = 'primary', className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; tone?: 'primary' | 'danger' | 'warning' | 'info' | 'neutral'; className?: string }) {
  const toneCls = { primary: 'bg-primary-soft text-primary-soft-foreground', danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', info: 'bg-info-soft text-info', neutral: 'bg-muted text-foreground' }[tone];
  return (
    <div className={cn('flex items-start gap-3.5 border-b border-border px-6 pb-4 pt-5', className)}>
      {icon && <div className={cn('mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5', toneCls)}>{icon}</div>}
      <div className="min-w-0 pe-8">
        <DialogPrimitive.Title className="text-[16px] font-semibold tracking-tight">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>}
      </div>
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5', className)}>{children}</div>;
}

export function DialogFooter({ children, className, aside }: { children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-t border-border bg-subtle px-6 py-3.5', className)}>
      <div className="min-w-0 text-[12.5px] text-muted-foreground">{aside}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Right-hand slide-over panel for detail views. */
export function Sheet({ open, onOpenChange, children, width = 'md' }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode; width?: 'md' | 'lg' | 'xl' }) {
  const w = { md: 'w-[560px]', lg: 'w-[760px]', xl: 'w-[960px]' }[width];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#0b1220]/25 animate-in dark:bg-black/50" />
        <DialogPrimitive.Content className={cn('fixed bottom-2 end-2 top-2 z-40 flex max-w-[calc(100vw-80px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-dialog outline-none animate-slide', w)}>
          {children}
          <DialogPrimitive.Close className="absolute end-3.5 top-3.5 rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SheetHeader({ title, subtitle, badges, actions, icon }: { title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="border-b border-border px-6 pb-4 pt-5">
      <div className="flex items-start gap-3.5 pe-8">
        {icon && <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground [&_svg]:size-5">{icon}</div>}
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-[17px] font-semibold tracking-tight">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</div>
          </DialogPrimitive.Description>
          {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}
        </div>
      </div>
      {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
