import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Smartphone, Landmark, UserRound, Split, CheckCircle2 } from 'lucide-react';
import type { SaleQuote } from '@shared/types/sales';
import { cn } from '@renderer/lib/cn';
import { useFormat } from '@renderer/lib/format';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { MoneyInput } from '@renderer/components/ui/inputs';
import { Alert } from '@renderer/components/ui/display';

type Method = 'CASH' | 'CARD' | 'MOBILE_WALLET' | 'BANK_TRANSFER' | 'CREDIT';
export interface PaymentResult {
  payments: Array<{ method: Method; amount: number; reference: string | null }>;
  cashTendered: number;
}

const METHODS: Array<{ id: Method | 'SPLIT'; label: string; icon: typeof Banknote; key: string }> = [
  { id: 'CASH', label: 'Cash', icon: Banknote, key: '1' },
  { id: 'CARD', label: 'Card', icon: CreditCard, key: '2' },
  { id: 'MOBILE_WALLET', label: 'Wallet', icon: Smartphone, key: '3' },
  { id: 'BANK_TRANSFER', label: 'Bank', icon: Landmark, key: '4' },
  { id: 'CREDIT', label: 'On account', icon: UserRound, key: '5' },
  { id: 'SPLIT', label: 'Split', icon: Split, key: '6' },
];

