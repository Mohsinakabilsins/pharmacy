import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Ban, CheckCircle2, FileText, Info, Save, Trash2, Truck, Gift } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseDetail } from '@shared/types/purchasing';
import { todayLocal, addDays } from '@shared/dates';
import { api, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { queryClient, useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, KeyValue, Skeleton } from '@renderer/components/ui/display';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { DateInput, ExpiryInput, MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Tooltip } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { useConfirm } from '@renderer/components/ui/confirm';
import { ProductPicker } from '@renderer/components/ProductPicker';
import { StatusBadge, MethodLabel } from '@renderer/components/StatusBadges';
import { usePrint } from '@renderer/components/PrintProvider';
import { usePurchasePrefill } from './prefill';

interface Row {
  key: string;
  productId: number;
  name: string;
  generic: string | null;
  packSize: number;
  packName: string;
  unitName: string;
  batchNumber: string;
  expiryDate: string | null;
  manufactureDate: string | null;
  packs: number | null;
  bonusPacks: number | null;
  costPrice: number | null;
  salePrice: number | null;
  discountPct: number | null;
  taxPct: number | null;
}

let seq = 0;
const key = () => `r${Date.now().toString(36)}${seq++}`;

export function PurchaseEditorPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const existing = useApiQuery('purchases.get', { id: id ?? 0 }, { enabled: !!id });
  if (id && existing.isLoading) {
    return (
      <Page>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-64" />
      </Page>
    );
  }
  if (existing.data && existing.data.status !== 'DRAFT') return <PurchaseView p={existing.data} />;
  return <PurchaseForm draft={existing.data ?? null} />;
}

