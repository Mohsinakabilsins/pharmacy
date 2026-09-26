import { allocateProportional, applyBp, lineAmount, mulDiv, sum } from '../money';

export interface PurchaseCalcLine {
  key: string;
  /** Paid units (base units). */
  quantity: number;
  /** Free units (base units). */
  bonusQuantity: number;
  packSize: number;
  /** Cost per pack before discount. */
  costPrice: number;
  discountBp: number;
  /** Explicit discount amount — takes precedence over `discountBp` when > 0. */
  discountAmount?: number | null;
  taxRateBp: number;
}

export interface PurchaseCalcInput {
  lines: PurchaseCalcLine[];
  invoiceDiscount: number;
  otherCharges: number;
}

export interface PurchaseCalcRow {
  key: string;
  gross: number;
  discount: number;
  tax: number;
  lineTotal: number;
  landedTotal: number;
  /** Landed cost per pack including bonus units, invoice discount and charges allocation. */
  landedCostPrice: number;
}

export interface PurchaseCalcResult {
  rows: PurchaseCalcRow[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  linesTotal: number;
  invoiceDiscount: number;
  otherCharges: number;
  total: number;
}

/** Purchase invoice calculation (docs/BUSINESS_RULES.md §10). */
export function calculatePurchase(input: PurchaseCalcInput): PurchaseCalcResult {
  const rows: PurchaseCalcRow[] = input.lines.map((l) => {
    const gross = lineAmount(l.quantity, l.costPrice, l.packSize);
    const requested = l.discountAmount && l.discountAmount > 0 ? l.discountAmount : applyBp(gross, l.discountBp);
    const discount = Math.min(Math.max(0, requested), gross);
    const tax = applyBp(gross - discount, l.taxRateBp);
    const lineTotal = gross - discount + tax;
    return { key: l.key, gross, discount, tax, lineTotal, landedTotal: lineTotal, landedCostPrice: 0 };
  });

  const linesTotal = sum(rows.map((r) => r.lineTotal));
  const invoiceDiscount = Math.min(Math.max(0, input.invoiceDiscount), linesTotal + Math.max(0, input.otherCharges));
  const otherCharges = Math.max(0, input.otherCharges);
  const adjustments = allocateProportional(otherCharges - invoiceDiscount, rows.map((r) => r.lineTotal));

  rows.forEach((r, i) => {
    const l = input.lines[i];
    r.landedTotal = r.lineTotal + adjustments[i];
    const units = l.quantity + l.bonusQuantity;
    r.landedCostPrice = units > 0 ? Math.max(0, mulDiv(r.landedTotal, Math.max(1, l.packSize), units)) : 0;
  });

  return {
    rows,
    subtotal: sum(rows.map((r) => r.gross)),
    discountTotal: sum(rows.map((r) => r.discount)),
    taxTotal: sum(rows.map((r) => r.tax)),
    linesTotal,
    invoiceDiscount,
    otherCharges,
    total: linesTotal - invoiceDiscount + otherCharges,
  };
}

/** Quantity-weighted average cost per pack when adding stock to an existing batch. */
export function weightedAverageCost(onHand: number, currentCost: number, addedUnits: number, addedCost: number): number {
  if (onHand <= 0) return addedCost;
  if (addedUnits <= 0) return currentCost;
  return mulDiv(onHand * currentCost + addedUnits * addedCost, 1, onHand + addedUnits);
}

/** Reverse a weighted average when removing units that were added at `removedCost`. */
export function reverseWeightedAverageCost(onHand: number, currentCost: number, removedUnits: number, removedCost: number): number {
  const remaining = onHand - removedUnits;
  if (remaining <= 0) return currentCost;
  const value = onHand * currentCost - removedUnits * removedCost;
  if (value <= 0) return currentCost;
  return mulDiv(value, 1, remaining);
}
