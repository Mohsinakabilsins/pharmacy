import type { Ledger } from '@shared/types/purchasing';
import { useFormat } from '@renderer/lib/format';
import { cn } from '@renderer/lib/cn';
import { EmptyState } from './ui/display';

const TYPE_LABEL: Record<string, string> = {
  OPENING_BALANCE: 'Opening balance',
  PURCHASE: 'Purchase',
  PURCHASE_VOID: 'Purchase void',
  PAYMENT: 'Payment',
  PAYMENT_VOID: 'Payment void',
  ADJUSTMENT: 'Adjustment',
  SALE_CREDIT: 'Credit sale',
  SALE_VOID: 'Sale void',
  RETURN_CREDIT: 'Return credit',
};

/** Ledger with running balance. `debitLabel` is the column for positive (balance-increasing) amounts. */
export function LedgerTable({ ledger, debitLabel, creditLabel }: { ledger: Ledger | undefined; debitLabel: string; creditLabel: string }) {
  const f = useFormat();
  if (!ledger) return null;
  if (ledger.entries.length === 0) return <EmptyState compact title="No transactions yet" />;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-start font-semibold">Date</th>
            <th className="px-3 py-2.5 text-start font-semibold">Transaction</th>
            <th className="px-3 py-2.5 text-end font-semibold">{debitLabel}</th>
            <th className="px-3 py-2.5 text-end font-semibold">{creditLabel}</th>
            <th className="px-4 py-2.5 text-end font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {ledger.openingBalance !== 0 && (
            <tr className="bg-subtle/60">
              <td className="px-4 py-2 text-muted-foreground" colSpan={4}>
                Balance brought forward
              </td>
              <td className="num px-4 py-2 text-end font-medium">{f.money(ledger.openingBalance)}</td>
            </tr>
          )}
          {ledger.entries.map((e) => (
            <tr key={e.id}>
              <td className="num px-4 py-2.5 text-muted-foreground">{f.date(e.date)}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium">{TYPE_LABEL[e.type] ?? e.type}</div>
                <div className="text-[11.5px] text-muted-foreground">{e.description ?? e.referenceNo}</div>
              </td>
              <td className="num px-3 py-2.5 text-end">{e.amount > 0 ? f.money(e.amount, { symbol: false }) : ''}</td>
              <td className="num px-3 py-2.5 text-end text-success">{e.amount < 0 ? f.money(-e.amount, { symbol: false }) : ''}</td>
              <td className={cn('num px-4 py-2.5 text-end font-semibold', e.balance < 0 && 'text-info')}>{f.money(e.balance, { symbol: false })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-subtle">
          <tr className="font-semibold">
            <td className="px-4 py-2.5" colSpan={2}>
              Closing balance
            </td>
            <td className="num px-3 py-2.5 text-end">{f.money(ledger.totalDebit, { symbol: false })}</td>
            <td className="num px-3 py-2.5 text-end">{f.money(ledger.totalCredit, { symbol: false })}</td>
            <td className="num px-4 py-2.5 text-end">{f.money(ledger.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
