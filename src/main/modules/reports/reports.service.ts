import type { z } from 'zod';
import type { ReportParamsSchema } from '@shared/schemas/reports';
import type { ReportColumn, ReportDefinition, ReportResult, ReportSummaryItem } from '@shared/types/reports';
import type { PermissionKey } from '@shared/permissions';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { MOVEMENT_LABELS, type MovementType } from '@shared/types/inventory';
import { addDays, daysBetween, localDayRangeToUtc, startOfMonth } from '@shared/dates';
import { stockStatus } from '@shared/calc/stock';
import { all, can, requirePermission, today, type ServiceContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { getSettings } from '../../core/settings';
import { expiryReport, reorderReport } from '../inventory/inventory.service';
import { financialMetrics } from './financials';

type Params = z.output<typeof ReportParamsSchema>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const REPORTS: ReportDefinition[] = [
  { id: 'sales-summary', group: 'Sales', title: 'Sales summary', description: 'Revenue, returns, COGS and gross profit by day, week or month', params: ['dateRange', 'groupBy'], permission: 'reports.sales' },
  { id: 'sales-register', group: 'Sales', title: 'Invoice register', description: 'Every invoice with customer, cashier, payment and status', params: ['dateRange', 'user'], permission: 'reports.sales' },
  { id: 'sales-by-product', group: 'Sales', title: 'Product-wise sales', description: 'Quantity, revenue and profit per product', params: ['dateRange', 'category'], permission: 'reports.sales' },
  { id: 'sales-by-category', group: 'Sales', title: 'Category-wise sales', description: 'Revenue and profit per category', params: ['dateRange'], permission: 'reports.sales' },
  { id: 'sales-by-cashier', group: 'Sales', title: 'Cashier-wise sales', description: 'Invoices, revenue, discounts and voids per cashier', params: ['dateRange'], permission: 'reports.sales' },
  { id: 'sales-by-payment', group: 'Sales', title: 'Payment methods', description: 'Collections by payment method', params: ['dateRange'], permission: 'reports.sales' },
  { id: 'sales-by-hour', group: 'Sales', title: 'Sales by hour', description: 'Busiest hours of the day', params: ['dateRange'], permission: 'reports.sales' },
  { id: 'returns-register', group: 'Sales', title: 'Returns register', description: 'All sales returns with refund method and reason', params: ['dateRange'], permission: 'reports.sales' },

  { id: 'current-stock', group: 'Inventory', title: 'Current stock', description: 'Sellable, expired and blocked quantity per product', params: ['category'], permission: 'reports.inventory' },
  { id: 'stock-valuation', group: 'Inventory', title: 'Stock valuation', description: 'Inventory value at cost and retail with potential margin', params: ['category'], permission: 'reports.inventory' },
  { id: 'low-stock', group: 'Inventory', title: 'Low stock', description: 'Products at or below minimum stock', params: ['category', 'supplier'], permission: 'reports.inventory' },
  { id: 'out-of-stock', group: 'Inventory', title: 'Out of stock', description: 'Active products with no sellable stock', params: ['category', 'supplier'], permission: 'reports.inventory' },
  { id: 'reorder', group: 'Inventory', title: 'Reorder report', description: 'Suggested order quantities with last supplier and cost', params: ['category', 'supplier'], permission: 'reports.inventory' },
  { id: 'expired-stock', group: 'Inventory', title: 'Expired stock', description: 'Expired batches still on hand with value', params: ['category', 'supplier'], permission: 'reports.inventory' },
  { id: 'expiring-stock', group: 'Inventory', title: 'Expiring stock', description: 'Batches expiring within N days', params: ['days', 'category', 'supplier'], permission: 'reports.inventory' },
  { id: 'batch-report', group: 'Inventory', title: 'Batch report', description: 'Every batch with received, on-hand, expiry and source', params: ['category', 'supplier'], permission: 'reports.inventory' },
  { id: 'stock-movements', group: 'Inventory', title: 'Stock movement ledger', description: 'All inventory movements in the period', params: ['dateRange', 'product'], permission: 'reports.inventory' },
  { id: 'adjustments', group: 'Inventory', title: 'Adjustments & write-offs', description: 'Stock adjustments with reasons and cost impact', params: ['dateRange'], permission: 'reports.inventory' },

  { id: 'purchase-register', group: 'Purchases', title: 'Purchase register', description: 'Posted purchase invoices in the period', params: ['dateRange', 'supplier'], permission: 'reports.purchases' },
  { id: 'purchases-by-supplier', group: 'Purchases', title: 'Supplier-wise purchases', description: 'Purchases, payments and balance per supplier', params: ['dateRange'], permission: 'reports.purchases' },
  { id: 'purchases-by-product', group: 'Purchases', title: 'Product-wise purchases', description: 'Quantity received, bonus and landed cost per product', params: ['dateRange', 'supplier'], permission: 'reports.purchases' },

  { id: 'profit-loss', group: 'Financial', title: 'Profit & loss', description: 'Revenue, COGS, gross profit, expenses and net operating result', params: ['dateRange'], permission: 'reports.financial' },
  { id: 'expenses', group: 'Financial', title: 'Expenses', description: 'Expenses by category and detail', params: ['dateRange'], permission: 'reports.financial' },
  { id: 'cash-report', group: 'Financial', title: 'Cash register report', description: 'Shifts with expected vs counted cash and variance', params: ['dateRange'], permission: 'reports.financial' },
  { id: 'supplier-balances', group: 'Financial', title: 'Supplier balances & aging', description: 'Outstanding payables aged by invoice date', params: [], permission: 'reports.financial' },
  { id: 'customer-balances', group: 'Financial', title: 'Customer balances', description: 'Outstanding customer credit', params: [], permission: 'reports.financial' },
  { id: 'payments-register', group: 'Financial', title: 'Payments register', description: 'Supplier payments and customer receipts', params: ['dateRange'], permission: 'reports.financial' },

  { id: 'fast-moving', group: 'Analytics', title: 'Fast-moving products', description: 'Highest quantity sold with days of stock remaining', params: ['dateRange', 'limit'], permission: 'reports.sales' },
  { id: 'slow-moving', group: 'Analytics', title: 'Slow-moving products', description: 'In-stock products with little or no sales', params: ['dateRange', 'threshold'], permission: 'reports.inventory' },
  { id: 'best-selling', group: 'Analytics', title: 'Best-selling products', description: 'Top products by revenue', params: ['dateRange', 'limit'], permission: 'reports.sales' },
  { id: 'low-margin', group: 'Analytics', title: 'Low-margin products', description: 'Products selling below a margin threshold', params: ['dateRange', 'threshold'], permission: 'reports.financial' },
];

const PRODUCT_NAME = `p.brand_name || CASE WHEN p.strength IS NOT NULL AND p.strength <> '' THEN ' ' || p.strength ELSE '' END`;

function range(ctx: ServiceContext, p: Params) {
  const t = today(ctx);
  const from = p.from ?? startOfMonth(t);
  const to = p.to ?? t;
  return { from, to, ...localDayRangeToUtc(from, to), label: from === to ? from : `${from} → ${to}` };
}

const col = (key: string, label: string, type: ReportColumn['type'] = 'text', extra: Partial<ReportColumn> = {}): ReportColumn => ({
  key,
  label,
  type,
  align: type === 'money' || type === 'qty' || type === 'number' || type === 'percent' ? 'right' : 'left',
  ...extra,
});

function sumBy<T extends Record<string, unknown>>(rows: T[], keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return out;
}

function result(ctx: ServiceContext, id: string, subtitle: string, data: Omit<ReportResult, 'id' | 'title' | 'subtitle' | 'generatedAt'>): ReportResult {
  const def = REPORTS.find((r) => r.id === id)!;
  return { id, title: def.title, subtitle, generatedAt: ctx.now().toISOString(), ...data };
}

/** Whether cost / profit may be shown to this user. */
function showProfit(ctx: ServiceContext) {
  return can(ctx, 'reports.financial') || can(ctx, 'inventory.cost_view');
}

function stripProfit(ctx: ServiceContext, columns: ReportColumn[], keys: string[]) {
  return showProfit(ctx) ? columns : columns.filter((c) => !keys.includes(c.key));
}

/* ─────────────────────────────── Sales ─────────────────────────────── */

function salesSummary(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const fmt = p.groupBy === 'month' ? "strftime('%Y-%m', s.created_at, 'localtime')" : p.groupBy === 'week' ? "date(s.created_at, 'localtime', 'weekday 1', '-7 days')" : "date(s.created_at, 'localtime')";
  const fmtR = fmt.replace(/s\.created_at/g, 'r.created_at');
  const sales = all<{ period: string; invoices: number; gross: number; discounts: number; tax: number; lt: number; cogs: number }>(
    ctx,
    `SELECT ${fmt} AS period, COUNT(DISTINCT s.id) AS invoices, SUM(si.gross_amount) AS gross, SUM(si.discount_amount) AS discounts,
            SUM(si.tax_amount) AS tax, SUM(si.line_total) AS lt, SUM(si.cost_amount) AS cogs
     FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY period`,
    r.start,
    r.end,
  );
  const roundOffs = all<{ period: string; ro: number }>(
    ctx,
    `SELECT ${fmt} AS period, SUM(s.round_off) AS ro FROM sales s WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY period`,
    r.start,
    r.end,
  );
  const returns = all<{ period: string; ret: number; rcost: number }>(
    ctx,
    `SELECT ${fmtR} AS period, SUM(r.total - r.tax_total) AS ret, SUM(r.cost_total) AS rcost FROM sale_returns r WHERE r.created_at >= ? AND r.created_at < ? GROUP BY period`,
    r.start,
    r.end,
  );
  const periods = new Set([...sales.map((x) => x.period), ...returns.map((x) => x.period)]);
  const rows = Array.from(periods)
    .sort()
    .map((period) => {
      const s = sales.find((x) => x.period === period);
      const ro = roundOffs.find((x) => x.period === period)?.ro ?? 0;
      const ret = returns.find((x) => x.period === period);
      const netSales = (s?.lt ?? 0) - (s?.tax ?? 0) + ro;
      const revenue = netSales - (ret?.ret ?? 0);
      const cogs = (s?.cogs ?? 0) - (ret?.rcost ?? 0);
      return {
        period,
        invoices: s?.invoices ?? 0,
        gross: s?.gross ?? 0,
        discounts: s?.discounts ?? 0,
        returns: ret?.ret ?? 0,
        tax: s?.tax ?? 0,
        revenue,
        cogs,
        grossProfit: revenue - cogs,
        margin: revenue ? ((revenue - cogs) / revenue) * 100 : null,
      };
    });
  const totals = sumBy(rows, ['invoices', 'gross', 'discounts', 'returns', 'tax', 'revenue', 'cogs', 'grossProfit']);
  const profit = showProfit(ctx);
  return result(ctx, 'sales-summary', r.label, {
    columns: stripProfit(
      ctx,
      [
        col('period', p.groupBy === 'month' ? 'Month' : p.groupBy === 'week' ? 'Week of' : 'Date', p.groupBy === 'day' ? 'date' : 'text'),
        col('invoices', 'Invoices', 'number'),
        col('gross', 'Gross sales', 'money'),
        col('discounts', 'Discounts', 'money'),
        col('returns', 'Returns', 'money'),
        col('tax', 'Tax', 'money'),
        col('revenue', 'Revenue', 'money'),
        col('cogs', 'COGS', 'money'),
        col('grossProfit', 'Gross profit', 'money'),
        col('margin', 'Margin', 'percent'),
      ],
      ['cogs', 'grossProfit', 'margin'],
    ),
    rows,
    totals: { period: 'Total', ...totals, margin: totals.revenue ? (totals.grossProfit / totals.revenue) * 100 : null },
    summary: [
      { label: 'Revenue', value: totals.revenue, type: 'money' },
      { label: 'Invoices', value: totals.invoices, type: 'number' },
      { label: 'Average bill', value: totals.invoices ? Math.round((totals.revenue + totals.returns) / totals.invoices) : 0, type: 'money' },
      ...(profit
        ? [
            { label: 'Gross profit', value: totals.grossProfit, type: 'money', tone: totals.grossProfit >= 0 ? 'positive' : 'negative' } as ReportSummaryItem,
            { label: 'Gross margin', value: totals.revenue ? (totals.grossProfit / totals.revenue) * 100 : null, type: 'percent' } as ReportSummaryItem,
          ]
        : []),
    ],
    chart: {
      type: 'bar',
      xKey: 'period',
      series: profit
        ? [
            { key: 'revenue', label: 'Revenue', type: 'money' },
            { key: 'grossProfit', label: 'Gross profit', type: 'money' },
          ]
        : [{ key: 'revenue', label: 'Revenue', type: 'money' }],
      data: rows.map((x) => ({ period: x.period, revenue: x.revenue, grossProfit: profit ? x.grossProfit : null })),
    },
    notes: ['Revenue = net sales excluding tax − returns (by return date). COGS uses the actual batch cost of each item sold.'],
  });
}

function salesRegister(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT s.invoice_no AS invoiceNo, s.created_at AS createdAt, COALESCE(c.name, '—') AS customer, u.full_name AS cashier, s.item_count AS units,
            s.discount_total AS discount, s.tax_total AS tax, s.total, s.paid_total AS paid, s.credit_amount AS credit,
            COALESCE((SELECT SUM(total) FROM sale_returns rr WHERE rr.sale_id = s.id), 0) AS returned,
            (SELECT GROUP_CONCAT(method, ', ') FROM (SELECT DISTINCT method FROM sale_payments sp WHERE sp.sale_id = s.id)) AS methods,
            s.status
     FROM sales s JOIN users u ON u.id = s.created_by LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.created_at >= ? AND s.created_at < ? ${p.userId ? 'AND s.created_by = ?' : ''} ORDER BY s.id`,
    r.start,
    r.end,
    ...(p.userId ? [p.userId] : []),
  );
  for (const row of rows) row.methods = String(row.methods ?? '').split(', ').filter(Boolean).map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(', ');
  const completed = rows.filter((x) => x.status === 'COMPLETED');
  const totals = sumBy(completed, ['units', 'discount', 'tax', 'total', 'paid', 'credit', 'returned']);
  return result(ctx, 'sales-register', r.label, {
    columns: [
      col('invoiceNo', 'Invoice'),
      col('createdAt', 'Date / time', 'datetime'),
      col('customer', 'Customer'),
      col('cashier', 'Cashier'),
      col('methods', 'Payment'),
      col('units', 'Units', 'number'),
      col('discount', 'Discount', 'money'),
      col('tax', 'Tax', 'money'),
      col('total', 'Total', 'money'),
      col('credit', 'On credit', 'money'),
      col('returned', 'Returned', 'money'),
      col('status', 'Status', 'badge'),
    ],
    rows,
    totals: { invoiceNo: `${completed.length} invoices`, ...totals },
    summary: [
      { label: 'Invoices', value: completed.length, type: 'number' },
      { label: 'Total billed', value: totals.total, type: 'money' },
      { label: 'On credit', value: totals.credit, type: 'money' },
      { label: 'Voided', value: rows.length - completed.length, type: 'number', tone: rows.length - completed.length ? 'warning' : 'neutral' },
    ],
    notes: ['Totals exclude voided invoices.'],
  });
}

function salesByProduct(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, number | string | null>>(
    ctx,
    `WITH sold AS (
       SELECT si.product_id, SUM(si.quantity) AS qty, SUM(si.line_total - si.tax_amount) AS revenue, SUM(si.cost_amount) AS cogs, SUM(si.discount_amount) AS discount
       FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY si.product_id
     ), ret AS (
       SELECT ri.product_id, SUM(ri.quantity) AS qty, SUM(ri.amount - ri.tax_amount) AS amount, SUM(CASE WHEN ri.restock = 1 THEN ri.cost_amount ELSE 0 END) AS cost
       FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE r.created_at >= ? AND r.created_at < ? GROUP BY ri.product_id
     )
     SELECT p.code, ${PRODUCT_NAME} AS product, p.generic_name AS generic, c.name AS category, p.pack_size AS packSize,
            COALESCE(sold.qty, 0) AS qtySold, COALESCE(ret.qty, 0) AS qtyReturned, COALESCE(sold.qty, 0) - COALESCE(ret.qty, 0) AS netQty,
            COALESCE(sold.discount, 0) AS discount, COALESCE(sold.revenue, 0) - COALESCE(ret.amount, 0) AS revenue,
            COALESCE(sold.cogs, 0) - COALESCE(ret.cost, 0) AS cogs
     FROM products p LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN ret ON ret.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id
     WHERE (sold.product_id IS NOT NULL OR ret.product_id IS NOT NULL) ${p.categoryId ? 'AND p.category_id = ?' : ''}
     ORDER BY revenue DESC`,
    r.start,
    r.end,
    r.start,
    r.end,
    ...(p.categoryId ? [p.categoryId] : []),
  );
  for (const row of rows) {
    row.profit = Number(row.revenue) - Number(row.cogs);
    row.margin = Number(row.revenue) ? (Number(row.profit) / Number(row.revenue)) * 100 : null;
  }
  const totals = sumBy(rows, ['discount', 'revenue', 'cogs', 'profit']);
  return result(ctx, 'sales-by-product', r.label, {
    columns: stripProfit(
      ctx,
      [
        col('code', 'Code'),
        col('product', 'Product'),
        col('generic', 'Generic'),
        col('category', 'Category'),
        col('qtySold', 'Sold', 'qty', { packKey: 'packSize' }),
        col('qtyReturned', 'Returned', 'qty', { packKey: 'packSize' }),
        col('netQty', 'Net qty', 'qty', { packKey: 'packSize' }),
        col('discount', 'Discount', 'money'),
        col('revenue', 'Revenue', 'money'),
        col('cogs', 'COGS', 'money'),
        col('profit', 'Profit', 'money'),
        col('margin', 'Margin', 'percent'),
      ],
      ['cogs', 'profit', 'margin'],
    ),
    rows,
    totals: { product: `${rows.length} products`, ...totals, margin: totals.revenue ? (totals.profit / totals.revenue) * 100 : null },
    chart: { type: 'bar', xKey: 'product', series: [{ key: 'revenue', label: 'Revenue', type: 'money' }], data: rows.slice(0, 15).map((x) => ({ product: x.product as string, revenue: x.revenue as number })) },
  });
}

function salesByCategory(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, number | string | null>>(
    ctx,
    `SELECT COALESCE(c.name, 'Uncategorised') AS category, COUNT(DISTINCT si.product_id) AS products, SUM(si.quantity) AS units,
            SUM(si.line_total - si.tax_amount) AS revenue, SUM(si.cost_amount) AS cogs
     FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY c.id ORDER BY revenue DESC`,
    r.start,
    r.end,
  );
  const total = rows.reduce((s, x) => s + Number(x.revenue), 0);
  for (const row of rows) {
    row.profit = Number(row.revenue) - Number(row.cogs);
    row.margin = Number(row.revenue) ? (Number(row.profit) / Number(row.revenue)) * 100 : null;
    row.share = total ? (Number(row.revenue) / total) * 100 : null;
  }
  const totals = sumBy(rows, ['products', 'units', 'revenue', 'cogs', 'profit']);
  return result(ctx, 'sales-by-category', r.label, {
    columns: stripProfit(
      ctx,
      [col('category', 'Category'), col('products', 'Products', 'number'), col('units', 'Units', 'number'), col('revenue', 'Revenue', 'money'), col('share', 'Share', 'percent'), col('cogs', 'COGS', 'money'), col('profit', 'Profit', 'money'), col('margin', 'Margin', 'percent')],
      ['cogs', 'profit', 'margin'],
    ),
    rows,
    totals: { category: 'Total', ...totals, share: 100, margin: totals.revenue ? (totals.profit / totals.revenue) * 100 : null },
    chart: { type: 'pie', xKey: 'category', series: [{ key: 'revenue', label: 'Revenue', type: 'money' }], data: rows.map((x) => ({ category: x.category as string, revenue: x.revenue as number })) },
    notes: ['Revenue before returns.'],
  });
}

function salesByCashier(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, number | string | null>>(
    ctx,
    `SELECT u.full_name AS cashier, r.name AS role,
            SUM(CASE WHEN s.status = 'COMPLETED' THEN 1 ELSE 0 END) AS invoices,
            SUM(CASE WHEN s.status = 'COMPLETED' THEN s.total ELSE 0 END) AS total,
            SUM(CASE WHEN s.status = 'COMPLETED' THEN s.discount_total ELSE 0 END) AS discount,
            SUM(CASE WHEN s.status = 'VOID' THEN 1 ELSE 0 END) AS voids,
            SUM(CASE WHEN s.status = 'VOID' THEN s.total ELSE 0 END) AS voidTotal
     FROM sales s JOIN users u ON u.id = s.created_by JOIN roles r ON r.id = u.role_id
     WHERE s.created_at >= ? AND s.created_at < ? GROUP BY u.id ORDER BY total DESC`,
    r.start,
    r.end,
  );
  for (const row of rows) row.avgBill = Number(row.invoices) ? Math.round(Number(row.total) / Number(row.invoices)) : 0;
  const totals = sumBy(rows, ['invoices', 'total', 'discount', 'voids', 'voidTotal']);
  return result(ctx, 'sales-by-cashier', r.label, {
    columns: [col('cashier', 'Cashier'), col('role', 'Role'), col('invoices', 'Invoices', 'number'), col('total', 'Sales', 'money'), col('avgBill', 'Avg bill', 'money'), col('discount', 'Discounts', 'money'), col('voids', 'Voids', 'number'), col('voidTotal', 'Voided amount', 'money')],
    rows,
    totals: { cashier: 'Total', ...totals },
    chart: { type: 'bar', xKey: 'cashier', series: [{ key: 'total', label: 'Sales', type: 'money' }], data: rows.map((x) => ({ cashier: x.cashier as string, total: x.total as number })) },
  });
}

function salesByPayment(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, number | string>>(
    ctx,
    `SELECT sp.method, COUNT(DISTINCT s.id) AS invoices, SUM(sp.amount) AS amount
     FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?
     GROUP BY sp.method ORDER BY amount DESC`,
    r.start,
    r.end,
  );
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  for (const row of rows) {
    row.share = total ? (Number(row.amount) / total) * 100 : 0;
    row.label = PAYMENT_METHOD_LABELS[row.method as string] ?? row.method;
  }
  const refunds = all<Record<string, number | string>>(
    ctx,
    `SELECT refund_method AS method, COUNT(*) AS n, SUM(total) AS amount FROM sale_returns WHERE created_at >= ? AND created_at < ? GROUP BY refund_method`,
    r.start,
    r.end,
  );
  return result(ctx, 'sales-by-payment', r.label, {
    columns: [col('label', 'Method'), col('invoices', 'Invoices', 'number'), col('amount', 'Amount', 'money'), col('share', 'Share', 'percent')],
    rows,
    totals: { label: 'Total', invoices: rows.reduce((s, x) => s + Number(x.invoices), 0), amount: total, share: 100 },
    chart: { type: 'pie', xKey: 'label', series: [{ key: 'amount', label: 'Amount', type: 'money' }], data: rows.map((x) => ({ label: x.label as string, amount: x.amount as number })) },
    notes: refunds.length ? [`Refunds in period: ${refunds.map((x) => `${PAYMENT_METHOD_LABELS[x.method as string] ?? x.method} ${(Number(x.amount) / 100).toFixed(2)}`).join(', ')}`] : undefined,
  });
}

function salesByHour(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const data = all<{ hour: number; invoices: number; total: number }>(
    ctx,
    `SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) AS hour, COUNT(*) AS invoices, SUM(total) AS total
     FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ? GROUP BY hour ORDER BY hour`,
    r.start,
    r.end,
  );
  const days = Math.max(1, daysBetween(r.from, r.to) + 1);
  const rows = Array.from({ length: 24 }, (_, h) => {
    const d = data.find((x) => x.hour === h);
    const label = `${String(h).padStart(2, '0')}:00`;
    return { hour: label, invoices: d?.invoices ?? 0, total: d?.total ?? 0, avgPerDay: Math.round((d?.total ?? 0) / days) };
  }).filter((x, i) => x.invoices > 0 || (i >= 8 && i <= 22));
  return result(ctx, 'sales-by-hour', r.label, {
    columns: [col('hour', 'Hour'), col('invoices', 'Invoices', 'number'), col('total', 'Sales', 'money'), col('avgPerDay', 'Avg / day', 'money')],
    rows,
    totals: { hour: 'Total', ...sumBy(rows, ['invoices', 'total']) },
    chart: { type: 'bar', xKey: 'hour', series: [{ key: 'total', label: 'Sales', type: 'money' }], data: rows.map((x) => ({ hour: x.hour, total: x.total })) },
  });
}

function returnsRegister(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT r.return_no AS returnNo, r.created_at AS createdAt, s.invoice_no AS invoiceNo, COALESCE(c.name, '—') AS customer, u.full_name AS user,
            r.refund_method AS method, (SELECT SUM(quantity) FROM sale_return_items i WHERE i.return_id = r.id) AS units,
            (SELECT SUM(quantity) FROM sale_return_items i WHERE i.return_id = r.id AND i.restock = 0) AS disposed, r.total, r.reason
     FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.created_by LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.id`,
    r.start,
    r.end,
  );
  for (const row of rows) row.method = PAYMENT_METHOD_LABELS[row.method as string] ?? row.method;
  return result(ctx, 'returns-register', r.label, {
    columns: [col('returnNo', 'Return'), col('createdAt', 'Date / time', 'datetime'), col('invoiceNo', 'Invoice'), col('customer', 'Customer'), col('user', 'Processed by'), col('method', 'Refund'), col('units', 'Units', 'number'), col('disposed', 'Disposed', 'number'), col('total', 'Refund', 'money'), col('reason', 'Reason')],
    rows,
    totals: { returnNo: `${rows.length} returns`, ...sumBy(rows, ['units', 'disposed', 'total']) },
  });
}

