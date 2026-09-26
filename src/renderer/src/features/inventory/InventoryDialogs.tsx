import { useEffect, useState } from 'react';
import { PackagePlus, SlidersHorizontal, Pencil, Tag } from 'lucide-react';
import type { BatchRow } from '@shared/types/inventory';
import type { ProductDetail } from '@shared/types/catalog';
import { ADJUSTMENT_REASONS } from '@shared/schemas/inventory';
import { todayLocal } from '@shared/dates';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { DateInput, ExpiryInput, MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { Alert } from '@renderer/components/ui/display';

export function OpeningStockDialog({ product, open, onClose }: { product: ProductDetail | null; open: boolean; onClose: () => void }) {
  const f = useFormat();
  const [batch, setBatch] = useState('');
  const [mfg, setMfg] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [mode, setMode] = useState<'pack' | 'unit'>('pack');
  const [cost, setCost] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open && product) {
      setBatch('');
      setMfg(null);
      setExpiry(null);
      setQty(null);
      setMode(product.packSize > 1 ? 'pack' : 'unit');
      setCost(product.defaultCostPrice);
      setPrice(product.defaultSalePrice);
      setLocation(product.storageLocation ?? '');
      setErrors({});
    }
  }, [open, product]);
  const save = useApiMutation('inventory.opening', { success: 'Opening stock added', onSuccess: onClose, onError: (e) => setErrors(e.fields ?? {}) });
  if (!product) return null;
  const units = (qty ?? 0) * (mode === 'pack' ? product.packSize : 1);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<PackagePlus />} title="Add opening stock" description={`${product.brandName}${product.strength ? ` ${product.strength}` : ''} — record stock already on the shelf when you start using PharmaDesk.`} />
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label="Batch number" required error={errors.batchNumber}>
            <Input autoFocus value={batch} onChange={(e) => setBatch(e.target.value.toUpperCase())} className="font-mono" />
          </Field>
          <Field label="Expiry" required error={errors.expiryDate} hint="MM/YYYY as printed on the pack">
            <ExpiryInput value={expiry} onChange={setExpiry} invalid={!!errors.expiryDate} />
          </Field>
          <Field label="Manufacturing date" error={errors.manufactureDate}>
            <DateInput value={mfg} onChange={setMfg} max={todayLocal()} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Quantity" required error={errors.quantity} hint={units > 0 ? `${f.number(units)} ${product.unitName.toLowerCase()}s` : undefined} aside={product.packSize > 1 && <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'pack', label: product.packName }, { value: 'unit', label: product.unitName }]} />}>
            <NumberInput value={qty} onChange={setQty} min={1} />
          </Field>
          <div />
          <Field label={`Cost per ${product.packName.toLowerCase()}`} error={errors.costPrice}>
            <MoneyInput value={cost} onChange={setCost} symbol={f.symbol} />
          </Field>
          <Field label={`Selling price per ${product.packName.toLowerCase()}`} error={errors.salePrice}>
            <MoneyInput value={price} onChange={setPrice} symbol={f.symbol} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!batch || !expiry || !units}
            onClick={() => save.mutate({ productId: product.id, batchNumber: batch, manufactureDate: mfg, expiryDate: expiry!, quantity: units, costPrice: cost ?? 0, salePrice: price ?? 0, location: location || null, notes: 'Opening stock' })}
          >
            Add stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REASON_LABEL: Record<string, string> = {
  COUNT_CORRECTION: 'Stock count correction',
  DAMAGED: 'Damaged / broken',
  EXPIRED: 'Expired — write off',
  LOST: 'Lost / theft',
  RETURN_TO_SUPPLIER: 'Returned to supplier',
  OTHER: 'Other',
};

