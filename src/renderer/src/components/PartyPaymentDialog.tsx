import { useEffect, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { todayLocal } from '@shared/dates';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation } from '@renderer/lib/query';
import { Button } from './ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from './ui/dialog';
import { Field } from './ui/field';
import { Input, Textarea } from './ui/input';
import { DateInput, MoneyInput } from './ui/inputs';
import { Select } from './ui/select';
import { MethodLabel } from './StatusBadges';

type Method = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CHEQUE';

export function PartyPaymentDialog({ open, onClose, party, id, name, balance }: { open: boolean; onClose: () => void; party: 'supplier' | 'customer'; id: number; name: string; balance: number }) {
  const f = useFormat();
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(party === 'supplier' ? 'BANK_TRANSFER' : 'CASH');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState<string | null>(todayLocal());
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(balance > 0 ? balance : null);
      setReference('');
      setNotes('');
      setDate(todayLocal());
    }
  }, [open, balance]);
  const onSuccess = () => onClose();
  const sup = useApiMutation('payments.supplier', { success: (p) => `Payment ${p.paymentNo} recorded`, onSuccess });
  const cus = useApiMutation('payments.customer', { success: (p) => `Receipt ${p.paymentNo} recorded`, onSuccess });
  const busy = sup.isPending || cus.isPending;
  const submit = () => {
    const common = { amount: amount ?? 0, method, reference: reference || null, paymentDate: date ?? todayLocal(), notes: notes || null };
    if (party === 'supplier') sup.mutate({ supplierId: id, ...common });
    else cus.mutate({ customerId: id, ...common });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<HandCoins />} title={party === 'supplier' ? `Pay ${name}` : `Receive payment from ${name}`} description={`Current balance ${f.money(balance)}${party === 'supplier' ? ' payable' : ' receivable'}.`} />
        <DialogBody className="space-y-4">
          <Field label="Amount" required>
            <div className="flex gap-2">
              <MoneyInput className="flex-1" size="lg" value={amount} onChange={setAmount} symbol={f.symbol} autoFocus />
              {balance > 0 && <Button onClick={() => setAmount(balance)}>Full</Button>}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <Select value={method} onChange={(v) => v && setMethod(v as Method)} options={['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_WALLET', 'CARD'].map((m) => ({ value: m, label: <MethodLabel method={m} /> }))} />
            </Field>
            <Field label="Date">
              <DateInput value={date} onChange={setDate} max={todayLocal()} />
            </Field>
          </div>
          <Field label="Reference" hint={method === 'CASH' ? 'Cash payments are recorded against the open shift' : undefined}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque no., transaction ID" />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[56px]" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!amount || amount <= 0} onClick={submit}>
            Record {party === 'supplier' ? 'payment' : 'receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
