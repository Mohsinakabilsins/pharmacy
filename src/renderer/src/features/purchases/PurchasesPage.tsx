import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Truck } from 'lucide-react';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { StatusBadge } from '@renderer/components/StatusBadges';

export function PurchasesPage() {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'DRAFT' | 'POSTED' | 'VOID'>('all');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [range, setRange] = useState(presetRange('month'));
  const [page, setPage] = useState(1);
  const ds = useDebounced(search, 180);
  const suppliers = useApiQuery('suppliers.options');
  const { data, isLoading } = useApiQuery('purchases.list', { search: ds, status, supplierId, from: range.from, to: range.to, page, pageSize: 25 });
  return (
    <Page>
      <PageHeader
        title="Purchases"
        description="Supplier invoices. Posting a purchase creates batches and updates the supplier balance."
        icon={<Truck />}
        actions={
          can('purchases.manage') && (
            <Button variant="primary" icon={<Plus />} onClick={() => nav('/purchases/new')}>
              New purchase
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="text-[12.5px] text-muted-foreground">Posted total <b className="num font-semibold text-foreground">{f.money(data.totalAmount)}</b></span>}>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Purchase no., supplier invoice, supplier" />
          <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
          <Segmented value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'POSTED', label: 'Posted' }, { value: 'VOID', label: 'Void' }]} />
          <Select className="w-56" value={supplierId ? String(supplierId) : null} onChange={(v) => (setSupplierId(v ? Number(v) : null), setPage(1))} allowClear clearLabel="All suppliers" placeholder="All suppliers" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/purchases/${r.id}`)}
          empty={<EmptyState icon={<Truck />} title="No purchases found" description="Record supplier invoices to bring stock in." action={can('purchases.manage') && <Button variant="primary" icon={<Plus />} onClick={() => nav('/purchases/new')}>New purchase</Button>} />}
          columns={[
            { key: 'no', header: 'Purchase', cell: (r) => <span className="font-semibold">{r.purchaseNo}</span> },
            { key: 'date', header: 'Invoice date', cell: (r) => f.date(r.invoiceDate) },
            { key: 'sup', header: 'Supplier', cell: (r) => <span className="font-medium">{r.supplierName}</span> },
            { key: 'inv', header: 'Supplier invoice', cell: (r) => <span className="text-muted-foreground">{r.supplierInvoiceNo ?? '—'}</span> },
            { key: 'items', header: 'Items', align: 'right', cell: (r) => r.itemCount },
            { key: 'total', header: 'Total', align: 'right', cell: (r) => <span className={r.status === 'VOID' ? 'text-muted-foreground line-through' : 'font-semibold'}>{f.money(r.total)}</span> },
            { key: 'paid', header: 'Paid on posting', align: 'right', cell: (r) => <span className="text-muted-foreground">{r.paidAmount ? f.money(r.paidAmount) : '—'}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'by', header: 'Created by', cell: (r) => <span className="text-[12.5px]">{r.createdByName}</span> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
    </Page>
  );
}
