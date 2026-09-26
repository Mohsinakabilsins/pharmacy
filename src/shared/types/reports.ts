export type ReportColumnType = 'text' | 'money' | 'qty' | 'number' | 'date' | 'datetime' | 'percent' | 'badge';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  align?: 'left' | 'right' | 'center';
  /** For qty columns: key holding the pack size to show packs + units. */
  packKey?: string;
  width?: number;
}

export interface ReportSummaryItem {
  label: string;
  value: number | null;
  type: 'money' | 'number' | 'percent' | 'qty';
  tone?: 'positive' | 'negative' | 'neutral' | 'warning';
  hint?: string;
}

export interface ReportChart {
  type: 'bar' | 'area' | 'line' | 'pie';
  xKey: string;
  series: Array<{ key: string; label: string; type?: 'money' | 'number' }>;
  data: Array<Record<string, string | number | null>>;
}

export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  summary?: ReportSummaryItem[];
  chart?: ReportChart;
  notes?: string[];
  /** Statement-style reports (P&L) render rows as labelled lines. */
  statement?: Array<{ label: string; value: number | null; level: 0 | 1 | 2; emphasis?: 'total' | 'grand' | 'muted'; note?: string }>;
}

export type ReportParamKind = 'dateRange' | 'groupBy' | 'supplier' | 'category' | 'user' | 'threshold' | 'days' | 'limit' | 'product';

export interface ReportDefinition {
  id: string;
  group: 'Sales' | 'Inventory' | 'Purchases' | 'Financial' | 'Analytics';
  title: string;
  description: string;
  params: ReportParamKind[];
  permission: string;
}

export interface DashboardData {
  today: string;
  kpis: {
    salesToday: number;
    salesYesterday: number;
    invoicesToday: number;
    avgBillToday: number;
    returnsToday: number;
    purchasesToday: number;
    expensesToday: number;
    grossProfitToday: number | null;
    grossProfitYesterday: number | null;
    netProfitToday: number | null;
    stockValueCost: number | null;
    stockValueRetail: number;
    productCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    expiringSoonCount: number;
    expiringSoonValue: number;
    expiredCount: number;
    expiredValue: number;
    payablesTotal: number;
    payablesSuppliers: number;
    receivablesTotal: number;
    heldBills: number;
  };
  salesTrend: Array<{ date: string; revenue: number; grossProfit: number | null; invoices: number }>;
  hourly: Array<{ hour: number; revenue: number }>;
  paymentMix: Array<{ method: string; amount: number }>;
  topProducts: Array<{ productId: number; name: string; quantity: number; revenue: number; packSize: number; unitName: string }>;
  recentSales: Array<{ id: number; invoiceNo: string; createdAt: string; customerName: string | null; total: number; status: string; cashierName: string }>;
  recentPurchases: Array<{ id: number; purchaseNo: string; supplierName: string; invoiceDate: string; total: number; status: string }>;
  alerts: {
    expiring: Array<{ batchId: number; productName: string; batchNumber: string; expiryDate: string; quantity: number; daysToExpiry: number }>;
    lowStock: Array<{ productId: number; productName: string; onHand: number; reorderLevel: number; status: string }>;
  };
  shift: { open: boolean; sessionNo: string | null; expectedCash: number | null; openedAt: string | null; openedByName: string | null };
  expiryWarningDays: number;
}