export function PaymentDialog({ open, onClose, quote, onConfirm, busy, defaultMethod, creditAllowed }: { open: boolean; onClose: () => void; quote: SaleQuote; onConfirm: (r: PaymentResult) => void; busy: boolean; defaultMethod: Method; creditAllowed: boolean }) {
  const f = useFormat();
  const total = quote.total;
  const [method, setMethod] = useState<Method | 'SPLIT'>(defaultMethod);
  const [tendered, setTendered] = useState<number | null>(total);
  const [reference, setReference] = useState('');
  const [split, setSplit] = useState<Record<Method, number | null>>({ CASH: null, CARD: null, MOBILE_WALLET: null, BANK_TRANSFER: null, CREDIT: null });

  useEffect(() => {
    if (open) {
      setMethod(defaultMethod);
      setTendered(total);
      setReference('');
      setSplit({ CASH: total, CARD: null, MOBILE_WALLET: null, BANK_TRANSFER: null, CREDIT: null });
    }
  }, [open, total, defaultMethod]);

  const quick = useMemo(() => {
    const steps = [10000, 50000, 100000, 500000];
    const set = new Set<number>([total]);
    for (const s of steps) set.add(Math.ceil(total / s) * s);
    return Array.from(set).filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  const customer = quote.customer;
  const creditBlocked = !customer ? 'Select a customer to sell on account' : !creditAllowed ? 'Credit sales are disabled' : null;
  const creditHeadroom = customer && customer.creditLimit > 0 ? customer.creditLimit - customer.balance : null;

  let result: PaymentResult | null = null;
  let problem: string | null = null;
  if (method === 'SPLIT') {
    const entries = (Object.entries(split) as Array<[Method, number | null]>).filter(([, v]) => v && v > 0) as Array<[Method, number]>;
    const sum = entries.reduce((s, [, v]) => s + v, 0);
    if (sum !== total) problem = sum < total ? `${f.money(total - sum)} still to allocate` : `Over-allocated by ${f.money(sum - total)}`;
    if (entries.some(([m]) => m === 'CREDIT') && creditBlocked) problem = creditBlocked;
    const cash = split.CASH ?? 0;
    result = { payments: entries.map(([m, v]) => ({ method: m, amount: v, reference: m === 'CASH' || m === 'CREDIT' ? null : reference || null })), cashTendered: cash > 0 ? Math.max(cash, tendered ?? cash) : 0 };
    if (cash > 0 && (tendered ?? 0) < cash) result.cashTendered = cash;
  } else if (method === 'CASH') {
    if ((tendered ?? 0) < total) problem = 'Cash received is less than the total';
    result = { payments: [{ method: 'CASH', amount: total, reference: null }], cashTendered: tendered ?? 0 };
  } else if (method === 'CREDIT') {
    if (creditBlocked) problem = creditBlocked;
    else if (creditHeadroom !== null && total > creditHeadroom) problem = `Exceeds credit limit — available ${f.money(creditHeadroom)}`;
    result = { payments: [{ method: 'CREDIT', amount: total, reference: null }], cashTendered: 0 };
  } else {
    result = { payments: [{ method, amount: total, reference: reference || null }], cashTendered: 0 };
  }
  const change = method === 'CASH' ? Math.max(0, (tendered ?? 0) - total) : method === 'SPLIT' ? Math.max(0, (tendered ?? 0) - (split.CASH ?? 0)) : 0;
  const ready = !problem && result;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" onKeyDown={(e) => {
        if (e.altKey && /^[1-6]$/.test(e.key)) setMethod(METHODS[Number(e.key) - 1].id);
      }}>
        <DialogHeader icon={<Banknote />} title="Take payment" description={`${quote.lines.length} item${quote.lines.length === 1 ? '' : 's'}${customer ? ` · ${customer.name}` : ''}`} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && result) onConfirm(result);
          }}
        >
          <DialogBody className="space-y-5">
            <div className="flex items-end justify-between rounded-xl bg-subtle px-5 py-4 ring-1 ring-border">
              <div>
                <div className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Amount due</div>
                <div className="num mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em]">{f.money(total)}</div>
              </div>
              {quote.discountTotal > 0 && <div className="text-end text-[12.5px] text-success">You saved {f.money(quote.discountTotal)}</div>}
            </div>
            <div className="grid grid-cols-6 gap-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const disabled = m.id === 'CREDIT' && !!creditBlocked;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[12px] font-medium transition disabled:opacity-40',
                      method === m.id ? 'border-primary bg-primary-soft text-primary-soft-foreground ring-2 ring-primary/20' : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                    {m.label}
                    <span className="absolute end-1.5 top-1 font-mono text-[9px] opacity-50">{m.key}</span>
                  </button>
                );
              })}
            </div>

            {method === 'CASH' && (
              <div className="space-y-3">
                <Field label="Cash received">
                  <MoneyInput size="xl" value={tendered} onChange={setTendered} symbol={f.symbol} autoFocus />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {quick.map((v, i) => (
                    <Button key={v} size="sm" variant={tendered === v ? 'soft' : 'secondary'} onClick={() => setTendered(v)}>
                      {i === 0 ? 'Exact' : f.money(v, { symbol: false })}
                    </Button>
                  ))}
                </div>
                <div className={cn('flex items-center justify-between rounded-xl px-5 py-3.5', change > 0 ? 'bg-success-soft' : 'bg-muted')}>
                  <span className="text-[13px] font-semibold">Change to return</span>
                  <span className={cn('num text-[26px] font-semibold tracking-tight', change > 0 && 'text-success')}>{f.money(change)}</span>
                </div>
              </div>
            )}

            {(method === 'CARD' || method === 'MOBILE_WALLET' || method === 'BANK_TRANSFER') && (
              <Field label="Reference (optional)" hint="Card slip no., transaction ID or last 4 digits">
                <Input autoFocus value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 4821 / TXN123456" />
              </Field>
            )}

            {method === 'CREDIT' && customer && (
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-border p-4 text-[12.5px]">
                <div>
                  <div className="text-muted-foreground">Current balance</div>
                  <div className="num mt-0.5 text-[15px] font-semibold">{f.money(customer.balance)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Credit limit</div>
                  <div className="num mt-0.5 text-[15px] font-semibold">{customer.creditLimit > 0 ? f.money(customer.creditLimit) : 'No limit'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Balance after</div>
                  <div className="num mt-0.5 text-[15px] font-semibold">{f.money(customer.balance + total)}</div>
                </div>
              </div>
            )}

            {method === 'SPLIT' && (
              <div className="space-y-2.5">
                {(['CASH', 'CARD', 'MOBILE_WALLET', 'BANK_TRANSFER', 'CREDIT'] as Method[]).map((m) => (
                  <div key={m} className="grid grid-cols-[140px_1fr] items-center gap-3">
                    <span className="text-[13px] font-medium">{METHODS.find((x) => x.id === m)!.label}</span>
                    <MoneyInput value={split[m]} onChange={(v) => setSplit((s) => ({ ...s, [m]: v }))} symbol={f.symbol} disabled={m === 'CREDIT' && !!creditBlocked} />
                  </div>
                ))}
                {(split.CASH ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                    <span className="text-[13px] text-muted-foreground">Cash received</span>
                    <MoneyInput value={tendered} onChange={setTendered} symbol={f.symbol} />
                  </div>
                )}
                {(split.CARD || split.MOBILE_WALLET || split.BANK_TRANSFER) && (
                  <Field label="Reference (optional)">
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                )}
                {change > 0 && <div className="text-end text-[13px] font-semibold text-success">Change: {f.money(change)}</div>}
              </div>
            )}

            {problem && <Alert tone="warning">{problem}</Alert>}
          </DialogBody>
          <DialogFooter aside="Alt+1…6 switches method · Enter completes">
            <Button variant="secondary" onClick={onClose}>
              Back
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!ready} icon={<CheckCircle2 />}>
              Complete sale
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
