import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
}

export function ChartTooltip({ active, payload, label, formatValue, formatLabel }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; formatValue: (v: number, key?: string) => string; formatLabel?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-border bg-elevated px-3 py-2 shadow-pop">
      <div className="mb-1.5 text-[11.5px] font-medium text-muted-foreground">{formatLabel ? formatLabel(label ?? '') : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5 text-[12.5px]">
          <span className="flex items-center gap-2 text-foreground/80">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-semibold text-foreground">{formatValue(Number(p.value ?? 0), p.dataKey)}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({
  data,
  xKey,
  series,
  formatValue,
  formatAxis,
  formatLabel,
  height = 260,
  type = 'area',
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  formatValue: (v: number, key?: string) => string;
  formatAxis?: (v: number) => string;
  formatLabel?: (l: string | number) => string;
  height?: number;
  type?: 'area' | 'bar';
}) {
  const tickFmt = (v: string) => (formatLabel ? formatLabel(v) : v);
  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'area' ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? SERIES[i]} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color ?? SERIES[i]} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={tickFmt} minTickGap={28} dy={6} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={formatAxis} />
          <Tooltip cursor={{ strokeWidth: 1 }} content={<ChartTooltip formatValue={formatValue} formatLabel={formatLabel} />} />
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? SERIES[i]} strokeWidth={2} fill={`url(#grad-${s.key})`} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} dot={false} />
          ))}
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={tickFmt} minTickGap={16} dy={6} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={formatAxis} />
          <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip formatValue={formatValue} formatLabel={formatLabel} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Horizontal bar list with direct labels — used instead of pie charts. */
export function BarList({ items, formatValue, color = 'var(--chart-1)', className, max }: { items: Array<{ label: ReactNode; value: number; hint?: ReactNode; key: string | number }>; formatValue: (v: number) => string; color?: string; className?: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={cn('space-y-2.5', className)}>
      {items.map((it) => (
        <div key={it.key} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate font-medium text-foreground/90">{it.label}</span>
            <span className="num shrink-0 font-semibold">{formatValue(it.value)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, (it.value / top) * 100)}%`, background: color }} />
            </div>
            {it.hint && <span className="num w-[72px] shrink-0 whitespace-nowrap text-end text-[11px] text-muted-foreground">{it.hint}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--chart-1)', height = 32, className }: { values: number[]; color?: string; height?: number; className?: string }) {
  if (values.length < 2) return <div style={{ height }} className={className} />;
  const w = 120;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / range) * (height - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `spark-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn('w-full', className)} style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
