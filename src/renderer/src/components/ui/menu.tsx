import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ children, align = 'end', className, sideOffset = 6 }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string; sideOffset?: number }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={sideOffset} className={cn('z-50 min-w-[200px] rounded-xl border border-border bg-elevated p-1 shadow-pop animate-in', className)}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ children, icon, onSelect, danger, disabled, shortcut }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        danger && 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[11px] text-muted-foreground">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}