/* ───────────────────────────── Inventory ───────────────────────────── */

function stockRows(ctx: ServiceContext, p: Params) {
  const t = today(ctx);
  return all<Record<string, number | string | null>>(
    ctx,
    `SELECT p.id, p.code, ${PRODUCT_NAME} AS product, p.generic_name AS generic, c.name AS category, m.name AS manufacturer, p.pack_size AS packSize,
            p.unit_name AS unitName, COALESCE(p.storage_location, '') AS location, p.min_stock AS minStock, p.reorder_level AS reorderLevel, p.max_stock AS maxStock,
            COALESCE(SUM(CASE WHEN b.status = 'ACTIVE' AND b.expiry_date > @t THEN b.quantity_on_hand END), 0) AS sellable,
            COALESCE(SUM(CASE WHEN b.expiry_date <= @t THEN b.quantity_on_hand END), 0) AS expired,
            COALESCE(SUM(CASE WHEN b.status <> 'ACTIVE' AND b.expiry_date > @t THEN b.quantity_on_hand END), 0) AS blocked,
            MIN(CASE WHEN b.quantity_on_hand > 0 AND b.status = 'ACTIVE' AND b.expiry_date > @t THEN b.expiry_date END) AS nearestExpiry,
            CAST(ROUND(COALESCE(SUM(CASE WHEN b.expiry_date > @t THEN b.quantity_on_hand * b.cost_price END), 0) * 1.0 / p.pack_size) AS INTEGER) AS costValue,
            CAST(ROUND(COALESCE(SUM(CASE WHEN b.expiry_date > @t THEN b.quantity_on_hand * b.sale_price END), 0) * 1.0 / p.pack_size) AS INTEGER) AS retailValue,
            CAST(ROUND(COALESCE(SUM(CASE WHEN b.expiry_date <= @t THEN b.quantity_on_hand * b.cost_price END), 0) * 1.0 / p.pack_size) AS INTEGER) AS expiredCost
     FROM products p LEFT JOIN batches b ON b.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
     WHERE p.is_active = 1 ${p.categoryId ? 'AND p.category_id = @cat' : ''}
     GROUP BY p.id ORDER BY p.brand_name COLLATE NOCASE`,
    { t, cat: p.categoryId ?? null },
  );
}

