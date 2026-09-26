import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { HandCoins, Pencil, Plus, Users, UserRound, ReceiptText } from 'lucide-react';
import type { CustomerDetail } from '@shared/types/customers';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState, KeyValue, Skeleton, Stat } from '@renderer/components/ui/display';
import { MoneyInput, SearchInput } from '@renderer/components/ui/inputs';
import { Segmented, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Sheet, SheetHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { Alert } from '@renderer/components/ui/display';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { FilterBar } from '@renderer/components/FilterBar';
import { LedgerTable } from '@renderer/components/LedgerTable';
import { PartyPaymentDialog } from '@renderer/components/PartyPaymentDialog';
import { StatusBadge } from '@renderer/components/StatusBadges';
import { SaleDetailSheet } from '../sales/SaleDetailSheet';

export function CustomersPage() {
  const f = useFormat();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [balance, setBalance] = useState<'all' | 'receivable'>('all');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<CustomerDetail | 'new' | null>(null);
  const ds = useDebounced(search, 180);
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const { data, isLoading } = useApiQuery('customers.list', { search: ds, balance, status: 'active', page, pageSize: 25 });
  return (
    <Page>
      <PageHeader
        title="Customers"
        description="Regular customers, purchase history and credit accounts. Only information the pharmacy needs is stored."
        icon={<Users />}
        actions={
          can('customers.manage') && (
            <Button variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>
              New customer
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="text-[12.5px] text-muted-foreground">Total receivable <b className="num font-semibold text-foreground">{f.money(data.totalReceivable)}</b></span>}>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Name, phone or code" />
          <Segmented value={balance} onChange={(v) => (setBalance(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'receivable', label: 'With balance' }]} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          selectedKey={openId}
          onRowClick={(r) => setParams({ open: String(r.id) })}
          empty={<EmptyState icon={<Users />} title="No customers" description="Customers can be added here or from the POS (F4)." />}
          columns={[
            {
              key: 'name',
              header: 'Customer',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-soft-foreground">{r.name.slice(0, 1)}</span>
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-[12px] text-muted-foreground">{r.code}</div>
                  </div>
                </div>
              ),
            },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
            { key: 'visits', header: 'Visits', align: 'right', cell: (r) => r.visitCount },
            { key: 'spent', header: 'Total purchases', align: 'right', cell: (r) => <span className="text-muted-foreground">{f.money(r.totalPurchases)}</span> },
            { key: 'last', header: 'Last visit', cell: (r) => <span className="text-[12.5px]">{r.lastVisit ? f.date(r.lastVisit) : '—'}</span> },
            { key: 'limit', header: 'Credit limit', align: 'right', cell: (r) => <span className="text-muted-foreground">{r.creditLimit ? f.money(r.creditLimit) : '—'}</span> },
            { key: 'bal', header: 'Balance', align: 'right', cell: (r) => <span className={cn('font-semibold', r.balance > 0 ? 'text-warning' : 'text-muted-foreground')}>{f.money(r.balance)}</span> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <CustomerSheet id={openId} onClose={() => setParams({})} onEdit={(c) => setEdit(c)} />
      <CustomerFormDialog value={edit} onClose={() => setEdit(null)} onSaved={(c) => setParams({ open: String(c.id) })} />
    </Page>
  );
}

function CustomerSheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (c: CustomerDetail) => void }) {
  const f = useFormat();
  const can = useCan();
  const [pay, setPay] = useState(false);
  const [sale, setSale] = useState<number | null>(null);
  const { data: c } = useApiQuery('customers.get', { id: id ?? 0 }, { enabled: !!id });
  const ledger = useApiQuery('customers.ledger', { id: id ?? 0 }, { enabled: !!id });
  const sales = useApiQuery('sales.list', { customerId: id, page: 1, pageSize: 50, status: 'all' }, { enabled: !!id });
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} width="lg">
      {!c ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <SheetHeader
            icon={<UserRound />}
            title={c.name}
            subtitle={`${c.code}${c.phone ? ` · ${c.phone}` : ''}`}
            badges={c.balance > 0 ? <Badge tone="warning">Owes {f.money(c.balance)}</Badge> : undefined}
            actions={
              <>
                {(can('payments.manage') || can('sales.credit')) && c.balance > 0 && (
                  <Button size="sm" variant="primary" icon={<HandCoins />} onClick={() => setPay(true)}>
                    Receive payment
                  </Button>
                )}
                {can('customers.manage') && (
                  <Button size="sm" icon={<Pencil />} onClick={() => onEdit(c)}>
                    Edit
                  </Button>
                )}
              </>
            }
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4">
                <Stat label="Balance" value={f.money(c.balance)} tone={c.balance > 0 ? 'warning' : undefined} sub={c.creditLimit ? `Limit ${f.money(c.creditLimit)}` : 'No credit limit'} />
              </Card>
              <Card className="p-4">
                <Stat label="Total purchases" value={f.money(c.totalPurchases)} sub={`${c.visitCount} visits`} />
              </Card>
              <Card className="p-4">
                <Stat label="Last visit" value={c.lastVisit ? f.date(c.lastVisit) : '—'} sub={`${c.prescriptionCount} prescriptions`} />
              </Card>
            </div>
            <Tabs defaultValue="sales">
              <TabsList className="w-full">
                <TabsTrigger value="sales">Purchase history</TabsTrigger>
                <TabsTrigger value="ledger">Account ledger</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <TabsContent value="sales" className="pt-4">
                <div className="space-y-1.5">
                  {sales.data?.rows.map((s) => (
                    <button key={s.id} type="button" onClick={() => setSale(s.id)} className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-2.5 text-start text-[13px] hover:border-border-strong hover:bg-subtle">
                      <span className="flex items-center gap-2">
                        <ReceiptText className="size-4 text-muted-foreground" />
                        <b className="font-semibold">{s.invoiceNo}</b> · {f.dateTime(s.createdAt)} · {s.itemCount} units
                      </span>
                      <span className="flex items-center gap-3">
                        {s.status !== 'COMPLETED' && <StatusBadge status={s.status} />}
                        {s.creditAmount > 0 && <Badge tone="info">Credit</Badge>}
                        <span className="num w-28 text-end font-semibold">{f.money(s.total)}</span>
                      </span>
                    </button>
                  ))}
                  {sales.data?.rows.length === 0 && <EmptyState compact title="No purchases yet" />}
                </div>
              </TabsContent>
              <TabsContent value="ledger" className="pt-4">
                <LedgerTable ledger={ledger.data} debitLabel="Credit sales (+)" creditLabel="Receipts (−)" />
              </TabsContent>
              <TabsContent value="details" className="pt-4">
                <Card className="p-5">
                  <KeyValue items={[['Phone', c.phone], ['Address', c.address], ['Credit limit', c.creditLimit ? f.money(c.creditLimit) : 'None'], ['Opening balance', f.money(c.openingBalance)], ['Customer since', f.date(c.createdAt)], ['Code', c.code]]} />
                  {c.notes && <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted-foreground">{c.notes}</p>}
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          <PartyPaymentDialog open={pay} onClose={() => setPay(false)} party="customer" id={c.id} name={c.name} balance={c.balance} />
          <SaleDetailSheet id={sale} onClose={() => setSale(null)} />
        </>
      )}
    </Sheet>
  );
}