export function AdjustStockDialog({ batch, open, onClose }: { batch: BatchRow | null; open: boolean; onClose: () => void }) {
  const f = useFormat();
  const [direction, setDirection] = useState<'OUT' | 'IN'>('OUT');
  const [reason, setReason] = useState<(typeof ADJUSTMENT_REASONS)[number]>('DAMAGED');
  const [qty, setQty] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [credit, setCredit] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suppliers = useApiQuery('suppliers.options', undefined, { enabled: open });
  useEffect(() => {
    if (open && batch) {
      setDirection('OUT');
      setReason(batch.isExpired ? 'EXPIRED' : 'DAMAGED');
      setQty(null);
      setNotes('');
      setSupplierId(null);
      setCredit(null);
      setErrors({});
    }
  }, [open, batch]);
  const save = useApiMutation('inventory.adjust', { success: 'Stock adjusted', onSuccess: onClose, onError: (e) => setErrors(e.fields ?? {}) });
  if (!batch) return null;
  const reasons = direction === 'IN' ? (['COUNT_CORRECTION', 'OTHER'] as const) : ADJUSTMENT_REASONS;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<SlidersHorizontal />} tone="warning" title="Adjust stock" description={`${batch.productName} · batch ${batch.batchNumber} · ${f.qty(batch.quantityOnHand, batch.packSize, batch.unitName, batch.packName)} on hand`} />
        <DialogBody className="space-y-4">
          <Segmented
            value={direction}
            onChange={(d) => {
              setDirection(d);
              setReason(d === 'IN' ? 'COUNT_CORRECTION' : 'DAMAGED');
            }}
            options={[
              { value: 'OUT', label: 'Remove stock' },
              { value: 'IN', label: 'Add stock' },
            ]}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Reason" error={errors.reason}>
              <Select value={reason} onChange={(v) => v && setReason(v as typeof reason)} options={reasons.map((r) => ({ value: r, label: REASON_LABEL[r] }))} />
            </Field>
            <Field label={`Quantity (${batch.unitName.toLowerCase()}s)`} required error={errors.quantity} hint={batch.packSize > 1 ? `${batch.packSize} per ${batch.packName.toLowerCase()}` : undefined}>
              <NumberInput value={qty} onChange={setQty} min={1} max={direction === 'OUT' ? batch.quantityOnHand : undefined} autoFocus />
            </Field>
            {reason === 'RETURN_TO_SUPPLIER' && (
              <>
                <Field label="Supplier" error={errors.supplierId}>
                  <Select value={supplierId ? String(supplierId) : null} onChange={(v) => setSupplierId(v ? Number(v) : null)} allowClear placeholder="Select supplier" options={(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
                </Field>
                <Field label="Credit from supplier" hint="Reduces the amount you owe them">
                  <MoneyInput value={credit} onChange={setCredit} symbol={f.symbol} />
                </Field>
              </>
            )}
            <Field label="Notes" required={reason === 'OTHER' || reason === 'COUNT_CORRECTION'} error={errors.notes} className="col-span-2">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
            </Field>
          </div>
          {direction === 'OUT' && qty ? (
            <Alert tone="warning">
              Loss at cost: <b className="num">{batch.costPrice !== null ? f.money(Math.round((qty * batch.costPrice) / batch.packSize)) : '—'}</b>. This creates an audit-logged stock movement and cannot be deleted.
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={direction === 'OUT' ? 'danger' : 'primary'}
            loading={save.isPending}
            disabled={!qty}
            onClick={() => save.mutate({ batchId: batch.id, direction, reason, quantity: qty ?? 0, notes: notes || null, supplierId, supplierCredit: credit ?? 0 })}
          >
            {direction === 'OUT' ? 'Remove stock' : 'Add stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditBatchDialog({ batch, open, onClose }: { batch: BatchRow | null; open: boolean; onClose: () => void }) {
  const f = useFormat();
  const can = useCan();
  const [price, setPrice] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'QUARANTINED' | 'RECALLED'>('ACTIVE');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open && batch) {
      setPrice(batch.salePrice);
      setLocation(batch.location ?? '');
      setStatus(batch.status);
      setExpiry(batch.expiryDate);
      setReason('');
    }
  }, [open, batch]);
  const save = useApiMutation('batches.update', { success: 'Batch updated', onSuccess: onClose });
  if (!batch) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<Pencil />} title={`Batch ${batch.batchNumber}`} description={batch.productName} />
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label={`Selling price per ${batch.packName.toLowerCase()}`} hint={can('products.price_change') ? undefined : 'Needs price-change permission'}>
            <MoneyInput value={price} onChange={setPrice} symbol={f.symbol} disabled={!can('products.price_change')} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Status" hint="Quarantined and recalled stock cannot be sold">
            <Select value={status} onChange={(v) => v && setStatus(v as typeof status)} options={[{ value: 'ACTIVE', label: 'Active — sellable' }, { value: 'QUARANTINED', label: 'Quarantined' }, { value: 'RECALLED', label: 'Recalled' }]} />
          </Field>
          <Field label="Expiry (correction)">
            <ExpiryInput value={expiry} onChange={setExpiry} />
          </Field>
          <Field label="Reason for change" required className="col-span-2" hint="Recorded in the audit log">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. MRP revised by manufacturer / supplier recall notice" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Tag />}
            loading={save.isPending}
            disabled={reason.trim().length < 3}
            onClick={() =>
              save.mutate({
                id: batch.id,
                salePrice: price ?? undefined,
                location: location || null,
                status,
                expiryDate: expiry ?? undefined,
                reason,
              })
            }
          >
            Save batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
