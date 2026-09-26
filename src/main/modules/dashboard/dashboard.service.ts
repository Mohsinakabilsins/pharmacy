import type { DashboardData } from '@shared/types/reports';
import { addDays, eachDay, localDayRangeToUtc } from '@shared/dates';
import { stockStatus } from '@shared/calc/stock';
import { all, can, get, requireUser, today, type ServiceContext } from '../../core/context';
import { getSettings } from '../../core/settings';
import { computeCashSummary } from '../finance/cash.service';
import { financialMetrics } from '../reports/financials';

const PRODUCT_NAME = `p.brand_name || CASE WHEN p.strength IS NOT NULL AND p.strength <> '' THEN ' ' || p.strength ELSE '' END`;

export function dashboard(ctx: ServiceContext): DashboardData {
  requireUser(ctx);
  const t = today(ctx);
  const yesterday = addDays(t, -1);
  const settings = getSettings(ctx);
  const showFin = can(ctx, 'dashboard.financials') || can(ctx, 'reports.financial');
  const showCost = can(ctx, 'inventory.cost_view') || showFin;
  const todayM = financialMetrics(ctx, t, t);
  const yM = financialMetrics(ctx, yesterday, yesterday);
  const { start: todayStart, end: todayEnd } = localDayRangeToUtc(t, t);

  const purchasesToday = get<{ v: number }>(
    ctx,
    `SELECT COALESCE(SUM(total), 0) AS v FROM purchases WHERE status = 'POSTED' AND posted_at >= ? AND posted_at < ?`,
    todayStart,
    todayEnd,
  )!.v;
  const stock = get<{ cost: number; retail: number }>(
    ctx,
    `SELECT CAST(ROUND(COALESCE(SUM(b.quantity_on_hand * b.cost_price * 1.0 / p.pack_size), 0)) AS INTEGER) AS cost,
            CAST(ROUND(COALESCE(SUM(b.quantity_on_hand * b.sale_price * 1.0 / p.pack_size), 0)) AS INTEGER) AS retail
     FROM batches b JOIN products p ON p.id = b.product_id WHERE b.quantity_on_hand > 0 AND b.expiry_date > ?`,
    t,
  )!;
  const levels = all<{ id: number; name: string; onHand: number; min: number; reorder: number; max: number }>(
    ctx,
    `SELECT p.id, ${PRODUCT_NAME} AS name, p.min_stock AS min, p.reorder_level AS reorder, p.max_stock AS max,
            COALESCE((SELECT SUM(quantity_on_hand) FROM batches b WHERE b.product_id = p.id AND b.status = 'ACTIVE' AND b.expiry_date > ?), 0) AS onHand
     FROM products p WHERE p.is_active = 1`,
    t,
  );
  let low = 0;
  let out = 0;
  const lowList: DashboardData['alerts']['lowStock'] = [];
  for (const l of levels) {
    const st = stockStatus(l.onHand, l.min, l.reorder, l.max);
    if (st === 'OUT_OF_STOCK') out++;
    if (st === 'LOW_STOCK') low++;
    if (st === 'OUT_OF_STOCK' || st === 'LOW_STOCK' || st === 'REORDER') lowList.push({ productId: l.id, productName: l.name, onHand: l.onHand, reorderLevel: l.reorder, status: st });
  }
  lowList.sort((a, b) => a.onHand / Math.max(1, a.reorderLevel) - b.onHand / Math.max(1, b.reorderLevel));

  const warnUntil = addDays(t, settings.inventory.expiryWarningDays);
  const expiring = get<{ n: number; v: number }>(
    ctx,
    `SELECT COUNT(*) AS n, CAST(ROUND(COALESCE(SUM(b.quantity_on_hand * b.${showCost ? 'cost' : 'sale'}_price * 1.0 / p.pack_size), 0)) AS INTEGER) AS v
     FROM batches b JOIN products p ON p.id = b.product_id WHERE b.quantity_on_hand > 0 AND b.expiry_date > ? AND b.expiry_date <= ?`,
    t,
    warnUntil,
  )!;
  const expired = get<{ n: number; v: number }>(
    ctx,
    `SELECT COUNT(*) AS n, CAST(ROUND(COALESCE(SUM(b.quantity_on_hand * b.${showCost ? 'cost' : 'sale'}_price * 1.0 / p.pack_size), 0)) AS INTEGER) AS v
     FROM batches b JOIN products p ON p.id = b.product_id WHERE b.quantity_on_hand > 0 AND b.expiry_date <= ?`,
    t,
  )!;
  const payables = get<{ total: number; n: number }>(
    ctx,
    `SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS n FROM (SELECT supplier_id, SUM(amount) AS balance FROM supplier_transactions GROUP BY supplier_id) WHERE balance > 0`,
  )!;
  const receivables = get<{ total: number }>(
    ctx,
    `SELECT COALESCE(SUM(balance), 0) AS total FROM (SELECT customer_id, SUM(amount) AS balance FROM customer_transactions GROUP BY customer_id) WHERE balance > 0`,
  )!;

  // 30-day trend
  const from30 = addDays(t, -29);
  const r30 = localDayRangeToUtc(from30, t);
  const daily = all<{ d: string; revenue: number; cogs: number; invoices: number }>(
    ctx,
    `SELECT date(s.created_at, 'localtime') AS d, SUM(si.line_total - si.tax_amount) AS revenue, SUM(si.cost_amount) AS cogs, COUNT(DISTINCT s.id) AS invoices
     FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY d`,
    r30.start,
    r30.end,
  );
  const dailyReturns = all<{ d: string; amt: number; cost: number }>(
    ctx,
    `SELECT date(r.created_at, 'localtime') AS d, SUM(r.total - r.tax_total) AS amt, SUM(r.cost_total) AS cost FROM sale_returns r WHERE r.created_at >= ? AND r.created_at < ? GROUP BY d`,
    r30.start,
    r30.end,
  );
  const salesTrend = eachDay(from30, t).map((d) => {
    const s = daily.find((x) => x.d === d);
    const r = dailyReturns.find((x) => x.d === d);
    const revenue = (s?.revenue ?? 0) - (r?.amt ?? 0);
    const cogs = (s?.cogs ?? 0) - (r?.cost ?? 0);
    return { date: d, revenue, grossProfit: showFin ? revenue - cogs : null, invoices: s?.invoices ?? 0 };
  });

  const hourlyRows = all<{ h: number; v: number }>(
    ctx,
    `SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) AS h, SUM(total) AS v FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ? GROUP BY h`,
    todayStart,
    todayEnd,
  );
  const hourly = Array.from({ length: 15 }, (_, i) => {
    const hour = i + 8;
    return { hour, revenue: hourlyRows.find((x) => x.h === hour)?.v ?? 0 };
  });
  const paymentMix = all<{ method: string; amount: number }>(
    ctx,
    `SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY sp.method ORDER BY amount DESC`,
    todayStart,
    todayEnd,
  );
  const topProducts = all<DashboardData['topProducts'][number]>(
    ctx,
    `SELECT p.id AS productId, ${PRODUCT_NAME} AS name, SUM(si.quantity - si.returned_quantity) AS quantity, SUM(si.line_total - si.tax_amount) AS revenue,
            p.pack_size AS packSize, p.unit_name AS unitName
     FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? GROUP BY p.id ORDER BY revenue DESC LIMIT 8`,
    r30.start,
    r30.end,
  );
  const recentSales = all<DashboardData['recentSales'][number]>(
    ctx,
    `SELECT s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt, c.name AS customerName, s.total, s.status, u.full_name AS cashierName
     FROM sales s JOIN users u ON u.id = s.created_by LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC LIMIT 8`,
  );
  const recentPurchases = all<DashboardData['recentPurchases'][number]>(
    ctx,
    `SELECT p.id, p.purchase_no AS purchaseNo, s.name AS supplierName, p.invoice_date AS invoiceDate, p.total, p.status
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status <> 'VOID' ORDER BY p.id DESC LIMIT 6`,
  );
  const expiringList = all<DashboardData['alerts']['expiring'][number]>(
    ctx,
    `SELECT b.id AS batchId, ${PRODUCT_NAME} AS productName, b.batch_number AS batchNumber, b.expiry_date AS expiryDate, b.quantity_on_hand AS quantity,
            CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) AS daysToExpiry
     FROM batches b JOIN products p ON p.id = b.product_id WHERE b.quantity_on_hand > 0 AND b.expiry_date <= ? ORDER BY b.expiry_date LIMIT 8`,
    t,
    warnUntil,
  );
  const shiftRow = get<{ id: number; session_no: string; opened_at: string; name: string }>(
    ctx,
    `SELECT cs.id, cs.session_no, cs.opened_at, u.full_name AS name FROM cash_sessions cs JOIN users u ON u.id = cs.opened_by WHERE cs.status = 'OPEN'`,
  );
  const heldBills = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM held_bills')!.n;
  const productCount = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM products WHERE is_active = 1')!.n;
  const expensesToday = todayM.expenses;
  const salesToday = todayM.revenue + todayM.taxCollected;

  return {
    today: t,
    kpis: {
      salesToday,
      salesYesterday: yM.revenue + yM.taxCollected,
      invoicesToday: todayM.invoices,
      avgBillToday: todayM.invoices ? Math.round((todayM.netSales + todayM.taxCollected + todayM.returnsTax) / todayM.invoices) : 0,
      returnsToday: todayM.returns,
      purchasesToday,
      expensesToday,
      grossProfitToday: showFin ? todayM.grossProfit : null,
      grossProfitYesterday: showFin ? yM.grossProfit : null,
      netProfitToday: showFin ? todayM.netOperatingResult : null,
      stockValueCost: showCost ? stock.cost : null,
      stockValueRetail: stock.retail,
      productCount,
      lowStockCount: low,
      outOfStockCount: out,
      expiringSoonCount: expiring.n,
      expiringSoonValue: expiring.v,
      expiredCount: expired.n,
      expiredValue: expired.v,
      payablesTotal: payables.total,
      payablesSuppliers: payables.n,
      receivablesTotal: receivables.total,
      heldBills,
    },
    salesTrend,
    hourly,
    paymentMix,
    topProducts,
    recentSales,
    recentPurchases,
    alerts: { expiring: expiringList, lowStock: lowList.slice(0, 8) },
    shift: shiftRow
      ? { open: true, sessionNo: shiftRow.session_no, expectedCash: computeCashSummary(ctx, shiftRow.id).expectedCash, openedAt: shiftRow.opened_at, openedByName: shiftRow.name }
      : { open: false, sessionNo: null, expectedCash: null, openedAt: null, openedByName: null },
    expiryWarningDays: settings.inventory.expiryWarningDays,
  };
}
