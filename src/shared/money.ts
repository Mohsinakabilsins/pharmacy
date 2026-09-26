/**
 * Integer money helpers. All amounts are integer paisa (1 rupee = 100 paisa).
 * Rates are integer basis points (100 bp = 1 %).
 */

export const PAISA_PER_RUPEE = 100;
export const BP_DENOMINATOR = 10_000;
/** Upper bound for any single amount (Rs 100,000,000) — keeps products well inside 2^53. */
export const MAX_AMOUNT = 10_000_000_000;
/** Upper bound for a single quantity (base units). */
export const MAX_QUANTITY = 1_000_000;

/** Round half away from zero to an integer (commercial rounding, symmetric for refunds). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Cannot round a non-finite number');
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
  return rounded === 0 ? 0 : rounded; // normalise -0
}

/** round(a × b ÷ c) using integer-safe arithmetic. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError('Division by zero');
  const product = a * b;
  if (Number.isSafeInteger(product) && Number.isInteger(c)) {
    // exact integer numerator → exact remainder-based rounding (half away from zero)
    const sign = Math.sign(product) * Math.sign(c);
    const n = Math.abs(product);
    const d = Math.abs(c);
    let q = Math.floor(n / d);
    let r = n - q * d;
    if (r < 0) {
      q -= 1;
      r += d;
    } else if (r >= d) {
      q += 1;
      r -= d;
    }
    if (r * 2 >= d) q += 1;
    return q === 0 ? 0 : q * sign;
  }
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
    return roundHalfUp((a * b) / c);
  }
  // fall back to BigInt for very large intermediate products
  const big = BigInt(Math.round(a)) * BigInt(Math.round(b));
  const bc = BigInt(c);
  const q = big / bc;
  const r = big - q * bc;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  let result = q;
  if (abs(r) * 2n >= abs(bc)) result += (big < 0n) !== (bc < 0n) ? -1n : 1n;
  return Number(result);
}

/** Apply a basis-point rate: round(amount × bp ÷ 10000). */
export function applyBp(amount: number, bp: number): number {
  return mulDiv(amount, bp, BP_DENOMINATOR);
}

/** Line amount for `quantity` base units at `pricePerPack` with `packSize` units per pack. */
export function lineAmount(quantity: number, pricePerPack: number, packSize: number): number {
  return mulDiv(quantity, pricePerPack, Math.max(1, packSize));
}

/**
 * Split `total` across `weights` proportionally using the largest-remainder method so that
 * the parts always sum exactly to `total`. Works for negative totals as well.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total === 0) return weights.map(() => 0);
  if (sumW === 0) {
    // equal split when there are no usable weights
    return allocateProportional(total, weights.map(() => 1));
  }
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const raw = weights.map((w) => (absTotal * Math.max(0, w)) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = absTotal - floors.reduce((s, x) => s + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x), w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    floors[order[k].i] += 1;
  }
  return floors.map((x) => (x === 0 ? 0 : x * sign));
}

/** Round `amount` to the nearest multiple of `step` (half away from zero). */
export function roundToStep(amount: number, step: number): number {
  if (step <= 1) return amount;
  return mulDiv(amount, 1, step) * step;
}

/** Parse a user-entered rupee value ("1,250.50") into paisa. Returns NaN when invalid. */
export function parseRupees(input: string | number): number {
  if (typeof input === 'number') return roundHalfUp(input * PAISA_PER_RUPEE);
  const cleaned = input.replace(/[,\s]/g, '').replace(/^(rs\.?|pkr)/i, '');
  if (cleaned === '' || !/^-?\d*(\.\d{0,4})?$/.test(cleaned)) return Number.NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? roundHalfUp(n * PAISA_PER_RUPEE) : Number.NaN;
}

/** Convert paisa to a plain rupee number (for inputs / charts only — never for math). */
export function toRupees(paisa: number): number {
  return paisa / PAISA_PER_RUPEE;
}

/** Percent (e.g. 12.5) → basis points (1250). */
export function percentToBp(percent: number): number {
  return roundHalfUp(percent * 100);
}

export function bpToPercent(bp: number): number {
  return bp / 100;
}

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
