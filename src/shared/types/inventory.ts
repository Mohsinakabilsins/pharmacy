import type { ExpiryBucket, StockStatus } from '../calc/stock';

export type MovementType =
  | 'OPENING'
  | 'PURCHASE'
  | 'PURCHASE_VOID'
  | 'SALE'
  | 'SALE_VOID'
  | 'SALE_RETURN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'WRITE_OFF';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  PURCHASE: 'Purchase',
  PURCHASE_VOID: 'Purchase void',
  SALE: 'Sale',
  SALE_VOID: 'Sale void',
  SALE_RETURN: 'Sale return',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  WRITE_OFF: 'Write-off',
};

export interface BatchRow {
  id: number;
  productId: number;
  productCode: string;
  productName: string;
  genericName: string | null;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string;
  costPrice: number | null;
  salePrice: number;
  quantityReceived: number;
  quantityOnHand: number;
  packSize: number;
  unitName: string;
  packName: string;
  supplierName: string | null;
  purchaseNo: string | null;
  location: string | null;
  status: 'ACTIVE' | 'QUARANTINED' | 'RECALLED';
  isExpired: boolean;
  daysToExpiry: number;
  expiryBucket: ExpiryBucket;
  valueCost: number | null;
  valueRetail: number;
  createdAt: string;
}

export interface MovementRow {
  id: number;
  createdAt: string;
  movementType: MovementType;
  productId: number;
  productName: string;
  batchId: number;
  batchNumber: string;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  packSize: number;
  referenceType: string | null;
  referenceId: number | null;
  referenceNo: string | null;
  note: string | null;
  userName: string | null;
}

export interface AdjustmentRow {
  id: number;
  adjustmentNo: string;
  createdAt: string;
  productId: number;
  productName: string;
  batchNumber: string;
  direction: 'IN' | 'OUT';
  reason: string;
  quantity: number;
  packSize: number;
  costValue: number | null;
  notes: string | null;
  userName: string | null;
}

export interface ExpiryRow {
  batchId: number;
  productId: number;
  productCode: string;
  productName: string;
  genericName: string | null;
  categoryName: string | null;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  bucket: ExpiryBucket;
  quantity: number;
  packSize: number;
  unitName: string;
  costValue: number | null;
  retailValue: number;
  supplierName: string | null;
  location: string | null;
  status: string;
}

export interface ExpirySummaryBucket {
  bucket: ExpiryBucket;
  batches: number;
  quantity: number;
  costValue: number | null;
  retailValue: number;
}

export interface ExpiryReport {
  rows: ExpiryRow[];
  summary: ExpirySummaryBucket[];
  today: string;
}

export interface ReorderRow {
  productId: number;
  productCode: string;
  productName: string;
  genericName: string | null;
  manufacturerName: string | null;
  categoryName: string | null;
  packSize: number;
  packName: string;
  unitName: string;
  onHand: number;
  minStock: number;
  reorderLevel: number;
  maxStock: number;
  status: StockStatus;
  suggestedPacks: number;
  soldLast30Days: number;
  avgMonthlySales: number;
  lastSupplierId: number | null;
  lastSupplierName: string | null;
  lastCostPrice: number | null;
  estimatedCost: number | null;
}

export interface IntegrityReport {
  checkedBatches: number;
  mismatches: Array<{ batchId: number; productName: string; batchNumber: string; onHand: number; ledger: number }>;
  negativeBatches: number;
  checkedAt: string;
}
