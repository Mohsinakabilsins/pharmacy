import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export function PageHeader({ title, description, actions, icon, className, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string; meta?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4 pb-5', className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-card [&_svg]:size-5">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
          {description && <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">{description}</p>}
          {meta}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-7 pb-10 pt-6', wide ? 'max-w-none' : 'max-w-[1560px]', className)}>{children}</div>;
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b border-border px-4 py-3', className)}>{children}</div>;
}
