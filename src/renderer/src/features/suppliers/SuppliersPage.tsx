import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Building2, HandCoins, Pencil, Plus, Phone, Truck, Mail, MapPin } from 'lucide-react';
import type { SupplierDetail } from '@shared/types/purchasing';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState, KeyValue, Skeleton, Stat } from '@renderer/components/ui/display';
import { SearchInput, MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { Segmented, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Sheet, SheetHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { FilterBar } from '@renderer/components/FilterBar';
import { LedgerTable } from '@renderer/components/LedgerTable';
import { PartyPaymentDialog } from '@renderer/components/PartyPaymentDialog';
import { StatusBadge } from '@renderer/components/StatusBadges';

export function SuppliersPage() {
  const f = useFormat();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [balance, setBalance] = useState<'all' | 'payable' | 'advance'>('all');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<SupplierDetail | 'new' | null>(null);
  const ds = useDebounced(search, 180);
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const { data, isLoading } = useApiQuery('suppliers.list', { search: ds, balance, status, page, pageSize: 25 });
  return (
    <Page>
      <PageHeader
        title="Suppliers"
        description="Distributors and their running balances, purchases and payments."
        icon={<Building2 />}
        actions={
          can('suppliers.manage') && (
            <Button variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>
              New supplier
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="text-[12.5px] text-muted-foreground">Total payable <b className="num font-semibold text-foreground">{f.money(data.totalPayable)}</b></span>}>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Name, contact, phone, city" />
          <Segmented value={balance} onChange={(v) => (setBalance(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'payable', label: 'We owe' }, { value: 'advance', label: 'Advance' }]} />
          <Segmented value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          selectedKey={openId}
          onRowClick={(r) => setParams({ open: String(r.id) })}
          empty={<EmptyState icon={<Building2 />} title="No suppliers" description="Add the distributors you purchase from." />}
          columns={[
            {
              key: 'name',
              header: 'Supplier',
              cell: (r) => (
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-[12px] text-muted-foreground">{[r.contactPerson, r.city].filter(Boolean).join(' · ') || '—'}</div>
                </div>
              ),
            },
            { key: 'phone', header: 'Phone', cell: (r) => <span className="text-[12.5px]">{r.phone ?? '—'}</span> },
            { key: 'terms', header: 'Terms', cell: (r) => <span className="text-[12.5px] text-muted-foreground">{r.paymentTermsDays ? `${r.paymentTermsDays} days` : 'Cash'}</span> },
            { key: 'count', header: 'Purchases', align: 'right', cell: (r) => r.purchaseCount },
            { key: 'total', header: 'Total purchased', align: 'right', cell: (r) => <span className="text-muted-foreground">{f.money(r.totalPurchases)}</span> },
            { key: 'last', header: 'Last purchase', cell: (r) => <span className="text-[12.5px]">{r.lastPurchaseDate ? f.date(r.lastPurchaseDate) : '—'}</span> },
            { key: 'bal', header: 'Balance', align: 'right', cell: (r) => <span className={cn('font-semibold', r.balance > 0 ? 'text-warning' : r.balance < 0 ? 'text-info' : 'text-muted-foreground')}>{f.money(r.balance)}</span> },
            { key: 'st', header: '', cell: (r) => !r.isActive && <Badge>Inactive</Badge> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <SupplierSheet id={openId} onClose={() => setParams({})} onEdit={(s) => setEdit(s)} />
      <SupplierFormDialog value={edit} onClose={() => setEdit(null)} onSaved={(s) => setParams({ open: String(s.id) })} />
    </Page>
  );
}

function SupplierSheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (s: SupplierDetail) => void }) {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const [pay, setPay] = useState(false);
  const { data: s } = useApiQuery('suppliers.get', { id: id ?? 0 }, { enabled: !!id });
  const ledger = useApiQuery('suppliers.ledger', { id: id ?? 0 }, { enabled: !!id });
  const purchases = useApiQuery('purchases.list', { supplierId: id, page: 1, pageSize: 50, status: 'all' }, { enabled: !!id });
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} width="lg">
      {!s ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <SheetHeader
            icon={<Building2 />}
            title={s.name}
            subtitle={[s.contactPerson, s.city].filter(Boolean).join(' · ') || 'Supplier'}
            badges={!s.isActive ? <Badge>Inactive</Badge> : undefined}
            actions={
              <>
                {can('payments.manage') && (
                  <Button size="sm" variant="primary" icon={<HandCoins />} onClick={() => setPay(true)}>
                    Record payment
                  </Button>
                )}
                {can('purchases.manage') && (
                  <Button size="sm" icon={<Truck />} onClick={() => nav('/purchases/new')}>
                    New purchase
                  </Button>
                )}
                {can('suppliers.manage') && (
                  <Button size="sm" icon={<Pencil />} onClick={() => onEdit(s)}>
                    Edit
                  </Button>
                )}
              </>
            }
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4">
                <Stat label="Balance payable" value={f.money(s.balance)} tone={s.balance > 0 ? 'warning' : undefined} sub={s.balance < 0 ? 'Advance paid to supplier' : `Terms ${s.paymentTermsDays ? `${s.paymentTermsDays} days` : 'cash'}`} />
              </Card>
              <Card className="p-4">
                <Stat label="Total purchased" value={f.money(s.totalPurchases)} sub={`${s.purchaseCount} posted invoices`} />
              </Card>
              <Card className="p-4">
                <Stat label="Total paid" value={f.money(s.totalPaid)} sub={s.lastPurchaseDate ? `Last purchase ${f.date(s.lastPurchaseDate)}` : 'No purchases yet'} />
              </Card>
            </div>
            <Tabs defaultValue="ledger">
              <TabsList className="w-full">
                <TabsTrigger value="ledger">Ledger</TabsTrigger>
                <TabsTrigger value="purchases">Purchases</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <TabsContent value="ledger" className="pt-4">
                <LedgerTable ledger={ledger.data} debitLabel="Purchases (+)" creditLabel="Payments (−)" />
              </TabsContent>
              <TabsContent value="purchases" className="pt-4">
                <div className="space-y-1.5">
                  {purchases.data?.rows.map((p) => (
                    <button key={p.id} type="button" onClick={() => nav(`/purchases/${p.id}`)} className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-2.5 text-start text-[13px] hover:border-border-strong hover:bg-subtle">
                      <span>
                        <b className="font-semibold">{p.purchaseNo}</b> · {f.date(p.invoiceDate)} · inv {p.supplierInvoiceNo ?? '—'}
                      </span>
                      <span className="flex items-center gap-3">
                        <StatusBadge status={p.status} />
                        <span className="num w-28 text-end font-semibold">{f.money(p.total)}</span>
                      </span>
                    </button>
                  ))}
                  {purchases.data?.rows.length === 0 && <EmptyState compact title="No purchases yet" />}
                </div>
              </TabsContent>
              <TabsContent value="details" className="pt-4">
                <Card className="p-5">
                  <KeyValue
                    items={[
                      ['Contact person', s.contactPerson],
                      [<span className="inline-flex items-center gap-1"><Phone className="size-3" /> Phone</span>, s.phone],
                      [<span className="inline-flex items-center gap-1"><Mail className="size-3" /> Email</span>, s.email],
                      [<span className="inline-flex items-center gap-1"><MapPin className="size-3" /> Address</span>, [s.address, s.city].filter(Boolean).join(', ') || null],
                      ['NTN', s.ntn],
                      ['STRN', s.strn],
                      ['Drug licence', s.drugLicenseNo],
                      ['Opening balance', f.money(s.openingBalance)],
                    ]}
                  />
                  {s.notes && <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted-foreground">{s.notes}</p>}
                </Card>
              </TabsContent>
            </Tabs>
          </div>
          <PartyPaymentDialog open={pay} onClose={() => setPay(false)} party="supplier" id={s.id} name={s.name} balance={s.balance} />
        </>
      )}
    </Sheet>
  );
}

function SupplierFormDialog({ value, onClose, onSaved }: { value: SupplierDetail | 'new' | null; onClose: () => void; onSaved: (s: SupplierDetail) => void }) {
  const f = useFormat();
  const editing = value && value !== 'new' ? value : null;
  const blank = { name: '', contactPerson: '', phone: '', email: '', address: '', city: '', ntn: '', strn: '', drugLicenseNo: '', paymentTermsDays: 30 as number | null, openingBalance: 0 as number | null, notes: '', isActive: true };
  const [s, setS] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (value) {
      setErrors({});
      setS(
        editing
          ? { name: editing.name, contactPerson: editing.contactPerson ?? '', phone: editing.phone ?? '', email: editing.email ?? '', address: editing.address ?? '', city: editing.city ?? '', ntn: editing.ntn ?? '', strn: editing.strn ?? '', drugLicenseNo: editing.drugLicenseNo ?? '', paymentTermsDays: editing.paymentTermsDays, openingBalance: editing.openingBalance, notes: editing.notes ?? '', isActive: editing.isActive }
          : blank,
      );
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation('suppliers.save', { success: 'Supplier saved', onSuccess: (r) => (onSaved(r), onClose()), onError: (e) => setErrors(e.fields ?? {}) });
  const set = (k: keyof typeof s, v: unknown) => setS((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Building2 />} title={editing ? `Edit ${editing.name}` : 'New supplier'} />
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label="Supplier name" required error={errors.name} className="col-span-2">
            <Input autoFocus value={s.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} />
          </Field>
          <Field label="Contact person">
            <Input value={s.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={s.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input value={s.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={s.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Address" className="col-span-2">
            <Input value={s.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="NTN">
            <Input value={s.ntn} onChange={(e) => set('ntn', e.target.value)} />
          </Field>
          <Field label="Drug licence no.">
            <Input value={s.drugLicenseNo} onChange={(e) => set('drugLicenseNo', e.target.value)} />
          </Field>
          <Field label="Payment terms" hint="Days of credit allowed">
            <NumberInput value={s.paymentTermsDays} onChange={(v) => set('paymentTermsDays', v)} min={0} max={365} suffix="days" />
          </Field>
          <Field label="Opening balance" hint={editing ? 'Changing this posts an adjustment to the ledger' : 'Amount you already owe this supplier'}>
            <MoneyInput value={s.openingBalance} onChange={(v) => set('openingBalance', v)} symbol={f.symbol} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea value={s.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <div className="col-span-2">
            <SwitchRow label="Active" checked={s.isActive} onChange={(v) => set('isActive', v)} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!s.name.trim()}
            onClick={() =>
              save.mutate({
                id: editing?.id,
                name: s.name,
                contactPerson: s.contactPerson || null,
                phone: s.phone || null,
                email: s.email || null,
                address: s.address || null,
                city: s.city || null,
                ntn: s.ntn || null,
                strn: s.strn || null,
                drugLicenseNo: s.drugLicenseNo || null,
                paymentTermsDays: s.paymentTermsDays ?? 0,
                openingBalance: s.openingBalance ?? 0,
                notes: s.notes || null,
                isActive: s.isActive,
              })
            }
          >
            Save supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
