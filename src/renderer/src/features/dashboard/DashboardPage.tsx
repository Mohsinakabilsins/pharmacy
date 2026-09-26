import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, Boxes, CalendarClock, ChevronRight, HandCoins, PackageX, Plus, ReceiptText, ScanBarcode, TrendingUp, Truck, Wallet, Landmark, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@renderer/lib/query';
import { useFormat } from '@renderer/lib/format';
import { useCan, useSession } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '@renderer/components/ui/display';
import { BarList, Sparkline, TrendChart } from '@renderer/components/Charts';
import { StatusBadge, MethodLabel } from '@renderer/components/StatusBadges';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Delta({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null || prev === null) return null;
  if (prev === 0) return now > 0 ? <span className="text-[12px] font-medium text-muted-foreground">vs Rs 0 yesterday</span> : null;
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold', up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct).toFixed(1)}%
      <span className="ms-1 font-medium text-muted-foreground">vs yesterday</span>
    </span>
  );
}

function Kpi({ label, value, icon, footer, spark, accent = 'var(--chart-1)', onClick, loading }: { label: string; value: ReactNode; icon: ReactNode; footer?: ReactNode; spark?: number[]; accent?: string; onClick?: () => void; loading?: boolean }) {
  return (
    <Card className={cn('group relative overflow-hidden p-5 transition', onClick && 'cursor-pointer hover:border-border-strong hover:shadow-pop')} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="text-[12.5px] font-medium text-muted-foreground">{label}</div>
        <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        {loading ? <Skeleton className="h-8 w-32" /> : <div className="num whitespace-nowrap text-[27px] font-semibold leading-none tracking-[-0.02em]">{value}</div>}
        {spark && spark.length > 1 && (
          <div className="pointer-events-none min-w-0 max-w-24 flex-1 opacity-90">
            <Sparkline values={spark} color={accent} height={30} />
          </div>
        )}
      </div>
      <div className="mt-3 flex min-h-[22px] items-center">{footer}</div>
    </Card>
  );
}

