import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, BarChart3, Boxes, ChevronRight, Coins, LineChart, ReceiptText, Truck, Info } from 'lucide-react';
import type { ReportColumn, ReportDefinition, ReportResult } from '@shared/types/reports';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@renderer/components/ui/display';
import { NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { DateRangePicker, presetRange, type DateRange } from '@renderer/components/FilterBar';
import { ExportMenu } from '@renderer/components/ExportMenu';
import { BarList, TrendChart } from '@renderer/components/Charts';
import { DataTable } from '@renderer/components/DataTable';
import { StatusBadge } from '@renderer/components/StatusBadges';

const GROUP_ICON: Record<string, typeof BarChart3> = { Sales: ReceiptText, Inventory: Boxes, Purchases: Truck, Financial: Coins, Analytics: LineChart };
const GROUP_TONE: Record<string, string> = { Sales: 'bg-primary-soft text-primary-soft-foreground', Inventory: 'bg-info-soft text-info', Purchases: 'bg-violet-soft text-violet', Financial: 'bg-success-soft text-success', Analytics: 'bg-warning-soft text-warning' };

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const list = useApiQuery('reports.list');
  const active = list.data?.find((r) => r.id === params.get('r'));
  if (active) return <ReportViewer def={active} onBack={() => setParams({})} />;
  const groups = ['Sales', 'Financial', 'Inventory', 'Purchases', 'Analytics'] as const;
  return (
    <Page>
      <PageHeader title="Reports" description="Accurate, exportable reports computed from the transaction ledger. Profit always uses the actual cost of the batch sold." icon={<BarChart3 />} />
      {list.isLoading && <Skeleton className="h-64" />}
      <div className="grid grid-cols-3 gap-4">
        {groups.map((g) => {
          const items = (list.data ?? []).filter((r) => r.group === g);
          if (!items.length) return null;
          const Icon = GROUP_ICON[g];
          return (
            <Card key={g} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <div className={cn('flex size-9 items-center justify-center rounded-xl', GROUP_TONE[g])}>
                  <Icon className="size-[18px]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">{g}</div>
                  <div className="text-[12px] text-muted-foreground">{items.length} reports</div>
                </div>
              </div>
              <div className="p-1.5">
                {items.map((r) => (
                  <button key={r.id} type="button" onClick={() => setParams({ r: r.id })} className="group flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-start transition hover:bg-muted">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium">{r.title}</div>
                      <div className="truncate text-[12px] text-muted-foreground">{r.description}</div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}

function ReportViewer({ def, onBack }: { def: ReportDefinition; onBack: () => void }) {
  const [range, setRange] = useState<DateRange>(presetRange('month'));
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [days, setDays] = useState<number | null>(90);
  const [threshold, setThreshold] = useState<number | null>(def.id === 'low-margin' ? 10 : 0);
  const [limit, setLimit] = useState<number | null>(50);
  const has = (p: string) => def.params.includes(p as never);
  const params = useMemo(
    () => ({
      from: has('dateRange') ? range.from : null,
      to: has('dateRange') ? range.to : null,
      groupBy,
      supplierId: has('supplier') ? supplierId : null,
      categoryId: has('category') ? categoryId : null,
      userId: has('user') ? userId : null,
      days: has('days') ? days : null,
      threshold: has('threshold') ? threshold : null,
      limit: has('limit') ? limit : null,
    }),
    [def, range, groupBy, supplierId, categoryId, userId, days, threshold, limit], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data, isLoading, isFetching } = useApiQuery('reports.run', { reportId: def.id, params });
  const suppliers = useApiQuery('suppliers.options', undefined, { enabled: has('supplier') });
  const cats = useApiQuery('categories.list', { includeInactive: false }, { enabled: has('category') });
  const users = useApiQuery('users.options', undefined, { enabled: has('user') });

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to reports">
            <ArrowLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{def.title}</h1>
              <Badge>{def.group}</Badge>
            </div>
            <p className="text-[13px] text-muted-foreground">{data?.subtitle ?? def.description}</p>
          </div>
        </div>
        <ExportMenu reportId={def.id} params={params} />
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-2 px-4 py-3">
        {has('dateRange') && <DateRangePicker value={range} onChange={setRange} allowAll={false} />}
        {has('groupBy') && <Segmented value={groupBy} onChange={setGroupBy} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />}
        {has('supplier') && <Select className="w-52" value={supplierId ? String(supplierId) : null} onChange={(v) => setSupplierId(v ? Number(v) : null)} allowClear clearLabel="All suppliers" placeholder="All suppliers" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />}
        {has('category') && <Select className="w-44" value={categoryId ? String(categoryId) : null} onChange={(v) => setCategoryId(v ? Number(v) : null)} allowClear clearLabel="All categories" placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))} />}
        {has('user') && <Select className="w-44" value={userId ? String(userId) : null} onChange={(v) => setUserId(v ? Number(v) : null)} allowClear clearLabel="All cashiers" placeholder="All cashiers" options={(users.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))} />}
        {has('days') && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Within <NumberInput className="w-24" value={days} onChange={setDays} min={1} max={730} suffix="days" />
          </div>
        )}
        {has('threshold') && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {def.id === 'low-margin' ? 'Margin below' : 'Sold at most'}
            <NumberInput className="w-24" value={threshold} onChange={setThreshold} min={0} suffix={def.id === 'low-margin' ? '%' : 'units'} allowDecimal={def.id === 'low-margin'} />
          </div>
        )}
        {has('limit') && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Top <NumberInput className="w-20" value={limit} onChange={setLimit} min={1} max={1000} />
          </div>
        )}
        {isFetching && <span className="ms-auto text-[12px] text-muted-foreground">Updating…</span>}
      </Card>
      {isLoading || !data ? <Skeleton className="h-96" /> : <ReportBody r={data} />}
    </Page>
  );
}

