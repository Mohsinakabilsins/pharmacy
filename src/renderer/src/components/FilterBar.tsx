import type { ReactNode } from 'react';
import { CalendarRange } from 'lucide-react';
import { addDays, startOfMonth, todayLocal } from '@shared/dates';
import { cn } from '@renderer/lib/cn';
import { DateInput } from './ui/inputs';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/menu';
import { Button } from './ui/button';

export interface DateRange {
  from: string | null;
  to: string | null;
}

export function presetRange(preset: 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'all'): DateRange {
  const t = todayLocal();
  switch (preset) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case '7d':
      return { from: addDays(t, -6), to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case 'month':
      return { from: startOfMonth(t), to: t };
    case 'lastMonth': {
      const firstThis = startOfMonth(t);
      const lastPrev = addDays(firstThis, -1);
      return { from: startOfMonth(lastPrev), to: lastPrev };
    }
    case 'year':
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    default:
      return { from: null, to: null };
  }
}

const PRESETS: Array<[Parameters<typeof presetRange>[0], string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
  ['lastMonth', 'Last month'],
  ['year', 'This year'],
  ['all', 'All time'],
];

export function DateRangePicker({ value, onChange, className, allowAll = true }: { value: DateRange; onChange: (r: DateRange) => void; className?: string; allowAll?: boolean }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Menu>
        <MenuTrigger asChild>
          <Button size="md" icon={<CalendarRange />}>
            {labelFor(value)}
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {PRESETS.filter(([p]) => allowAll || p !== 'all').map(([p, label]) => (
            <MenuItem key={p} onSelect={() => onChange(presetRange(p))}>
              {label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <DateInput value={value.from} onChange={(from) => onChange({ ...value, from })} className="w-[150px]" max={value.to ?? undefined} />
      <span className="text-muted-foreground">→</span>
      <DateInput value={value.to} onChange={(to) => onChange({ ...value, to })} className="w-[150px]" min={value.from ?? undefined} />
    </div>
  );
}

function labelFor(v: DateRange): string {
  for (const [p, label] of PRESETS) {
    const r = presetRange(p);
    if (r.from === v.from && r.to === v.to) return label;
  }
  return 'Custom';
}

export function FilterBar({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
