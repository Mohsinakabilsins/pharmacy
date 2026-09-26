import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export function Checkbox({ checked, onChange, disabled, id, className }: { checked: boolean | 'indeterminate'; onChange: (v: boolean) => void; disabled?: boolean; id?: string; className?: string }) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onChange(v === true)}
      className={cn('flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-card shadow-xs transition data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary disabled:opacity-50', className)}
    >
      <CheckboxPrimitive.Indicator className="text-white">{checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}</CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ checked, onChange, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  return (
    <SwitchPrimitive.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50">
      <SwitchPrimitive.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform data-[state=checked]:translate-x-[18px] rtl:data-[state=checked]:-translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function SwitchRow({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-1">
      <span>
        <span className="block text-[13.5px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[70] max-w-xs rounded-md bg-foreground px-2 py-1 text-[12px] font-medium text-background shadow-pop animate-in">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, children, align = 'start', sideOffset = 6, ...props }: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} className={cn('z-50 rounded-xl border border-border bg-elevated p-2 shadow-pop outline-none animate-in', className)} {...props}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn('inline-flex items-center gap-1 border-b border-border', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-9 items-center gap-2 border-b-2 border-transparent px-3 text-[13px] font-medium text-muted-foreground transition hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

/** Pill-style segmented control. */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; count?: number }>; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border bg-muted/70 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 font-medium text-muted-foreground transition hover:text-foreground',
            size === 'sm' ? 'h-7 text-[12.5px]' : 'h-8 text-[13px]',
            value === o.value && 'bg-card text-foreground shadow-card',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('num rounded-full px-1.5 text-[11px]', value === o.value ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-border/80')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