function currentStock(ctx: ServiceContext, p: Params): ReportResult {
  const rows = stockRows(ctx, p).map((r): Row => ({
    ...r,
    status: stockStatus(Number(r.sellable), Number(r.minStock), Number(r.reorderLevel), Number(r.maxStock)).replace(/_/g, ' '),
  }));
  return result(ctx, 'current-stock', `As of ${today(ctx)}`, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('generic', 'Generic'), col('category', 'Category'), col('location', 'Location'), col('sellable', 'Sellable', 'qty', { packKey: 'packSize' }), col('expired', 'Expired', 'qty', { packKey: 'packSize' }), col('blocked', 'Quarantined', 'qty', { packKey: 'packSize' }), col('nearestExpiry', 'Nearest expiry', 'date'), col('status', 'Status', 'badge')],
    rows,
    summary: [
      { label: 'Active products', value: rows.length, type: 'number' },
      { label: 'Out of stock', value: rows.filter((r) => Number(r.sellable) <= 0).length, type: 'number', tone: 'negative' },
      { label: 'With expired stock', value: rows.filter((r) => Number(r.expired) > 0).length, type: 'number', tone: 'warning' },
    ],
  });
}

function stockValuation(ctx: ServiceContext, p: Params): ReportResult {
  requirePermission(ctx, 'inventory.cost_view');
  const rows = stockRows(ctx, p)
    .filter((r) => Number(r.sellable) + Number(r.blocked) + Number(r.expired) > 0)
    .map((r): Row => ({ ...r, potentialProfit: Number(r.retailValue) - Number(r.costValue), margin: Number(r.retailValue) ? ((Number(r.retailValue) - Number(r.costValue)) / Number(r.retailValue)) * 100 : null }));
  const totals = sumBy(rows, ['costValue', 'retailValue', 'potentialProfit', 'expiredCost']);
  return result(ctx, 'stock-valuation', `As of ${today(ctx)}`, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('category', 'Category'), col('sellable', 'Sellable', 'qty', { packKey: 'packSize' }), col('costValue', 'Cost value', 'money'), col('retailValue', 'Retail value', 'money'), col('potentialProfit', 'Potential profit', 'money'), col('margin', 'Margin', 'percent'), col('expiredCost', 'Expired (cost)', 'money')],
    rows,
    totals: { product: `${rows.length} products`, ...totals, margin: totals.retailValue ? (totals.potentialProfit / totals.retailValue) * 100 : null },
    summary: [
      { label: 'Stock at cost', value: totals.costValue, type: 'money' },
      { label: 'Stock at retail', value: totals.retailValue, type: 'money' },
      { label: 'Potential gross profit', value: totals.potentialProfit, type: 'money', tone: 'positive' },
      { label: 'Expired stock (cost)', value: totals.expiredCost, type: 'money', tone: totals.expiredCost ? 'negative' : 'neutral' },
    ],
    notes: ['Valuation uses each batch’s cost (weighted average within a batch). Expired stock is excluded from cost/retail value and shown separately.'],
  });
}

