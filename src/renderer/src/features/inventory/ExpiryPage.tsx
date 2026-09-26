import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock, AlertOctagon, Trash2 } from 'lucide-react';
import type { ExpiryBucket } from '@shared/calc/stock';
import type { BatchRow, ExpiryRow } from '@shared/types/inventory';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { DataTable } from '@renderer/components/DataTable';
import { FilterBar } from '@renderer/components/FilterBar';
import { ExpiryBadge } from '@renderer/components/StatusBadges';
import { ExportMenu } from '@renderer/components/ExportMenu';
import { AdjustStockDialog } from './InventoryDialogs';

const BUCKETS: Array<{ id: ExpiryBucket; label: string; sub: string; tone: string; bar: string }> = [
  { id: 'EXPIRED', label: 'Expired', sub: 'Remove from shelves', tone: 'text-danger', bar: 'bg-danger' },
  { id: 'D30', label: 'Within 30 days', sub: 'Sell or return now', tone: 'text-danger', bar: 'bg-[var(--chart-2)]' },
  { id: 'D60', label: '31 – 60 days', sub: 'Prioritise sales', tone: 'text-warning', bar: 'bg-warning' },
  { id: 'D90', label: '61 – 90 days', sub: 'Watch closely', tone: 'text-info', bar: 'bg-info' },
  { id: 'LATER', label: 'Later', sub: 'Healthy stock', tone: 'text-success', bar: 'bg-success' },
];

function toBatch(r: ExpiryRow): BatchRow {
  return {
    id: r.batchId,
    productId: r.productId,
    productCode: r.productCode,
    productName: r.productName,
    genericName: r.genericName,
    batchNumber: r.batchNumber,
    manufactureDate: null,
    expiryDate: r.expiryDate,
    costPrice: r.costValue !== null && r.quantity ? Math.round((r.costValue * r.packSize) / r.quantity) : null,
    salePrice: 0,
    quantityReceived: r.quantity,
    quantityOnHand: r.quantity,
    packSize: r.packSize,
    unitName: r.unitName,
    packName: 'pack',
    supplierName: r.supplierName,
    purchaseNo: null,
    location: r.location,
    status: r.status as BatchRow['status'],
    isExpired: r.bucket === 'EXPIRED',
    daysToExpiry: r.daysToExpiry,
    expiryBucket: r.bucket,
    valueCost: r.costValue,
    valueRetail: r.retailValue,
    createdAt: '',
  };
}

