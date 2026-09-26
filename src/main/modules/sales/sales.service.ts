import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { HoldBillSchema, SaleCompleteSchema, SaleDraftSchema, SaleListSchema } from '@shared/schemas/sales';
import type {
  HeldBillRow,
  QuoteAllocation,
  QuoteIssue,
  QuoteLine,
  SaleCompleted,
  SaleDetail,
  SaleItemDetail,
  SaleQuote,
  SaleRow,
} from '@shared/types/sales';
import type { Paged } from '@shared/types/common';
import type { PermissionKey } from '@shared/permissions';
import { calculateSale, discountAmount, type Discount, type SaleCalcLine } from '@shared/calc/sale';
import { daysToExpiry, isExpired } from '@shared/calc/stock';
import { addDays, localDayRangeToUtc, toLocalDate } from '@shared/dates';
import { BP_DENOMINATOR, sum } from '@shared/money';
import { audit } from '../../core/audit';
import { all, can, get, requirePermission, requireUser, run, today, transaction, type ServiceContext } from '../../core/context';
import { AppError, invalid, notFound, rule } from '../../core/errors';
import { overrides, type OverrideStore } from '../../core/overrides';
import { nextNumber } from '../../core/sequences';
import { getSettings } from '../../core/settings';
import { Where } from '../../core/sql';
import { allocate, applyMovement, type AllocatedBatch } from '../inventory/inventory.service';
import { customerBalance, openCashSessionId, postCustomerTxn } from '../finance/ledger';

type Draft = z.output<typeof SaleDraftSchema>;

interface ProductInfo {
  id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: number;
  unit_name: string;
  pack_name: string;
  allow_loose_sale: number;
  requires_prescription: number;
  is_controlled: number;
  is_active: number;
  tax_rate_bp: number;
  default_sale_price: number;
}

interface InternalLine {
  quote: QuoteLine;
  allocations: AllocatedBatch[];
  product: ProductInfo | null;
}

interface InternalQuote {
  quote: SaleQuote;
  lines: InternalLine[];
  calc: ReturnType<typeof calculateSale>;
  sessionId: number | null;
  /** Tokens (by permission) that satisfy overrides, to be consumed on completion. */
  tokenFor: Map<string, string>;
}

function productLabel(p: Pick<ProductInfo, 'brand_name' | 'strength'>): string {
  return p.strength ? `${p.brand_name} ${p.strength}` : p.brand_name;
}

/** Find a supplied override token that satisfies `permission` (without consuming it). */
function findToken(store: OverrideStore, tokens: string[], permission: PermissionKey): string | null {
  for (const t of tokens) if (store.peek(t, permission)) return t;
  return null;
}

/**
 * Build the authoritative sale quote: FEFO allocation, prices, discounts, tax, rounding and
 * every rule check. Used for live POS display and recomputed inside the completion transaction.
 */
