export type QuoteIssueCode =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'INSUFFICIENT_STOCK'
  | 'NO_STOCK'
  | 'EXPIRED_BATCH'
  | 'BLOCKED_BATCH'
  | 'NEAR_EXPIRY'
  | 'LOOSE_NOT_ALLOWED'
  | 'RX_REQUIRED'
  | 'CONTROLLED'
  | 'PRICE_OVERRIDE'
  | 'DISCOUNT_NOT_ALLOWED'
  | 'DISCOUNT_LIMIT'
  | 'SHIFT_REQUIRED'
  | 'CREDIT_NOT_ALLOWED'
  | 'CUSTOMER_REQUIRED'
  | 'CREDIT_LIMIT'
  | 'PRICE_BELOW_COST';

export interface QuoteIssue {
  code: QuoteIssueCode;
  message: string;
  severity: 'error' | 'warning';
  /** Permission that would resolve the issue through a supervisor override. */
  permission?: string;
  lineKey?: string;
}

export interface QuoteAllocation {
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  quantity: number;
  available: number;
  unitPrice: number;
  expired: boolean;
  nearExpiry: boolean;
}

export interface QuoteLine {
  key: string;
  productId: number;
  productName: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: number;
  unitName: string;
  packName: string;
  allowLooseSale: boolean;
  requiresPrescription: boolean;
  isControlled: boolean;
  quantity: number;
  allocatedQuantity: number;
  available: number;
  unitPrice: number;
  priceOverridden: boolean;
  manualBatch: boolean;
  gross: number;
  discount: number;
  tax: number;
  total: number;
  taxRateBp: number;
  allocations: QuoteAllocation[];
  issues: QuoteIssue[];
}

export interface SaleQuote {
  lines: QuoteLine[];
  subtotal: number;
  lineDiscountTotal: number;
  invoiceDiscountTotal: number;
  discountTotal: number;
  taxTotal: number;
  preRoundTotal: number;
  roundOff: number;
  total: number;
  unitCount: number;
  issues: QuoteIssue[];
  /** Permissions still needing a supervisor override token. */
  requiredOverrides: string[];
  canComplete: boolean;
  customer: { id: number; name: string; phone: string | null; balance: number; creditLimit: number } | null;
  shiftOpen: boolean;
  taxEnabled: boolean;
  taxLabel: string;
}

export interface SaleCompleted {
  saleId: number;
  invoiceNo: string;
  total: number;
  paidTotal: number;
  changeDue: number;
  creditAmount: number;
}

export interface HeldBillRow {
  id: number;
  label: string;
  customerId: number | null;
  customerName: string | null;
  itemCount: number;
  totalEstimate: number;
  createdByName: string;
  createdAt: string;
}

export interface SaleRow {
  id: number;
  invoiceNo: string;
  createdAt: string;
  customerId: number | null;
  customerName: string | null;
  cashierName: string;
  itemCount: number;
  total: number;
  paidTotal: number;
  creditAmount: number;
  status: 'COMPLETED' | 'VOID';
  returnedTotal: number;
  paymentMethods: string;
}

export interface SaleItemDetail {
  id: number;
  lineNo: number;
  productId: number;
  productName: string;
  genericName: string | null;
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  packSize: number;
  unitName: string;
  packName: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  taxRateBp: number;
  taxAmount: number;
  lineTotal: number;
  costAmount: number | null;
  returnedQuantity: number;
  expiredOverride: boolean;
}

export interface SaleDetail extends SaleRow {
  uuid: string;
  customerPhone: string | null;
  prescriptionId: number | null;
  prescriptionNo: string | null;
  cashSessionId: number | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  roundOff: number;
  cashTendered: number;
  changeDue: number;
  costTotal: number | null;
  notes: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  items: SaleItemDetail[];
  payments: Array<{ method: string; amount: number; reference: string | null }>;
  returns: Array<{ id: number; returnNo: string; createdAt: string; total: number; refundMethod: string }>;
  canVoid: boolean;
  voidBlockReason: string | null;
}

export interface ReturnRow {
  id: number;
  returnNo: string;
  createdAt: string;
  saleId: number;
  invoiceNo: string;
  customerName: string | null;
  refundMethod: string;
  total: number;
  itemCount: number;
  reason: string;
  createdByName: string;
}

export interface ReturnDetail extends ReturnRow {
  subtotal: number;
  taxTotal: number;
  roundOff: number;
  costTotal: number | null;
  notes: string | null;
  items: Array<{
    id: number;
    saleItemId: number;
    productName: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    packSize: number;
    unitName: string;
    amount: number;
    taxAmount: number;
    restock: boolean;
  }>;
}
