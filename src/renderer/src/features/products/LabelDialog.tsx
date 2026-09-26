import { useEffect, useState } from 'react';
import { Barcode, Eye } from 'lucide-react';
import { toast } from 'sonner';
import type { BatchRow } from '@shared/types/inventory';
import { api, errorMessage } from '@renderer/lib/api';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { SwitchRow } from '@renderer/components/ui/controls';
import { usePrint } from '@renderer/components/PrintProvider';

export function LabelDialog({ open, onClose, productId, batches }: { open: boolean; onClose: () => void; productId: number; batches: BatchRow[] }) {
  const printer = usePrint();
  const [batchId, setBatchId] = useState<number | null>(null);
  const [copies, setCopies] = useState<number | null>(10);
  const [layout, setLayout] = useState<'38x25' | '50x25' | 'a4-40'>('38x25');
  const [showPrice, setShowPrice] = useState(true);
  useEffect(() => {
    if (open) setBatchId(batches.find((b) => b.quantityOnHand > 0 && !b.isExpired)?.id ?? null);
  }, [open, batches]);
  const input = (mode: 'preview' | 'print') => ({ items: [{ productId, batchId, copies: copies ?? 1 }], layout, showPrice, mode });
  const preview = async () => {
    try {
      const r = await api('print.labels', input('preview'));
      printer.showHtml('Label preview', r, async () => {
        const res = await api('print.labels', input('print'));
        if (res.printed) toast.success('Labels sent to printer');
      });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Barcode />} title="Print barcode labels" description="Shelf or pack labels with barcode, price and batch." />
        <DialogBody className="space-y-4">
          <Field label="Batch (optional)">
            <Select value={batchId ? String(batchId) : null} onChange={(v) => setBatchId(v ? Number(v) : null)} allowClear clearLabel="No batch — product label" options={batches.filter((b) => b.quantityOnHand > 0).map((b) => ({ value: String(b.id), label: `${b.batchNumber} · exp ${b.expiryDate}` }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Copies">
              <NumberInput value={copies} onChange={setCopies} min={1} max={500} />
            </Field>
            <Field label="Label size">
              <Select value={layout} onChange={(v) => v && setLayout(v as typeof layout)} options={[{ value: '38x25', label: '38 × 25 mm roll' }, { value: '50x25', label: '50 × 25 mm roll' }, { value: 'a4-40', label: 'A4 sheet (40 per page)' }]} />
            </Field>
          </div>
          <SwitchRow label="Show price" checked={showPrice} onChange={setShowPrice} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Eye />} onClick={() => void preview()} disabled={!copies}>
            Preview labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