export function buildQuote(ctx: ServiceContext, draft: Draft, store: OverrideStore = overrides): InternalQuote {
  const user = requireUser(ctx);
  const settings = getSettings(ctx);
  const t = today(ctx);
  const warnUntil = addDays(t, settings.inventory.expiryWarningDays);
  const blockDays = settings.inventory.blockSaleWithinDays;
  const sellableFrom = blockDays > 0 ? addDays(t, blockDays) : t;
  const issues: QuoteIssue[] = [];
  const required = new Set<string>();
  const tokenFor = new Map<string, string>();

  const needs = (permission: PermissionKey, issue: Omit<QuoteIssue, 'permission'>, opts: { always?: boolean } = {}) => {
    if (!opts.always && can(ctx, permission)) return false;
    const token = findToken(store, draft.overrideTokens, permission);
    if (token) {
      tokenFor.set(permission, token);
      return false;
    }
    required.add(permission);
    const target = issue.lineKey ? undefined : issues;
    const full = { ...issue, permission } as QuoteIssue;
    if (target) target.push(full);
    return full;
  };

  const lines: InternalLine[] = [];
  for (const l of draft.lines) {
    const p = get<ProductInfo>(
      ctx,
      `SELECT id, brand_name, generic_name, strength, dosage_form, pack_size, unit_name, pack_name, allow_loose_sale, requires_prescription,
              is_controlled, is_active, tax_rate_bp, default_sale_price FROM products WHERE id = ?`,
      l.productId,
    );
    const lineIssues: QuoteIssue[] = [];
    if (!p) {
      lineIssues.push({ code: 'NOT_FOUND', message: 'Product not found', severity: 'error', lineKey: l.key });
      lines.push({
        product: null,
        allocations: [],
        quote: {
          key: l.key, productId: l.productId, productName: 'Unknown product', genericName: null, strength: null, dosageForm: null, packSize: 1,
          unitName: 'Unit', packName: 'Pack', allowLooseSale: true, requiresPrescription: false, isControlled: false, quantity: l.quantity,
          allocatedQuantity: 0, available: 0, unitPrice: 0, priceOverridden: false, manualBatch: !!l.batchId, gross: 0, discount: 0, tax: 0,
          total: 0, taxRateBp: 0, allocations: [], issues: lineIssues,
        },
      });
      continue;
    }
    if (!p.is_active) lineIssues.push({ code: 'INACTIVE', message: 'Product is inactive', severity: 'error', lineKey: l.key });
    if (!p.allow_loose_sale && l.quantity % p.pack_size !== 0) {
      lineIssues.push({ code: 'LOOSE_NOT_ALLOWED', message: `Sold in whole ${p.pack_name.toLowerCase()}s of ${p.pack_size} only`, severity: 'error', lineKey: l.key });
    }

    // FEFO (or manual) allocation. Batches inside the block window are treated like expired for auto-selection.
    const alloc = allocate({ ...ctx, now: () => new Date(`${sellableFrom}T12:00:00`) } as ServiceContext, p.id, l.quantity, { batchId: l.batchId });
    const available = get<{ q: number }>(
      ctx,
      `SELECT COALESCE(SUM(quantity_on_hand), 0) AS q FROM batches WHERE product_id = ? AND status = 'ACTIVE' AND expiry_date > ? AND quantity_on_hand > 0`,
      p.id,
      sellableFrom,
    )!.q;
    if (alloc.blocked) {
      lineIssues.push({
        code: 'BLOCKED_BATCH',
        message: alloc.blocked === 'NOT_FOUND' ? 'Selected batch not found' : `Selected batch is ${alloc.blocked.toLowerCase()} and cannot be sold`,
        severity: 'error',
        lineKey: l.key,
      });
    } else if (alloc.shortfall > 0) {
      const allocated = l.quantity - alloc.shortfall;
      lineIssues.push({
        code: allocated === 0 ? 'NO_STOCK' : 'INSUFFICIENT_STOCK',
        message: allocated === 0 ? 'Out of stock' : `Only ${allocated} ${p.unit_name.toLowerCase()}(s) available`,
        severity: 'error',
        lineKey: l.key,
      });
    }

    const allocations: QuoteAllocation[] = alloc.allocations.map((a) => {
      const reallyExpired = isExpired(a.expiryDate, t);
      return {
        batchId: a.batchId,
        batchNumber: a.batchNumber,
        expiryDate: a.expiryDate,
        daysToExpiry: daysToExpiry(a.expiryDate, t),
        quantity: a.quantity,
        available: a.available,
        unitPrice: l.unitPrice ?? a.salePrice,
        expired: a.expired,
        nearExpiry: !reallyExpired && a.expiryDate <= warnUntil,
      };
    });
    for (const a of allocations) {
      if (a.expired) {
        const expiredNow = isExpired(a.expiryDate, t);
        const issue = needs(
          'sales.sell_expired',
          {
            code: 'EXPIRED_BATCH',
            message: expiredNow
              ? `Batch ${a.batchNumber} expired on ${a.expiryDate} — supervisor authorisation required`
              : `Batch ${a.batchNumber} expires ${a.expiryDate}, inside the ${blockDays}-day sale block — authorisation required`,
            severity: 'error',
            lineKey: l.key,
          },
          { always: true },
        );
        if (issue) lineIssues.push(issue);
      } else if (a.nearExpiry) {
        lineIssues.push({ code: 'NEAR_EXPIRY', message: `Batch ${a.batchNumber} expires in ${a.daysToExpiry} days`, severity: 'warning', lineKey: l.key });
      }
    }
    if (l.unitPrice != null) {
      const fefoPrice = alloc.allocations[0]?.salePrice ?? p.default_sale_price;
      if (l.unitPrice !== fefoPrice) {
        const issue = needs('sales.price_override', { code: 'PRICE_OVERRIDE', message: 'Price changed from batch price — authorisation required', severity: 'error', lineKey: l.key });
        if (issue) lineIssues.push(issue);
        const minCost = Math.max(0, ...alloc.allocations.map((a) => a.costPrice));
        if (l.unitPrice < minCost) lineIssues.push({ code: 'PRICE_BELOW_COST', message: 'Selling price is below cost', severity: 'warning', lineKey: l.key });
      }
    }
    if (p.is_controlled && settings.sales.prescriptionEnforcement !== 'off') {
      lineIssues.push({
        code: 'CONTROLLED',
        message: draft.prescriptionId ? 'Controlled medicine — prescription linked' : 'Controlled medicine — link a prescription to sell',
        severity: draft.prescriptionId ? 'warning' : 'error',
        lineKey: l.key,
      });
    } else if (p.requires_prescription && settings.sales.prescriptionEnforcement !== 'off' && !draft.prescriptionId) {
      lineIssues.push({
        code: 'RX_REQUIRED',
        message: settings.sales.prescriptionEnforcement === 'require' ? 'Prescription required — link a prescription to sell' : 'Prescription-only medicine — verify prescription',
        severity: settings.sales.prescriptionEnforcement === 'require' ? 'error' : 'warning',
        lineKey: l.key,
      });
    }
    lines.push({
      product: p,
      allocations: alloc.allocations,
      quote: {
        key: l.key,
        productId: p.id,
        productName: productLabel(p),
        genericName: p.generic_name,
        strength: p.strength,
        dosageForm: p.dosage_form,
        packSize: p.pack_size,
        unitName: p.unit_name,
        packName: p.pack_name,
        allowLooseSale: !!p.allow_loose_sale,
        requiresPrescription: !!p.requires_prescription,
        isControlled: !!p.is_controlled,
        quantity: l.quantity,
        allocatedQuantity: sum(alloc.allocations.map((a) => a.quantity)),
        available,
        unitPrice: l.unitPrice ?? alloc.allocations[0]?.salePrice ?? p.default_sale_price,
        priceOverridden: l.unitPrice != null,
        manualBatch: !!l.batchId,
        gross: 0,
        discount: 0,
        tax: 0,
        total: 0,
        taxRateBp: settings.tax.enabled ? p.tax_rate_bp : 0,
        allocations,
        issues: lineIssues,
      },
    });
  }

  // Calculation
  const calcLines: SaleCalcLine[] = lines.map((il, idx) => {
    const draftLine = draft.lines[idx];
    return {
      key: il.quote.key,
      discount: (draftLine.discount ?? null) as Discount | null,
      allocations: il.allocations.map((a) => ({
        key: `${il.quote.key}:${a.batchId}`,
        quantity: a.quantity,
        packSize: il.quote.packSize,
        unitPrice: draftLine.unitPrice ?? a.salePrice,
        unitCost: a.costPrice,
        taxRateBp: il.quote.taxRateBp,
      })),
    };
  });
  const calc = calculateSale({
    lines: calcLines,
    invoiceDiscount: (draft.invoiceDiscount ?? null) as Discount | null,
    taxEnabled: settings.tax.enabled,
    taxMode: settings.tax.mode,
    roundingStep: settings.sales.roundingStep,
  });
  calc.lines.forEach((lr, idx) => {
    const q = lines[idx].quote;
    q.gross = lr.gross;
    q.discount = lr.discount;
    q.tax = lr.tax;
    q.total = lr.total;
  });

  // Discount permissions and limits
  const maxBp = settings.sales.maxDiscountBp;
  const exceeds = (requested: number, base: number) => base > 0 && requested * BP_DENOMINATOR > base * maxBp;
  const anyDiscount = draft.lines.some((l) => (l.discount?.value ?? 0) > 0) || (draft.invoiceDiscount?.value ?? 0) > 0;
  if (anyDiscount) {
    needs('sales.discount', { code: 'DISCOUNT_NOT_ALLOWED', message: 'You are not permitted to give discounts — authorisation required', severity: 'error' });
    let over = false;
    calc.lines.forEach((lr) => {
      if (exceeds(lr.requestedDiscount, lr.gross)) over = true;
    });
    const invBase = calc.subtotal - calc.lineDiscountTotal;
    if (exceeds(calc.requestedInvoiceDiscount, invBase)) over = true;
    if (calc.discountTotal * BP_DENOMINATOR > calc.subtotal * maxBp) over = true;
    if (over) {
      needs('sales.discount_unlimited', {
        code: 'DISCOUNT_LIMIT',
        message: `Discount exceeds the ${maxBp / 100}% limit — supervisor authorisation required`,
        severity: 'error',
      });
    }
    for (const l of draft.lines) {
      if (l.discount?.type === 'AMOUNT' && l.discount.value > 0) {
        const lr = calc.lines.find((x) => x.key === l.key);
        if (lr && l.discount.value > lr.gross) {
          issues.push({ code: 'DISCOUNT_LIMIT', message: 'Line discount is larger than the line amount', severity: 'warning', lineKey: l.key });
        }
      }
    }
  }

  // Customer
  let customer: SaleQuote['customer'] = null;
  if (draft.customerId) {
    const c = get<{ id: number; name: string; phone: string | null; credit_limit: number; is_active: number }>(
      ctx,
      'SELECT id, name, phone, credit_limit, is_active FROM customers WHERE id = ?',
      draft.customerId,
    );
    if (!c) issues.push({ code: 'CUSTOMER_REQUIRED', message: 'Selected customer not found', severity: 'error' });
    else customer = { id: c.id, name: c.name, phone: c.phone, balance: customerBalance(ctx, c.id), creditLimit: c.credit_limit };
  }

  // Prescription enforcement and shift
  const sessionId = openCashSessionId(ctx);
  if (!sessionId && settings.sales.requireOpenShift) {
    issues.push({ code: 'SHIFT_REQUIRED', message: 'Open a cash shift to start selling', severity: 'error' });
  }

  const lineIssues = lines.flatMap((l) => l.quote.issues);
  const hasErrors = issues.some((i) => i.severity === 'error' && !i.permission) || lineIssues.some((i) => i.severity === 'error' && !i.permission);
  const quote: SaleQuote = {
    lines: lines.map((l) => l.quote),
    subtotal: calc.subtotal,
    lineDiscountTotal: calc.lineDiscountTotal,
    invoiceDiscountTotal: calc.invoiceDiscountTotal,
    discountTotal: calc.discountTotal,
    taxTotal: calc.taxTotal,
    preRoundTotal: calc.preRoundTotal,
    roundOff: calc.roundOff,
    total: calc.total,
    unitCount: sum(lines.map((l) => l.quote.quantity)),
    issues,
    requiredOverrides: Array.from(required),
    canComplete: lines.length > 0 && !hasErrors && required.size === 0,
    customer,
    shiftOpen: !!sessionId,
    taxEnabled: settings.tax.enabled,
    taxLabel: settings.tax.label,
  };
  void user;
  return { quote, lines, calc, sessionId, tokenFor };
}

