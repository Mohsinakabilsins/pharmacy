import { useEffect, useState } from 'react';
import { Pill, Plus, Barcode } from 'lucide-react';
import type { ProductDetail } from '@shared/types/catalog';
import { DOSAGE_FORMS } from '@shared/schemas/catalog';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useFormat } from '@renderer/lib/format';
import { useCan } from '@renderer/stores/session';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field, FormSection } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { SwitchRow } from '@renderer/components/ui/controls';
import { Alert } from '@renderer/components/ui/display';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/controls';

interface FormState {
  code: string;
  barcode: string;
  brandName: string;
  genericName: string;
  manufacturerId: number | null;
  categoryId: number | null;
  dosageForm: string;
  strength: string;
  packSize: number | null;
  unitName: string;
  packName: string;
  allowLooseSale: boolean;
  requiresPrescription: boolean;
  isControlled: boolean;
  storageLocation: string;
  storageCondition: string;
  minStock: number | null;
  reorderLevel: number | null;
  maxStock: number | null;
  defaultCostPrice: number | null;
  defaultSalePrice: number | null;
  taxRatePct: number | null;
  isActive: boolean;
  notes: string;
}

const UNIT_FOR_FORM: Record<string, [string, string]> = {
  Tablet: ['Tablet', 'Box'],
  Capsule: ['Capsule', 'Box'],
  Syrup: ['Bottle', 'Bottle'],
  Suspension: ['Bottle', 'Bottle'],
  Drops: ['Bottle', 'Bottle'],
  Injection: ['Vial', 'Box'],
  Infusion: ['Bag', 'Bag'],
  Cream: ['Tube', 'Tube'],
  Ointment: ['Tube', 'Tube'],
  Gel: ['Tube', 'Tube'],
  Inhaler: ['Inhaler', 'Inhaler'],
  Sachet: ['Sachet', 'Box'],
  Device: ['Piece', 'Piece'],
};

function initial(p?: ProductDetail | null): FormState {
  return {
    code: p?.code ?? '',
    barcode: p?.barcode ?? '',
    brandName: p?.brandName ?? '',
    genericName: p?.genericName ?? '',
    manufacturerId: p?.manufacturerId ?? null,
    categoryId: p?.categoryId ?? null,
    dosageForm: p?.dosageForm ?? 'Tablet',
    strength: p?.strength ?? '',
    packSize: p?.packSize ?? 10,
    unitName: p?.unitName ?? 'Tablet',
    packName: p?.packName ?? 'Box',
    allowLooseSale: p?.allowLooseSale ?? true,
    requiresPrescription: p?.requiresPrescription ?? false,
    isControlled: p?.isControlled ?? false,
    storageLocation: p?.storageLocation ?? '',
    storageCondition: p?.storageCondition ?? '',
    minStock: p?.minStock ?? null,
    reorderLevel: p?.reorderLevel ?? null,
    maxStock: p?.maxStock ?? null,
    defaultCostPrice: p?.defaultCostPrice ?? null,
    defaultSalePrice: p?.defaultSalePrice ?? null,
    taxRatePct: p ? p.taxRateBp / 100 : null,
    isActive: p?.isActive ?? true,
    notes: p?.notes ?? '',
  };
}

