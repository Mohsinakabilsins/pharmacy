import { useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Plus } from 'lucide-react';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Segmented } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@renderer/components/ui/dialog';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { MethodLabel, StatusBadge } from '@renderer/components/StatusBadges';
import { PartyPaymentDialog } from '@renderer/components/PartyPaymentDialog';
import { useConfirm } from '@renderer/components/ui/confirm';

export function PaymentsPage() {
  const f = useFormat();
  const can = useCan();
  const confirm = useConfirm();
  const [direction, setDirection] = useState<'all' | 'IN' | 'OUT'>('all');
  const [range, setRange] = useState(presetRange('month'));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [picking, setPicking] = useState<'supplier' | 'customer' | null>(null);
  const [party, setParty] = useState<{ kind: 'supplier' | 'customer'; id: number; name: string; balance: number } | null>(null);
  const ds = useDebounced(search, 180);
  const { data, isLoading } = useApiQuery('payments.list', { direction, from: range.from, to: range.to, search: ds, page, pageSize: 25, status: 'all' });
  const voidM = useApiMutation('payments.void', { success: 'Payment voided — balance restored' });
  return (
    <Page>
      <PageHeader
        title="Payments"
        description="Money paid to suppliers and received from customers on account."
        icon={<ArrowLeftRight />}
        actions={
          can('payments.manage') && (
            <>
              <Button icon={<ArrowDownLeft />} onClick={() => setPicking('customer')}>
                Receive from customer
              </Button>
              <Button variant="primary" icon={<ArrowUpRight />} onClick={() => setPicking('supplier')}>
                Pay supplier
              </Button>
            </>
          )
        }
      />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="text-[12.5px] text-muted-foreground">Total <b className="num font-semibold text-foreground">{f.money(data.amountTotal)}</b></span>}>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Payment no., party, reference" />
          <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
          <Segmented value={direction} onChange={(v) => (setDirection(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'OUT', label: 'Paid out' }, { value: 'IN', label: 'Received' }]} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<ArrowLeftRight />} title="No payments in this period" />}
          columns={[
            { key: 'no', header: 'No.', cell: (r) => <span className="font-medium">{r.paymentNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => f.date(r.paymentDate) },
            { key: 'dir', header: 'Type', cell: (r) => (r.direction === 'OUT' ? <Badge tone="warning" icon={<ArrowUpRight />}>Paid to supplier</Badge> : <Badge tone="success" icon={<ArrowDownLeft />}>Received</Badge>) },
            {
              key: 'party',
              header: 'Party',
              cell: (r) => (
                <div>
                  <div className="font-medium">{r.partyName}</div>
                  {r.purchaseNo && <div className="text-[11.5px] text-muted-foreground">On posting {r.purchaseNo}</div>}
                </div>
              ),
            },
            { key: 'method', header: 'Method', cell: (r) => <MethodLabel method={r.method} className="text-[12.5px]" /> },
            { key: 'ref', header: 'Reference', cell: (r) => <span className="text-muted-foreground">{r.reference ?? '—'}</span> },
            { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <span className={r.status === 'VOID' ? 'text-muted-foreground line-through' : 'font-semibold'}>{f.money(r.amount)}</span> },
            {
              key: 'st',
              header: '',
              cell: (r) =>
                r.status === 'VOID' ? (
                  <StatusBadge status="VOID" />
                ) : (
                  can('payments.manage') && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Void"
                      onClick={async () => {
                        const reason = await confirm({ title: `Void ${r.paymentNo}?`, description: `${r.partyName} · ${f.money(r.amount)}. The balance will be restored.`, tone: 'danger', confirmLabel: 'Void payment', requireReason: true });
                        if (reason !== false) voidM.mutate({ id: r.id, reason });
                      }}
                    >
                      <Ban />
                    </Button>
                  )
                ),
            },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <PartyPicker kind={picking} onClose={() => setPicking(null)} onPick={(p) => (setPicking(null), setParty(p))} />
      {party && <PartyPaymentDialog open onClose={() => setParty(null)} party={party.kind} id={party.id} name={party.name} balance={party.balance} />}
    </Page>
  );
}

function PartyPicker({ kind, onClose, onPick }: { kind: 'supplier' | 'customer' | null; onClose: () => void; onPick: (p: { kind: 'supplier' | 'customer'; id: number; name: string; balance: number }) => void }) {
  const f = useFormat();
  const [search, setSearch] = useState('');
  const ds = useDebounced(search, 150);
  const sups = useApiQuery('suppliers.list', { search: ds, balance: 'all', status: 'active', page: 1, pageSize: 30 }, { enabled: kind === 'supplier' });
  const cus = useApiQuery('customers.list', { search: ds, balance: 'all', status: 'active', page: 1, pageSize: 30 }, { enabled: kind === 'customer' });
  const rows = kind === 'supplier' ? (sups.data?.rows ?? []) : (cus.data?.rows ?? []);
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      {kind && (
        <DialogContent size="md">
          <DialogHeader icon={<Plus />} title={kind === 'supplier' ? 'Pay a supplier' : 'Receive from a customer'} description="Choose the account." />
          <DialogBody className="space-y-3">
            <SearchInput value={search} onChange={setSearch} autoFocus className="w-full" placeholder={`Search ${kind}s`} />
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {rows.map((r) => (
                <button key={r.id} type="button" onClick={() => onPick({ kind, id: r.id, name: r.name, balance: r.balance })} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start hover:bg-muted">
                  <span className="text-[13.5px] font-medium">{r.name}</span>
                  <span className="num text-[12.5px] text-muted-foreground">{f.money(r.balance)}</span>
                </button>
              ))}
            </div>
          </DialogBody>
        </DialogContent>
      )}
    </Dialog>
  );
}