function reorderBased(ctx: ServiceContext, p: Params, id: 'low-stock' | 'out-of-stock' | 'reorder'): ReportResult {
  const filter = id === 'low-stock' ? 'low' : id === 'out-of-stock' ? 'out' : 'all';
  const rows = reorderReport(ctx, { filter, supplierId: p.supplierId ?? null, categoryId: p.categoryId ?? null } as never).map((r) => ({ ...r, status: r.status.replace(/_/g, ' ') }));
  const showCost = can(ctx, 'inventory.cost_view');
  const columns = [
    col('productCode', 'Code'),
    col('productName', 'Product'),
    col('genericName', 'Generic'),
    col('onHand', 'On hand', 'qty', { packKey: 'packSize' }),
    col('minStock', 'Min', 'qty', { packKey: 'packSize' }),
    col('reorderLevel', 'Reorder at', 'qty', { packKey: 'packSize' }),
    col('soldLast30Days', 'Sold 30d', 'qty', { packKey: 'packSize' }),
    col('suggestedPacks', 'Order (packs)', 'number'),
    col('lastSupplierName', 'Last supplier'),
    ...(showCost ? [col('lastCostPrice', 'Last cost / pack', 'money'), col('estimatedCost', 'Est. cost', 'money')] : []),
    col('status', 'Status', 'badge'),
  ];
  return result(ctx, id, `As of ${today(ctx)}`, {
    columns,
    rows: rows as unknown as Record<string, unknown>[],
    totals: showCost ? { productName: `${rows.length} products`, estimatedCost: rows.reduce((s, r) => s + (r.estimatedCost ?? 0), 0) } : { productName: `${rows.length} products` },
  });
}

