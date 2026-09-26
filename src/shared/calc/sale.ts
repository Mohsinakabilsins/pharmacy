import { allocateProportional, applyBp, BP_DENOMINATOR, lineAmount, mulDiv, roundToStep, sum } from '../money';

export type Discount =
  | { type: 'PERCENT'; value: number } // basis points
  | { type: 'AMOUNT'; value: number }; // paisa

export type TaxMode = 'EXCLUSIVE' | 'INCLUSIVE';

export interface SaleCalcAllocation {
  /** Unique id of this row (e.g. `${lineKey}:${batchId}`). */
  key: string;
  quantity: number;
  packSize: number;
  unitPrice: number;
  unitCost: number;
  taxRateBp: number;
}

export interface SaleCalcLine {
  key: string;
  discount?: Discount | null;
  allocations: SaleCalcAllocation[];
}

export interface SaleCalcInput {
  lines: SaleCalcLine[];
  invoiceDiscount?: Discount | null;
  taxEnabled: boolean;
  taxMode: TaxMode;
  /** Cash rounding step in paisa (0/1 = none, 100 = Rs 1, 500 = Rs 5 …). */
  roundingStep: number;
}

export interface SaleCalcRow {
  key: string;
  lineKey: string;
  quantity: number;
  gross: number;
  lineDiscount: number;
  invoiceDiscount: number;
  discount: number;
  net: number;
  tax: number;
  lineTotal: number;
  cost: number;
}

export interface SaleCalcLineResult {
  key: string;
  quantity: number;
  gross: number;
  discount: number;
  /** Requested line discount before clamping to the line amount. */
  requestedDiscount: number;
  tax: number;
  total: number;
  cost: number;
}

export interface SaleCalcResult {
  rows: SaleCalcRow[];
  lines: SaleCalcLineResult[];
  subtotal: number;
  lineDiscountTotal: number;
  invoiceDiscountTotal: number;
  requestedInvoiceDiscount: number;
  discountTotal: number;
  taxTotal: number;
  preRoundTotal: number;
  roundOff: number;
  total: number;
  costTotal: number;
}

/** Discount amount for a base amount; percent in bp. Never negative, never above `base`. */
export function discountAmount(base: number, discount: Discount | null | undefined): { requested: number; applied: number } {
  if (!discount || discount.value <= 0 || base <= 0) return { requested: 0, applied: 0 };
  const requested = discount.type === 'PERCENT' ? applyBp(base, Math.min(discount.value, BP_DENOMINATOR)) : discount.value;
  return { requested, applied: Math.min(Math.max(0, requested), base) };
}

/** Tax for a net amount under the given mode. Returns [tax, lineTotal]. */
export function computeTax(net: number, rateBp: number, mode: TaxMode, enabled: boolean): [number, number] {
  if (!enabled || rateBp <= 0 || net === 0) return [0, net];
  if (mode === 'EXCLUSIVE') {
    const tax = applyBp(net, rateBp);
    return [tax, net + tax];
  }
  const exTax = mulDiv(net, BP_DENOMINATOR, BP_DENOMINATOR + rateBp);
  return [net - exTax, net];
}

/**
 * Deterministic sale calculation (see docs/BUSINESS_RULES.md §5). Pure — used by the main
 * process for quotes and for the final recomputation inside the sale transaction.
 */
