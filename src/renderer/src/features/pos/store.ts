import { create } from 'zustand';
import type { ProductSearchHit } from '@shared/types/catalog';

export type Discount = { type: 'PERCENT' | 'AMOUNT'; value: number } | null;

export interface CartLine {
  key: string;
  productId: number;
  name: string;
  packSize: number;
  unitName: string;
  packName: string;
  allowLooseSale: boolean;
  /** Base units. */
  quantity: number;
  unitMode: 'pack' | 'unit';
  batchId: number | null;
  unitPrice: number | null;
  discount: Discount;
}

interface PosState {
  lines: CartLine[];
  customerId: number | null;
  customerName: string | null;
  prescriptionId: number | null;
  prescriptionNo: string | null;
  invoiceDiscount: Discount;
  overrideTokens: string[];
  selected: string | null;
  add: (p: ProductSearchHit, opts?: { quantity?: number; batchId?: number | null }) => string;
  update: (key: string, patch: Partial<CartLine>) => void;
  remove: (key: string) => void;
  clear: () => void;
  select: (key: string | null) => void;
  setCustomer: (id: number | null, name: string | null) => void;
  setPrescription: (id: number | null, no: string | null) => void;
  setInvoiceDiscount: (d: Discount) => void;
  addToken: (t: string) => void;
  load: (draft: { lines: Array<Omit<CartLine, 'name' | 'packSize' | 'unitName' | 'packName' | 'allowLooseSale' | 'unitMode'> & Partial<CartLine>>; customerId?: number | null; invoiceDiscount?: Discount; prescriptionId?: number | null }) => void;
}

let seq = 0;
const newKey = () => `L${Date.now().toString(36)}${(seq++).toString(36)}`;

export const usePos = create<PosState>((set, get) => ({
  lines: [],
  customerId: null,
  customerName: null,
  prescriptionId: null,
  prescriptionNo: null,
  invoiceDiscount: null,
  overrideTokens: [],
  selected: null,
  add: (p, opts = {}) => {
    // a scanned barcode is on the box: default to one full pack
    const qty = opts.quantity ?? p.packSize;
    const existing = get().lines.find((l) => l.productId === p.id && l.batchId === (opts.batchId ?? null) && l.unitPrice === null);
    if (existing) {
      set((s) => ({ lines: s.lines.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + qty } : l)), selected: existing.key }));
      return existing.key;
    }
    const key = newKey();
    const line: CartLine = {
      key,
      productId: p.id,
      name: p.strength ? `${p.brandName} ${p.strength}` : p.brandName,
      packSize: p.packSize,
      unitName: p.unitName,
      packName: p.packName,
      allowLooseSale: p.allowLooseSale,
      quantity: qty,
      unitMode: p.packSize > 1 && qty % p.packSize !== 0 ? 'unit' : 'pack',
      batchId: opts.batchId ?? null,
      unitPrice: null,
      discount: null,
    };
    set((s) => ({ lines: [...s.lines, line], selected: key }));
    return key;
  },
  update: (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
  remove: (key) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => l.key === key);
      const lines = s.lines.filter((l) => l.key !== key);
      const next = lines[Math.min(idx, lines.length - 1)]?.key ?? null;
      return { lines, selected: s.selected === key ? next : s.selected };
    }),
  clear: () => set({ lines: [], customerId: null, customerName: null, prescriptionId: null, prescriptionNo: null, invoiceDiscount: null, overrideTokens: [], selected: null }),
  select: (selected) => set({ selected }),
  setCustomer: (customerId, customerName) => set({ customerId, customerName }),
  setPrescription: (prescriptionId, prescriptionNo) => set({ prescriptionId, prescriptionNo }),
  setInvoiceDiscount: (invoiceDiscount) => set({ invoiceDiscount }),
  addToken: (t) => set((s) => ({ overrideTokens: [...s.overrideTokens, t] })),
  load: (draft) =>
    set({
      lines: draft.lines.map((l) => ({
        key: l.key || newKey(),
        productId: l.productId,
        name: l.name ?? 'Loading…',
        packSize: l.packSize ?? 1,
        unitName: l.unitName ?? 'Unit',
        packName: l.packName ?? 'Pack',
        allowLooseSale: l.allowLooseSale ?? true,
        quantity: l.quantity,
        unitMode: 'unit',
        batchId: l.batchId ?? null,
        unitPrice: l.unitPrice ?? null,
        discount: l.discount ?? null,
      })),
      customerId: draft.customerId ?? null,
      customerName: null,
      prescriptionId: draft.prescriptionId ?? null,
      prescriptionNo: null,
      invoiceDiscount: draft.invoiceDiscount ?? null,
      overrideTokens: [],
      selected: null,
    }),
}));

export function draftOf(s: Pick<PosState, 'lines' | 'customerId' | 'invoiceDiscount' | 'prescriptionId' | 'overrideTokens'>) {
  return {
    lines: s.lines.map((l) => ({ key: l.key, productId: l.productId, quantity: l.quantity, batchId: l.batchId, unitPrice: l.unitPrice, discount: l.discount })),
    customerId: s.customerId,
    invoiceDiscount: s.invoiceDiscount,
    prescriptionId: s.prescriptionId,
    overrideTokens: s.overrideTokens,
  };
}