function expiryBased(ctx: ServiceContext, p: Params, id: 'expired-stock' | 'expiring-stock'): ReportResult {
  const rep = expiryReport(ctx, { bucket: 'ALL', supplierId: p.supplierId ?? null, categoryId: p.categoryId ?? null, includeZero: false } as never);
  const t = today(ctx);
  const days = p.days ?? getSettings(ctx).inventory.expiryWarningDays;
  const limit = addDays(t, days);
  const rows = rep.rows.filter((r) => (id === 'expired-stock' ? r.bucket === 'EXPIRED' : r.bucket !== 'EXPIRED' && r.expiryDate <= limit));
  const showCost = can(ctx, 'inventory.cost_view');
  const totals = sumBy(rows as unknown as Record<string, unknown>[], ['quantity', 'costValue', 'retailValue']);
  return result(ctx, id, id === 'expired-stock' ? `As of ${t}` : `Expiring by ${limit} (${days} days)`, {
    columns: [
      col('productCode', 'Code'),
      col('productName', 'Product'),
      col('batchNumber', 'Batch'),
      col('expiryDate', 'Expiry', 'date'),
      col('daysToExpiry', 'Days', 'number'),
      col('quantity', 'Quantity', 'qty', { packKey: 'packSize' }),
      ...(showCost ? [col('costValue', 'Purchase value', 'money')] : []),
      col('retailValue', 'Selling value', 'money'),
      col('supplierName', 'Supplier'),
      col('location', 'Location'),
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: { productName: `${rows.length} batches`, costValue: showCost ? totals.costValue : undefined, retailValue: totals.retailValue },
    summary: [
      { label: 'Batches', value: rows.length, type: 'number' },
      ...(showCost ? [{ label: 'Purchase value', value: totals.costValue, type: 'money', tone: 'negative' } as ReportSummaryItem] : []),
      { label: 'Selling value', value: totals.retailValue, type: 'money' },
    ],
  });
}

function batchReport(ctx: ServiceContext, p: Params): ReportResult {
  const t = today(ctx);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT p.code, ${PRODUCT_NAME} AS product, b.batch_number AS batch, b.manufacture_date AS mfg, b.expiry_date AS expiry, p.pack_size AS packSize,
            b.quantity_received AS received, b.quantity_on_hand AS onHand, b.cost_price AS cost, b.sale_price AS price, s.name AS supplier,
            pu.purchase_no AS purchaseNo, b.status, CASE WHEN b.expiry_date <= ? THEN 'EXPIRED' ELSE b.status END AS state
     FROM batches b JOIN products p ON p.id = b.product_id LEFT JOIN suppliers s ON s.id = b.supplier_id LEFT JOIN purchases pu ON pu.id = b.purchase_id
     WHERE 1 = 1 ${p.categoryId ? 'AND p.category_id = ?' : ''} ${p.supplierId ? 'AND b.supplier_id = ?' : ''}
     ORDER BY p.brand_name COLLATE NOCASE, b.expiry_date`,
    t,
    ...(p.categoryId ? [p.categoryId] : []),
    ...(p.supplierId ? [p.supplierId] : []),
  );
  const showCost = can(ctx, 'inventory.cost_view');
  return result(ctx, 'batch-report', `As of ${t}`, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('batch', 'Batch'), col('mfg', 'Mfg', 'date'), col('expiry', 'Expiry', 'date'), col('received', 'Received', 'qty', { packKey: 'packSize' }), col('onHand', 'On hand', 'qty', { packKey: 'packSize' }), ...(showCost ? [col('cost', 'Cost / pack', 'money')] : []), col('price', 'Price / pack', 'money'), col('supplier', 'Supplier'), col('purchaseNo', 'Purchase'), col('state', 'Status', 'badge')],
    rows,
  });
}

function stockMovements(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT m.created_at AS createdAt, m.movement_type AS type, ${PRODUCT_NAME} AS product, b.batch_number AS batch, p.pack_size AS packSize,
            m.quantity, m.balance_after AS balance, u.full_name AS user, m.note
     FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN batches b ON b.id = m.batch_id LEFT JOIN users u ON u.id = m.user_id
     WHERE m.created_at >= ? AND m.created_at < ? ${p.productId ? 'AND m.product_id = ?' : ''} ORDER BY m.id`,
    r.start,
    r.end,
    ...(p.productId ? [p.productId] : []),
  );
  for (const row of rows) row.type = MOVEMENT_LABELS[row.type as MovementType] ?? row.type;
  return result(ctx, 'stock-movements', r.label, {
    columns: [col('createdAt', 'Date / time', 'datetime'), col('type', 'Movement', 'badge'), col('product', 'Product'), col('batch', 'Batch'), col('quantity', 'Qty', 'qty', { packKey: 'packSize' }), col('balance', 'Balance', 'qty', { packKey: 'packSize' }), col('user', 'User'), col('note', 'Reference / note')],
    rows,
  });
}

function adjustments(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT a.adjustment_no AS no, a.created_at AS createdAt, ${PRODUCT_NAME} AS product, b.batch_number AS batch, a.direction, a.reason,
            p.pack_size AS packSize, a.quantity, CASE WHEN a.direction = 'OUT' THEN a.cost_value ELSE -a.cost_value END AS costImpact, a.notes, u.full_name AS user
     FROM stock_adjustments a JOIN products p ON p.id = a.product_id JOIN batches b ON b.id = a.batch_id LEFT JOIN users u ON u.id = a.created_by
     WHERE a.created_at >= ? AND a.created_at < ? AND a.reason <> 'OPENING_STOCK' ORDER BY a.id`,
    r.start,
    r.end,
  );
  for (const row of rows) row.reason = String(row.reason).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const showCost = can(ctx, 'inventory.cost_view');
  return result(ctx, 'adjustments', r.label, {
    columns: [col('no', 'No.'), col('createdAt', 'Date / time', 'datetime'), col('product', 'Product'), col('batch', 'Batch'), col('direction', 'Dir.', 'badge'), col('reason', 'Reason'), col('quantity', 'Qty', 'qty', { packKey: 'packSize' }), ...(showCost ? [col('costImpact', 'Loss at cost', 'money')] : []), col('user', 'User'), col('notes', 'Notes')],
    rows,
    totals: showCost ? { no: `${rows.length} adjustments`, costImpact: rows.reduce((s, x) => s + Number(x.costImpact), 0) } : undefined,
  });
}

/* ───────────────────────────── Purchases ───────────────────────────── */

function purchaseRegister(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT pu.purchase_no AS purchaseNo, pu.invoice_date AS invoiceDate, s.name AS supplier, pu.supplier_invoice_no AS supplierInvoice,
            (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS items, pu.subtotal, pu.discount_total + pu.invoice_discount AS discount,
            pu.tax_total AS tax, pu.other_charges AS charges, pu.total, pu.paid_amount AS paid, pu.status
     FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
     WHERE pu.status <> 'DRAFT' AND pu.invoice_date >= ? AND pu.invoice_date <= ? ${p.supplierId ? 'AND pu.supplier_id = ?' : ''} ORDER BY pu.invoice_date, pu.id`,
    r.from,
    r.to,
    ...(p.supplierId ? [p.supplierId] : []),
  );
  const posted = rows.filter((x) => x.status === 'POSTED');
  const totals = sumBy(posted, ['items', 'subtotal', 'discount', 'tax', 'charges', 'total', 'paid']);
  return result(ctx, 'purchase-register', r.label, {
    columns: [col('purchaseNo', 'Purchase'), col('invoiceDate', 'Date', 'date'), col('supplier', 'Supplier'), col('supplierInvoice', 'Supplier inv.'), col('items', 'Items', 'number'), col('subtotal', 'Gross', 'money'), col('discount', 'Discount', 'money'), col('tax', 'Tax', 'money'), col('charges', 'Charges', 'money'), col('total', 'Total', 'money'), col('paid', 'Paid', 'money'), col('status', 'Status', 'badge')],
    rows,
    totals: { purchaseNo: `${posted.length} posted`, ...totals },
    summary: [
      { label: 'Purchases', value: totals.total, type: 'money' },
      { label: 'Invoices', value: posted.length, type: 'number' },
      { label: 'Paid at posting', value: totals.paid, type: 'money' },
    ],
  });
}

