import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ReceiptText } from 'lucide-react';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Card, EmptyState, Badge } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { MethodLabel, StatusBadge } from '@renderer/components/StatusBadges';
import { SaleDetailSheet } from './SaleDetailSheet';

export function SalesPage() {
  const f = useFormat();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [range, setRange] = useState(presetRange(params.get('open') ? 'all' : 'month'));
  const [status, setStatus] = useState<'all' | 'COMPLETED' | 'VOID' | 'RETURNED'>('all');
  const [userId, setUserId] = useState<number | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const dsearch = useDebounced(search, 200);
  const users = useApiQuery('users.options', undefined, { enabled: can('sales.view') });
  const { data, isLoading } = useApiQuery('sales.list', { search: dsearch, from: range.from, to: range.to, status, userId, paymentMethod: method as never, page, pageSize: 25 });

  return (
    <Page>
      <PageHeader title="Sales history" description="Every invoice with payment, returns and void status." icon={<ReceiptText />} />
      <Card className="overflow-hidden">
        <FilterBar
          right={
            data && (
              <div className="text-[12.5px] text-muted-foreground">
                Total <b className="num font-semibold text-foreground">{f.money(data.totalAmount)}</b>
              </div>
            )
          }
        >
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Invoice no., customer or phone" />
          <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
          <Segmented value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'RETURNED', label: 'With returns' }, { value: 'VOID', label: 'Void' }]} />
          {can('sales.view') && (
            <Select className="w-44" value={userId ? String(userId) : null} onChange={(v) => (setUserId(v ? Number(v) : null), setPage(1))} allowClear clearLabel="All cashiers" placeholder="All cashiers" options={(users.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))} />
          )}
          <Select
            className="w-40"
            value={method}
            onChange={(v) => (setMethod(v), setPage(1))}
            allowClear
            clearLabel="Any payment"
            placeholder="Any payment"
            options={['CASH', 'CARD', 'MOBILE_WALLET', 'BANK_TRANSFER', 'CREDIT'].map((m) => ({ value: m, label: <MethodLabel method={m} /> }))}
          />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          selectedKey={openId}
          onRowClick={(r) => setParams({ open: String(r.id) })}
          empty={<EmptyState icon={<ReceiptText />} title="No sales found" description="Try a different date range or search." />}
          columns={[
            { key: 'inv', header: 'Invoice', cell: (r) => <span className="font-semibold">{r.invoiceNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted-foreground">{f.dateTime(r.createdAt)}</span> },
            { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted-foreground">Walk-in</span> },
            { key: 'cashier', header: 'Cashier', cell: (r) => r.cashierName },
            {
              key: 'pay',
              header: 'Payment',
              cell: (r) => (
                <div className="flex flex-wrap gap-2">
                  {r.paymentMethods.split(', ').filter(Boolean).map((m) => (
                    <MethodLabel key={m} method={m} className="text-[12.5px]" />
                  ))}
                </div>
              ),
            },
            { key: 'items', header: 'Units', align: 'right', cell: (r) => f.number(r.itemCount) },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              cell: (r) => (
                <div>
                  <div className={r.status === 'VOID' ? 'text-muted-foreground line-through' : 'font-semibold'}>{f.money(r.total)}</div>
                  {r.returnedTotal > 0 && <div className="text-[11.5px] text-warning">−{f.money(r.returnedTotal)} returned</div>}
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <div className="flex gap-1.5">
                  <StatusBadge status={r.status} />
                  {r.creditAmount > 0 && <Badge tone="info">Credit</Badge>}
                </div>
              ),
            },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <SaleDetailSheet id={openId} onClose={() => setParams({})} />
    </Page>
  );
}
