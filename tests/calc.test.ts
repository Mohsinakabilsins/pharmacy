import { describe, expect, it } from 'vitest';
import { allocateProportional, lineAmount, mulDiv, parseRupees, roundHalfUp, roundToStep } from '@shared/money';
import { calculateSale, computeTax, settlePayments } from '@shared/calc/sale';
import { calculatePurchase, reverseWeightedAverageCost, weightedAverageCost } from '@shared/calc/purchase';
import { prorate } from '@shared/calc/returns';
import { expiryBucket, isExpired, splitPacks, stockStatus, suggestedOrderPacks } from '@shared/calc/stock';
import { planFefo } from '@shared/calc/fefo';
import { parseExpiryInput } from '@shared/dates';

describe('money primitives', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(7, 12500, 10)).toBe(8750);
  });

  it('prices loose units pro-rata from the pack price', () => {
    expect(lineAmount(10, 12500, 10)).toBe(12500); // full strip
    expect(lineAmount(3, 12500, 10)).toBe(3750);
    expect(lineAmount(1, 10000, 3)).toBe(3333);
    expect(lineAmount(2, 10000, 3)).toBe(6667);
  });

  it('allocates proportionally with exact sums', () => {
    const parts = allocateProportional(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateProportional(-10, [3, 7])).toEqual([-3, -7]);
    expect(allocateProportional(5, [0, 0])).toEqual([3, 2]);
  });

  it('parses rupee input and rounds to steps', () => {
    expect(parseRupees('1,250.50')).toBe(125050);
    expect(parseRupees('Rs 99')).toBe(9900);
    expect(Number.isNaN(parseRupees('abc'))).toBe(true);
    expect(roundToStep(12345, 500)).toBe(12500);
    expect(roundToStep(12249, 500)).toBe(12000);
  });
});

describe('sale calculation', () => {
  const alloc = (key: string, quantity: number, unitPrice: number, unitCost = 0, packSize = 10, taxRateBp = 0) => ({ key, quantity, unitPrice, unitCost, packSize, taxRateBp });

  it('computes gross, line + invoice discounts and totals exactly', () => {
    const r = calculateSale({
      lines: [
        { key: 'a', discount: { type: 'PERCENT', value: 1000 }, allocations: [alloc('a:1', 10, 10000, 8000)] },
        { key: 'b', discount: null, allocations: [alloc('b:1', 5, 5000, 3000, 5)] },
      ],
      invoiceDiscount: { type: 'AMOUNT', value: 1000 },
      taxEnabled: false,
      taxMode: 'INCLUSIVE',
      roundingStep: 0,
    });
    expect(r.subtotal).toBe(15000);
    expect(r.lineDiscountTotal).toBe(1000);
    expect(r.invoiceDiscountTotal).toBe(1000);
    expect(r.total).toBe(13000);
    expect(r.costTotal).toBe(11000);
    expect(r.rows.reduce((s, x) => s + x.discount, 0)).toBe(r.discountTotal);
  });

  it('splits a line discount across batches of the same line', () => {
    const r = calculateSale({
      lines: [{ key: 'a', discount: { type: 'AMOUNT', value: 100 }, allocations: [alloc('a:1', 3, 1000, 0, 10), alloc('a:2', 7, 1100, 0, 10)] }],
      taxEnabled: false,
      taxMode: 'INCLUSIVE',
      roundingStep: 0,
    });
    expect(r.rows.map((x) => x.gross)).toEqual([300, 770]);
    expect(r.rows[0].discount + r.rows[1].discount).toBe(100);
    expect(r.total).toBe(970);
  });

  it('handles exclusive and inclusive tax', () => {
    expect(computeTax(10000, 1700, 'EXCLUSIVE', true)).toEqual([1700, 11700]);
    expect(computeTax(11700, 1700, 'INCLUSIVE', true)).toEqual([1700, 11700]);
    expect(computeTax(10000, 1700, 'EXCLUSIVE', false)).toEqual([0, 10000]);
  });

  it('applies cash rounding and records round-off', () => {
    const r = calculateSale({ lines: [{ key: 'a', allocations: [alloc('a:1', 1, 12345, 0, 1)] }], taxEnabled: false, taxMode: 'INCLUSIVE', roundingStep: 500 });
    expect(r.preRoundTotal).toBe(12345);
    expect(r.total).toBe(12500);
    expect(r.roundOff).toBe(155);
  });

  it('never lets a discount exceed the amount', () => {
    const r = calculateSale({ lines: [{ key: 'a', discount: { type: 'AMOUNT', value: 999999 }, allocations: [alloc('a:1', 1, 500, 0, 1)] }], taxEnabled: false, taxMode: 'INCLUSIVE', roundingStep: 0 });
    expect(r.total).toBe(0);
    expect(r.lines[0].requestedDiscount).toBe(999999);
  });

  it('settles cash, card and credit with change', () => {
    const s = settlePayments(10000, [{ method: 'CARD', amount: 4000 }, { method: 'CREDIT', amount: 1000 }], 10000);
    expect(s.cashDue).toBe(5000);
    expect(s.changeDue).toBe(5000);
    expect(s.paidTotal).toBe(9000);
    expect(s.balance).toBe(0);
  });
});

