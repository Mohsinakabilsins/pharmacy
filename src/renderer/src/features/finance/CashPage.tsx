import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Lock, Printer, Wallet, Banknote, Coins, CircleDollarSign } from 'lucide-react';
import type { CashSessionDetail } from '@shared/types/finance';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState } from '@renderer/components/ui/display';
import { MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { Segmented } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { StatusBadge } from '@renderer/components/StatusBadges';
import { usePrint } from '@renderer/components/PrintProvider';

const DENOMS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

export function CashPage() {
  const f = useFormat();
  const can = useCan();
  const printer = usePrint();
  const current = useApiQuery('cash.current', undefined, { refetchInterval: 30_000 });
  const [page, setPage] = useState(1);
  const history = useApiQuery('cash.list', { page, pageSize: 15 });
  const [dialog, setDialog] = useState<'open' | 'adjust' | 'close' | null>(null);
  const s = current.data;
  return (
    <Page>
      <PageHeader
        title="Cash register"
        description="Shift-based cash control: opening float, live expected cash and closing reconciliation."
        icon={<Wallet />}
        actions={
          can('cash.operate') &&
          (s ? (
            <>
              <Button icon={<Printer />} onClick={() => printer.preview({ channel: 'print.cashSession', id: s.id, title: `Shift ${s.sessionNo} (interim)`, format: 'receipt' })}>
                Interim report
              </Button>
              <Button icon={<ArrowDownLeft />} onClick={() => setDialog('adjust')}>
                Cash in / out
              </Button>
              <Button variant="primary" icon={<Lock />} onClick={() => setDialog('close')}>
                Close shift
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={<Wallet />} onClick={() => setDialog('open')}>
              Open shift
            </Button>
          ))
        }
      />
      {s ? <CurrentShift s={s} /> : current.isFetched && <Card className="mb-4"><EmptyState icon={<Wallet />} title="No shift is open" description="Open a shift with the counted opening float before making cash sales." action={can('cash.operate') && <Button variant="primary" onClick={() => setDialog('open')}>Open shift</Button>} /></Card>}
      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Shift history" description="Closed shifts are immutable — their totals are snapshotted at closing." />
        <DataTable
          rows={history.data?.rows}
          loading={history.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => printer.preview({ channel: 'print.cashSession', id: r.id, title: `Shift ${r.sessionNo}`, format: 'receipt' })}
          empty={<EmptyState compact title="No shifts yet" />}
          columns={[
            { key: 'no', header: 'Shift', cell: (r) => <span className="whitespace-nowrap font-semibold">{r.sessionNo}</span> },
            { key: 'open', header: 'Opened', cell: (r) => <span className="text-[12.5px]">{f.dateTime(r.openedAt)} · {r.openedByName}</span> },
            { key: 'close', header: 'Closed', cell: (r) => <span className="text-[12.5px]">{r.closedAt ? `${f.dateTime(r.closedAt)} · ${r.closedByName}` : '—'}</span> },
            { key: 'opening', header: 'Opening', align: 'right', cell: (r) => f.money(r.openingCash) },
            { key: 'exp', header: 'Expected', align: 'right', cell: (r) => f.money(r.expectedCash) },
            { key: 'count', header: 'Counted', align: 'right', cell: (r) => f.money(r.countedCash) },
            { key: 'var', header: 'Variance', align: 'right', cell: (r) => (r.variance === null ? '—' : <span className={cn('font-semibold', r.variance < 0 ? 'text-danger' : r.variance > 0 ? 'text-warning' : 'text-success')}>{f.money(r.variance, { signed: true })}</span>) },
            { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'p', header: '', cell: () => <Printer className="size-4 text-muted-foreground" /> },
          ]}
        />
        {history.data && <Pagination page={page} pageSize={15} total={history.data.total} onPage={setPage} />}
      </Card>
      <OpenShiftDialog open={dialog === 'open'} onClose={() => setDialog(null)} />
      {s && <AdjustDialog open={dialog === 'adjust'} onClose={() => setDialog(null)} expected={s.summary.expectedCash} />}
      {s && <CloseShiftDialog open={dialog === 'close'} onClose={() => setDialog(null)} s={s} />}
    </Page>
  );
}

function CurrentShift({ s }: { s: CashSessionDetail }) {
  const f = useFormat();
  const x = s.summary;
  const rows: Array<[string, number, 'in' | 'out' | 'base']> = [
    ['Opening float', x.openingCash, 'base'],
    ['Cash sales', x.cashSales, 'in'],
    ['Customer receipts', x.customerReceipts, 'in'],
    ['Cash in', x.adjustmentsIn, 'in'],
    ['Cash refunds', x.cashRefunds, 'out'],
    ['Expenses', x.cashExpenses, 'out'],
    ['Supplier payments', x.supplierPayments, 'out'],
    ['Cash out', x.adjustmentsOut, 'out'],
    ['Voided sales', x.voidReversals, 'out'],
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="relative col-span-1 overflow-hidden p-6">
        <div className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-primary/10 blur-2xl" />
        <div className="flex items-center gap-2">
          <Badge tone="success" dot>
            Shift {s.sessionNo} open
          </Badge>
        </div>
        <div className="mt-5 text-[12.5px] font-medium text-muted-foreground">Expected cash in drawer</div>
        <div className="num mt-1 text-[38px] font-semibold leading-none tracking-[-0.025em]">{f.money(x.expectedCash)}</div>
        <div className="mt-3 text-[12.5px] text-muted-foreground">
          Opened {f.dateTime(s.openedAt)} by {s.openedByName}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-5">
          <div>
            <div className="text-[12px] text-muted-foreground">Sales</div>
            <div className="num text-[17px] font-semibold">{f.money(x.salesTotal)}</div>
            <div className="text-[11.5px] text-muted-foreground">{x.salesCount} invoices</div>
          </div>
          <div>
            <div className="text-[12px] text-muted-foreground">Returns</div>
            <div className="num text-[17px] font-semibold">{f.money(x.returnsTotal)}</div>
            <div className="text-[11.5px] text-muted-foreground">{x.returnsCount} refunds</div>
          </div>
        </div>
      </Card>
      <Card className="col-span-1">
        <CardHeader title="Drawer movement" icon={<Banknote />} />
        <div className="space-y-1 px-5 pb-5">
          {rows
            .filter(([, v, k]) => v !== 0 || k === 'base')
            .map(([label, v, k]) => (
              <div key={label} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle">
                <span className="flex items-center gap-2">
                  {k === 'in' ? <ArrowDownLeft className="size-3.5 text-success" /> : k === 'out' ? <ArrowUpRight className="size-3.5 text-danger" /> : <Coins className="size-3.5 text-muted-foreground" />}
                  {label}
                </span>
                <span className={cn('num font-medium', k === 'in' && 'text-success', k === 'out' && 'text-danger')}>
                  {k === 'in' ? '+' : k === 'out' ? '−' : ''}
                  {f.money(v)}
                </span>
              </div>
            ))}
          <div className="mt-2 flex items-center justify-between border-t border-border px-2 pt-3 text-[14px] font-semibold">
            <span>Expected</span>
            <span className="num">{f.money(x.expectedCash)}</span>
          </div>
        </div>
      </Card>
      <Card className="col-span-1">
        <CardHeader title="Other takings" description="Reconcile with card machine and wallet statements" icon={<CircleDollarSign />} />
        <div className="space-y-2 px-5 pb-5">
          {x.nonCash.map((n) => (
            <div key={n.method} className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS[n.method] ?? n.method}</span>
              <span className="num font-medium">{f.money(n.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Credit sales (on account)</span>
            <span className="num font-medium">{f.money(x.creditSales)}</span>
          </div>
          {s.adjustments.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Cash in / out</div>
              {s.adjustments.map((a) => (
                <div key={a.id} className="flex justify-between py-1 text-[12.5px]">
                  <span className="truncate">
                    {f.time(a.createdAt)} · {a.reason}
                  </span>
                  <span className={cn('num font-medium', a.direction === 'IN' ? 'text-success' : 'text-danger')}>
                    {a.direction === 'IN' ? '+' : '−'}
                    {f.money(a.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function OpenShiftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const f = useFormat();
  const [cash, setCash] = useState<number | null>(500000);
  const [notes, setNotes] = useState('');
  const m = useApiMutation('cash.open', { success: (s) => `Shift ${s.sessionNo} opened`, onSuccess: onClose });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Wallet />} title="Open shift" description="Count the cash in the drawer before you start." />
        <DialogBody className="space-y-4">
          <Field label="Opening cash">
            <MoneyInput size="lg" value={cash} onChange={setCash} symbol={f.symbol} autoFocus />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={cash === null} onClick={() => m.mutate({ openingCash: cash ?? 0, notes: notes || null })}>
            Open shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, expected }: { open: boolean; onClose: () => void; expected: number }) {
  const f = useFormat();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const m = useApiMutation('cash.adjust', { success: 'Cash movement recorded', onSuccess: () => (onClose(), setAmount(null), setReason('')) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<ArrowDownLeft />} title="Cash in / out" description="Float top-ups, owner withdrawals, change fetched from the bank…" />
        <DialogBody className="space-y-4">
          <Segmented value={direction} onChange={setDirection} options={[{ value: 'OUT', label: 'Cash out' }, { value: 'IN', label: 'Cash in' }]} />
          <Field label="Amount" hint={direction === 'OUT' ? `Expected in drawer: ${f.money(expected)}` : undefined}>
            <MoneyInput size="lg" value={amount} onChange={setAmount} symbol={f.symbol} autoFocus />
          </Field>
          <Field label="Reason" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === 'OUT' ? 'Owner withdrawal' : 'Float top-up'} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={!amount || !reason.trim()} onClick={() => m.mutate({ direction, amount: amount ?? 0, reason })}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({ open, onClose, s }: { open: boolean; onClose: () => void; s: CashSessionDetail }) {
  const f = useFormat();
  const printer = usePrint();
  const [mode, setMode] = useState<'count' | 'total'>('count');
  const [counts, setCounts] = useState<Record<number, number | null>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const counted = useMemo(() => (mode === 'count' ? DENOMS.reduce((sum, d) => sum + d * 100 * (counts[d] ?? 0), 0) : (total ?? 0)), [mode, counts, total]);
  const variance = counted - s.summary.expectedCash;
  const m = useApiMutation('cash.close', {
    success: 'Shift closed',
    onSuccess: (r) => {
      onClose();
      printer.preview({ channel: 'print.cashSession', id: r.id, title: `Shift ${r.sessionNo} closing report`, format: 'receipt' });
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<Lock />} title={`Close shift ${s.sessionNo}`} description="Count the drawer. The variance is recorded and the closing report is generated." />
        <DialogBody className="space-y-4">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'count', label: 'Count by denomination' }, { value: 'total', label: 'Enter total' }]} />
          {mode === 'count' ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {DENOMS.map((d) => (
                <div key={d} className="grid grid-cols-[72px_1fr_96px] items-center gap-2">
                  <span className="num text-[13px] font-medium">
                    {f.symbol} {d.toLocaleString()}
                  </span>
                  <NumberInput size="sm" value={counts[d] ?? null} onChange={(v) => setCounts((c) => ({ ...c, [d]: v }))} min={0} placeholder="0" />
                  <span className="num text-end text-[12.5px] text-muted-foreground">{f.money(d * 100 * (counts[d] ?? 0))}</span>
                </div>
              ))}
            </div>
          ) : (
            <Field label="Counted cash">
              <MoneyInput size="lg" value={total} onChange={setTotal} symbol={f.symbol} autoFocus />
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-subtle p-3 ring-1 ring-border">
              <div className="text-[12px] text-muted-foreground">Expected</div>
              <div className="num text-[17px] font-semibold">{f.money(s.summary.expectedCash)}</div>
            </div>
            <div className="rounded-xl bg-subtle p-3 ring-1 ring-border">
              <div className="text-[12px] text-muted-foreground">Counted</div>
              <div className="num text-[17px] font-semibold">{f.money(counted)}</div>
            </div>
            <div className={cn('rounded-xl p-3 ring-1', variance === 0 ? 'bg-success-soft ring-success/20' : 'bg-warning-soft ring-warning/25')}>
              <div className="text-[12px] text-muted-foreground">Variance</div>
              <div className={cn('num text-[17px] font-semibold', variance === 0 ? 'text-success' : variance < 0 ? 'text-danger' : 'text-warning')}>{f.money(variance, { signed: true })}</div>
            </div>
          </div>
          {variance !== 0 && <Alert tone="warning">{variance < 0 ? 'The drawer is short.' : 'The drawer has excess cash.'} Recount before closing, or explain the difference below.</Alert>}
          <Field label="Closing notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[56px]" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Lock />} loading={m.isPending} onClick={() => m.mutate({ countedCash: counted, denominations: mode === 'count' ? Object.fromEntries(Object.entries(counts).filter(([, v]) => v).map(([k, v]) => [k, v ?? 0])) : null, notes: notes || null })}>
            Close shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
