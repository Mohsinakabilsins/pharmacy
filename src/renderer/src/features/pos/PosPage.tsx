import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, FileHeart, History, PauseCircle, Percent, Printer, ScanBarcode, ShieldCheck, Trash2, UserRound, X, Pill, Keyboard } from 'lucide-react';
import { api, ApiError, errorMessage } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { useFormat } from '@renderer/lib/format';
import { useHotkeys } from '@renderer/lib/hotkeys';
import { useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { Button } from '@renderer/components/ui/button';
import { Badge, Kbd } from '@renderer/components/ui/display';
import { Popover, PopoverContent, PopoverTrigger, Segmented } from '@renderer/components/ui/controls';
import { MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { useConfirm } from '@renderer/components/ui/confirm';
import { useOverride } from '@renderer/components/OverrideProvider';
import { usePrint } from '@renderer/components/PrintProvider';
import type { SaleCompleted } from '@shared/types/sales';
import { draftOf, usePos } from './store';
import { ProductSearch, type ProductSearchHandle } from './ProductSearch';
import { CartTable } from './CartTable';
import { PaymentDialog, type PaymentResult } from './PaymentDialog';
import { CustomerPickerDialog, HeldBillsDialog, HoldDialog, PrescriptionLinkDialog, SaleCompleteDialog, ShiftGate } from './PosDialogs';

type DialogName = 'customer' | 'held' | 'hold' | 'rx' | 'pay' | null;

export function PosPage() {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const requestOverride = useOverride();
  const printer = usePrint();
  const searchRef = useRef<ProductSearchHandle>(null);
  const state = usePos();
  const draft = draftOf(state);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [completed, setCompleted] = useState<SaleCompleted | null>(null);
  const [busy, setBusy] = useState(false);

  const quoteQ = useApiQuery('pos.quote', draft, { enabled: state.lines.length > 0 || !!state.customerId, staleTime: 0, refetchOnMount: 'always' });
  const quote = state.lines.length > 0 ? quoteQ.data : undefined;
  const shift = useApiQuery('cash.current');
  const settings = f.settings;
  const needsShift = settings.sales.requireOpenShift && shift.isFetched && !shift.data;

  // fill in product details for lines restored from a held bill
  useEffect(() => {
    if (!quote) return;
    for (const l of state.lines) {
      const q = quote.lines.find((x) => x.key === l.key);
      if (q && l.name === 'Loading…') state.update(l.key, { name: q.productName, packSize: q.packSize, unitName: q.unitName, packName: q.packName, allowLooseSale: q.allowLooseSale, unitMode: l.quantity % q.packSize === 0 ? 'pack' : 'unit' });
    }
    if (quote.customer && !state.customerName) state.setCustomer(quote.customer.id, quote.customer.name);
  }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusSearch = () => searchRef.current?.focus();
  const blockingOverride = quote?.requiredOverrides ?? [];
  const globalErrors = quote?.issues.filter((i) => i.severity === 'error') ?? [];

  const startPayment = () => {
    if (!quote || state.lines.length === 0) return toast.info('Add items to the bill first');
    if (quoteQ.isFetching) return;
    if (!quote.canComplete) {
      const first = [...quote.issues, ...quote.lines.flatMap((l) => l.issues)].find((i) => i.severity === 'error');
      return toast.error(first?.message ?? 'Resolve the highlighted issues before payment');
    }
    setDialog('pay');
  };

  const complete = async (p: PaymentResult) => {
    if (!quote) return;
    setBusy(true);
    try {
      const res = await api('pos.complete', { ...draft, payments: p.payments, cashTendered: p.cashTendered, expectedTotal: quote.total });
      setDialog(null);
      state.clear();
      setCompleted(res);
      void qc.invalidateQueries();
      if (settings.receipt.autoPrint) void printer.print({ channel: 'print.sale', id: res.saleId, format: 'receipt' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUOTE_CHANGED') {
        toast.warning(e.message);
        setDialog(null);
        void quoteQ.refetch();
      } else if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED') {
        const perms = (e.data?.permissions as string[] | undefined) ?? [];
        for (const perm of perms) {
          const token = await requestOverride(perm);
          if (!token) break;
          state.addToken(token);
        }
      } else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hold = async (label: string) => {
    try {
      await api('pos.hold', { label, customerId: state.customerId, draft, totalEstimate: quote?.total ?? 0 });
      state.clear();
      setDialog(null);
      toast.success('Bill held — find it under Held bills (F7)');
      void qc.invalidateQueries({ queryKey: ['pos.held'] });
      focusSearch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const resume = async (id: number) => {
    if (state.lines.length > 0) {
      const ok = await confirm({ title: 'Replace current bill?', description: 'The current bill has items. Hold it first if you want to keep it.', confirmLabel: 'Replace', tone: 'warning' });
      if (ok === false) return;
    }
    try {
      const d = await api('pos.resume', { id });
      state.load({ lines: d.lines.map((l) => ({ ...l, batchId: l.batchId ?? null, unitPrice: l.unitPrice ?? null, discount: l.discount ?? null })), customerId: d.customerId, invoiceDiscount: d.invoiceDiscount ?? null, prescriptionId: d.prescriptionId });
      setDialog(null);
      void qc.invalidateQueries({ queryKey: ['pos.held'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const clear = async () => {
    if (state.lines.length === 0) return;
    const ok = await confirm({ title: 'Clear this bill?', description: 'All items will be removed. Nothing is saved.', confirmLabel: 'Clear bill', tone: 'danger' });
    if (ok !== false) {
      state.clear();
      focusSearch();
    }
  };

  const reprint = async () => {
    const id = await api('sales.last');
    if (id) printer.preview({ channel: 'print.sale', id, title: 'Reprint last receipt', format: 'receipt', allowFormats: true });
    else toast.info('No previous sale to reprint');
  };

  const moveSelection = (dir: 1 | -1) => {
    const idx = state.lines.findIndex((l) => l.key === state.selected);
    const next = state.lines[Math.max(0, Math.min(state.lines.length - 1, idx + dir))];
    if (next) state.select(next.key);
  };
  const bump = (dir: 1 | -1) => {
    const l = state.lines.find((x) => x.key === state.selected);
    if (!l) return;
    const step = l.unitMode === 'pack' ? l.packSize : 1;
    if (l.quantity + dir * step > 0) state.update(l.key, { quantity: l.quantity + dir * step });
  };

  useHotkeys(
    {
      F2: focusSearch,
      F4: () => setDialog('customer'),
      F5: () => setDialog('rx'),
      F6: () => state.lines.length && setDialog('hold'),
      F7: () => setDialog('held'),
      F9: startPayment,
      F10: () => void reprint(),
      'Ctrl+Delete': () => void clear(),
      'Ctrl+ArrowDown': () => moveSelection(1),
      'Ctrl+ArrowUp': () => moveSelection(-1),
      'Ctrl+=': () => bump(1),
      'Ctrl+-': () => bump(-1),
      Delete: () => state.selected && state.remove(state.selected),
      '+': () => bump(1),
      '-': () => bump(-1),
    },
    [state, quote, quoteQ.isFetching],
    !completed && dialog === null,
  );

  return (
    <div className="relative flex h-full">
      {needsShift && <ShiftGate />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border bg-background px-6 pb-4 pt-5">
          <ProductSearch ref={searchRef} onPick={(p) => state.add(p)} disabled={needsShift} />
        </div>
        {state.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10">
            <div className="relative">
              <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative flex size-20 items-center justify-center rounded-3xl border border-border bg-card shadow-pop">
                <ScanBarcode className="size-9 text-primary" />
              </div>
            </div>
            <h2 className="mt-6 text-[18px] font-semibold tracking-tight">Ready for the next customer</h2>
            <p className="mt-1.5 max-w-sm text-center text-[13.5px] text-muted-foreground">Scan a barcode or start typing a medicine name. Stock is picked automatically from the batch that expires first.</p>
            <div className="mt-8 grid grid-cols-3 gap-x-8 gap-y-2.5 text-[12.5px] text-muted-foreground">
              {[
                ['F2', 'Search'],
                ['F4', 'Customer'],
                ['F5', 'Prescription'],
                ['F6', 'Hold bill'],
                ['F7', 'Held bills'],
                ['F9', 'Payment'],
                ['F10', 'Reprint last'],
                ['Del', 'Remove line'],
                ['Ctrl+Del', 'Clear bill'],
              ].map(([k, l]) => (
                <div key={k} className="flex items-center gap-2">
                  <Kbd className="min-w-9">{k}</Kbd>
                  {l}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <CartTable quote={quote} />
        )}
      </div>

      {/* Checkout panel */}
      <aside className="flex w-[400px] shrink-0 flex-col border-s border-border bg-card">
        <div className="space-y-2.5 border-b border-border p-4">
          <button type="button" onClick={() => setDialog('customer')} className="flex w-full items-center gap-3 rounded-xl border border-border bg-subtle px-3.5 py-3 text-start transition hover:border-border-strong">
            <span className={cn('flex size-9 items-center justify-center rounded-full', state.customerId ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-muted text-muted-foreground')}>
              <UserRound className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold">{state.customerName ?? quote?.customer?.name ?? settings.sales.walkInLabel}</span>
              <span className="block text-[12px] text-muted-foreground">
                {quote?.customer ? (
                  <>
                    Balance <b className={cn('font-semibold', quote.customer.balance > 0 && 'text-warning')}>{f.money(quote.customer.balance)}</b>
                    {quote.customer.creditLimit > 0 && ` · limit ${f.money(quote.customer.creditLimit)}`}
                  </>
                ) : (
                  'Press F4 to select a customer'
                )}
              </span>
            </span>
            {state.customerId ? (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  state.setCustomer(null, null);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </span>
            ) : (
              <Kbd>F4</Kbd>
            )}
          </button>
          {can('prescriptions.view') && (
            <button type="button" onClick={() => setDialog('rx')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-[12.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <FileHeart className="size-4" />
              <span className="flex-1">{state.prescriptionId ? <span className="font-medium text-foreground">Prescription {state.prescriptionNo ?? `#${state.prescriptionId}`} linked</span> : 'Link a prescription'}</span>
              <Kbd>F5</Kbd>
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {globalErrors.filter((i) => i.code !== 'SHIFT_REQUIRED').map((i) => (
            <div key={i.code} className="mb-2.5 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <span className="flex-1">{i.message}</span>
              {i.permission && (
                <Button
                  size="xs"
                  variant="danger"
                  icon={<ShieldCheck />}
                  onClick={async () => {
                    const t = await requestOverride(i.permission!);
                    if (t) state.addToken(t);
                  }}
                >
                  Authorise
                </Button>
              )}
            </div>
          ))}
          {blockingOverride.length > 0 && globalErrors.length === 0 && (
            <div className="mb-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning">Some items need supervisor authorisation — see the highlighted lines.</div>
          )}
          <dl className="space-y-2.5 text-[13.5px]">
            <Row label={`Subtotal${quote ? ` · ${quote.lines.length} item${quote.lines.length === 1 ? '' : 's'}` : ''}`} value={f.money(quote?.subtotal ?? 0)} />
            <div className="flex items-center justify-between">
              <InvoiceDiscount />
              <span className={cn('num', (quote?.discountTotal ?? 0) > 0 && 'font-medium text-success')}>{(quote?.discountTotal ?? 0) > 0 ? `−${f.money(quote!.discountTotal)}` : f.money(0)}</span>
            </div>
            {quote?.taxEnabled && <Row label={quote.taxLabel} value={f.money(quote.taxTotal)} />}
            {quote && quote.roundOff !== 0 && <Row label="Rounding" value={f.money(quote.roundOff, { signed: true })} />}
          </dl>
        </div>

        <div className="border-t border-border bg-subtle p-4">
          <div className="flex items-end justify-between">
            <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
            <span className="num text-[38px] font-semibold leading-none tracking-[-0.025em]">{f.money(quote?.total ?? 0)}</span>
          </div>
          <Button variant="primary" size="xl" className="mt-4 w-full" icon={<Banknote />} disabled={state.lines.length === 0 || needsShift} loading={quoteQ.isFetching && state.lines.length > 0 && !quote} onClick={startPayment}>
            Charge {f.money(quote?.total ?? 0)}
            <kbd className="ms-auto rounded border border-white/25 px-1.5 font-mono text-[11px] text-white/80">F9</kbd>
          </Button>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            <PanelButton icon={<PauseCircle />} label="Hold" k="F6" onClick={() => state.lines.length && setDialog('hold')} disabled={state.lines.length === 0} />
            <PanelButton icon={<History />} label="Held" k="F7" onClick={() => setDialog('held')} />
            <PanelButton icon={<Printer />} label="Reprint" k="F10" onClick={() => void reprint()} />
            <PanelButton icon={<Trash2 />} label="Clear" k="^Del" onClick={() => void clear()} disabled={state.lines.length === 0} danger />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Keyboard className="size-3.5" /> Ctrl+↑↓ select · +/− qty · Del remove
            </span>
            {shift.data && (
              <Badge tone="success" dot>
                {shift.data.sessionNo}
              </Badge>
            )}
          </div>
        </div>
      </aside>

      <CustomerPickerDialog
        open={dialog === 'customer'}
        onClose={() => setDialog(null)}
        onPick={(c) => {
          state.setCustomer(c?.id ?? null, c?.name ?? null);
          setDialog(null);
          focusSearch();
        }}
      />
      <HeldBillsDialog open={dialog === 'held'} onClose={() => setDialog(null)} onResume={(id) => void resume(id)} />
      <HoldDialog open={dialog === 'hold'} onClose={() => setDialog(null)} onHold={(l) => void hold(l)} />
      <PrescriptionLinkDialog
        open={dialog === 'rx'}
        customerId={state.customerId}
        onClose={() => setDialog(null)}
        onPick={(rx) => {
          state.setPrescription(rx?.id ?? null, rx?.no ?? null);
          setDialog(null);
        }}
      />
      {quote && <PaymentDialog open={dialog === 'pay'} onClose={() => setDialog(null)} quote={quote} onConfirm={(p) => void complete(p)} busy={busy} defaultMethod={settings.sales.defaultPaymentMethod} creditAllowed={settings.sales.allowCreditSales && can('sales.credit')} />}
      <SaleCompleteDialog
        sale={completed}
        onClose={() => {
          setCompleted(null);
          setTimeout(focusSearch, 50);
        }}
        onPrint={() => {
          if (completed) void printer.print({ channel: 'print.sale', id: completed.saleId, format: 'receipt' });
          setCompleted(null);
          setTimeout(focusSearch, 50);
        }}
        onPrintA4={() => {
          if (completed) printer.preview({ channel: 'print.sale', id: completed.saleId, title: `Invoice ${completed.invoiceNo}`, format: 'a4', allowFormats: true });
          setCompleted(null);
        }}
      />
      {!can('pos.access') && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <Button onClick={() => nav('/')} icon={<Pill />}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}

function PanelButton({ icon, label, k, onClick, disabled, danger }: { icon: React.ReactNode; label: string; k: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('flex flex-col items-center gap-1 rounded-lg border border-border bg-card py-2 text-[11.5px] font-medium text-muted-foreground transition hover:border-border-strong hover:text-foreground disabled:opacity-40 [&_svg]:size-4', danger && 'hover:border-danger/30 hover:bg-danger-soft hover:text-danger')}
    >
      {icon}
      <span>
        {label} <span className="font-mono text-[9.5px] opacity-60">{k}</span>
      </span>
    </button>
  );
}

function InvoiceDiscount() {
  const f = useFormat();
  const d = usePos((s) => s.invoiceDiscount);
  const set = usePos((s) => s.setInvoiceDiscount);
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>(d?.type ?? 'PERCENT');
  const [pct, setPct] = useState<number | null>(d?.type === 'PERCENT' ? d.value / 100 : null);
  const [amt, setAmt] = useState<number | null>(d?.type === 'AMOUNT' ? d.value : null);
  const apply = () => set(type === 'PERCENT' ? (pct ? { type, value: Math.round(pct * 100) } : null) : amt ? { type, value: amt } : null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          Discount
          <span className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
            <Percent className="size-3" />
            {d ? (d.type === 'PERCENT' ? `${d.value / 100}%` : f.money(d.value)) : 'Bill'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold">Bill discount</span>
          <Segmented size="sm" value={type} onChange={setType} options={[{ value: 'PERCENT', label: '%' }, { value: 'AMOUNT', label: f.symbol }]} />
        </div>
        {type === 'PERCENT' ? <NumberInput value={pct} onChange={setPct} max={100} allowDecimal suffix="%" autoFocus onEnter={apply} /> : <MoneyInput value={amt} onChange={setAmt} symbol={f.symbol} autoFocus onEnter={apply} />}
        <p className="mt-2 text-[11.5px] text-muted-foreground">Above {f.settings.sales.maxDiscountBp / 100}% requires supervisor approval.</p>
        <div className="mt-3 flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => set(null)}>
            Remove
          </Button>
          <Button size="sm" variant="primary" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
