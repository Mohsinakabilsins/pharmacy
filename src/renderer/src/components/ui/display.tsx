import type { HTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  primary: 'bg-primary-soft text-primary-soft-foreground ring-primary/15',
  success: 'bg-success-soft text-success ring-success/15',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/15',
  info: 'bg-info-soft text-info ring-info/15',
  violet: 'bg-violet-soft text-violet ring-violet/15',
};
const DOTS: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/60',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
};

export function Badge({ tone = 'neutral', dot, children, className, icon }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11.5px] font-semibold ring-1 ring-inset [&_svg]:size-3', TONES[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {icon}
      {children}
    </span>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, icon, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pb-3 pt-4', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-card px-1 font-mono text-[10.5px] font-medium text-muted-foreground shadow-[0_1px_0_var(--border)]', className)}>{children}</kbd>;
}

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-6 py-8' : 'px-6 py-16', className)}>
      {icon && (
        <div className="relative mb-4">
          <div className="absolute inset-0 -m-3 rounded-full bg-primary/5 blur-xl" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-card [&_svg]:size-5">{icon}</div>
        </div>
      )}
      <h3 className="text-[14.5px] font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? 'mx-1 h-5 w-px' : 'h-px w-full', 'bg-border', className)} />;
}

export function Stat({ label, value, sub, className, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className={cn('num mt-1 truncate text-[17px] font-semibold tracking-tight', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function KeyValue({ items, className, cols = 2 }: { items: Array<[ReactNode, ReactNode]>; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 truncate text-[13.5px] font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = 'info', title, children, icon, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-inset', TONES[tone], className)}>
      {icon && <div className="mt-px shrink-0 [&_svg]:size-[18px]">{icon}</div>}
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'text-foreground/80')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