function purchasesBySupplier(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT s.name AS supplier, COUNT(pu.id) AS invoices, COALESCE(SUM(pu.total), 0) AS purchases,
            COALESCE((SELECT SUM(amount) FROM payments pay WHERE pay.supplier_id = s.id AND pay.status = 'POSTED' AND pay.payment_date >= ? AND pay.payment_date <= ?), 0) AS paid,
            COALESCE((SELECT SUM(amount) FROM supplier_transactions t WHERE t.supplier_id = s.id), 0) AS balance
     FROM suppliers s LEFT JOIN purchases pu ON pu.supplier_id = s.id AND pu.status = 'POSTED' AND pu.invoice_date >= ? AND pu.invoice_date <= ?
     GROUP BY s.id HAVING invoices > 0 OR paid > 0 OR balance <> 0 ORDER BY purchases DESC`,
    r.from,
    r.to,
    r.from,
    r.to,
  );
  return result(ctx, 'purchases-by-supplier', r.label, {
    columns: [col('supplier', 'Supplier'), col('invoices', 'Invoices', 'number'), col('purchases', 'Purchases', 'money'), col('paid', 'Paid in period', 'money'), col('balance', 'Balance now', 'money')],
    rows,
    totals: { supplier: 'Total', ...sumBy(rows, ['invoices', 'purchases', 'paid', 'balance']) },
    chart: { type: 'bar', xKey: 'supplier', series: [{ key: 'purchases', label: 'Purchases', type: 'money' }], data: rows.slice(0, 12).map((x) => ({ supplier: x.supplier as string, purchases: x.purchases as number })) },
  });
}

function purchasesByProduct(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT p.code, ${PRODUCT_NAME} AS product, p.pack_size AS packSize, SUM(i.quantity) AS quantity, SUM(i.bonus_quantity) AS bonus,
            SUM(i.line_total) AS total, CAST(ROUND(SUM(i.landed_cost_price * (i.quantity + i.bonus_quantity)) * 1.0 / MAX(SUM(i.quantity + i.bonus_quantity), 1)) AS INTEGER) AS avgLanded,
            COUNT(DISTINCT pu.id) AS invoices
     FROM purchase_items i JOIN purchases pu ON pu.id = i.purchase_id JOIN products p ON p.id = i.product_id
     WHERE pu.status = 'POSTED' AND pu.invoice_date >= ? AND pu.invoice_date <= ? ${p.supplierId ? 'AND pu.supplier_id = ?' : ''}
     GROUP BY p.id ORDER BY total DESC`,
    r.from,
    r.to,
    ...(p.supplierId ? [p.supplierId] : []),
  );
  return result(ctx, 'purchases-by-product', r.label, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('invoices', 'Invoices', 'number'), col('quantity', 'Qty bought', 'qty', { packKey: 'packSize' }), col('bonus', 'Bonus', 'qty', { packKey: 'packSize' }), col('total', 'Total cost', 'money'), col('avgLanded', 'Avg landed / pack', 'money')],
    rows,
    totals: { product: `${rows.length} products`, total: rows.reduce((s, x) => s + Number(x.total), 0) },
  });
}

/* ───────────────────────────── Financial ───────────────────────────── */

function profitLoss(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const m = financialMetrics(ctx, r.from, r.to);
  const statement: NonNullable<ReportResult['statement']> = [
    { label: 'Gross sales', value: m.grossSales, level: 1 },
    { label: 'Less: discounts', value: -m.discounts, level: 1 },
    { label: 'Less: tax collected', value: -(m.taxCollected + m.returnsTax), level: 1, emphasis: 'muted' },
    { label: 'Cash rounding', value: m.roundOff, level: 1, emphasis: 'muted' },
    { label: 'Net sales', value: m.netSales, level: 0, emphasis: 'total' },
    { label: `Less: sales returns (${m.returnsCount})`, value: -m.returns, level: 1 },
    { label: 'Revenue', value: m.revenue, level: 0, emphasis: 'total' },
    { label: 'Cost of goods sold', value: -m.cogsSold, level: 1 },
    { label: 'Cost of restocked returns', value: m.cogsReturned, level: 1 },
    { label: 'Gross profit', value: m.grossProfit, level: 0, emphasis: 'total', note: m.grossMargin !== null ? `${(m.grossMargin * 100).toFixed(1)}% margin` : undefined },
    { label: 'Inventory losses (write-offs, net of supplier credits)', value: -m.inventoryLosses, level: 1 },
    ...m.expensesByCategory.map((e) => ({ label: e.category, value: -e.amount, level: 2 as const })),
    { label: 'Total operating expenses', value: -m.expenses, level: 1 },
    { label: 'Net operating result', value: m.netOperatingResult, level: 0, emphasis: 'grand' },
  ];
  return result(ctx, 'profit-loss', r.label, {
    columns: [col('label', 'Line'), col('value', 'Amount', 'money')],
    rows: statement.map((s) => ({ label: s.label, value: s.value })),
    statement,
    summary: [
      { label: 'Revenue', value: m.revenue, type: 'money' },
      { label: 'Gross profit', value: m.grossProfit, type: 'money', tone: m.grossProfit >= 0 ? 'positive' : 'negative' },
      { label: 'Gross margin', value: m.grossMargin !== null ? m.grossMargin * 100 : null, type: 'percent' },
      { label: 'Net operating result', value: m.netOperatingResult, type: 'money', tone: m.netOperatingResult >= 0 ? 'positive' : 'negative' },
    ],
    notes: [
      'Accrual basis: revenue is recognised at the time of sale (credit sales included); returns reduce revenue on the return date.',
      'COGS uses the exact cost of the batch each unit was sold from. Purchases are inventory, not expenses — they affect profit only when sold.',
      'Tax collected is excluded from revenue. Supplier payments are not expenses.',
    ],
  });
}

function expensesReport(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT e.expense_no AS no, e.expense_date AS date, c.name AS category, e.description, e.payment_method AS method, e.reference, e.amount, u.full_name AS user
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
     WHERE e.status = 'POSTED' AND e.expense_date >= ? AND e.expense_date <= ? ORDER BY e.expense_date, e.id`,
    r.from,
    r.to,
  );
  for (const row of rows) row.method = PAYMENT_METHOD_LABELS[row.method as string] ?? row.method;
  const byCat = new Map<string, number>();
  for (const row of rows) byCat.set(row.category as string, (byCat.get(row.category as string) ?? 0) + Number(row.amount));
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  return result(ctx, 'expenses', r.label, {
    columns: [col('no', 'No.'), col('date', 'Date', 'date'), col('category', 'Category'), col('description', 'Description'), col('method', 'Paid by'), col('reference', 'Reference'), col('amount', 'Amount', 'money'), col('user', 'Recorded by')],
    rows,
    totals: { no: `${rows.length} expenses`, amount: total },
    summary: Array.from(byCat.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, value]) => ({ label, value, type: 'money' as const })),
    chart: { type: 'pie', xKey: 'category', series: [{ key: 'amount', label: 'Amount', type: 'money' }], data: Array.from(byCat.entries()).map(([category, amount]) => ({ category, amount })) },
  });
}

function cashReport(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT cs.session_no AS sessionNo, cs.opened_at AS openedAt, uo.full_name AS openedBy, cs.closed_at AS closedAt, uc.full_name AS closedBy,
            cs.opening_cash AS opening, cs.expected_cash AS expected, cs.counted_cash AS counted, cs.variance, cs.status
     FROM cash_sessions cs JOIN users uo ON uo.id = cs.opened_by LEFT JOIN users uc ON uc.id = cs.closed_by
     WHERE cs.opened_at >= ? AND cs.opened_at < ? ORDER BY cs.id`,
    r.start,
    r.end,
  );
  const closed = rows.filter((x) => x.status === 'CLOSED');
  return result(ctx, 'cash-report', r.label, {
    columns: [col('sessionNo', 'Shift'), col('openedAt', 'Opened', 'datetime'), col('openedBy', 'Opened by'), col('closedAt', 'Closed', 'datetime'), col('closedBy', 'Closed by'), col('opening', 'Opening', 'money'), col('expected', 'Expected', 'money'), col('counted', 'Counted', 'money'), col('variance', 'Variance', 'money'), col('status', 'Status', 'badge')],
    rows,
    totals: { sessionNo: `${rows.length} shifts`, variance: closed.reduce((s, x) => s + Number(x.variance ?? 0), 0) },
    summary: [
      { label: 'Shifts', value: rows.length, type: 'number' },
      { label: 'Net variance', value: closed.reduce((s, x) => s + Number(x.variance ?? 0), 0), type: 'money', tone: closed.some((x) => Number(x.variance) !== 0) ? 'warning' : 'neutral' },
      { label: 'Shifts with variance', value: closed.filter((x) => Number(x.variance) !== 0).length, type: 'number' },
    ],
  });
}