function ReportBody({ r }: { r: ReportResult }) {
  const f = useFormat();
  const fmt = (c: ReportColumn, row: Record<string, unknown>) => {
    const v = row[c.key];
    if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
    switch (c.type) {
      case 'money':
        return f.money(Number(v));
      case 'number':
        return f.number(Number(v), Number.isInteger(Number(v)) ? 0 : 1);
      case 'percent':
        return f.percent(Number(v));
      case 'qty':
        return c.packKey ? f.qty(Number(v), Number(row[c.packKey] ?? 1), 'unit', 'pack') : f.number(Number(v));
      case 'date':
        return f.date(String(v));
      case 'datetime':
        return f.dateTime(String(v));
      case 'badge':
        return <StatusBadge status={String(v).toUpperCase().replace(/ /g, '_')} />;
      default:
        return String(v);
    }
  };
  const chart = r.chart;
  return (
    <div className="space-y-4">
      {r.summary && r.summary.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(4, r.summary.length)}, minmax(0, 1fr))` }}>
          {r.summary.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="text-[12.5px] font-medium text-muted-foreground">{s.label}</div>
              <div className={cn('num mt-1 text-[22px] font-semibold tracking-tight', s.tone === 'positive' && 'text-success', s.tone === 'negative' && 'text-danger', s.tone === 'warning' && 'text-warning')}>
                {s.value === null ? '—' : s.type === 'money' ? f.money(s.value) : s.type === 'percent' ? f.percent(s.value) : f.number(s.value)}
              </div>
            </Card>
          ))}
        </div>
      )}
      {chart && chart.data.length > 1 && (
        <Card className="p-5">
          {chart.type === 'pie' ? (
            <BarList
              items={chart.data
                .map((d, i) => ({ key: `${i}`, label: String(d[chart.xKey]), value: Number(d[chart.series[0].key] ?? 0) }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 12)}
              formatValue={(v) => (chart.series[0].type === 'money' ? f.money(v) : f.number(v))}
            />
          ) : (
            <TrendChart
              type={chart.type === 'bar' ? 'bar' : 'area'}
              height={280}
              data={chart.data as Array<Record<string, unknown>>}
              xKey={chart.xKey}
              series={chart.series.filter((s) => chart.data.some((d) => d[s.key] !== null)).map((s) => ({ key: s.key, label: s.label }))}
              formatValue={(v) => (chart.series[0].type === 'money' ? f.money(v) : f.number(v))}
              formatAxis={(v) => (chart.series[0].type === 'money' ? f.compact(v).replace(`${f.symbol} `, '') : f.number(v))}
              formatLabel={(l) => (/^\d{4}-\d{2}-\d{2}$/.test(String(l)) ? f.date(String(l)).slice(0, 5) : String(l).length > 14 ? `${String(l).slice(0, 13)}…` : String(l))}
            />
          )}
        </Card>
      )}
      {r.statement ? (
        <Card className="overflow-hidden">
          <table className="w-full text-[13.5px]">
            <tbody>
              {r.statement.map((l, i) => (
                <tr key={i} className={cn('border-b border-border/70 last:border-0', l.emphasis === 'total' && 'bg-subtle font-semibold', l.emphasis === 'grand' && 'bg-primary-soft/60 text-[15px] font-bold', l.emphasis === 'muted' && 'text-muted-foreground')}>
                  <td className={cn('px-6 py-3', l.level === 1 && 'ps-10', l.level === 2 && 'ps-16 text-[13px] text-muted-foreground')}>
                    {l.label}
                    {l.note && <span className="ms-2 text-[12px] font-normal text-muted-foreground">({l.note})</span>}
                  </td>
                  <td className={cn('num px-6 py-3 text-end', (l.value ?? 0) < 0 && l.emphasis !== 'grand' && 'text-muted-foreground', l.emphasis === 'grand' && ((l.value ?? 0) >= 0 ? 'text-success' : 'text-danger'))}>{l.value === null ? '' : f.money(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            dense
            maxHeight="calc(100vh - 260px)"
            rows={r.rows as Array<Record<string, unknown>>}
            rowKey={(row) => r.rows.indexOf(row)}
            showFooter={!!r.totals}
            empty={<EmptyState compact icon={<BarChart3 />} title="No data for the selected filters" />}
            columns={r.columns.map((c) => ({
              key: c.key,
              header: c.label,
              align: c.align === 'right' ? 'right' : 'left',
              cell: (row: Record<string, unknown>) => fmt(c, row),
              footer: r.totals && r.totals[c.key] !== undefined ? fmt(c, r.totals as Record<string, unknown>) : undefined,
            }))}
          />
        </Card>
      )}
      {r.notes && r.notes.length > 0 && (
        <div className="space-y-1 px-1">
          {r.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
