export interface SupplierRow {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  city: string | null;
  paymentTermsDays: number;
  isActive: boolean;
  balance: number;
  purchaseCount: number;
  totalPurchases: number;
  lastPurchaseDate: string | null;
}

export interface SupplierDetail extends SupplierRow {
  email: string | null;
  address: string | null;
  ntn: string | null;
  strn: string | null;
  drugLicenseNo: string | null;
  openingBalance: number;
  notes: string | null;
  totalPaid: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  date: string;
  createdAt: string;
  type: string;
  description: string | null;
  referenceType: string | null;
  referenceId: number | null;
  referenceNo: string | null;
  /** Signed amount (+ increases balance owed). */
  amount: number;
  balance: number;
  userName: string | null;
}

export interface Ledger {
  openingBalance: number;
  entries: LedgerEntry[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface PurchaseRow {
  id: number;
  purchaseNo: string;
  supplierId: number;
  supplierName: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  itemCount: number;
  total: number;
  paidAmount: number;
  createdByName: string | null;
  postedAt: string | null;
  createdAt: string;
}

export interface PurchaseItemDetail {
  id: number;
  lineNo: number;
  productId: number;
  productCode: string;
  productName: string;
  genericName: string | null;
  packSize: number;
  unitName: string;
  packName: string;
  batchId: number | null;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string;
  quantity: number;
  bonusQuantity: number;
  costPrice: number;
  salePrice: number;
  discountBp: number;
  discountAmount: number;
  taxRateBp: number;
  taxAmount: number;
  lineTotal: number;
  landedCostPrice: number;
  gross: number;
}

export interface PurchaseDetail extends PurchaseRow {
  subtotal: number;
  discountTotal: number;
  invoiceDiscount: number;
  otherCharges: number;
  taxTotal: number;
  paymentMethod: string | null;
  notes: string | null;
  postedByName: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  items: PurchaseItemDetail[];
  payments: Array<{ id: number; paymentNo: string; amount: number; method: string; paymentDate: string; status: string }>;
  supplierBalance: number;
  canVoid: boolean;
  voidBlockReason: string | null;
}

export interface PurchaseTotals {
  rows: Array<{ gross: number; discount: number; tax: number; lineTotal: number; landedCostPrice: number }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  linesTotal: number;
  invoiceDiscount: number;
  otherCharges: number;
  total: number;
}
