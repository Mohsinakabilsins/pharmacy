import type { StockStatus } from '../calc/stock';

export interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
}

export interface ManufacturerRow {
  id: number;
  name: string;
  country: string | null;
  phone: string | null;
  isActive: boolean;
  productCount: number;
}

export interface ProductListRow {
  id: number;
  code: string;
  barcode: string | null;
  brandName: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  manufacturerName: string | null;
  categoryName: string | null;
  packSize: number;
  unitName: string;
  packName: string;
  requiresPrescription: boolean;
  isControlled: boolean;
  isActive: boolean;
  defaultSalePrice: number;
  defaultCostPrice: number | null;
  minStock: number;
  reorderLevel: number;
  maxStock: number;
  stockOnHand: number;
  expiredQty: number;
  nearestExpiry: string | null;
  batchCount: number;
  stockStatus: StockStatus;
  storageLocation: string | null;
  stockValueCost: number | null;
  stockValueRetail: number;
}

export interface ProductDetail {
  id: number;
  uuid: string;
  code: string;
  barcode: string | null;
  brandName: string;
  genericName: string | null;
  manufacturerId: number | null;
  manufacturerName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  dosageForm: string | null;
  strength: string | null;
  packSize: number;
  unitName: string;
  packName: string;
  allowLooseSale: boolean;
  requiresPrescription: boolean;
  isControlled: boolean;
  storageLocation: string | null;
  storageCondition: string | null;
  minStock: number;
  reorderLevel: number;
  maxStock: number;
  defaultCostPrice: number | null;
  defaultSalePrice: number;
  taxRateBp: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  stock: {
    sellable: number;
    expired: number;
    blocked: number;
    total: number;
    valueCost: number | null;
    valueRetail: number;
    nearestExpiry: string | null;
    status: StockStatus;
    soldLast30Days: number;
    lastSaleAt: string | null;
    lastPurchaseAt: string | null;
  };
}

export interface ProductSearchHit {
  id: number;
  code: string;
  barcode: string | null;
  brandName: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  manufacturerName: string | null;
  packSize: number;
  unitName: string;
  packName: string;
  allowLooseSale: boolean;
  requiresPrescription: boolean;
  isControlled: boolean;
  isActive: boolean;
  taxRateBp: number;
  sellableQty: number;
  expiredQty: number;
  /** FEFO batch price per pack (or default price when no stock). */
  price: number;
  nearestExpiry: string | null;
  storageLocation: string | null;
}
