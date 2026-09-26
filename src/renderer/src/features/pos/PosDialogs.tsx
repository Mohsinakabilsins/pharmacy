import { useState } from 'react';
import { CheckCircle2, FileHeart, FileText, PauseCircle, Printer, Search, UserPlus, UserRound, Wallet, Trash2, Play } from 'lucide-react';
import type { SaleCompleted } from '@shared/types/sales';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { MoneyInput, SearchInput } from '@renderer/components/ui/inputs';
import { Badge, EmptyState, Kbd } from '@renderer/components/ui/display';
import { Card } from '@renderer/components/ui/display';

export function CustomerPickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: { id: number; name: string } | null) => void }) {
  const f = useFormat();
  const can = useCan();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 120);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const list = useApiQuery('customers.search', { query: dq, limit: 20 }, { enabled: open });
  const create = useApiMutation('customers.save', {
    success: 'Customer added',
    onSuccess: (c) => {
      onPick({ id: c.id, name: c.name });
      setCreating(false);
      setName('');
      setPhone('');
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<UserRound />} title="Select customer" description="Link the sale to a customer for history, credit and prescriptions." />
        <DialogBody className="space-y-3">
          {!creating ? (
            <>
              <SearchInput value={q} onChange={setQ} autoFocus placeholder="Search by name, phone or code" className="w-full" />
              <div className="max-h-[340px] space-y-1 overflow-y-auto">
                <button type="button" onClick={() => onPick(null)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start hover:bg-muted">
                  <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-4" />
                  </span>
                  <span className="text-[13.5px] font-medium">Walk-in customer</span>
                </button>
                {list.data?.map((c) => (
                  <button key={c.id} type="button" onClick={() => onPick({ id: c.id, name: c.name })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start hover:bg-muted">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-soft-foreground">{c.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {c.code} {c.phone && `· ${c.phone}`}
                      </span>
                    </span>
                    {c.balance > 0 && <Badge tone="warning">Owes {f.money(c.balance)}</Badge>}
                  </button>
                ))}
                {list.data?.length === 0 && dq && <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">No customer found.</div>}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" required className="col-span-2">
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone" className="col-span-2">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {creating ? (
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Back
              </Button>
              <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate({ name, phone: phone || null })}>
                Save & select
              </Button>
            </>
          ) : (
            can('customers.manage') && (
              <Button icon={<UserPlus />} onClick={() => (setCreating(true), setName(q))}>
                New customer
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HeldBillsDialog({ open, onClose, onResume }: { open: boolean; onClose: () => void; onResume: (id: number) => void }) {
  const f = useFormat();
  const held = useApiQuery('pos.held', undefined, { enabled: open });
  const del = useApiMutation('pos.deleteHeld', { success: 'Held bill discarded' });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<PauseCircle />} title="Held bills" description="Resume a bill that was parked for later." />
        <DialogBody className="space-y-2">
          {held.data?.length === 0 && <EmptyState compact icon={<PauseCircle />} title="No held bills" description="Press F6 in the POS to park the current bill." />}
          {held.data?.map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{b.label}</div>
                <div className="text-[12px] text-muted-foreground">
                  {b.itemCount} item{b.itemCount === 1 ? '' : 's'} · {b.customerName ?? 'Walk-in'} · {f.time(b.createdAt)} by {b.createdByName}
                </div>
              </div>
              <div className="num text-[14px] font-semibold">{f.money(b.totalEstimate)}</div>
              <Button size="icon-sm" variant="ghost" onClick={() => del.mutate({ id: b.id })} aria-label="Discard">
                <Trash2 />
              </Button>
              <Button size="sm" variant="primary" icon={<Play />} onClick={() => onResume(b.id)}>
                Resume
              </Button>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function PrescriptionLinkDialog({ open, onClose, customerId, onPick }: { open: boolean; onClose: () => void; customerId: number | null; onPick: (rx: { id: number; no: string } | null) => void }) {
  const f = useFormat();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const list = useApiQuery('prescriptions.list', { search: dq, customerId: dq ? null : customerId, page: 1, pageSize: 20, status: 'ACTIVE' }, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<FileHeart />} title="Link prescription" description="Attach the prescription this sale is dispensed against." />
        <DialogBody className="space-y-3">
          <SearchInput value={q} onChange={setQ} autoFocus placeholder="Search patient, prescriber or Rx number" className="w-full" />
          <div className="max-h-[340px] space-y-1 overflow-y-auto">
            {list.data?.rows.map((rx) => (
              <button key={rx.id} type="button" onClick={() => onPick({ id: rx.id, no: rx.prescriptionNo })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start hover:bg-muted">
                <FileText className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">
                    {rx.prescriptionNo} · {rx.patientName}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {rx.prescriberName} · {f.date(rx.prescriptionDate)} · {rx.itemCount} items
                  </span>
                </span>
              </button>
            ))}
            {list.data?.rows.length === 0 && <EmptyState compact title="No prescriptions found" description="Record prescriptions from the Prescriptions page." />}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onPick(null)}>
            Unlink
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftGate() {
  const f = useFormat();
  const can = useCan();
  const [cash, setCash] = useState<number | null>(500000);
  const open = useApiMutation('cash.open', { success: 'Shift opened — ready to sell' });
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <Card className="w-[420px] p-7 shadow-dialog">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          <Wallet className="size-6" />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold tracking-tight">Open a cash shift to start selling</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Count the cash in the drawer and enter the opening float. All cash sales, refunds and expenses will be reconciled against it at closing.</p>
        {can('cash.operate') ? (
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (cash !== null) open.mutate({ openingCash: cash, notes: null });
            }}
          >
            <Field label="Opening cash">
              <MoneyInput size="lg" value={cash} onChange={setCash} symbol={f.symbol} autoFocus />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={open.isPending} disabled={cash === null}>
              Open shift
            </Button>
          </form>
        ) : (
          <p className="mt-4 text-[13px] text-danger">Ask a user with cash-register permission to open the shift.</p>
        )}
      </Card>
    </div>
  );
}

export function SaleCompleteDialog({ sale, onClose, onPrint, onPrintA4 }: { sale: SaleCompleted | null; onClose: () => void; onPrint: () => void; onPrintA4: () => void }) {
  const f = useFormat();
  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      {sale && (
        <DialogContent size="sm" onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onPrint();
          }
        }}>
          <div className="px-7 pb-6 pt-8 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success ring-8 ring-success-soft/50">
              <CheckCircle2 className="size-7" />
            </div>
            <h2 className="mt-5 text-[18px] font-semibold tracking-tight">Sale completed</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Invoice {sale.invoiceNo}</p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-start">
              <div className="rounded-xl bg-subtle p-4 ring-1 ring-border">
                <div className="text-[12px] text-muted-foreground">Total</div>
                <div className="num mt-1 text-[20px] font-semibold">{f.money(sale.total)}</div>
              </div>
              <div className={cn('rounded-xl p-4 ring-1', sale.changeDue > 0 ? 'bg-success-soft ring-success/20' : 'bg-subtle ring-border')}>
                <div className="text-[12px] text-muted-foreground">{sale.creditAmount > 0 ? 'On account' : 'Change'}</div>
                <div className={cn('num mt-1 text-[20px] font-semibold', sale.changeDue > 0 && 'text-success')}>{f.money(sale.creditAmount > 0 ? sale.creditAmount : sale.changeDue)}</div>
              </div>
            </div>
          </div>
          <DialogFooter aside={<span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> print · <Kbd>Esc</Kbd> new sale</span>}>
            <Button icon={<FileText />} onClick={onPrintA4}>
              A4
            </Button>
            <Button variant="primary" icon={<Printer />} onClick={onPrint} autoFocus>
              Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function HoldDialog({ open, onClose, onHold }: { open: boolean; onClose: () => void; onHold: (label: string) => void }) {
  const [label, setLabel] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<PauseCircle />} title="Hold bill" description="Park this bill and serve the next customer." />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onHold(label);
            setLabel('');
          }}
        >
          <DialogBody>
            <Field label="Label (optional)" hint="e.g. customer name or counter">
              <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} leading={<Search />} placeholder="Mr. Khan — waiting for doctor" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Hold bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export async function reprintLast(print: (id: number) => void) {
  const id = await api('sales.last');
  if (id) print(id);
}
