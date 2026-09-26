import { create } from 'zustand';

export interface PrefillItem {
  productId: number;
  name: string;
  packSize: number;
  packs: number;
  costPrice: number | null;
}

interface PrefillState {
  supplierId: number | null;
  items: PrefillItem[];
  set: (supplierId: number | null, items: PrefillItem[]) => void;
  take: () => { supplierId: number | null; items: PrefillItem[] };
}

/** Hands a reorder selection to the purchase editor. */
export const usePurchasePrefill = create<PrefillState>((set, get) => ({
  supplierId: null,
  items: [],
  set: (supplierId, items) => set({ supplierId, items }),
  take: () => {
    const v = { supplierId: get().supplierId, items: get().items };
    set({ supplierId: null, items: [] });
    return v;
  },
}));
