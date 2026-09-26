import { useState } from 'react';
import { Boxes, ShieldCheck, SlidersHorizontal, History, Pencil, MoreHorizontal, MapPin, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import type { BatchRow } from '@shared/types/inventory';
import { MOVEMENT_LABELS, type MovementType } from '@shared/types/inventory';
import { api, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { ExpiryBadge, StatusBadge } from '@renderer/components/StatusBadges';
import { useConfirm } from '@renderer/components/ui/confirm';
import { AdjustStockDialog, EditBatchDialog } from './InventoryDialogs';
import { ProductSheet } from '../products/ProductSheet';

export function StockPage() {
  const can = useCan();
  const confirm = useConfirm();
  const [checking, setChecking] = useState(false);
  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await api('inventory.integrity');
      if (r.mismatches.length === 0) toast.success(`Integrity check passed — ${r.checkedBatches} batches match the movement ledger exactly.`);
      else
        await confirm({
          title: `${r.mismatches.length} batch balance mismatch${r.mismatches.length === 1 ? '' : 'es'}`,
          description: 'These batches do not match their movement ledger. Contact support; do not adjust manually.',
          body: (
            <ul className="space-y-1 text-[12.5px]">
              {r.mismatches.map((m) => (
                <li key={m.batchId}>
                  {m.productName} {m.batchNumber}: on hand {m.onHand}, ledger {m.ledger}
                </li>
              ))}
            </ul>
          ),
          tone: 'danger',
          confirmLabel: 'OK',
        });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };
  return (
    <Page>
      <PageHeader
        title="Stock & batches"
        description="Batch-level inventory. Every change is recorded as a stock movement."
        icon={<Boxes />}
        actions={
          (can('settings.manage') || can('stock.adjust')) && (
            <Button icon={<ShieldCheck />} loading={checking} onClick={() => void runCheck()}>
              Verify integrity
            </Button>
          )
        }
      />
      <Tabs defaultValue="batches">
        <TabsList className="mb-4">
          <TabsTrigger value="batches">
            <Boxes /> Batches
          </TabsTrigger>
          <TabsTrigger value="adjustments">
            <SlidersHorizontal /> Adjustments
          </TabsTrigger>
          <TabsTrigger value="movements">
            <History /> Movement ledger
          </TabsTrigger>
        </TabsList>
        <TabsContent value="batches">
          <BatchList />
        </TabsContent>
        <TabsContent value="adjustments">
          <AdjustmentList />
        </TabsContent>
        <TabsContent value="movements">
          <MovementList />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function BatchList() {
  const f = useFormat();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'in_stock' | 'sellable' | 'expiring' | 'expired' | 'blocked' | 'depleted' | 'all'>('in_stock');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState<BatchRow | null>(null);
  const [edit, setEdit] = useState<BatchRow | null>(null);
  const [product, setProduct] = useState<number | null>(null);
  const ds = useDebounced(search, 180);
  const suppliers = useApiQuery('suppliers.options');
  const { data, isLoading } = useApiQuery('batches.list', { search: ds, status, supplierId, page, pageSize: 30, sort: 'expiry' });
  return (
    <Card className="overflow-hidden">
      <FilterBar right={data && <span className="num text-[12.5px] text-muted-foreground">{f.number(data.total)} batches</span>}>
        <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Product or batch number" />
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'in_stock', label: 'In stock' },
            { value: 'sellable', label: 'Sellable' },
            { value: 'expiring', label: 'Expiring' },
            { value: 'expired', label: 'Expired' },
            { value: 'blocked', label: 'Quarantined' },
            { value: 'depleted', label: 'Empty' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select className="w-52" value={supplierId ? String(supplierId) : null} onChange={(v) => (setSupplierId(v ? Number(v) : null), setPage(1))} allowClear clearLabel="All suppliers" placeholder="All suppliers" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setProduct(r.productId)}
        empty={<EmptyState icon={<Boxes />} title="No batches" description="Batches are created when purchases are posted or opening stock is added." />}
        columns={[
          {
            key: 'product',
            header: 'Product',
            cell: (r) => (
              <div>
                <div className="font-semibold">{r.productName}</div>
                <div className="text-[12px] text-muted-foreground">
                  {r.genericName ?? '—'} · {r.productCode}
                </div>
              </div>
            ),
          },
          {
            key: 'batch',
            header: 'Batch',
            cell: (r) => (
              <div>
                <div className="font-mono text-[12.5px] font-medium">{r.batchNumber}</div>
                {r.location && (
                  <div className="flex items-center gap-0.5 text-[11.5px] text-muted-foreground">
                    <MapPin className="size-3" />
                    {r.location}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'exp',
            header: 'Expiry',
            cell: (r) => (
              <div className="flex items-center gap-2">
                <span className="num">{f.date(r.expiryDate)}</span>
                {r.quantityOnHand > 0 && <ExpiryBadge bucket={r.expiryBucket} days={r.daysToExpiry} />}
              </div>
            ),
          },
          { key: 'qty', header: 'On hand', align: 'right', cell: (r) => <span className="font-semibold">{f.qty(r.quantityOnHand, r.packSize, r.unitName, r.packName)}</span> },
          ...(can('inventory.cost_view') ? [{ key: 'cost', header: 'Cost / pack', align: 'right' as const, cell: (r: BatchRow) => f.money(r.costPrice, { symbol: false }) }] : []),
          { key: 'price', header: 'Price / pack', align: 'right', cell: (r) => f.money(r.salePrice, { symbol: false }) },
          { key: 'value', header: 'Value', align: 'right', cell: (r) => <span className="text-muted-foreground">{f.money(r.valueCost ?? r.valueRetail)}</span> },
          { key: 'sup', header: 'Supplier', cell: (r) => <span className="block max-w-[150px] truncate text-[12.5px]" title={r.supplierName ?? undefined}>{r.supplierName ?? '—'}</span> },
          { key: 'st', header: 'Status', cell: (r) => (r.isExpired && r.quantityOnHand > 0 ? <StatusBadge status="EXPIRED" /> : <StatusBadge status={r.status} />) },
          {
            key: 'act',
            header: '',
            width: 44,
            cell: (r) =>
              (can('stock.adjust') || can('batches.manage')) && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label="Actions">
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      {can('stock.adjust') && (
                        <MenuItem icon={<SlidersHorizontal />} onSelect={() => setAdjust(r)}>
                          Adjust / write off
                        </MenuItem>
                      )}
                      {can('batches.manage') && (
                        <MenuItem icon={<Pencil />} onSelect={() => setEdit(r)}>
                          Edit batch
                        </MenuItem>
                      )}
                    </MenuContent>
                  </Menu>
                </div>
              ),
          },
        ]}
      />
      {data && <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />}
      <AdjustStockDialog batch={adjust} open={!!adjust} onClose={() => setAdjust(null)} />
      <EditBatchDialog batch={edit} open={!!edit} onClose={() => setEdit(null)} />
      <ProductSheet id={product} onClose={() => setProduct(null)} />
    </Card>
  );
}

const REASON: Record<string, string> = {
  COUNT_CORRECTION: 'Count correction',
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
  LOST: 'Lost / theft',
  RETURN_TO_SUPPLIER: 'Returned to supplier',
  OPENING_STOCK: 'Opening stock',
  OTHER: 'Other',
};

function AdjustmentList() {
  const f = useFormat();
  const [range, setRange] = useState(presetRange('30d'));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const ds = useDebounced(search, 180);
  const { data, isLoading } = useApiQuery('inventory.adjustments', { from: range.from, to: range.to, search: ds, page, pageSize: 30 });
  return (
    <Card className="overflow-hidden">
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Product, batch or adjustment no." />
        <DateRangePicker value={range} onChange={setRange} />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        loading={isLoading}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={<SlidersHorizontal />} title="No adjustments in this period" />}
        columns={[
          { key: 'no', header: 'No.', cell: (r) => <span className="font-medium">{r.adjustmentNo}</span> },
          { key: 'date', header: 'Date', cell: (r) => <span className="text-muted-foreground">{f.dateTime(r.createdAt)}</span> },
          { key: 'product', header: 'Product', cell: (r) => r.productName },
          { key: 'batch', header: 'Batch', cell: (r) => <span className="font-mono text-[12.5px]">{r.batchNumber}</span> },
          {
            key: 'dir',
            header: 'Change',
            cell: (r) => (
              <Badge tone={r.direction === 'IN' ? 'success' : 'danger'} icon={r.direction === 'IN' ? <ArrowUpRight /> : <ArrowDownRight />}>
                {r.direction === 'IN' ? '+' : '−'}
                {f.qty(r.quantity, r.packSize, 'unit', 'pack', 'units')}
              </Badge>
            ),
          },
          { key: 'reason', header: 'Reason', cell: (r) => REASON[r.reason] ?? r.reason },
          { key: 'cost', header: 'Cost value', align: 'right', cell: (r) => f.money(r.costValue) },
          { key: 'notes', header: 'Notes', cell: (r) => <span className="line-clamp-1 text-[12.5px] text-muted-foreground">{r.notes ?? '—'}</span> },
          { key: 'by', header: 'By', cell: (r) => r.userName },
        ]}
      />
      {data && <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function MovementList() {
  const f = useFormat();
  const [range, setRange] = useState(presetRange('7d'));
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const ds = useDebounced(search, 180);
  const { data, isLoading } = useApiQuery('inventory.movements', { from: range.from, to: range.to, type, search: ds, page, pageSize: 40 });
  return (
    <Card className="overflow-hidden">
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Product or batch" />
        <DateRangePicker value={range} onChange={setRange} />
        <Select className="w-44" value={type} onChange={setType} allowClear clearLabel="All movements" placeholder="All movements" options={Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))} />
      </FilterBar>
      <DataTable
        dense
        rows={data?.rows}
        loading={isLoading}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={<History />} title="No movements in this period" />}
        columns={[
          { key: 'date', header: 'When', cell: (r) => <span className="text-muted-foreground">{f.dateTime(r.createdAt)}</span> },
          { key: 'type', header: 'Movement', cell: (r) => <MovementBadge type={r.movementType} /> },
          { key: 'product', header: 'Product', cell: (r) => <span className="font-medium">{r.productName}</span> },
          { key: 'batch', header: 'Batch', cell: (r) => <span className="font-mono text-[12px]">{r.batchNumber}</span> },
          { key: 'ref', header: 'Reference', cell: (r) => r.referenceNo ?? '—' },
          { key: 'qty', header: 'Qty', align: 'right', cell: (r) => <span className={cn('font-semibold', r.quantity > 0 ? 'text-success' : 'text-danger')}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</span> },
          { key: 'bal', header: 'Balance', align: 'right', cell: (r) => r.balanceAfter },
          { key: 'user', header: 'User', cell: (r) => <span className="text-[12.5px]">{r.userName ?? 'System'}</span> },
        ]}
      />
      {data && <Pagination page={page} pageSize={40} total={data.total} onPage={setPage} />}
    </Card>
  );
}

export function MovementBadge({ type }: { type: MovementType }) {
  const tone = type === 'SALE' || type === 'WRITE_OFF' || type === 'ADJUSTMENT_OUT' || type === 'PURCHASE_VOID' ? 'danger' : type === 'PURCHASE' || type === 'OPENING' ? 'success' : type === 'SALE_RETURN' || type === 'SALE_VOID' || type === 'ADJUSTMENT_IN' ? 'info' : 'neutral';
  return <Badge tone={tone}>{MOVEMENT_LABELS[type]}</Badge>;
}
