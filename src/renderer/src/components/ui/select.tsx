import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { inputBase } from './input';
import { useFieldId } from './field';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

const NONE = '__none__';

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  size = 'md',
  allowClear,
  clearLabel = 'None',
  disabled,
  invalid,
  icon,
  id,
}: {
  value: T | null | undefined;
  onChange: (v: T | null) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  icon?: ReactNode;
  id?: string;
}) {
  const h = { sm: 'h-8', md: 'h-9', lg: 'h-11' }[size];
  const fieldId = useFieldId(id);
  return (
    <SelectPrimitive.Root value={value ?? (allowClear ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : (v as T))} disabled={disabled}>
      <SelectPrimitive.Trigger id={fieldId} aria-invalid={invalid || undefined} className={cn(inputBase, h, 'flex items-center justify-between gap-2 px-3 text-start data-[placeholder]:text-muted-foreground/70', className)}>
        <span className="flex min-w-0 items-center gap-2 truncate">
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-pop animate-in">
          <SelectPrimitive.Viewport className="p-0.5">
            {allowClear && (
              <SelectItem value={NONE}>
                <span className="text-muted-foreground">{clearLabel}</span>
              </SelectItem>
            )}
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.disabled} hint={o.hint}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function SelectItem({ value, children, disabled, hint }: { value: string; children: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <SelectPrimitive.Item value={value} disabled={disabled} className="relative flex cursor-default select-none items-center justify-between gap-3 rounded-md py-2 pe-8 ps-2.5 text-[13.5px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
      <SelectPrimitive.ItemIndicator className="absolute end-2.5">
        <Check className="size-4 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
