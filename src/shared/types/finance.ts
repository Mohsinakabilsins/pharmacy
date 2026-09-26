export interface ExpenseCategoryRow {
  id: number;
  name: string;
  isActive: boolean;
  expenseCount: number;
}

export interface ExpenseRow {
  id: number;
  expenseNo: string;
  expenseDate: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  description: string;
  paymentMethod: string;
  reference: string | null;
  status: 'POSTED' | 'VOID';
  createdByName: string | null;
  createdAt: string;
  voidReason: string | null;
}

export interface ExpenseList {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  amountTotal: number;
  byCategory: Array<{ categoryName: string; amount: number }>;
}

export interface PaymentRow {
  id: number;
  paymentNo: string;
  direction: 'IN' | 'OUT';
  partyName: string;
  supplierId: number | null;
  customerId: number | null;
  purchaseNo: string | null;
  amount: number;
  method: string;
  reference: string | null;
  paymentDate: string;
  notes: string | null;
  status: 'POSTED' | 'VOID';
  createdByName: string | null;
  createdAt: string;
  voidReason: string | null;
}

export interface CashSummary {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  customerReceipts: number;
  cashExpenses: number;
  supplierPayments: number;
  adjustmentsIn: number;
  adjustmentsOut: number;
  voidReversals: number;
  expectedCash: number;
  /** Non-cash takings for reconciliation. */
  nonCash: Array<{ method: string; amount: number }>;
  creditSales: number;
  salesCount: number;
  salesTotal: number;
  returnsCount: number;
  returnsTotal: number;
}

export interface CashSessionRow {
  id: number;
  sessionNo: string;
  status: 'OPEN' | 'CLOSED';
  openedByName: string;
  openedAt: string;
  closedByName: string | null;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
}

export interface CashSessionDetail extends CashSessionRow {
  summary: CashSummary;
  denominations: Record<string, number> | null;
  closingNotes: string | null;
  adjustments: Array<{ id: number; direction: 'IN' | 'OUT'; amount: number; reason: string; createdAt: string; userName: string | null }>;
}
