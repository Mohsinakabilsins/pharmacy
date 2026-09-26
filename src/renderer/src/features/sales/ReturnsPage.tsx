import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Printer, Search, Undo2, PackageCheck, Trash } from 'lucide-react';
import { toast } from 'sonner';
import type { SaleDetail } from '@shared/types/sales';
import { api, ApiError, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { queryClient, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Alert, Card, EmptyState } from '@renderer/components/ui/display';
import { Button } from '@renderer/components/ui/button';
import { Input, Textarea } from '@renderer/components/ui/input';
import { Field } from '@renderer/components/ui/field';
import { NumberInput, SearchInput } from '@renderer/components/ui/inputs';
import { Checkbox, Segmented } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { MethodLabel } from '@renderer/components/StatusBadges';
import { useOverride } from '@renderer/components/OverrideProvider';
import { usePrint } from '@renderer/components/PrintProvider';

const REASONS = ['Customer changed mind', 'Wrong item dispensed', 'Doctor changed prescription', 'Damaged / defective', 'Adverse reaction', 'Near expiry at sale'];

export function ReturnsPage() {
  const f = useFormat();
  const [params, setParams] = useSearchParams();
  const printer = usePrint();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState(presetRange('month'));
  const [page, setPage] = useState(1);
  const [openNew, setOpenNew] = useState(!!params.get('invoice'));
  const ds = useDebounced(search, 200);
  const { data, isLoading } = useApiQuery('returns.list', { search: ds, from: range.from, to: range.to, page, pageSize: 25 });

  return (
    <Page>
      <PageHeader
        title="Sales returns"
        description="Refunds against invoices — stock goes back to the original batch, or is written off when disposed."
        icon={<Undo2 />}
        actions={
          <Button variant="primary" icon={<Undo2 />} onClick={() => setOpenNew(true)}>
            New return
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="text-[12.5px] text-muted-foreground">Refunded <b className="num font-semibold text-foreground">{f.money(data.totalAmount)}</b></span>}>
          <SearchInput value={search} onChange={setSearch} placeholder="Return no., invoice, customer, reason" />
          <DateRangePicker value={range} onChange={setRange} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => printer.preview({ channel: 'print.return', id: r.id, title: `Return ${r.returnNo}`, format: 'receipt' })}
          empty={<EmptyState icon={<Undo2 />} title="No returns in this period" description="Returns processed against invoices appear here." />}
          columns={[
            { key: 'no', header: 'Return', cell: (r) => <span className="font-semibold">{r.returnNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted-foreground">{f.dateTime(r.createdAt)}</span> },
            { key: 'inv', header: 'Invoice', cell: (r) => r.invoiceNo },
            { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted-foreground">Walk-in</span> },
            { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-1">{r.reason}</span> },
            { key: 'method', header: 'Refund', cell: (r) => <MethodLabel method={r.refundMethod} /> },
            { key: 'by', header: 'By', cell: (r) => r.createdByName },
            { key: 'total', header: 'Amount', align: 'right', cell: (r) => <span className="font-semibold text-danger">−{f.money(r.total)}</span> },
            { key: 'p', header: '', cell: () => <Printer className="size-4 text-muted-foreground" /> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <NewReturnDialog
        open={openNew}
        initialInvoice={params.get('invoice') ?? ''}
        onClose={() => {
          setOpenNew(false);
          if (params.get('invoice')) setParams({});
        }}
      />
    </Page>
  );
}

function NewReturnDialog({ open, onClose, initialInvoice }: { open: boolean; onClose: () => void; initialInvoice: string }) {
  const f = useFormat();
  const printer = usePrint();
  const requestOverride = useOverride();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CUSTOMER_ACCOUNT'>('CASH');
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (inv = invoice) => {
    setLookupError(null);
    setSale(null);
    try {
      const s = await api('sales.byInvoice', { invoiceNo: inv });
      setSale(s);
      setQty({});
      setRestock(Object.fromEntries(s.items.map((i) => [i.id, true])));
      setMethod(s.creditAmount > 0 && s.customerId ? 'CUSTOMER_ACCOUNT' : 'CASH');
    } catch (e) {
      setLookupError(errorMessage(e));
    }
  };

  useEffect(() => {
    if (open && initialInvoice) {
      setInvoice(initialInvoice);
      void lookup(initialInvoice);
    }
    if (!open) {
      setSale(null);
      setInvoice('');
    }
  }, [open, initialInvoice]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = sale?.items.filter((i) => i.quantity - i.returnedQuantity > 0) ?? [];
  const selected = Object.entries(qty).filter(([, q]) => q > 0);
  const estimate = sale
    ? selected.reduce((s, [id, q]) => {
        const it = sale.items.find((i) => i.id === Number(id))!;
        return s + Math.round((it.lineTotal * q) / it.quantity);
      }, 0)
    : 0;

  const submit = async () => {
    if (!sale) return;
    setBusy(true);
    let token: string | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await api('returns.create', {
            saleId: sale.id,
            items: selected.map(([id, q]) => ({ saleItemId: Number(id), quantity: q, restock: restock[Number(id)] ?? true })),
            refundMethod: method,
            reason: notes ? `${reason} — ${notes}` : reason,
            notes: null,
            overrideToken: token,
          });
          toast.success(`Return ${r.returnNo} recorded — refund ${f.money(r.total)}`);
          void queryClient.invalidateQueries();
          onClose();
          printer.preview({ channel: 'print.return', id: r.id, title: `Return ${r.returnNo}`, format: 'receipt' });
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED' && attempt === 0) {
            token = await requestOverride('returns.override', 'This invoice is outside the return window.');
            if (!token) return;
          } else throw e;
        }
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Undo2 />} title="Process a return" description="Find the original invoice, choose the items and quantities being returned." />
        <DialogBody className="space-y-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <Input autoFocus inputSize="lg" className="flex-1" leading={<Search />} placeholder="Scan or type the invoice number (e.g. INV-000123)" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
            <Button type="submit" size="lg" disabled={!invoice.trim()}>
              Find invoice
            </Button>
          </form>
          {lookupError && <Alert tone="danger">{lookupError}</Alert>}
          {sale && sale.status === 'VOID' && <Alert tone="danger">This invoice was voided — nothing can be returned.</Alert>}
          {sale && sale.status !== 'VOID' && (
            <>
              <div className="flex items-center justify-between rounded-xl bg-subtle px-4 py-3 ring-1 ring-border">
                <div className="text-[13px]">
                  <b className="font-semibold">{sale.invoiceNo}</b> · {f.dateTime(sale.createdAt)} · {sale.customerName ?? 'Walk-in'}
                </div>
                <div className="num text-[13px]">
                  Paid <b>{f.money(sale.total)}</b>
                </div>
              </div>
              {items.length === 0 ? (
                <EmptyState compact icon={<PackageCheck />} title="Everything on this invoice has already been returned" />
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-start font-semibold">Item</th>
                        <th className="px-3 py-2.5 text-end font-semibold">Returnable</th>
                        <th className="w-32 px-3 py-2.5 text-center font-semibold">Return qty</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Back to stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {items.map((i) => {
                        const max = i.quantity - i.returnedQuantity;
                        return (
                          <tr key={i.id} className={cn((qty[i.id] ?? 0) > 0 && 'bg-primary-soft/40')}>
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{i.productName}</div>
                              <div className="text-[11.5px] text-muted-foreground">
                                Batch {i.batchNumber} · Exp {f.expiry(i.expiryDate)} · {f.money(i.lineTotal)} for {i.quantity}
                              </div>
                            </td>
                            <td className="num px-3 py-2.5 text-end">{max}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <NumberInput size="sm" value={qty[i.id] ?? 0} min={0} max={max} onChange={(v) => setQty((s) => ({ ...s, [i.id]: v ?? 0 }))} />
                                <Button size="xs" variant="ghost" onClick={() => setQty((s) => ({ ...s, [i.id]: max }))}>
                                  All
                                </Button>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <label className="inline-flex items-center gap-2 text-[12.5px]">
                                <Checkbox checked={restock[i.id] ?? true} onChange={(v) => setRestock((s) => ({ ...s, [i.id]: v }))} />
                                {restock[i.id] ?? true ? 'Restock' : (
                                  <span className="inline-flex items-center gap-1 text-danger">
                                    <Trash className="size-3" /> Dispose
                                  </span>
                                )}
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Refund method">
                  <Segmented
                    value={method}
                    onChange={setMethod}
                    options={[
                      { value: 'CASH', label: 'Cash' },
                      { value: 'CARD', label: 'Card' },
                      { value: 'MOBILE_WALLET', label: 'Wallet' },
                      ...(sale.customerId ? [{ value: 'CUSTOMER_ACCOUNT' as const, label: 'Account' }] : []),
                    ]}
                  />
                </Field>
                <Field label="Reason">
                  <select className="h-9 rounded-lg border border-input bg-card px-3 text-[13.5px] outline-none focus:border-ring" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Notes (optional)" className="col-span-2">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[56px]" />
                </Field>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter aside={selected.length > 0 && <span>Estimated refund <b className="num text-foreground">{f.money(estimate)}</b></span>}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!sale || selected.length === 0} onClick={() => void submit()} icon={<Undo2 />}>
            Record return & refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