function PurchaseForm({ draft }: { draft: PurchaseDetail | null }) {
  const f = useFormat();
  const nav = useNavigate();
  const confirm = useConfirm();
  const take = usePurchasePrefill((s) => s.take);
  const suppliers = useApiQuery('suppliers.options');
  const [supplierId, setSupplierId] = useState<number | null>(draft?.supplierId ?? null);
  const [invoiceNo, setInvoiceNo] = useState(draft?.supplierInvoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState<string | null>(draft?.invoiceDate ?? todayLocal());
  const [dueDate, setDueDate] = useState<string | null>(draft?.dueDate ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [invoiceDiscount, setInvoiceDiscount] = useState<number | null>(draft?.invoiceDiscount ?? null);
  const [otherCharges, setOtherCharges] = useState<number | null>(draft?.otherCharges ?? null);
  const [rows, setRows] = useState<Row[]>(
    () =>
      draft?.items.map((i) => ({
        key: key(),
        productId: i.productId,
        name: i.productName,
        generic: i.genericName,
        packSize: i.packSize,
        packName: i.packName,
        unitName: i.unitName,
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate,
        manufactureDate: i.manufactureDate,
        packs: i.quantity / i.packSize,
        bonusPacks: i.bonusQuantity / i.packSize,
        costPrice: i.costPrice,
        salePrice: i.salePrice,
        discountPct: i.discountBp / 100,
        taxPct: i.taxRateBp / 100,
      })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [postOpen, setPostOpen] = useState(false);
  const supplier = useApiQuery('suppliers.get', { id: supplierId ?? 0 }, { enabled: !!supplierId });

  // prefill from the reorder planner
  useEffect(() => {
    if (draft) return;
    const pre = take();
    if (pre.items.length) {
      if (pre.supplierId) setSupplierId(pre.supplierId);
      void Promise.all(pre.items.map((i) => api('products.get', { id: i.productId }))).then((products) =>
        setRows(
          products.map((p, idx) => ({
            key: key(),
            productId: p.id,
            name: `${p.brandName}${p.strength ? ` ${p.strength}` : ''}`,
            generic: p.genericName,
            packSize: p.packSize,
            packName: p.packName,
            unitName: p.unitName,
            batchNumber: '',
            expiryDate: null,
            manufactureDate: null,
            packs: pre.items[idx].packs,
            bonusPacks: null,
            costPrice: pre.items[idx].costPrice ?? p.defaultCostPrice,
            salePrice: p.defaultSalePrice,
            discountPct: null,
            taxPct: null,
          })),
        ),
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (supplier.data && invoiceDate && !dueDate && supplier.data.paymentTermsDays > 0) setDueDate(addDays(invoiceDate, supplier.data.paymentTermsDays));
  }, [supplier.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcInput = useMemo(
    () => ({
      items: rows.map((r) => ({
        productId: r.productId,
        quantity: Math.round((r.packs ?? 0) * r.packSize),
        bonusQuantity: Math.round((r.bonusPacks ?? 0) * r.packSize),
        costPrice: r.costPrice ?? 0,
        discountBp: Math.round((r.discountPct ?? 0) * 100),
        discountAmount: 0,
        taxRateBp: Math.round((r.taxPct ?? 0) * 100),
      })),
      invoiceDiscount: invoiceDiscount ?? 0,
      otherCharges: otherCharges ?? 0,
    }),
    [rows, invoiceDiscount, otherCharges],
  );
  const dcalc = useDebounced(calcInput, 150);
  const totals = useApiQuery('purchases.calculate', dcalc, { enabled: rows.length > 0 });

  const update = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const payload = () => ({
    id: draft?.id,
    supplierId: supplierId ?? 0,
    supplierInvoiceNo: invoiceNo || null,
    invoiceDate: invoiceDate ?? todayLocal(),
    dueDate,
    invoiceDiscount: invoiceDiscount ?? 0,
    otherCharges: otherCharges ?? 0,
    notes: notes || null,
    items: rows.map((r) => ({
      productId: r.productId,
      batchNumber: r.batchNumber,
      manufactureDate: r.manufactureDate,
      expiryDate: r.expiryDate ?? '',
      quantity: Math.round((r.packs ?? 0) * r.packSize),
      bonusQuantity: Math.round((r.bonusPacks ?? 0) * r.packSize),
      costPrice: r.costPrice ?? 0,
      salePrice: r.salePrice ?? 0,
      discountBp: Math.round((r.discountPct ?? 0) * 100),
      discountAmount: 0,
      taxRateBp: Math.round((r.taxPct ?? 0) * 100),
    })),
  });

  const save = useApiMutation('purchases.saveDraft', {
    onError: (e) => setErrors(e.fields ?? {}),
  });
  const del = useApiMutation('purchases.deleteDraft', { success: 'Draft deleted', onSuccess: () => nav('/purchases') });

  const saveDraft = async (silent = false) => {
    setErrors({});
    const res = await save.mutateAsync(payload()).catch(() => null);
    if (res) {
      if (!silent) toast.success(`Draft ${res.purchaseNo} saved`);
      if (!draft) nav(`/purchases/${res.id}`, { replace: true });
    }
    return res;
  };

  const rowError = (idx: number, field: string) => errors[`items.${idx}.${field}`];
  const problems = rows.filter((r) => !r.batchNumber || !r.expiryDate || !r.packs || r.salePrice === null).length;
  const t = totals.data;

  return (
    <Page wide className="max-w-[1680px]">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => nav('/purchases')} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{draft ? draft.purchaseNo : 'New purchase'}</h1>
              <Badge tone="warning" dot>
                Draft
              </Badge>
            </div>
            <p className="text-[13px] text-muted-foreground">Enter the supplier invoice exactly as printed. Stock is added only when you post.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft && (
            <Button
              variant="ghost"
              icon={<Trash2 />}
              onClick={async () => {
                if ((await confirm({ title: 'Delete this draft?', description: 'Drafts have not affected stock or balances.', confirmLabel: 'Delete draft', tone: 'danger' })) !== false) del.mutate({ id: draft.id });
              }}
            >
              Delete draft
            </Button>
          )}
          <Button icon={<Save />} loading={save.isPending} disabled={!supplierId} onClick={() => void saveDraft()}>
            Save draft
          </Button>
          <Button variant="primary" icon={<CheckCircle2 />} disabled={!supplierId || rows.length === 0} onClick={() => setPostOpen(true)}>
            Review & post
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid grid-cols-4 gap-4">
              <Field label="Supplier" required error={errors.supplierId} className="col-span-2">
                <Select size="md" value={supplierId ? String(supplierId) : null} onChange={(v) => setSupplierId(v ? Number(v) : null)} placeholder="Select supplier" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
              </Field>
              <Field label="Supplier invoice no." error={errors.supplierInvoiceNo}>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. SI-44821" />
              </Field>
              <Field label="Invoice date" required error={errors.invoiceDate}>
                <DateInput value={invoiceDate} onChange={setInvoiceDate} max={todayLocal()} />
              </Field>
            </div>
            {supplier.data && (
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-muted-foreground">
                <span>
                  Balance <b className={cn('num font-semibold', supplier.data.balance > 0 ? 'text-warning' : 'text-foreground')}>{f.money(supplier.data.balance)}</b>
                </span>
                <span>Terms {supplier.data.paymentTermsDays ? `${supplier.data.paymentTermsDays} days` : 'cash'}</span>
                {supplier.data.phone && <span>{supplier.data.phone}</span>}
                {supplier.data.lastPurchaseDate && <span>Last purchase {f.date(supplier.data.lastPurchaseDate)}</span>}
              </div>
            )}
          </Card>

          <Card className="overflow-visible">
            <CardHeader title="Items" description="Quantities in packs. Bonus packs are free goods — they lower the landed unit cost." actions={<span className="num text-[12.5px] text-muted-foreground">{rows.length} lines</span>} />
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[1100px] text-[13px]">
                <thead className="bg-subtle text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start">Product</th>
                    <th className="w-[130px] px-2 py-2.5 text-start">Batch</th>
                    <th className="w-[104px] px-2 py-2.5 text-start">Expiry</th>
                    <th className="w-[84px] px-2 py-2.5 text-end">Qty</th>
                    <th className="w-[76px] px-2 py-2.5 text-end">Bonus</th>
                    <th className="w-[118px] px-2 py-2.5 text-end">Cost / pack</th>
                    <th className="w-[118px] px-2 py-2.5 text-end">MRP / pack</th>
                    <th className="w-[74px] px-2 py-2.5 text-end">Disc %</th>
                    {f.settings.tax.enabled && <th className="w-[70px] px-2 py-2.5 text-end">Tax %</th>}
                    <th className="w-[112px] px-3 py-2.5 text-end">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rows.map((r, idx) => {
                    const line = t?.rows[idx];
                    const margin = r.salePrice && line ? ((r.salePrice - line.landedCostPrice) / r.salePrice) * 100 : null;
                    return (
                      <tr key={r.key} className="align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold">{r.name}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {r.generic ?? '—'} · {r.packSize > 1 ? `${r.packSize} ${r.unitName.toLowerCase()}s/${r.packName.toLowerCase()}` : r.packName}
                          </div>
                          {line && (
                            <Tooltip content="Landed cost includes discounts, bonus units and the share of invoice discount / charges">
                              <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                                <Info className="size-3" />
                                Landed {f.money(line.landedCostPrice)}
                                {margin !== null && <span className={cn('ms-1 font-medium', margin < 5 ? 'text-danger' : margin < 15 ? 'text-warning' : 'text-success')}>· {margin.toFixed(1)}% margin</span>}
                              </div>
                            </Tooltip>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Input inputSize="sm" className="font-mono uppercase" value={r.batchNumber} onChange={(e) => update(r.key, { batchNumber: e.target.value.toUpperCase() })} invalid={!!rowError(idx, 'batchNumber')} placeholder="Batch" data-batch={r.key} />
                        </td>
                        <td className="px-2 py-2">
                          <ExpiryInput size="sm" value={r.expiryDate} onChange={(v) => update(r.key, { expiryDate: v })} invalid={!!rowError(idx, 'expiryDate')} />
                        </td>
                        <td className="px-2 py-2">
                          <NumberInput size="sm" value={r.packs} onChange={(v) => update(r.key, { packs: v })} min={0} allowDecimal={r.packSize > 1} invalid={!!rowError(idx, 'quantity')} />
                        </td>
                        <td className="px-2 py-2">
                          <NumberInput size="sm" value={r.bonusPacks} onChange={(v) => update(r.key, { bonusPacks: v })} min={0} allowDecimal={r.packSize > 1} placeholder="0" />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput size="sm" value={r.costPrice} onChange={(v) => update(r.key, { costPrice: v })} symbol={f.symbol} />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput size="sm" value={r.salePrice} onChange={(v) => update(r.key, { salePrice: v })} symbol={f.symbol} invalid={!!rowError(idx, 'salePrice')} />
                        </td>
                        <td className="px-2 py-2">
                          <NumberInput size="sm" value={r.discountPct} onChange={(v) => update(r.key, { discountPct: v })} min={0} max={100} allowDecimal placeholder="0" />
                        </td>
                        {f.settings.tax.enabled && (
                          <td className="px-2 py-2">
                            <NumberInput size="sm" value={r.taxPct} onChange={(v) => update(r.key, { taxPct: v })} min={0} max={100} allowDecimal placeholder="0" />
                          </td>
                        )}
                        <td className="num px-3 py-2.5 text-end">
                          <div className="font-semibold">{line ? f.money(line.lineTotal, { symbol: false }) : '—'}</div>
                          {(r.bonusPacks ?? 0) > 0 && (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-success">
                              <Gift className="size-3" />+{r.bonusPacks} free
                            </div>
                          )}
                        </td>
                        <td className="pe-2 pt-2">
                          <Button size="icon-sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove line">
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <EmptyState compact icon={<Truck />} title="No items yet" description="Search for a product below to add it to this invoice." />}
            </div>
            <div className="border-t border-border p-4">
              <ProductPicker
                autoFocus={!!draft || rows.length > 0 ? false : true}
                onPick={(p) => {
                  const k = key();
                  setRows((rs) => [
                    ...rs,
                    {
                      key: k,
                      productId: p.id,
                      name: `${p.brandName}${p.strength ? ` ${p.strength}` : ''}`,
                      generic: p.genericName,
                      packSize: p.packSize,
                      packName: p.packName,
                      unitName: p.unitName,
                      batchNumber: '',
                      expiryDate: null,
                      manufactureDate: null,
                      packs: null,
                      bonusPacks: null,
                      costPrice: null,
                      salePrice: p.price,
                      discountPct: null,
                      taxPct: f.settings.tax.enabled ? p.taxRateBp / 100 : null,
                    },
                  ]);
                  void api('products.get', { id: p.id }).then((d) => update(k, { costPrice: d.defaultCostPrice, salePrice: d.defaultSalePrice }));
                  setTimeout(() => (document.querySelector(`[data-batch="${k}"]`) as HTMLInputElement | null)?.focus(), 60);
                }}
              />
            </div>
          </Card>
          <Card className="p-5">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery notes, terms, remarks…" />
            </Field>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="sticky top-4 p-5">
            <h3 className="text-[14px] font-semibold">Invoice summary</h3>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              <SumRow label="Gross amount" value={f.money(t?.subtotal ?? 0)} />
              <SumRow label="Line discounts" value={`−${f.money(t?.discountTotal ?? 0)}`} />
              {f.settings.tax.enabled && <SumRow label="Tax" value={f.money(t?.taxTotal ?? 0)} />}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Invoice discount</dt>
                <MoneyInput size="sm" className="w-32" value={invoiceDiscount} onChange={setInvoiceDiscount} symbol={f.symbol} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Freight / other</dt>
                <MoneyInput size="sm" className="w-32" value={otherCharges} onChange={setOtherCharges} symbol={f.symbol} />
              </div>
            </dl>
            <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
              <span className="text-[13px] font-semibold text-muted-foreground">Invoice total</span>
              <span className="num text-[26px] font-semibold tracking-tight">{f.money(t?.total ?? 0)}</span>
            </div>
            <div className="mt-4">
              <Field label="Payment due">
                <DateInput value={dueDate} onChange={setDueDate} />
              </Field>
            </div>
            {problems > 0 && (
              <Alert tone="warning" className="mt-4">
                {problems} line{problems === 1 ? '' : 's'} missing batch, expiry, quantity or price.
              </Alert>
            )}
          </Card>
        </div>
      </div>

      <PostDialog
        open={postOpen}
        onClose={() => setPostOpen(false)}
        total={t?.total ?? 0}
        onPost={async (paidAmount, method, reference) => {
          const saved = await saveDraft(true);
          if (!saved) {
            setPostOpen(false);
            return;
          }
          try {
            const posted = await api('purchases.post', { id: saved.id, paidAmount, paymentMethod: method, paymentReference: reference || null });
            toast.success(`${posted.purchaseNo} posted — ${posted.items.length} batches received`);
            void queryClient.invalidateQueries();
            setPostOpen(false);
            nav(`/purchases/${posted.id}`, { replace: true });
          } catch (e) {
            const err = e as { fields?: Record<string, string> };
            if (err.fields) setErrors(err.fields);
            toast.error(errorMessage(e));
            setPostOpen(false);
          }
        }}
      />
    </Page>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}

function PostDialog({ open, onClose, total, onPost }: { open: boolean; onClose: () => void; total: number; onPost: (paid: number, method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CHEQUE', reference: string) => Promise<void> }) {
  const f = useFormat();
  const [paid, setPaid] = useState<number | null>(0);
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CHEQUE'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPaid(0);
      setReference('');
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<CheckCircle2 />} title="Post purchase" description="Posting receives the stock into batches and adds the invoice to the supplier balance. Posted purchases cannot be edited — only voided." />
        <DialogBody className="space-y-4">
          <div className="flex items-end justify-between rounded-xl bg-subtle px-4 py-3 ring-1 ring-border">
            <span className="text-[13px] text-muted-foreground">Invoice total</span>
            <span className="num text-[22px] font-semibold">{f.money(total)}</span>
          </div>
          <Field label="Amount paid now" hint="Leave 0 to add the full amount to the supplier's payable balance.">
            <div className="flex gap-2">
              <MoneyInput className="flex-1" value={paid} onChange={setPaid} symbol={f.symbol} />
              <Button onClick={() => setPaid(total)}>Full</Button>
            </div>
          </Field>
          {(paid ?? 0) > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <Select value={method} onChange={(v) => v && setMethod(v as typeof method)} options={['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_WALLET', 'CARD'].map((m) => ({ value: m, label: <MethodLabel method={m} /> }))} />
              </Field>
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / txn no." />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={(paid ?? 0) > total}
            onClick={async () => {
              setBusy(true);
              await onPost(paid ?? 0, method, reference);
              setBusy(false);
            }}
          >
            Post purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseView({ p }: { p: PurchaseDetail }) {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const confirm = useConfirm();
  const printer = usePrint();
  const voidM = useApiMutation('purchases.void', { success: 'Purchase voided — stock and balances reversed' });
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => nav('/purchases')} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{p.purchaseNo}</h1>
              <StatusBadge status={p.status} />
            </div>
            <p className="text-[13px] text-muted-foreground">
              {p.supplierName} · invoice {p.supplierInvoiceNo ?? '—'} · {f.date(p.invoiceDate)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button icon={<FileText />} onClick={() => printer.preview({ channel: 'print.purchase', id: p.id, title: p.purchaseNo, format: 'a4' })}>
            Print
          </Button>
          {can('purchases.void') && p.status === 'POSTED' && (
            <Tooltip content={p.canVoid ? undefined : p.voidBlockReason}>
              <span>
                <Button
                  variant="danger-soft"
                  icon={<Ban />}
                  disabled={!p.canVoid}
                  loading={voidM.isPending}
                  onClick={async () => {
                    const reason = await confirm({ title: `Void ${p.purchaseNo}?`, description: 'Received stock is removed from its batches, the supplier balance is reversed and any payment made on posting is voided.', tone: 'danger', confirmLabel: 'Void purchase', requireReason: true });
                    if (reason !== false) voidM.mutate({ id: p.id, reason });
                  }}
                >
                  Void
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      {p.status === 'VOID' && (
        <Alert tone="danger" icon={<Ban />} className="mb-4" title={`Voided ${f.dateTime(p.voidedAt)} by ${p.voidedByName}`}>
          {p.voidReason}
        </Alert>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-start font-semibold">Product</th>
                <th className="px-3 py-2.5 text-start font-semibold">Batch</th>
                <th className="px-3 py-2.5 text-start font-semibold">Expiry</th>
                <th className="px-3 py-2.5 text-end font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-end font-semibold">Bonus</th>
                <th className="px-3 py-2.5 text-end font-semibold">Cost</th>
                <th className="px-3 py-2.5 text-end font-semibold">Landed</th>
                <th className="px-3 py-2.5 text-end font-semibold">MRP</th>
                <th className="px-4 py-2.5 text-end font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{i.productName}</div>
                    <div className="text-[11.5px] text-muted-foreground">{i.productCode}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">{i.batchNumber}</td>
                  <td className="num px-3 py-2.5">{f.expiry(i.expiryDate)}</td>
                  <td className="num px-3 py-2.5 text-end">{f.qty(i.quantity, i.packSize, i.unitName, i.packName)}</td>
                  <td className="num px-3 py-2.5 text-end text-success">{i.bonusQuantity ? f.qty(i.bonusQuantity, i.packSize, i.unitName, i.packName) : '—'}</td>
                  <td className="num px-3 py-2.5 text-end">{f.money(i.costPrice, { symbol: false })}</td>
                  <td className="num px-3 py-2.5 text-end text-muted-foreground">{f.money(i.landedCostPrice, { symbol: false })}</td>
                  <td className="num px-3 py-2.5 text-end">{f.money(i.salePrice, { symbol: false })}</td>
                  <td className="num px-4 py-2.5 text-end font-semibold">{f.money(i.lineTotal, { symbol: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <dl className="space-y-2.5 text-[13px]">
              <SumRow label="Gross" value={f.money(p.subtotal)} />
              <SumRow label="Line discounts" value={`−${f.money(p.discountTotal)}`} />
              {p.taxTotal > 0 && <SumRow label="Tax" value={f.money(p.taxTotal)} />}
              {p.invoiceDiscount > 0 && <SumRow label="Invoice discount" value={`−${f.money(p.invoiceDiscount)}`} />}
              {p.otherCharges > 0 && <SumRow label="Other charges" value={f.money(p.otherCharges)} />}
            </dl>
            <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
              <span className="text-[13px] font-semibold text-muted-foreground">Total</span>
              <span className="num text-[24px] font-semibold">{f.money(p.total)}</span>
            </div>
          </Card>
          <Card className="p-5">
            <KeyValue
              cols={1}
              items={[
                ['Supplier balance now', <span className="num">{f.money(p.supplierBalance)}</span>],
                ['Due date', p.dueDate ? f.date(p.dueDate) : '—'],
                ['Posted', p.postedAt ? `${f.dateTime(p.postedAt)} by ${p.postedByName}` : '—'],
                ['Created by', p.createdByName],
              ]}
            />
            {p.payments.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Payments</div>
                {p.payments.map((pay) => (
                  <div key={pay.id} className="flex items-center justify-between py-1 text-[13px]">
                    <span>
                      {pay.paymentNo} · <MethodLabel method={pay.method} />
                    </span>
                    <span className={cn('num font-medium', pay.status === 'VOID' && 'text-muted-foreground line-through')}>{f.money(pay.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {p.notes && <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted-foreground">{p.notes}</p>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