function supplierBalances(ctx: ServiceContext): ReportResult {
  const t = today(ctx);
  const suppliers = all<{ id: number; name: string; phone: string | null; terms: number; balance: number; lastPurchase: string | null; lastPayment: string | null }>(
    ctx,
    `SELECT s.id, s.name, s.phone, s.payment_terms_days AS terms, COALESCE((SELECT SUM(amount) FROM supplier_transactions t WHERE t.supplier_id = s.id), 0) AS balance,
            (SELECT MAX(invoice_date) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'POSTED') AS lastPurchase,
            (SELECT MAX(payment_date) FROM payments p WHERE p.supplier_id = s.id AND p.status = 'POSTED') AS lastPayment
     FROM suppliers s ORDER BY balance DESC`,
  ).filter((s) => s.balance !== 0);
  const rows = suppliers.map((s) => {
    // FIFO aging: the outstanding balance is attributed to the most recent debit entries
    const debits = all<{ date: string; amount: number }>(ctx, `SELECT txn_date AS date, amount FROM supplier_transactions WHERE supplier_id = ? AND amount > 0 ORDER BY txn_date DESC, id DESC`, s.id);
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    let remaining = Math.max(0, s.balance);
    for (const d of debits) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, d.amount);
      const age = daysBetween(d.date, t);
      if (age <= s.terms) buckets.current += take;
      else if (age <= 30) buckets.d30 += take;
      else if (age <= 60) buckets.d60 += take;
      else if (age <= 90) buckets.d90 += take;
      else buckets.over90 += take;
      remaining -= take;
    }
    return { supplier: s.name, phone: s.phone, terms: s.terms, lastPurchase: s.lastPurchase, lastPayment: s.lastPayment, balance: s.balance, ...buckets };
  });
  const totals = sumBy(rows, ['balance', 'current', 'd30', 'd60', 'd90', 'over90']);
  return result(ctx, 'supplier-balances', `As of ${t}`, {
    columns: [col('supplier', 'Supplier'), col('phone', 'Phone'), col('terms', 'Terms (days)', 'number'), col('lastPurchase', 'Last purchase', 'date'), col('lastPayment', 'Last payment', 'date'), col('current', 'Within terms', 'money'), col('d30', '≤ 30 days', 'money'), col('d60', '31–60', 'money'), col('d90', '61–90', 'money'), col('over90', '> 90', 'money'), col('balance', 'Balance', 'money')],
    rows,
    totals: { supplier: `${rows.length} suppliers`, ...totals },
    summary: [
      { label: 'Total payable', value: rows.filter((x) => x.balance > 0).reduce((s, x) => s + x.balance, 0), type: 'money' },
      { label: 'Overdue > 60 days', value: totals.d90 + totals.over90, type: 'money', tone: totals.d90 + totals.over90 ? 'negative' : 'neutral' },
      { label: 'Advances to suppliers', value: -rows.filter((x) => x.balance < 0).reduce((s, x) => s + x.balance, 0), type: 'money' },
    ],
    notes: ['Aging attributes the outstanding balance to the most recent purchases first (FIFO settlement). Amounts past the supplier’s payment terms are aged from the invoice date.'],
  });
}