function CustomerFormDialog({ value, onClose, onSaved }: { value: CustomerDetail | 'new' | null; onClose: () => void; onSaved: (c: CustomerDetail) => void }) {
  const f = useFormat();
  const editing = value && value !== 'new' ? value : null;
  const [s, setS] = useState({ name: '', phone: '', address: '', notes: '', creditLimit: 0 as number | null, openingBalance: 0 as number | null, isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (value) {
      setErrors({});
      setS(editing ? { name: editing.name, phone: editing.phone ?? '', address: editing.address ?? '', notes: editing.notes ?? '', creditLimit: editing.creditLimit, openingBalance: editing.openingBalance, isActive: editing.isActive } : { name: '', phone: '', address: '', notes: '', creditLimit: 0, openingBalance: 0, isActive: true });
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation('customers.save', { success: 'Customer saved', onSuccess: (r) => (onSaved(r), onClose()), onError: (e) => setErrors(e.fields ?? {}) });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<UserRound />} title={editing ? `Edit ${editing.name}` : 'New customer'} />
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label="Name" required error={errors.name} className="col-span-2">
            <Input autoFocus value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
          </Field>
          <Field label="Credit limit" hint="0 = no limit">
            <MoneyInput value={s.creditLimit} onChange={(v) => setS({ ...s, creditLimit: v })} symbol={f.symbol} />
          </Field>
          <Field label="Address" className="col-span-2">
            <Input value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} />
          </Field>
          <Field label="Opening balance" hint="Amount the customer already owes">
            <MoneyInput value={s.openingBalance} onChange={(v) => setS({ ...s, openingBalance: v })} symbol={f.symbol} />
          </Field>
          <Field label="Notes" className="col-span-2" hint="Avoid recording medical conditions here — use prescriptions for dispensing records.">
            <Textarea value={s.notes} onChange={(e) => setS({ ...s, notes: e.target.value })} />
          </Field>
          <div className="col-span-2">
            <SwitchRow label="Active" checked={s.isActive} onChange={(v) => setS({ ...s, isActive: v })} />
          </div>
          {Object.keys(errors).length > 0 && !errors.name && <Alert tone="danger" className="col-span-2">{Object.values(errors)[0]}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!s.name.trim()} onClick={() => save.mutate({ id: editing?.id, code: editing?.code, name: s.name, phone: s.phone || null, address: s.address || null, notes: s.notes || null, creditLimit: s.creditLimit ?? 0, openingBalance: s.openingBalance ?? 0, isActive: s.isActive })}>
            Save customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