export function ProductFormDialog({ open, onClose, product, onSaved }: { open: boolean; onClose: () => void; product?: ProductDetail | null; onSaved?: (p: ProductDetail) => void }) {
  const f = useFormat();
  const can = useCan();
  const [s, setS] = useState<FormState>(initial(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cats = useApiQuery('categories.list', { includeInactive: false }, { enabled: open });
  const mans = useApiQuery('manufacturers.list', { includeInactive: false }, { enabled: open });
  const nextCode = useApiQuery('products.nextCode', undefined, { enabled: open && !product });
  const tax = f.settings.tax;
  const inv = f.settings.inventory;

  useEffect(() => {
    if (open) {
      const init = initial(product);
      if (!product) {
        init.minStock = inv.defaultMinStock;
        init.reorderLevel = inv.defaultReorderLevel;
        init.taxRatePct = tax.defaultRateBp / 100;
      }
      setS(init);
      setErrors({});
    }
  }, [open, product]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useApiMutation('products.save', {
    success: product ? 'Product updated' : 'Product created',
    onSuccess: (p) => {
      onSaved?.(p);
      onClose();
    },
    onError: (e) => setErrors(e.fields ?? {}),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const margin = s.defaultSalePrice && s.defaultCostPrice !== null && s.defaultSalePrice > 0 ? ((s.defaultSalePrice - s.defaultCostPrice) / s.defaultSalePrice) * 100 : null;
  const priceLocked = !!product && !can('products.price_change');

  const submit = () => {
    save.mutate({
      id: product?.id,
      code: s.code || null,
      barcode: s.barcode || null,
      brandName: s.brandName,
      genericName: s.genericName || null,
      manufacturerId: s.manufacturerId,
      categoryId: s.categoryId,
      dosageForm: s.dosageForm || null,
      strength: s.strength || null,
      packSize: s.packSize ?? 1,
      unitName: s.unitName,
      packName: s.packName,
      allowLooseSale: s.allowLooseSale,
      requiresPrescription: s.requiresPrescription || s.isControlled,
      isControlled: s.isControlled,
      storageLocation: s.storageLocation || null,
      storageCondition: s.storageCondition || null,
      minStock: s.minStock ?? 0,
      reorderLevel: s.reorderLevel ?? 0,
      maxStock: s.maxStock ?? 0,
      defaultCostPrice: s.defaultCostPrice ?? 0,
      defaultSalePrice: s.defaultSalePrice ?? 0,
      taxRateBp: Math.round((s.taxRatePct ?? 0) * 100),
      isActive: s.isActive,
      notes: s.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader icon={<Pill />} title={product ? `Edit ${product.brandName}` : 'New product'} description="Medicine master data. Stock and batches are added through purchases or opening stock." />
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="grid grid-cols-[1.35fr_1fr] gap-8">
            <div className="space-y-7">
              <FormSection title="Identification">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Brand name" required error={errors.brandName} className="col-span-2">
                    <Input autoFocus value={s.brandName} onChange={(e) => set('brandName', e.target.value)} placeholder="e.g. Calmol" invalid={!!errors.brandName} />
                  </Field>
                  <Field label="Generic name" error={errors.genericName} className="col-span-2">
                    <Input value={s.genericName} onChange={(e) => set('genericName', e.target.value)} placeholder="e.g. Paracetamol" />
                  </Field>
                  <Field label="Strength">
                    <Input value={s.strength} onChange={(e) => set('strength', e.target.value)} placeholder="500 mg · 250 mg/5 ml" />
                  </Field>
                  <Field label="Dosage form">
                    <Select
                      value={s.dosageForm}
                      onChange={(v) => {
                        set('dosageForm', v ?? '');
                        const u = v ? UNIT_FOR_FORM[v] : undefined;
                        if (u && !product) setS((prev) => ({ ...prev, dosageForm: v ?? '', unitName: u[0], packName: u[1], packSize: u[0] === u[1] ? 1 : prev.packSize, allowLooseSale: u[0] !== u[1] }));
                      }}
                      options={DOSAGE_FORMS.map((d) => ({ value: d, label: d }))}
                    />
                  </Field>
                  <Field label="Manufacturer">
                    <EntitySelect kind="manufacturer" value={s.manufacturerId} onChange={(v) => set('manufacturerId', v)} options={(mans.data ?? []).map((m) => ({ id: m.id, name: m.name }))} />
                  </Field>
                  <Field label="Category">
                    <EntitySelect kind="category" value={s.categoryId} onChange={(v) => set('categoryId', v)} options={(cats.data ?? []).map((c) => ({ id: c.id, name: c.name }))} />
                  </Field>
                  <Field label="Barcode" error={errors.barcode} hint="Scan the box barcode into this field">
                    <Input leading={<Barcode />} value={s.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type" invalid={!!errors.barcode} />
                  </Field>
                  <Field label="Product code" error={errors.code} hint={product ? undefined : `Leave blank to use ${nextCode.data ?? 'auto'}`}>
                    <Input value={s.code} onChange={(e) => set('code', e.target.value)} placeholder={nextCode.data ?? 'Auto'} />
                  </Field>
                </div>
              </FormSection>
              <FormSection title="Packaging" description="Stock is counted in the base unit; prices are per pack.">
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Base unit" required error={errors.unitName}>
                    <Input value={s.unitName} onChange={(e) => set('unitName', e.target.value)} placeholder="Tablet" />
                  </Field>
                  <Field label="Pack name" required error={errors.packName}>
                    <Input value={s.packName} onChange={(e) => set('packName', e.target.value)} placeholder="Box" />
                  </Field>
                  <Field label={`${s.unitName || 'Units'} per ${s.packName.toLowerCase() || 'pack'}`} required error={errors.packSize}>
                    <NumberInput value={s.packSize} onChange={(v) => set('packSize', v)} min={1} max={10000} invalid={!!errors.packSize} />
                  </Field>
                </div>
                <SwitchRow label="Allow loose sale" description={`Sell individual ${s.unitName.toLowerCase() || 'units'}s from a ${s.packName.toLowerCase() || 'pack'}.`} checked={s.allowLooseSale} onChange={(v) => set('allowLooseSale', v)} />
              </FormSection>
              <FormSection title="Notes">
                <Textarea value={s.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Counselling notes, substitutes, special handling…" />
              </FormSection>
            </div>
            <div className="space-y-7">
              <FormSection title="Pricing" description={`Per ${s.packName.toLowerCase() || 'pack'} — new batches start from these values.`}>
                {priceLocked && <Alert tone="warning">You can view prices but changing them needs the price-change permission.</Alert>}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Purchase price" error={errors.defaultCostPrice}>
                    <MoneyInput value={s.defaultCostPrice} onChange={(v) => set('defaultCostPrice', v)} symbol={f.symbol} disabled={priceLocked} />
                  </Field>
                  <Field label="Selling price (MRP)" error={errors.defaultSalePrice}>
                    <MoneyInput value={s.defaultSalePrice} onChange={(v) => set('defaultSalePrice', v)} symbol={f.symbol} disabled={priceLocked} />
                  </Field>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-subtle px-3.5 py-2.5 text-[12.5px] ring-1 ring-border">
                  <span className="text-muted-foreground">Margin</span>
                  <span className={margin !== null && margin < 0 ? 'font-semibold text-danger' : 'font-semibold'}>{margin === null ? '—' : `${margin.toFixed(1)}%`}</span>
                </div>
                {tax.enabled && (
                  <Field label={`${tax.label} rate`}>
                    <NumberInput value={s.taxRatePct} onChange={(v) => set('taxRatePct', v)} allowDecimal max={100} suffix="%" />
                  </Field>
                )}
              </FormSection>
              <FormSection title="Stock levels" description={`In ${s.unitName.toLowerCase() || 'unit'}s. Drives low-stock and reorder alerts.`}>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Minimum" error={errors.minStock}>
                    <NumberInput value={s.minStock} onChange={(v) => set('minStock', v)} min={0} />
                  </Field>
                  <Field label="Reorder at" error={errors.reorderLevel}>
                    <NumberInput value={s.reorderLevel} onChange={(v) => set('reorderLevel', v)} min={0} invalid={!!errors.reorderLevel} />
                  </Field>
                  <Field label="Maximum" error={errors.maxStock}>
                    <NumberInput value={s.maxStock} onChange={(v) => set('maxStock', v)} min={0} invalid={!!errors.maxStock} />
                  </Field>
                </div>
              </FormSection>
              <FormSection title="Storage">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Location">
                    <Input value={s.storageLocation} onChange={(e) => set('storageLocation', e.target.value)} placeholder="Rack A-3" />
                  </Field>
                  <Field label="Condition">
                    <Input value={s.storageCondition} onChange={(e) => set('storageCondition', e.target.value)} placeholder="Store below 25 °C" />
                  </Field>
                </div>
              </FormSection>
              <FormSection title="Regulatory">
                <div className="space-y-2 rounded-xl border border-border p-4">
                  <SwitchRow label="Prescription required" description="Warns or blocks sale without a linked prescription (see settings)." checked={s.requiresPrescription || s.isControlled} onChange={(v) => set('requiresPrescription', v)} disabled={s.isControlled} />
                  <SwitchRow label="Controlled / restricted" description="Narcotic, psychotropic or otherwise restricted medicine." checked={s.isControlled} onChange={(v) => set('isControlled', v)} />
                  <SwitchRow label="Active" description="Inactive products are hidden from POS search." checked={s.isActive} onChange={(v) => set('isActive', v)} />
                </div>
              </FormSection>
            </div>
          </DialogBody>
          <DialogFooter aside={Object.keys(errors).length > 0 ? <span className="text-danger">Please fix the highlighted fields.</span> : undefined}>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!s.brandName.trim()}>
              {product ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Select with inline "create new" for categories and manufacturers. */
function EntitySelect({ kind, value, onChange, options }: { kind: 'category' | 'manufacturer'; value: number | null; onChange: (v: number | null) => void; options: Array<{ id: number; name: string }> }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const saveCat = useApiMutation('categories.save', { onSuccess: (c) => (onChange(c.id), setOpen(false), setName('')) });
  const saveMan = useApiMutation('manufacturers.save', { onSuccess: (m) => (onChange(m.id), setOpen(false), setName('')) });
  const busy = saveCat.isPending || saveMan.isPending;
  return (
    <div className="flex gap-1.5">
      <Select className="flex-1" value={value ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)} allowClear clearLabel="None" placeholder="Select…" options={options.map((o) => ({ value: String(o.id), label: o.name }))} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="icon" variant="secondary" aria-label={`New ${kind}`}>
            <Plus />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="mb-2 text-[12.5px] font-semibold">New {kind}</div>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!name.trim()) return;
              if (kind === 'category') saveCat.mutate({ name, description: null, isActive: true });
              else saveMan.mutate({ name, country: null, phone: null, isActive: true });
            }
          }} />
          <Button
            size="sm"
            variant="primary"
            className="mt-2 w-full"
            loading={busy}
            disabled={!name.trim()}
            onClick={() => (kind === 'category' ? saveCat.mutate({ name, description: null, isActive: true }) : saveMan.mutate({ name, country: null, phone: null, isActive: true }))}
          >
            Add {kind}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
