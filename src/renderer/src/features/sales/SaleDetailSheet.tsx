import { Ban, FileText, Printer, ReceiptText, Undo2, User, UserRound, FileHeart } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { queryClient, useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { Sheet, SheetHeader } from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, KeyValue, Skeleton } from '@renderer/components/ui/display';
import { useConfirm } from '@renderer/components/ui/confirm';
import { useOverride } from '@renderer/components/OverrideProvider';
import { usePrint } from '@renderer/components/PrintProvider';
import { MethodLabel, StatusBadge } from '@renderer/components/StatusBadges';

export function SaleDetailSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const f = useFormat();
  const can = useCan();
  const nav = useNavigate();
  const confirm = useConfirm();
  const requestOverride = useOverride();
  const printer = usePrint();
  const { data: s, isLoading } = useApiQuery('sales.get', { id: id ?? 0 }, { enabled: !!id });

  const voidSale = async () => {
    if (!s) return;
    const reason = await confirm({ title: `Void ${s.invoiceNo}?`, description: 'Stock returns to the original batches and the sale is excluded from totals. This is recorded in the audit log and cannot be undone.', confirmLabel: 'Void sale', tone: 'danger', requireReason: true });
    if (reason === false) return;
    let token: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await api('sales.void', { id: s.id, reason, overrideToken: token });
        toast.success(`${s.invoiceNo} voided`);
        void queryClient.invalidateQueries();
        return;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED' && attempt === 0) {
          token = await requestOverride('sales.void', `Void ${s.invoiceNo}`);
          if (!token) return;
        } else {
          toast.error(errorMessage(e));
          return;
        }
      }
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} width="lg">
      {isLoading || !s ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="mt-6 h-40" />
        </div>
      ) : (
        <>
          <SheetHeader
            icon={<ReceiptText />}
            title={s.invoiceNo}
            subtitle={`${f.dateTime(s.createdAt)} · by ${s.cashierName}`}
            badges={
              <>
                <StatusBadge status={s.status} />
                {s.returnedTotal > 0 && <Badge tone="warning">Returned {f.money(s.returnedTotal)}</Badge>}
                {s.creditAmount > 0 && <Badge tone="info">On account {f.money(s.creditAmount)}</Badge>}
                {s.items.some((i) => i.expiredOverride) && <Badge tone="danger">Expired stock override</Badge>}
              </>
            }
            actions={
              <>
                <Button size="sm" variant="primary" icon={<Printer />} onClick={() => printer.preview({ channel: 'print.sale', id: s.id, title: `Receipt ${s.invoiceNo}`, format: 'receipt', allowFormats: true })}>
                  Print
                </Button>
                <Button size="sm" icon={<FileText />} onClick={() => printer.preview({ channel: 'print.sale', id: s.id, title: `Invoice ${s.invoiceNo}`, format: 'a4', allowFormats: true })}>
                  A4 invoice
                </Button>
                {can('returns.manage') && s.status === 'COMPLETED' && s.items.some((i) => i.quantity > i.returnedQuantity) && (
                  <Button size="sm" icon={<Undo2 />} onClick={() => nav(`/returns?invoice=${encodeURIComponent(s.invoiceNo)}`)}>
                    Return items
                  </Button>
                )}
                {s.status === 'COMPLETED' && (can('sales.void') || can('pos.access')) && (
                  <Button size="sm" variant="danger-soft" icon={<Ban />} disabled={!s.canVoid} title={s.voidBlockReason ?? undefined} onClick={() => void voidSale()}>
                    Void
                  </Button>
                )}
              </>
            }
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {s.status === 'VOID' && (
              <Alert tone="danger" icon={<Ban />} title={`Voided ${f.dateTime(s.voidedAt)} by ${s.voidedByName}`}>
                {s.voidReason}
              </Alert>
            )}
            <Card className="p-4">
              <KeyValue
                cols={3}
                items={[
                  [
                    'Customer',
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="size-3.5 text-muted-foreground" />
                      {s.customerName ?? 'Walk-in'}
                    </span>,
                  ],
                  ['Phone', s.customerPhone],
                  [
                    'Prescription',
                    s.prescriptionNo ? (
                      <span className="inline-flex items-center gap-1.5">
                        <FileHeart className="size-3.5 text-muted-foreground" />
                        {s.prescriptionNo}
                      </span>
                    ) : (
                      '—'
                    ),
                  ],
                  [
                    'Cashier',
                    <span className="inline-flex items-center gap-1.5">
                      <User className="size-3.5 text-muted-foreground" />
                      {s.cashierName}
                    </span>,
                  ],
                  ['Payment', s.payments.map((p) => <MethodLabel key={p.method} method={p.method} className="me-2" />)],
                  ['Units', f.number(s.itemCount)],
                ]}
              />
            </Card>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold">Item</th>
                    <th className="px-3 py-2.5 text-end font-semibold">Qty</th>
                    <th className="px-3 py-2.5 text-end font-semibold">Rate</th>
                    <th className="px-3 py-2.5 text-end font-semibold">Disc.</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {s.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{i.productName}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          Batch <span className="font-mono">{i.batchNumber}</span> · Exp {f.expiry(i.expiryDate)}
                          {i.returnedQuantity > 0 && <span className="ms-1.5 font-medium text-warning">· {i.returnedQuantity} returned</span>}
                          {i.expiredOverride && <span className="ms-1.5 font-medium text-danger">· expired override</span>}
                        </div>
                      </td>
                      <td className="num px-3 py-2.5 text-end">{f.qty(i.quantity, i.packSize, i.unitName, i.packName)}</td>
                      <td className="num px-3 py-2.5 text-end">{f.money(i.unitPrice, { symbol: false })}</td>
                      <td className="num px-3 py-2.5 text-end text-muted-foreground">{i.discountAmount ? f.money(i.discountAmount, { symbol: false }) : '—'}</td>
                      <td className="num px-4 py-2.5 text-end font-semibold">{f.money(i.lineTotal, { symbol: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1.5 border-t border-border bg-subtle px-4 py-3 text-[13px]">
                <Line label="Subtotal" value={f.money(s.subtotal)} />
                {s.discountTotal > 0 && <Line label="Discount" value={`−${f.money(s.discountTotal)}`} />}
                {s.taxTotal > 0 && <Line label="Tax" value={f.money(s.taxTotal)} />}
                {s.roundOff !== 0 && <Line label="Rounding" value={f.money(s.roundOff, { signed: true })} />}
                <div className="flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                  <span>Total</span>
                  <span className="num">{f.money(s.total)}</span>
                </div>
                {s.cashTendered > 0 && <Line label={`Cash received · change ${f.money(s.changeDue)}`} value={f.money(s.cashTendered)} />}
                {s.costTotal !== null && <Line label="Cost of goods (profit)" value={`${f.money(s.costTotal)} (${f.money(s.total - s.taxTotal - s.costTotal)})`} />}
              </div>
            </div>
            {s.returns.length > 0 && (
              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Returns</div>
                <div className="space-y-1.5">
                  {s.returns.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-[13px]">
                      <span>
                        <b className="font-semibold">{r.returnNo}</b> · {f.dateTime(r.createdAt)} · <MethodLabel method={r.refundMethod} />
                      </span>
                      <span className="num font-semibold text-danger">−{f.money(r.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="num text-foreground">{value}</span>
    </div>
  );
}