export function quoteSale(ctx: ServiceContext, draft: Draft): SaleQuote {
  return buildQuote(ctx, draft).quote;
}

type CompleteInput = z.output<typeof SaleCompleteSchema>;

export function completeSale(ctx: ServiceContext, input: CompleteInput, store: OverrideStore = overrides): SaleCompleted {
  const user = requirePermission(ctx, 'pos.access');
  const settings = getSettings(ctx);
  return transaction(ctx, () => {
    const iq = buildQuote(ctx, input, store);
    const q = iq.quote;
    if (q.lines.length === 0) throw rule('The bill is empty');
    const blocking = [...q.issues, ...q.lines.flatMap((l) => l.issues)].filter((i) => i.severity === 'error');
    const shiftIssue = blocking.find((i) => i.code === 'SHIFT_REQUIRED');
    if (shiftIssue) throw new AppError('SHIFT_REQUIRED', shiftIssue.message);
    const stock = blocking.find((i) => i.code === 'INSUFFICIENT_STOCK' || i.code === 'NO_STOCK');
    if (stock) {
      const line = q.lines.find((l) => l.key === stock.lineKey);
      throw new AppError('INSUFFICIENT_STOCK', `${line?.productName ?? 'Item'}: ${stock.message}`);
    }
    const rx = blocking.find((i) => i.code === 'RX_REQUIRED' || i.code === 'CONTROLLED');
    if (rx) throw new AppError('PRESCRIPTION_REQUIRED', rx.message);
    if (q.requiredOverrides.length > 0) {
      throw new AppError('OVERRIDE_REQUIRED', 'Supervisor authorisation is required to complete this sale', undefined, { permissions: q.requiredOverrides });
    }
    const other = blocking.find((i) => !i.permission);
    if (other) throw rule(other.message);
    if (q.total !== input.expectedTotal) {
      throw new AppError('QUOTE_CHANGED', 'Prices or stock changed while the bill was open. Please review the updated total and try again.', undefined, { total: q.total });
    }

    // Payments
    const cash = sum(input.payments.filter((p) => p.method === 'CASH').map((p) => p.amount));
    const credit = sum(input.payments.filter((p) => p.method === 'CREDIT').map((p) => p.amount));
    const paidTotal = sum(input.payments.filter((p) => p.method !== 'CREDIT').map((p) => p.amount));
    if (paidTotal + credit !== q.total) throw invalid(`Payments (${(paidTotal + credit) / 100}) do not match the bill total (${q.total / 100})`);
    if (input.payments.some((p) => p.amount < 0)) throw invalid('Payment amounts cannot be negative');
    if (cash > 0 && input.cashTendered < cash) throw invalid('Cash received is less than the cash amount due', { cashTendered: 'Less than cash due' });
    const changeDue = cash > 0 ? input.cashTendered - cash : 0;
    if (credit > 0) {
      if (!settings.sales.allowCreditSales) throw rule('Credit sales are disabled in settings');
      if (!input.customerId || !q.customer) throw invalid('Select a customer for a credit sale');
      if (!can(ctx, 'sales.credit')) {
        const token = findToken(store, input.overrideTokens, 'sales.credit');
        if (!token) throw new AppError('OVERRIDE_REQUIRED', 'Supervisor authorisation is required for credit sales', undefined, { permissions: ['sales.credit'] });
        iq.tokenFor.set('sales.credit', token);
      }
      if (q.customer.creditLimit > 0 && q.customer.balance + credit > q.customer.creditLimit) {
        throw rule(`Credit limit exceeded for ${q.customer.name} (limit ${q.customer.creditLimit / 100}, balance ${q.customer.balance / 100})`);
      }
    }

    // Consume override tokens (single use)
    const grants = Array.from(iq.tokenFor.entries()).map(([perm, token]) => store.consume(token, perm as PermissionKey));

    const now = ctx.now().toISOString();
    const invoiceNo = nextNumber(ctx, 'sale');
    const res = run(
      ctx,
      `INSERT INTO sales (uuid, invoice_no, customer_id, prescription_id, cash_session_id, status, subtotal, discount_total, tax_total, round_off, total,
         paid_total, cash_tendered, change_due, credit_amount, cost_total, item_count, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), invoiceNo, input.customerId ?? null, input.prescriptionId ?? null, iq.sessionId, q.subtotal, q.discountTotal, q.taxTotal,
      q.roundOff, q.total, paidTotal, cash > 0 ? input.cashTendered : 0, changeDue, credit, iq.calc.costTotal, q.unitCount, input.notes, user.id, now,
    );
    const saleId = Number(res.lastInsertRowid);

    const insItem = ctx.sqlite.prepare(
      `INSERT INTO sale_items (sale_id, line_no, product_id, batch_id, product_name, batch_number, expiry_date, pack_size, quantity, unit_price,
         unit_cost, gross_amount, discount_amount, tax_rate_bp, tax_amount, line_total, cost_amount, expired_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rowByKey = new Map(iq.calc.rows.map((r) => [r.key, r]));
    let lineNo = 0;
    const expiredLines: string[] = [];
    for (const il of iq.lines) {
      const p = il.product!;
      const draftLine = input.lines.find((l) => l.key === il.quote.key)!;
      for (const a of il.allocations) {
        const r = rowByKey.get(`${il.quote.key}:${a.batchId}`)!;
        lineNo += 1;
        const unitPrice = draftLine.unitPrice ?? a.salePrice;
        insItem.run(
          saleId, lineNo, p.id, a.batchId, productLabel(p), a.batchNumber, a.expiryDate, p.pack_size, a.quantity, unitPrice, a.costPrice,
          r.gross, r.discount, il.quote.taxRateBp, r.tax, r.lineTotal, r.cost, a.expired ? 1 : 0,
        );
        applyMovement(ctx, { batchId: a.batchId, type: 'SALE', quantity: -a.quantity, referenceType: 'sale', referenceId: saleId, note: invoiceNo });
        if (a.expired) expiredLines.push(`${productLabel(p)} batch ${a.batchNumber} (exp ${a.expiryDate}) × ${a.quantity}`);
      }
    }
    const insPay = ctx.sqlite.prepare('INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES (?, ?, ?, ?)');
    for (const p of input.payments) if (p.amount > 0) insPay.run(saleId, p.method, p.amount, p.reference);

    if (credit > 0 && input.customerId) {
      postCustomerTxn(ctx, input.customerId, { type: 'SALE_CREDIT', amount: credit, referenceType: 'sale', referenceId: saleId, description: `Credit sale ${invoiceNo}` });
    }

    audit(ctx, {
      action: 'SALE_CREATE',
      entityType: 'sale',
      entityId: saleId,
      description: `Sale ${invoiceNo}: ${q.lines.length} item(s), total ${q.total / 100}${q.customer ? ` to ${q.customer.name}` : ''}`,
      details: {
        total: q.total,
        discount: q.discountTotal,
        payments: input.payments.map((p) => ({ method: p.method, amount: p.amount })),
        overrides: grants.map((g) => ({ permission: g.permission, by: g.grantedByName })),
      },
    });
    if (expiredLines.length) {
      const grant = grants.find((g) => g.permission === 'sales.sell_expired');
      audit(ctx, {
        action: 'EXPIRED_STOCK_OVERRIDE',
        entityType: 'sale',
        entityId: saleId,
        description: `Expired stock sold on ${invoiceNo}, authorised by ${grant?.grantedByName ?? user.fullName}: ${expiredLines.join('; ')}`,
        severity: 'CRITICAL',
        details: { authorisedBy: grant?.grantedById ?? user.id, lines: expiredLines },
      });
    }
    return { saleId, invoiceNo, total: q.total, paidTotal, changeDue, creditAmount: credit };
  });
}

/* ─────────────────────────────── Held bills ─────────────────────────────── */

export function holdBill(ctx: ServiceContext, input: z.output<typeof HoldBillSchema>): HeldBillRow {
  const user = requirePermission(ctx, 'pos.access');
  if (input.draft.lines.length === 0) throw rule('Nothing to hold — the bill is empty');
  const count = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM held_bills')!.n;
  const label = input.label || `Bill ${count + 1}`;
  const res = run(
    ctx,
    'INSERT INTO held_bills (label, customer_id, payload, item_count, total_estimate, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    label,
    input.customerId ?? null,
    JSON.stringify({ ...input.draft, overrideTokens: [] }),
    input.draft.lines.length,
    input.totalEstimate,
    user.id,
    ctx.now().toISOString(),
  );
  return listHeldBills(ctx).find((b) => b.id === Number(res.lastInsertRowid))!;
}

export function listHeldBills(ctx: ServiceContext): HeldBillRow[] {
  return all<HeldBillRow>(
    ctx,
    `SELECT h.id, h.label, h.customer_id AS customerId, c.name AS customerName, h.item_count AS itemCount, h.total_estimate AS totalEstimate,
            u.full_name AS createdByName, h.created_at AS createdAt
     FROM held_bills h JOIN users u ON u.id = h.created_by LEFT JOIN customers c ON c.id = h.customer_id ORDER BY h.id DESC`,
  );
}

export function resumeHeldBill(ctx: ServiceContext, id: number): Draft {
  requirePermission(ctx, 'pos.access');
  const row = get<{ payload: string }>(ctx, 'SELECT payload FROM held_bills WHERE id = ?', id);
  if (!row) throw notFound('Held bill');
  run(ctx, 'DELETE FROM held_bills WHERE id = ?', id);
  return JSON.parse(row.payload) as Draft;
}

export function deleteHeldBill(ctx: ServiceContext, id: number): void {
  requirePermission(ctx, 'pos.access');
  run(ctx, 'DELETE FROM held_bills WHERE id = ?', id);
}

/* ─────────────────────────────── Sales history ─────────────────────────────── */

const SALE_SELECT = `s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt, s.customer_id AS customerId, c.name AS customerName,
  u.full_name AS cashierName, s.item_count AS itemCount, s.total, s.paid_total AS paidTotal, s.credit_amount AS creditAmount, s.status,
  COALESCE((SELECT SUM(r.total) FROM sale_returns r WHERE r.sale_id = s.id), 0) AS returnedTotal,
  COALESCE((SELECT GROUP_CONCAT(method, ', ') FROM (SELECT DISTINCT method FROM sale_payments sp WHERE sp.sale_id = s.id)), '') AS paymentMethods`;
const SALE_FROM = `sales s JOIN users u ON u.id = s.created_by LEFT JOIN customers c ON c.id = s.customer_id`;

export function listSales(ctx: ServiceContext, q: z.output<typeof SaleListSchema>): Paged<SaleRow> & { totalAmount: number } {
  const user = requireUser(ctx);
  const w = new Where();
  if (q.mine || !can(ctx, 'sales.view')) w.add('s.created_by = ?', user.id);
  if (q.status === 'COMPLETED' || q.status === 'VOID') w.add('s.status = ?', q.status);
  if (q.status === 'RETURNED') w.add('EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id)');
  w.addIf(q.userId, 's.created_by = ?', q.userId);
  w.addIf(q.customerId, 's.customer_id = ?', q.customerId);
  if (q.paymentMethod) w.add('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ?)', q.paymentMethod);
  if (q.from || q.to) {
    const r = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('s.created_at >= ? AND s.created_at < ?', r.start, r.end);
  }
  w.search(q.search, ['s.invoice_no', 'c.name', 'c.phone']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const agg = get<{ n: number; amt: number }>(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN s.status = 'COMPLETED' THEN s.total END), 0) AS amt FROM ${SALE_FROM}${where}`, ...w.params)!;
  const rows = all<SaleRow>(ctx, `SELECT ${SALE_SELECT} FROM ${SALE_FROM}${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows, total: agg.n, page: q.page, pageSize: q.pageSize, totalAmount: agg.amt };
}

function voidCheck(ctx: ServiceContext, sale: { status: string; cash_session_id: number | null; created_at: string; id: number }): { ok: boolean; reason: string | null } {
  if (sale.status === 'VOID') return { ok: false, reason: 'Sale is already void' };
  const hasReturns = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id = ?', sale.id)!.n;
  if (hasReturns) return { ok: false, reason: 'Items from this sale have been returned — use returns instead' };
  const open = openCashSessionId(ctx);
  if (sale.cash_session_id) {
    if (sale.cash_session_id !== open) return { ok: false, reason: 'The shift for this sale is closed — process a return instead' };
  } else if (toLocalDate(new Date(sale.created_at)) !== today(ctx)) {
    return { ok: false, reason: 'Only same-day sales can be voided — process a return instead' };
  }
  return { ok: true, reason: null };
}

export function getSale(ctx: ServiceContext, id: number): SaleDetail {
  const user = requireUser(ctx);
  const row = get<SaleDetail & { cash_session_id: number | null }>(
    ctx,
    `SELECT ${SALE_SELECT}, s.uuid, c.phone AS customerPhone, s.prescription_id AS prescriptionId, rx.prescription_no AS prescriptionNo,
            s.cash_session_id AS cashSessionId, s.subtotal, s.discount_total AS discountTotal, s.tax_total AS taxTotal, s.round_off AS roundOff,
            s.cash_tendered AS cashTendered, s.change_due AS changeDue, s.cost_total AS costTotal, s.notes, s.voided_at AS voidedAt,
            uv.full_name AS voidedByName, s.void_reason AS voidReason, s.created_by AS createdById
     FROM ${SALE_FROM} LEFT JOIN users uv ON uv.id = s.voided_by LEFT JOIN prescriptions rx ON rx.id = s.prescription_id WHERE s.id = ?`,
    id,
  );
  if (!row) throw notFound('Sale');
  const createdById = (row as unknown as { createdById: number }).createdById;
  if (!can(ctx, 'sales.view') && createdById !== user.id) throw new AppError('FORBIDDEN', 'You can only view your own sales');
  const showCost = can(ctx, 'inventory.cost_view');
  const items = all<SaleItemDetail>(
    ctx,
    `SELECT si.id, si.line_no AS lineNo, si.product_id AS productId, si.product_name AS productName, p.generic_name AS genericName,
            si.batch_id AS batchId, si.batch_number AS batchNumber, si.expiry_date AS expiryDate, si.pack_size AS packSize, p.unit_name AS unitName,
            p.pack_name AS packName, si.quantity, si.unit_price AS unitPrice, si.gross_amount AS grossAmount, si.discount_amount AS discountAmount,
            si.tax_rate_bp AS taxRateBp, si.tax_amount AS taxAmount, si.line_total AS lineTotal, si.cost_amount AS costAmount,
            si.returned_quantity AS returnedQuantity, si.expired_override AS expiredOverride
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.line_no`,
    id,
  );
  for (const i of items) {
    i.expiredOverride = !!i.expiredOverride;
    if (!showCost) i.costAmount = null;
  }
  const payments = all<SaleDetail['payments'][number]>(ctx, 'SELECT method, amount, reference FROM sale_payments WHERE sale_id = ? ORDER BY id', id);
  const returns = all<SaleDetail['returns'][number]>(
    ctx,
    'SELECT id, return_no AS returnNo, created_at AS createdAt, total, refund_method AS refundMethod FROM sale_returns WHERE sale_id = ? ORDER BY id',
    id,
  );
  const check = voidCheck(ctx, { status: row.status, cash_session_id: row.cashSessionId, created_at: row.createdAt, id });
  return {
    ...row,
    costTotal: showCost ? row.costTotal : null,
    items,
    payments,
    returns,
    canVoid: check.ok,
    voidBlockReason: check.reason,
  };
}

export function findSaleByInvoice(ctx: ServiceContext, invoiceNo: string): SaleDetail {
  const s = get<{ id: number }>(ctx, 'SELECT id FROM sales WHERE invoice_no = ? COLLATE NOCASE', invoiceNo.trim());
  if (!s) {
    // allow typing just the number part
    const digits = invoiceNo.replace(/\D/g, '');
    const alt = digits ? get<{ id: number }>(ctx, "SELECT id FROM sales WHERE CAST(ltrim(replace(invoice_no, 'INV-', ''), '0') AS INTEGER) = ?", Number(digits)) : undefined;
    if (!alt) throw notFound(`Invoice ${invoiceNo}`);
    return getSale(ctx, alt.id);
  }
  return getSale(ctx, s.id);
}

export function lastSaleId(ctx: ServiceContext): number | null {
  const user = requireUser(ctx);
  return get<{ id: number }>(ctx, 'SELECT id FROM sales WHERE created_by = ? ORDER BY id DESC LIMIT 1', user.id)?.id ?? null;
}

export function voidSale(ctx: ServiceContext, id: number, reason: string, overrideToken?: string | null, store: OverrideStore = overrides): SaleDetail {
  const user = requireUser(ctx);
  transaction(ctx, () => {
    const sale = get<{ id: number; invoice_no: string; status: string; cash_session_id: number | null; created_at: string; customer_id: number | null; credit_amount: number; total: number }>(
      ctx,
      'SELECT id, invoice_no, status, cash_session_id, created_at, customer_id, credit_amount, total FROM sales WHERE id = ?',
      id,
    );
    if (!sale) throw notFound('Sale');
    let grantedBy = user.fullName;
    if (!can(ctx, 'sales.void')) {
      const g = store.consume(overrideToken, 'sales.void');
      grantedBy = g.grantedByName;
    }
    const check = voidCheck(ctx, sale);
    if (!check.ok) throw rule(check.reason!);
    const items = all<{ batch_id: number; quantity: number }>(ctx, 'SELECT batch_id, quantity FROM sale_items WHERE sale_id = ?', id);
    for (const i of items) {
      applyMovement(ctx, { batchId: i.batch_id, type: 'SALE_VOID', quantity: i.quantity, referenceType: 'sale', referenceId: id, note: `Void ${sale.invoice_no}: ${reason}`, allowNegative: true });
    }
    if (sale.credit_amount > 0 && sale.customer_id) {
      postCustomerTxn(ctx, sale.customer_id, { type: 'SALE_VOID', amount: -sale.credit_amount, referenceType: 'sale', referenceId: id, description: `Void of ${sale.invoice_no}` });
    }
    run(
      ctx,
      "UPDATE sales SET status = 'VOID', voided_by = ?, voided_at = ?, void_reason = ?, void_cash_session_id = ? WHERE id = ?",
      user.id,
      ctx.now().toISOString(),
      reason,
      openCashSessionId(ctx),
      id,
    );
    audit(ctx, {
      action: 'SALE_VOID',
      entityType: 'sale',
      entityId: id,
      description: `Voided sale ${sale.invoice_no} (${sale.total / 100}) — ${reason}${grantedBy !== user.fullName ? ` (authorised by ${grantedBy})` : ''}`,
      severity: 'CRITICAL',
    });
  });
  return getSale(ctx, id);
}

export function discountPreview(base: number, d: Discount | null) {
  return discountAmount(base, d);
}