function customerBalances(ctx: ServiceContext): ReportResult {
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT c.code, c.name AS customer, c.phone, c.credit_limit AS creditLimit, COALESCE((SELECT SUM(amount) FROM customer_transactions t WHERE t.customer_id = c.id), 0) AS balance,
            (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED') AS lastSale,
            (SELECT MAX(payment_date) FROM payments p WHERE p.customer_id = c.id AND p.status = 'POSTED') AS lastPayment
     FROM customers c ORDER BY balance DESC`,
  ).filter((x) => Number(x.balance) !== 0);
  return result(ctx, 'customer-balances', `As of ${today(ctx)}`, {
    columns: [col('code', 'Code'), col('customer', 'Customer'), col('phone', 'Phone'), col('creditLimit', 'Credit limit', 'money'), col('lastSale', 'Last sale', 'datetime'), col('lastPayment', 'Last payment', 'date'), col('balance', 'Balance', 'money')],
    rows,
    totals: { customer: `${rows.length} customers`, balance: rows.reduce((s, x) => s + Number(x.balance), 0) },
    summary: [{ label: 'Total receivable', value: rows.filter((x) => Number(x.balance) > 0).reduce((s, x) => s + Number(x.balance), 0), type: 'money' }],
  });
}

function paymentsRegister(ctx: ServiceContext, p: Params): ReportResult {
  const r = range(ctx, p);
  const rows = all<Record<string, unknown>>(
    ctx,
    `SELECT pay.payment_no AS no, pay.payment_date AS date, CASE pay.direction WHEN 'OUT' THEN 'Paid to supplier' ELSE 'Received from customer' END AS type,
            COALESCE(s.name, c.name) AS party, pay.method, pay.reference, pay.amount, pay.status
     FROM payments pay LEFT JOIN suppliers s ON s.id = pay.supplier_id LEFT JOIN customers c ON c.id = pay.customer_id
     WHERE pay.payment_date >= ? AND pay.payment_date <= ? ORDER BY pay.payment_date, pay.id`,
    r.from,
    r.to,
  );
  for (const row of rows) row.method = PAYMENT_METHOD_LABELS[row.method as string] ?? row.method;
  const posted = rows.filter((x) => x.status === 'POSTED');
  return result(ctx, 'payments-register', r.label, {
    columns: [col('no', 'No.'), col('date', 'Date', 'date'), col('type', 'Type'), col('party', 'Party'), col('method', 'Method'), col('reference', 'Reference'), col('amount', 'Amount', 'money'), col('status', 'Status', 'badge')],
    rows,
    summary: [
      { label: 'Paid to suppliers', value: posted.filter((x) => x.type === 'Paid to supplier').reduce((s, x) => s + Number(x.amount), 0), type: 'money' },
      { label: 'Received from customers', value: posted.filter((x) => x.type !== 'Paid to supplier').reduce((s, x) => s + Number(x.amount), 0), type: 'money' },
    ],
  });
}

/* ───────────────────────────── Analytics ───────────────────────────── */

function productVelocity(ctx: ServiceContext, p: Params) {
  const r = range(ctx, p);
  const t = today(ctx);
  return {
    r,
    rows: all<Record<string, number | string | null>>(
      ctx,
      `WITH sold AS (
         SELECT si.product_id, SUM(si.quantity - si.returned_quantity) AS qty, SUM(si.line_total - si.tax_amount) AS revenue, SUM(si.cost_amount) AS cogs,
                MAX(s.created_at) AS lastSale
         FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY si.product_id
       ), stock AS (
         SELECT product_id, SUM(CASE WHEN status = 'ACTIVE' AND expiry_date > ? THEN quantity_on_hand ELSE 0 END) AS onHand,
                CAST(ROUND(SUM(CASE WHEN expiry_date > ? THEN quantity_on_hand * cost_price ELSE 0 END) * 1.0) AS INTEGER) AS costUnits
         FROM batches GROUP BY product_id
       ), everSold AS (
         SELECT si.product_id, MAX(s.created_at) AS lastEver FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' GROUP BY si.product_id
       )
       SELECT p.id, p.code, ${PRODUCT_NAME} AS product, p.generic_name AS generic, p.pack_size AS packSize, COALESCE(sold.qty, 0) AS qty,
              COALESCE(sold.revenue, 0) AS revenue, COALESCE(sold.cogs, 0) AS cogs, COALESCE(stock.onHand, 0) AS onHand,
              CAST(ROUND(COALESCE(stock.costUnits, 0) * 1.0 / p.pack_size) AS INTEGER) AS stockCost, everSold.lastEver AS lastSale,
              p.default_sale_price AS price, p.default_cost_price AS cost
       FROM products p LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN stock ON stock.product_id = p.id LEFT JOIN everSold ON everSold.product_id = p.id
       WHERE p.is_active = 1`,
      r.start,
      r.end,
      t,
      t,
    ),
  };
}

function fastMoving(ctx: ServiceContext, p: Params): ReportResult {
  const { r, rows } = productVelocity(ctx, p);
  const days = Math.max(1, daysBetween(r.from, r.to) + 1);
  const out = rows
    .filter((x) => Number(x.qty) > 0)
    .sort((a, b) => Number(b.qty) - Number(a.qty))
    .slice(0, p.limit ?? 50)
    .map((x, i): Row => {
      const perDay = Number(x.qty) / days;
      return { rank: i + 1, ...x, perDay: Math.round(perDay * 10) / 10, daysLeft: perDay > 0 ? Math.floor(Number(x.onHand) / perDay) : null };
    });
  return result(ctx, 'fast-moving', r.label, {
    columns: [col('rank', '#', 'number'), col('code', 'Code'), col('product', 'Product'), col('qty', 'Sold', 'qty', { packKey: 'packSize' }), col('perDay', 'Units / day', 'number'), col('onHand', 'On hand', 'qty', { packKey: 'packSize' }), col('daysLeft', 'Days of stock', 'number'), col('revenue', 'Revenue', 'money')],
    rows: out,
    chart: { type: 'bar', xKey: 'product', series: [{ key: 'qty', label: 'Units sold', type: 'number' }], data: out.slice(0, 15).map((x) => ({ product: x.product as string, qty: x.qty as number })) },
    notes: ['Days of stock = sellable units ÷ average units sold per day in the period.'],
  });
}

function slowMoving(ctx: ServiceContext, p: Params): ReportResult {
  const { r, rows } = productVelocity(ctx, p);
  const threshold = p.threshold ?? 0;
  const t = today(ctx);
  const showCost = can(ctx, 'inventory.cost_view');
  const out = rows
    .filter((x) => Number(x.onHand) > 0 && Number(x.qty) <= threshold)
    .map((x): Row => ({ ...x, daysSinceSale: x.lastSale ? daysBetween(String(x.lastSale).slice(0, 10), t) : null }))
    .sort((a, b) => Number(b.stockCost) - Number(a.stockCost));
  return result(ctx, 'slow-moving', `${r.label} · sold ≤ ${threshold} units`, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('generic', 'Generic'), col('onHand', 'On hand', 'qty', { packKey: 'packSize' }), col('qty', 'Sold in period', 'qty', { packKey: 'packSize' }), col('lastSale', 'Last sale', 'datetime'), col('daysSinceSale', 'Days since sale', 'number'), ...(showCost ? [col('stockCost', 'Stock value (cost)', 'money')] : [])],
    rows: out,
    totals: showCost ? { product: `${out.length} products`, stockCost: out.reduce((s, x) => s + Number(x.stockCost), 0) } : { product: `${out.length} products` },
    summary: showCost ? [{ label: 'Capital tied up', value: out.reduce((s, x) => s + Number(x.stockCost), 0), type: 'money', tone: 'warning' }] : undefined,
  });
}

function bestSelling(ctx: ServiceContext, p: Params): ReportResult {
  const { r, rows } = productVelocity(ctx, p);
  const total = rows.reduce((s, x) => s + Number(x.revenue), 0);
  let cumulative = 0;
  const out = rows
    .filter((x) => Number(x.revenue) > 0)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, p.limit ?? 50)
    .map((x, i): Row => {
      cumulative += Number(x.revenue);
      return { rank: i + 1, ...x, profit: Number(x.revenue) - Number(x.cogs), share: total ? (Number(x.revenue) / total) * 100 : 0, cumulative: total ? (cumulative / total) * 100 : 0 };
    });
  return result(ctx, 'best-selling', r.label, {
    columns: stripProfit(
      ctx,
      [col('rank', '#', 'number'), col('code', 'Code'), col('product', 'Product'), col('qty', 'Sold', 'qty', { packKey: 'packSize' }), col('revenue', 'Revenue', 'money'), col('share', 'Share', 'percent'), col('cumulative', 'Cumulative', 'percent'), col('profit', 'Profit', 'money')],
      ['profit'],
    ),
    rows: out,
    chart: { type: 'bar', xKey: 'product', series: [{ key: 'revenue', label: 'Revenue', type: 'money' }], data: out.slice(0, 15).map((x) => ({ product: x.product as string, revenue: x.revenue as number })) },
  });
}

function lowMargin(ctx: ServiceContext, p: Params): ReportResult {
  const { r, rows } = productVelocity(ctx, p);
  const threshold = p.threshold ?? 10;
  const out = rows
    .map((x): Row => {
      const realised = Number(x.revenue) > 0 ? ((Number(x.revenue) - Number(x.cogs)) / Number(x.revenue)) * 100 : null;
      const listMargin = Number(x.price) > 0 ? ((Number(x.price) - Number(x.cost)) / Number(x.price)) * 100 : null;
      return { ...x, realised, listMargin };
    })
    .filter((x) => (x.realised !== null && x.realised < threshold) || (x.realised === null && x.listMargin !== null && x.listMargin < threshold && Number(x.onHand) > 0))
    .sort((a, b) => (a.realised ?? a.listMargin ?? 0) - (b.realised ?? b.listMargin ?? 0));
  return result(ctx, 'low-margin', `${r.label} · margin below ${threshold}%`, {
    columns: [col('code', 'Code'), col('product', 'Product'), col('qty', 'Sold', 'qty', { packKey: 'packSize' }), col('revenue', 'Revenue', 'money'), col('cogs', 'COGS', 'money'), col('realised', 'Realised margin', 'percent'), col('cost', 'Cost / pack', 'money'), col('price', 'Price / pack', 'money'), col('listMargin', 'List margin', 'percent')],
    rows: out,
    notes: ['Realised margin comes from actual sales in the period; list margin compares the current default price with the latest cost.'],
  });
}

/* ───────────────────────────── Dispatcher ───────────────────────────── */

const RUNNERS: Record<string, (ctx: ServiceContext, p: Params) => ReportResult> = {
  'sales-summary': salesSummary,
  'sales-register': salesRegister,
  'sales-by-product': salesByProduct,
  'sales-by-category': salesByCategory,
  'sales-by-cashier': salesByCashier,
  'sales-by-payment': salesByPayment,
  'sales-by-hour': salesByHour,
  'returns-register': returnsRegister,
  'current-stock': currentStock,
  'stock-valuation': stockValuation,
  'low-stock': (c, p) => reorderBased(c, p, 'low-stock'),
  'out-of-stock': (c, p) => reorderBased(c, p, 'out-of-stock'),
  reorder: (c, p) => reorderBased(c, p, 'reorder'),
  'expired-stock': (c, p) => expiryBased(c, p, 'expired-stock'),
  'expiring-stock': (c, p) => expiryBased(c, p, 'expiring-stock'),
  'batch-report': batchReport,
  'stock-movements': stockMovements,
  adjustments,
  'purchase-register': purchaseRegister,
  'purchases-by-supplier': purchasesBySupplier,
  'purchases-by-product': purchasesByProduct,
  'profit-loss': profitLoss,
  expenses: expensesReport,
  'cash-report': cashReport,
  'supplier-balances': supplierBalances,
  'customer-balances': customerBalances,
  'payments-register': paymentsRegister,
  'fast-moving': fastMoving,
  'slow-moving': slowMoving,
  'best-selling': bestSelling,
  'low-margin': lowMargin,
};

export function listReports(ctx: ServiceContext): ReportDefinition[] {
  return REPORTS.filter((r) => can(ctx, r.permission as PermissionKey));
}

export function runReport(ctx: ServiceContext, reportId: string, params: Params): ReportResult {
  const def = REPORTS.find((r) => r.id === reportId);
  const runner = RUNNERS[reportId];
  if (!def || !runner) throw new AppError('NOT_FOUND', 'Unknown report');
  requirePermission(ctx, def.permission as PermissionKey);
  return runner(ctx, params);
}