function MiniStat({ label, value, sub, icon, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone: 'teal' | 'amber' | 'rose' | 'blue' | 'violet'; onClick?: () => void }) {
  const toneCls = { teal: 'bg-primary-soft text-primary-soft-foreground', amber: 'bg-warning-soft text-warning', rose: 'bg-danger-soft text-danger', blue: 'bg-info-soft text-info', violet: 'bg-violet-soft text-violet' }[tone];
  return (
    <Card className={cn('flex items-center gap-4 px-5 py-4 transition', onClick && 'cursor-pointer hover:border-border-strong')} onClick={onClick}>
      <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5', toneCls)}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-muted-foreground">{label}</div>
        <div className="num mt-0.5 truncate text-[19px] font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div>}
      </div>
      {onClick && <ChevronRight className="size-4 text-muted-foreground/60" />}
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const can = useCan();
  const f = useFormat();
  const session = useSession((s) => s.session);
  const { data, isLoading } = useApiQuery('dashboard.get', undefined, { refetchInterval: 60_000 });
  const k = data?.kpis;
  const trendRevenue = data?.salesTrend.map((d) => d.revenue) ?? [];
  const showProfit = k?.grossProfitToday !== null && k?.grossProfitToday !== undefined;
  const margin = k && k.grossProfitToday !== null && k.salesToday > 0 ? (k.grossProfitToday / k.salesToday) * 100 : null;

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <div className="text-[13px] font-medium text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">
            {greeting()}, {session?.user.fullName.split(' ')[0]}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {can('purchases.manage') && (
            <Button icon={<Truck />} onClick={() => nav('/purchases/new')}>
              {t('dash.receive', 'Receive stock')}
            </Button>
          )}
          {can('products.manage') && (
            <Button icon={<Plus />} onClick={() => nav('/products?new=1')}>
              {t('dash.addProduct', 'Add product')}
            </Button>
          )}
          {can('pos.access') && (
            <Button variant="primary" icon={<ScanBarcode />} shortcut="F2" onClick={() => nav('/pos')}>
              {t('dash.newSale', 'New sale')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Kpi
          label={t('dash.salesToday', "Today's sales")}
          loading={isLoading}
          value={f.money(k?.salesToday ?? 0)}
          icon={<ReceiptText />}
          spark={trendRevenue}
          footer={
            k && (
              <div className="flex items-center gap-2">
                <Delta now={k.salesToday} prev={k.salesYesterday} />
                <span className="whitespace-nowrap text-[12px] text-muted-foreground">{f.number(k.invoicesToday)} bills</span>
              </div>
            )
          }
          onClick={can('sales.view') ? () => nav('/sales') : undefined}
        />
        {showProfit ? (
          <Kpi
            label={t('dash.profitToday', 'Gross profit today')}
            loading={isLoading}
            value={f.money(k?.grossProfitToday ?? 0)}
            icon={<TrendingUp />}
            accent="var(--chart-3)"
            spark={data?.salesTrend.map((d) => d.grossProfit ?? 0)}
            footer={
              <span className="text-[12px] text-muted-foreground">
                {margin !== null ? (
                  <>
                    <b className="font-semibold text-foreground">{margin.toFixed(1)}%</b> margin · net {f.money(k?.netProfitToday)}
                  </>
                ) : (
                  'No sales yet today'
                )}
              </span>
            }
          />
        ) : (
          <Kpi label={t('dash.invoices', 'Invoices today')} loading={isLoading} value={f.number(k?.invoicesToday ?? 0)} icon={<ReceiptText />} footer={<span className="text-[12px] text-muted-foreground">Avg bill {f.money(k?.avgBillToday ?? 0)}</span>} />
        )}
        <Kpi
          label={t('dash.purchasesToday', "Today's purchases")}
          loading={isLoading}
          value={f.money(k?.purchasesToday ?? 0)}
          icon={<Truck />}
          footer={<span className="text-[12px] text-muted-foreground">Stock received today, at cost</span>}
          onClick={can('purchases.view') ? () => nav('/purchases') : undefined}
        />
        <Kpi
          label={t('dash.expensesToday', "Today's expenses")}
          loading={isLoading}
          value={f.money(k?.expensesToday ?? 0)}
          icon={<HandCoins />}
          footer={<span className="text-[12px] text-muted-foreground">Returns today {f.money(k?.returnsToday ?? 0)}</span>}
          onClick={can('expenses.view') ? () => nav('/expenses') : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-4">
        <MiniStat tone="teal" icon={<Boxes />} label="Stock value" value={k?.stockValueCost !== null && k?.stockValueCost !== undefined ? f.money(k.stockValueCost) : f.money(k?.stockValueRetail ?? 0)} sub={k?.stockValueCost !== null && k ? `At cost · retail ${f.compact(k.stockValueRetail)}` : `${f.number(k?.productCount ?? 0)} active products`} onClick={can('inventory.view') ? () => nav('/stock') : undefined} />
        <MiniStat tone="rose" icon={<PackageX />} label="Out of stock / low" value={`${f.number(k?.outOfStockCount ?? 0)} / ${f.number(k?.lowStockCount ?? 0)}`} sub={`of ${f.number(k?.productCount ?? 0)} active products`} onClick={can('inventory.view') ? () => nav('/reorder') : undefined} />
        <MiniStat tone="amber" icon={<CalendarClock />} label={`Expiring ≤ ${data?.expiryWarningDays ?? 90} days`} value={`${f.number(k?.expiringSoonCount ?? 0)} batches`} sub={k ? `${k.expiredCount} expired on hand · ${f.compact(k.expiredValue)}` : undefined} onClick={can('inventory.view') ? () => nav('/expiry') : undefined} />
        <MiniStat tone="violet" icon={<Landmark />} label="Supplier payables" value={f.money(k?.payablesTotal ?? 0)} sub={k ? `${k.payablesSuppliers} suppliers · receivables ${f.compact(k.receivablesTotal)}` : undefined} onClick={can('suppliers.view') ? () => nav('/suppliers') : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader
            title="Sales performance"
            description="Revenue and gross profit — last 30 days"
            actions={
              <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-chart-1" /> Revenue
                </span>
                {showProfit && (
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-chart-3" /> Gross profit
                  </span>
                )}
              </div>
            }
          />
          <div className="px-3 pb-4">
            {isLoading ? (
              <Skeleton className="mx-2 h-[260px]" />
            ) : (
              <TrendChart
                data={data?.salesTrend ?? []}
                xKey="date"
                series={showProfit ? [{ key: 'revenue', label: 'Revenue', color: 'var(--chart-1)' }, { key: 'grossProfit', label: 'Gross profit', color: 'var(--chart-3)' }] : [{ key: 'revenue', label: 'Revenue', color: 'var(--chart-1)' }]}
                formatValue={(v) => f.money(v)}
                formatAxis={(v) => f.compact(v).replace(`${f.symbol} `, '')}
                formatLabel={(l) => f.date(String(l)).slice(0, 5)}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Top sellers" description="By revenue — last 30 days" />
          <div className="px-5 pb-5">
            {data && data.topProducts.length === 0 ? (
              <EmptyState compact title="No sales yet" description="Top products will appear here." />
            ) : (
              <BarList
                items={(data?.topProducts ?? []).map((p) => ({ key: p.productId, label: p.name, value: p.revenue, hint: f.qty(p.quantity, p.packSize, p.unitName, 'pack').replace(/ \+.*/, '') }))}
                formatValue={(v) => f.money(v)}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="col-span-2 overflow-hidden">
          <CardHeader
            title="Recent sales"
            actions={
              can('sales.view', 'sales.view_own') && (
                <Button size="sm" variant="ghost" onClick={() => nav('/sales')}>
                  View all <ChevronRight />
                </Button>
              )
            }
          />
          <div className="divide-y divide-border/70 border-t border-border">
            {(data?.recentSales ?? []).map((s) => (
              <button key={s.id} type="button" onClick={() => nav(`/sales?open=${s.id}`)} className="flex w-full items-center gap-4 px-5 py-3 text-start transition hover:bg-subtle">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ReceiptText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">
                    {s.invoiceNo} <span className="font-normal text-muted-foreground">· {s.customerName ?? 'Walk-in'}</span>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {f.dateTime(s.createdAt)} · {s.cashierName}
                  </div>
                </div>
                {s.status !== 'COMPLETED' && <StatusBadge status={s.status} />}
                <div className="num w-28 text-end text-[14px] font-semibold">{f.money(s.total)}</div>
              </button>
            ))}
            {data && data.recentSales.length === 0 && <EmptyState compact icon={<ReceiptText />} title="No sales recorded yet" description="Completed sales will show up here." />}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Needs attention" description="Expiry and stock alerts" icon={<AlertTriangle />} />
          <div className="max-h-[420px] divide-y divide-border/70 overflow-y-auto border-t border-border">
            {data?.alerts.expiring.map((a) => (
              <div key={`e${a.batchId}`} className="flex items-center gap-3 px-5 py-2.5">
                <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', a.daysToExpiry <= 0 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
                  <CalendarClock className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.productName}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    Batch {a.batchNumber} · {a.quantity} units
                  </div>
                </div>
                <Badge tone={a.daysToExpiry <= 0 ? 'danger' : a.daysToExpiry <= 30 ? 'warning' : 'info'}>{a.daysToExpiry <= 0 ? 'Expired' : `${a.daysToExpiry}d`}</Badge>
              </div>
            ))}
            {data?.alerts.lowStock.map((a) => (
              <div key={`l${a.productId}`} className="flex items-center gap-3 px-5 py-2.5">
                <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', a.onHand <= 0 ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info')}>
                  <PackageX className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.productName}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {a.onHand} on hand · reorder at {a.reorderLevel}
                  </div>
                </div>
                <Badge tone={a.onHand <= 0 ? 'danger' : 'info'}>{a.onHand <= 0 ? 'Out' : 'Low'}</Badge>
              </div>
            ))}
            {data && data.alerts.expiring.length === 0 && data.alerts.lowStock.length === 0 && <EmptyState compact title="All clear" description="No expiry or stock alerts." />}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Today by hour" description="Sales from 8 am to 10 pm" />
          <div className="px-3 pb-3">
            <TrendChart type="bar" height={180} data={(data?.hourly ?? []).map((h) => ({ hour: `${h.hour % 12 || 12}${h.hour < 12 ? 'a' : 'p'}`, revenue: h.revenue }))} xKey="hour" series={[{ key: 'revenue', label: 'Sales' }]} formatValue={(v) => f.money(v)} formatAxis={(v) => f.compact(v).replace(`${f.symbol} `, '')} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Payment mix" description="Today's collections" />
          <div className="px-5 pb-5">
            {data && data.paymentMix.length > 0 ? (
              <BarList items={data.paymentMix.map((p) => ({ key: p.method, label: <MethodLabel method={p.method} />, value: p.amount }))} formatValue={(v) => f.money(v)} color="var(--chart-3)" />
            ) : (
              <EmptyState compact title="No collections yet" description={`Payment methods (${Object.values(PAYMENT_METHOD_LABELS).slice(0, 3).join(', ')}…) will appear here.`} />
            )}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader
            title="Cash drawer"
            icon={<Wallet />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => nav('/cash')}>
                Open <ChevronRight />
              </Button>
            }
          />
          <div className="px-5 pb-5">
            {data?.shift.open ? (
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone="success" dot>
                    Shift {data.shift.sessionNo} open
                  </Badge>
                </div>
                <div className="num mt-3 text-[28px] font-semibold tracking-tight">{f.money(data.shift.expectedCash)}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  Expected in drawer · opened {f.time(data.shift.openedAt)} by {data.shift.openedByName}
                </div>
              </div>
            ) : (
              <EmptyState compact title="No shift open" description="Open a shift with the opening float before selling." action={can('cash.operate') ? <Button size="sm" variant="primary" onClick={() => nav('/cash')}>Open shift</Button> : undefined} />
            )}
            {data && data.recentPurchases.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Recent purchases</div>
                {data.recentPurchases.slice(0, 3).map((p) => (
                  <button key={p.id} type="button" onClick={() => nav(`/purchases/${p.id}`)} className="flex w-full items-center justify-between py-1.5 text-start text-[12.5px] hover:text-primary">
                    <span className="truncate">
                      {p.purchaseNo} · {p.supplierName}
                    </span>
                    <span className="num font-medium">{f.money(p.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
