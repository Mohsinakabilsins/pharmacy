import type { ServiceContext } from '../../core/context';
import { get, all } from '../../core/context';
import { localDayRangeToUtc } from '@shared/dates';

export interface FinancialMetrics {
  invoices: number;
  grossSales: number;
  discounts: number;
  taxCollected: number;
  roundOff: number;
  /** Net sales excluding tax (line totals − tax + round-off). */
  netSales: number;
  returnsCount: number;
  /** Returns excluding tax. */
  returns: number;
  returnsTax: number;
  revenue: number;
  cogsSold: number;
  cogsReturned: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  inventoryLosses: number;
  supplierCredits: number;
  expenses: number;
  expensesByCategory: Array<{ category: string; amount: number }>;
  netOperatingResult: number;
}

/**
 * Accrual-basis figures for a local date range (docs/BUSINESS_RULES.md §13).
 * Profit uses the exact batch cost captured on each sale item.
 */
export function financialMetrics(ctx: ServiceContext, from: string, to: string): FinancialMetrics {
  const { start, end } = localDayRangeToUtc(from, to);
  const s = get<{ invoices: number; gross: number; disc: number; tax: number; lt: number; cogs: number }>(
    ctx,
    `SELECT COUNT(DISTINCT s.id) AS invoices, COALESCE(SUM(si.gross_amount), 0) AS gross, COALESCE(SUM(si.discount_amount), 0) AS disc,
            COALESCE(SUM(si.tax_amount), 0) AS tax, COALESCE(SUM(si.line_total), 0) AS lt, COALESCE(SUM(si.cost_amount), 0) AS cogs
     FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?`,
    start,
    end,
  )!;
  const ro = get<{ ro: number }>(ctx, `SELECT COALESCE(SUM(round_off), 0) AS ro FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ?`, start, end)!.ro;
  const r = get<{ n: number; total: number; tax: number }>(
    ctx,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(tax_total), 0) AS tax FROM sale_returns WHERE created_at >= ? AND created_at < ?`,
    start,
    end,
  )!;
  const retCost = get<{ c: number }>(
    ctx,
    `SELECT COALESCE(SUM(ri.cost_amount), 0) AS c FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id
     WHERE ri.restock = 1 AND r.created_at >= ? AND r.created_at < ?`,
    start,
    end,
  )!.c;
  const adj = get<{ outv: number; inv: number }>(
    ctx,
    `SELECT COALESCE(SUM(CASE WHEN direction = 'OUT' THEN cost_value END), 0) AS outv,
            COALESCE(SUM(CASE WHEN direction = 'IN' AND reason <> 'OPENING_STOCK' THEN cost_value END), 0) AS inv
     FROM stock_adjustments WHERE created_at >= ? AND created_at < ?`,
    start,
    end,
  )!;
  const credits = get<{ c: number }>(
    ctx,
    `SELECT COALESCE(-SUM(amount), 0) AS c FROM supplier_transactions WHERE type = 'ADJUSTMENT' AND reference_type = 'adjustment' AND txn_date >= ? AND txn_date <= ?`,
    from,
    to,
  )!.c;
  const expensesByCategory = all<{ category: string; amount: number }>(
    ctx,
    `SELECT c.name AS category, SUM(e.amount) AS amount FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'POSTED' AND e.expense_date >= ? AND e.expense_date <= ? GROUP BY c.id ORDER BY amount DESC`,
    from,
    to,
  );
  const expenses = expensesByCategory.reduce((a, b) => a + b.amount, 0);
  const netSales = s.lt - s.tax + ro;
  const returns = r.total - r.tax;
  const revenue = netSales - returns;
  const cogs = s.cogs - retCost;
  const grossProfit = revenue - cogs;
  const inventoryLosses = adj.outv - adj.inv - credits;
  return {
    invoices: s.invoices,
    grossSales: s.gross,
    discounts: s.disc,
    taxCollected: s.tax - r.tax,
    roundOff: ro,
    netSales,
    returnsCount: r.n,
    returns,
    returnsTax: r.tax,
    revenue,
    cogsSold: s.cogs,
    cogsReturned: retCost,
    cogs,
    grossProfit,
    grossMargin: revenue !== 0 ? grossProfit / revenue : null,
    inventoryLosses,
    supplierCredits: credits,
    expenses,
    expensesByCategory,
    netOperatingResult: grossProfit - inventoryLosses - expenses,
  };
}