describe('purchase calculation', () => {
  it('computes landed cost including bonus units, discount and charges', () => {
    const r = calculatePurchase({
      lines: [
        { key: '1', quantity: 100, bonusQuantity: 10, packSize: 10, costPrice: 10000, discountBp: 500, taxRateBp: 0 },
        { key: '2', quantity: 50, bonusQuantity: 0, packSize: 1, costPrice: 2000, discountBp: 0, taxRateBp: 0 },
      ],
      invoiceDiscount: 1000,
      otherCharges: 3000,
    });
    // line 1: gross 100000, disc 5000 → 95000; line 2: 100000
    expect(r.rows[0].lineTotal).toBe(95000);
    expect(r.rows[1].lineTotal).toBe(100000);
    expect(r.total).toBe(195000 - 1000 + 3000);
    expect(r.rows[0].landedTotal + r.rows[1].landedTotal).toBe(r.total);
    // landed cost per pack for line 1 = landedTotal * 10 / 110 units
    expect(r.rows[0].landedCostPrice).toBe(Math.round((r.rows[0].landedTotal * 10) / 110));
  });

  it('maintains weighted average cost and can reverse it', () => {
    const merged = weightedAverageCost(50, 8000, 50, 10000);
    expect(merged).toBe(9000);
    expect(reverseWeightedAverageCost(100, merged, 50, 10000)).toBe(8000);
    expect(weightedAverageCost(0, 8000, 10, 9500)).toBe(9500);
  });
});

describe('returns proration', () => {
  it('sums exactly across repeated partial returns', () => {
    const total = 1000;
    const parts = [prorate(total, 3, 0, 1), prorate(total, 3, 1, 1), prorate(total, 3, 2, 1)];
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([333, 334, 333]);
  });
});

describe('stock and expiry rules', () => {
  it('classifies stock status', () => {
    expect(stockStatus(0, 10, 20, 100)).toBe('OUT_OF_STOCK');
    expect(stockStatus(10, 10, 20, 100)).toBe('LOW_STOCK');
    expect(stockStatus(15, 10, 20, 100)).toBe('REORDER');
    expect(stockStatus(50, 10, 20, 100)).toBe('OK');
    expect(stockStatus(150, 10, 20, 100)).toBe('OVERSTOCK');
  });

  it('suggests order quantities in packs', () => {
    expect(suggestedOrderPacks(15, 20, 100, 10)).toBe(9);
    expect(suggestedOrderPacks(0, 20, 0, 10)).toBe(4);
  });

  it('treats stock as expired on its expiry date and buckets correctly', () => {
    expect(isExpired('2026-09-27', '2026-09-27')).toBe(true);
    expect(isExpired('2026-09-28', '2026-09-27')).toBe(false);
    expect(expiryBucket('2026-09-27', '2026-09-27')).toBe('EXPIRED');
    expect(expiryBucket('2026-10-27', '2026-09-27')).toBe('D30');
    expect(expiryBucket('2026-10-28', '2026-09-27')).toBe('D60');
    expect(expiryBucket('2026-12-26', '2026-09-27')).toBe('D90');
    expect(expiryBucket('2026-12-27', '2026-09-27')).toBe('LATER');
  });

  it('parses month/year expiry to end of month', () => {
    expect(parseExpiryInput('03/2027')).toBe('2027-03-31');
    expect(parseExpiryInput('2/28')).toBe('2028-02-29');
    expect(parseExpiryInput('2027-11')).toBe('2027-11-30');
    expect(parseExpiryInput('13/2027')).toBeNull();
  });

  it('splits units into packs and loose', () => {
    expect(splitPacks(25, 10)).toEqual({ packs: 2, loose: 5 });
  });
});

describe('FEFO allocation', () => {
  const today = '2026-09-27';
  const batches = [
    { id: 1, expiryDate: '2027-06-30', quantityOnHand: 50, status: 'ACTIVE' as const },
    { id: 2, expiryDate: '2026-12-31', quantityOnHand: 20, status: 'ACTIVE' as const },
    { id: 3, expiryDate: '2026-09-01', quantityOnHand: 100, status: 'ACTIVE' as const }, // expired
    { id: 4, expiryDate: '2026-11-30', quantityOnHand: 30, status: 'QUARANTINED' as const },
    { id: 5, expiryDate: '2026-12-31', quantityOnHand: 5, status: 'ACTIVE' as const },
  ];

  it('picks the earliest valid expiry first and splits across batches', () => {
    const plan = planFefo(batches, 30, today);
    expect(plan.allocations).toEqual([
      { batchId: 2, quantity: 20, expired: false },
      { batchId: 5, quantity: 5, expired: false },
      { batchId: 1, quantity: 5, expired: false },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  it('never auto-selects expired or quarantined stock and reports shortfall', () => {
    const plan = planFefo(batches, 100, today);
    expect(plan.allocations.map((a) => a.batchId)).toEqual([2, 5, 1]);
    expect(plan.shortfall).toBe(25);
  });

  it('allows a manual expired batch but flags it; blocks quarantined', () => {
    expect(planFefo(batches, 10, today, { batchId: 3 }).allocations[0]).toEqual({ batchId: 3, quantity: 10, expired: true });
    expect(planFefo(batches, 10, today, { batchId: 4 }).blocked).toBe('QUARANTINED');
  });
});
