import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PackageSearch, Truck } from 'lucide-react';
import type { ReorderRow } from '@shared/types/inventory';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Card, EmptyState } from '@renderer/components/ui/display';
import { NumberInput, SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Checkbox, Segmented } from '@renderer/components/ui/controls';
import { DataTable } from '@renderer/components/DataTable';
import { FilterBar } from '@renderer/components/FilterBar';
import { StockBadge } from '@renderer/components/StatusBadges';
import { ExportMenu } from '@renderer/components/ExportMenu';
import { usePurchasePrefill } from '../purchases/prefill';

export function ReorderPage() {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const prefill = usePurchasePrefill((s) => s.set);
  const [filter, setFilter] = useState<'all' | 'out' | 'low' | 'reorder'>('all');
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [packs, setPacks] = useState<Record<number, number>>({});
  const ds = useDebounced(search, 180);
  const suppliers = useApiQuery('suppliers.options');
  const { data, isLoading } = useApiQuery('inventory.reorder', { filter, search: ds, supplierId });
  const rows = data ?? [];
  const chosen = rows.filter((r) => selected[r.productId]);
  const estimate = useMemo(() => chosen.reduce((s, r) => s + (r.lastCostPrice ?? 0) * (packs[r.productId] ?? r.suggestedPacks), 0), [chosen, packs]);
  const counts = { out: rows.filter((r) => r.status === 'OUT_OF_STOCK').length, low: rows.filter((r) => r.status === 'LOW_STOCK').length };

  const createDraft = () => {
    const sup = supplierId ?? chosen.find((r) => r.lastSupplierId)?.lastSupplierId ?? null;
    prefill(
      sup,
      chosen.map((r) => ({ productId: r.productId, name: r.productName, packSize: r.packSize, packs: packs[r.productId] ?? r.suggestedPacks, costPrice: r.lastCostPrice })),
    );
    nav('/purchases/new');
  };

  return (
    <Page>
      <PageHeader
        title="Reorder planner"
        description="Products at or below their reorder level, with suggested order quantities from sales velocity."
        icon={<PackageSearch />}
        actions={
          <>
            <ExportMenu reportId="reorder" params={{ supplierId }} />
            {can('purchases.manage') && (
              <Button variant="primary" icon={<Truck />} disabled={chosen.length === 0} onClick={createDraft}>
                Create purchase draft{chosen.length ? ` (${chosen.length})` : ''}
              </Button>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        <FilterBar
          right={
            chosen.length > 0 && (
              <span className="text-[12.5px] text-muted-foreground">
                Estimated order <b className="num font-semibold text-foreground">{f.money(estimate)}</b>
              </span>
            )
          }
        >
          <SearchInput value={search} onChange={setSearch} placeholder="Search products" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: rows.length },
              { value: 'out', label: 'Out of stock', count: filter === 'all' ? counts.out : undefined },
              { value: 'low', label: 'Low', count: filter === 'all' ? counts.low : undefined },
              { value: 'reorder', label: 'Reorder' },
            ]}
          />
          <Select className="w-56" value={supplierId ? String(supplierId) : null} onChange={(v) => setSupplierId(v ? Number(v) : null)} allowClear clearLabel="Any last supplier" placeholder="Any last supplier" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
        </FilterBar>
        <DataTable
          rows={rows}
          loading={isLoading}
          rowKey={(r) => r.productId}
          onRowClick={(r) => setSelected((s) => ({ ...s, [r.productId]: !s[r.productId] }))}
          empty={<EmptyState icon={<PackageSearch />} title="Nothing to reorder" description="All products are above their reorder levels." />}
          columns={[
            {
              key: 'sel',
              header: <Checkbox checked={chosen.length > 0 && chosen.length === rows.length ? true : chosen.length > 0 ? 'indeterminate' : false} onChange={(v) => setSelected(v ? Object.fromEntries(rows.map((r) => [r.productId, true])) : {})} />,
              width: 44,
              cell: (r) => <Checkbox checked={!!selected[r.productId]} onChange={(v) => setSelected((s) => ({ ...s, [r.productId]: v }))} />,
            },
            {
              key: 'product',
              header: 'Product',
              cell: (r) => (
                <div>
                  <div className="font-semibold">{r.productName}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {r.genericName ?? '—'} · {r.manufacturerName ?? '—'}
                  </div>
                </div>
              ),
            },
            { key: 'status', header: 'Status', cell: (r) => <StockBadge status={r.status} /> },
            { key: 'onhand', header: 'On hand', align: 'right', cell: (r) => <span className="font-semibold">{f.qty(r.onHand, r.packSize, r.unitName, r.packName)}</span> },
            { key: 'levels', header: 'Min / reorder', align: 'right', cell: (r) => <span className="text-muted-foreground">{r.minStock} / {r.reorderLevel}</span> },
            { key: 'sold', header: 'Sold 30d', align: 'right', cell: (r) => f.qty(r.soldLast30Days, r.packSize, r.unitName, r.packName) },
            { key: 'avg', header: 'Avg / month', align: 'right', cell: (r) => <span className="text-muted-foreground">{f.number(r.avgMonthlySales)}</span> },
            {
              key: 'order',
              header: 'Order',
              align: 'right',
              width: 150,
              cell: (r: ReorderRow) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
                  <NumberInput size="sm" className="w-[110px]" value={packs[r.productId] ?? r.suggestedPacks} onChange={(v) => setPacks((s) => ({ ...s, [r.productId]: v ?? 0 }))} min={0} suffix={r.packName.toLowerCase().slice(0, 5)} />
                </div>
              ),
            },
            { key: 'sup', header: 'Last supplier', cell: (r) => <span className="text-[12.5px]">{r.lastSupplierName ?? '—'}</span> },
            ...(rows[0]?.lastCostPrice !== null && rows.length ? [{ key: 'cost', header: 'Est. cost', align: 'right' as const, cell: (r: ReorderRow) => f.money((r.lastCostPrice ?? 0) * (packs[r.productId] ?? r.suggestedPacks)) }] : []),
          ]}
        />
      </Card>
    </Page>
  );
}