export function calculateSale(input: SaleCalcInput): SaleCalcResult {
  const rows: SaleCalcRow[] = [];
  const lineResults: SaleCalcLineResult[] = [];

  // 1-2. gross per allocation and line discounts split proportionally
  for (const line of input.lines) {
    const grosses = line.allocations.map((a) => lineAmount(a.quantity, a.unitPrice, a.packSize));
    const lineGross = sum(grosses);
    const { requested, applied } = discountAmount(lineGross, line.discount);
    const parts = allocateProportional(applied, grosses);
    line.allocations.forEach((a, i) => {
      rows.push({
        key: a.key,
        lineKey: line.key,
        quantity: a.quantity,
        gross: grosses[i],
        lineDiscount: parts[i],
        invoiceDiscount: 0,
        discount: parts[i],
        net: grosses[i] - parts[i],
        tax: 0,
        lineTotal: 0,
        cost: lineAmount(a.quantity, a.unitCost, a.packSize),
      });
    });
    lineResults.push({
      key: line.key,
      quantity: sum(line.allocations.map((a) => a.quantity)),
      gross: lineGross,
      discount: applied,
      requestedDiscount: requested,
      tax: 0,
      total: 0,
      cost: 0,
    });
  }

  // 3. invoice discount on the post-line-discount base
  const base = sum(rows.map((r) => r.net));
  const inv = discountAmount(base, input.invoiceDiscount);
  const invParts = allocateProportional(inv.applied, rows.map((r) => r.net));
  rows.forEach((r, i) => {
    r.invoiceDiscount = invParts[i];
    r.discount = r.lineDiscount + r.invoiceDiscount;
    r.net = r.gross - r.discount;
  });

  // 4. tax per row
  const allocByKey = new Map<string, SaleCalcAllocation>();
  for (const line of input.lines) for (const a of line.allocations) allocByKey.set(a.key, a);
  for (const r of rows) {
    const a = allocByKey.get(r.key)!;
    const [tax, total] = computeTax(r.net, a.taxRateBp, input.taxMode, input.taxEnabled);
    r.tax = tax;
    r.lineTotal = total;
  }

  for (const lr of lineResults) {
    const lineRows = rows.filter((r) => r.lineKey === lr.key);
    lr.discount = sum(lineRows.map((r) => r.discount));
    lr.tax = sum(lineRows.map((r) => r.tax));
    lr.total = sum(lineRows.map((r) => r.lineTotal));
    lr.cost = sum(lineRows.map((r) => r.cost));
  }

  const preRoundTotal = sum(rows.map((r) => r.lineTotal));
  const total = rows.length === 0 ? 0 : roundToStep(preRoundTotal, input.roundingStep);

  return {
    rows,
    lines: lineResults,
    subtotal: sum(rows.map((r) => r.gross)),
    lineDiscountTotal: sum(rows.map((r) => r.lineDiscount)),
    invoiceDiscountTotal: inv.applied,
    requestedInvoiceDiscount: inv.requested,
    discountTotal: sum(rows.map((r) => r.discount)),
    taxTotal: sum(rows.map((r) => r.tax)),
    preRoundTotal,
    roundOff: total - preRoundTotal,
    total,
    costTotal: sum(rows.map((r) => r.cost)),
  };
}

export interface PaymentInput {
  method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CREDIT';
  amount: number;
}

export interface PaymentSettlement {
  cashDue: number;
  nonCashTotal: number;
  creditAmount: number;
  paidTotal: number;
  changeDue: number;
  balance: number; // total − (payments + credit); 0 when fully settled
}

/**
 * Settle payments against a sale total. Cash `amount` is the tendered amount; any excess over
 * the remaining due becomes change. Non-cash and credit may not exceed what is due.
 */
export function settlePayments(total: number, payments: PaymentInput[], cashTendered: number): PaymentSettlement {
  const nonCash = sum(payments.filter((p) => p.method !== 'CASH' && p.method !== 'CREDIT').map((p) => p.amount));
  const credit = sum(payments.filter((p) => p.method === 'CREDIT').map((p) => p.amount));
  const cashDue = Math.max(0, total - nonCash - credit);
  const cashApplied = Math.min(cashTendered, cashDue);
  const changeDue = Math.max(0, cashTendered - cashDue);
  const paidTotal = nonCash + cashApplied;
  return {
    cashDue,
    nonCashTotal: nonCash,
    creditAmount: credit,
    paidTotal,
    changeDue,
    balance: total - paidTotal - credit,
  };
}