export function ExpiryPage() {
  const f = useFormat();
  const can = useCan();
  const [params] = useSearchParams();
  const [bucket, setBucket] = useState<'ALL' | ExpiryBucket>((params.get('bucket') as ExpiryBucket) ?? 'ALL');
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [writeOff, setWriteOff] = useState<BatchRow | null>(null);
  const ds = useDebounced(search, 180);
  useEffect(() => {
    const b = params.get('bucket');
    if (b) setBucket(b as ExpiryBucket);
  }, [params]);
  const suppliers = useApiQuery('suppliers.options');
  const cats = useApiQuery('categories.list', { includeInactive: false });
  const { data, isLoading } = useApiQuery('inventory.expiry', { bucket, search: ds, supplierId, categoryId });
  const total = data?.summary.reduce((s, b) => s + b.quantity, 0) ?? 0;
  const expired = data?.summary.find((b) => b.bucket === 'EXPIRED');

  return (
    <Page>
      <PageHeader
        title="Expiry management"
        description="Every batch on hand by time to expiry. Expired stock is never hidden."
        icon={<CalendarClock />}
        actions={<ExportMenu reportId={bucket === 'EXPIRED' ? 'expired-stock' : 'expiring-stock'} params={{ supplierId, categoryId, days: bucket === 'D30' ? 30 : bucket === 'D60' ? 60 : bucket === 'D90' ? 90 : 365 }} />}
      />
      {expired && expired.batches > 0 && (
        <Alert tone="danger" icon={<AlertOctagon />} className="mb-4" title={`${expired.batches} expired batch${expired.batches === 1 ? '' : 'es'} still on hand`}>
          These cannot be sold without supervisor authorisation. Write them off, or return them to the supplier for credit.
        </Alert>
      )}
      <div className="grid grid-cols-5 gap-3">
        {BUCKETS.map((b) => {
          const s = data?.summary.find((x) => x.bucket === b.id);
          const active = bucket === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBucket(active ? 'ALL' : b.id)}
              className={cn('relative overflow-hidden rounded-xl border bg-card p-4 text-start shadow-card transition hover:border-border-strong', active ? 'border-primary ring-2 ring-primary/15' : 'border-border')}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold">{b.label}</span>
                <span className={cn('num text-[12px] font-semibold', b.tone)}>{s?.batches ?? 0} batches</span>
              </div>
              <div className="num mt-2 text-[22px] font-semibold tracking-tight">{f.money(s?.costValue ?? s?.retailValue ?? 0)}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {s?.costValue !== null ? 'at cost' : 'at retail'} · {b.sub}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full', b.bar)} style={{ width: `${total ? Math.max(2, ((s?.quantity ?? 0) / total) * 100) : 0}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      <Card className="mt-4 overflow-hidden">
        <FilterBar right={<span className="num text-[12.5px] text-muted-foreground">{data?.rows.length ?? 0} batches</span>}>
          <SearchInput value={search} onChange={setSearch} placeholder="Product or batch" />
          <Select className="w-52" value={supplierId ? String(supplierId) : null} onChange={(v) => setSupplierId(v ? Number(v) : null)} allowClear clearLabel="All suppliers" placeholder="All suppliers" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
          <Select className="w-44" value={categoryId ? String(categoryId) : null} onChange={(v) => setCategoryId(v ? Number(v) : null)} allowClear clearLabel="All categories" placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.batchId}
          rowClassName={(r) => (r.bucket === 'EXPIRED' ? 'bg-danger-soft/40' : undefined)}
          empty={<EmptyState icon={<CalendarClock />} title="Nothing in this range" description="No batches with stock match the filters." />}
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (r) => (
                <div>
                  <div className="font-semibold">{r.productName}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.genericName ?? '—'} · {r.categoryName ?? 'Uncategorised'}
                  </div>
                </div>
              ),
            },
            { key: 'batch', header: 'Batch', cell: (r) => <span className="font-mono text-[12.5px]">{r.batchNumber}</span> },
            {
              key: 'exp',
              header: 'Expiry',
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <span className="num">{f.date(r.expiryDate)}</span>
                  <ExpiryBadge bucket={r.bucket} days={r.daysToExpiry} />
                </div>
              ),
            },
            { key: 'qty', header: 'Quantity', align: 'right', cell: (r) => <span className="font-semibold">{f.qty(r.quantity, r.packSize, r.unitName, 'pack', 'units')}</span> },
            ...(data?.summary[0]?.costValue !== null ? [{ key: 'cost', header: 'Purchase value', align: 'right' as const, cell: (r: ExpiryRow) => f.money(r.costValue) }] : []),
            { key: 'retail', header: 'Selling value', align: 'right', cell: (r) => f.money(r.retailValue) },
            { key: 'sup', header: 'Supplier', cell: (r) => <span className="block max-w-[150px] truncate text-[12.5px]" title={r.supplierName ?? undefined}>{r.supplierName ?? '—'}</span> },
            { key: 'loc', header: 'Location', cell: (r) => <span className="text-[12.5px] text-muted-foreground">{r.location ?? '—'}</span> },
            {
              key: 'act',
              header: '',
              cell: (r) =>
                can('stock.adjust') &&
                r.bucket === 'EXPIRED' && (
                  <Button size="xs" variant="danger-soft" icon={<Trash2 />} onClick={() => setWriteOff(toBatch(r))}>
                    Write off
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <AdjustStockDialog batch={writeOff} open={!!writeOff} onClose={() => setWriteOff(null)} />
    </Page>
  );
}
