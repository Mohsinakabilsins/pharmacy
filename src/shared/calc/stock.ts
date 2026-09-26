import { daysBetween } from '../dates';

export type StockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'REORDER' | 'OVERSTOCK' | 'OK';
export type ExpiryBucket = 'EXPIRED' | 'D30' | 'D60' | 'D90' | 'LATER';

export function stockStatus(onHand: number, minStock: number, reorderLevel: number, maxStock: number): StockStatus {
  if (onHand <= 0) return 'OUT_OF_STOCK';
  if (onHand <= minStock) return 'LOW_STOCK';
  if (onHand <= reorderLevel) return 'REORDER';
  if (maxStock > 0 && onHand > maxStock) return 'OVERSTOCK';
  return 'OK';
}

export function needsReorder(status: StockStatus): boolean {
  return status === 'OUT_OF_STOCK' || status === 'LOW_STOCK' || status === 'REORDER';
}

/** Stock is not sold on its expiry date: expired when expiry ≤ today. */
export function isExpired(expiryDate: string, today: string): boolean {
  return expiryDate <= today;
}

export function daysToExpiry(expiryDate: string, today: string): number {
  return daysBetween(today, expiryDate);
}

export function expiryBucket(expiryDate: string, today: string): ExpiryBucket {
  const days = daysBetween(today, expiryDate);
  if (days <= 0) return 'EXPIRED';
  if (days <= 30) return 'D30';
  if (days <= 60) return 'D60';
  if (days <= 90) return 'D90';
  return 'LATER';
}

/** Suggested order in packs: ⌈(target − onHand) ÷ packSize⌉, at least 1 pack when reorder is needed. */
export function suggestedOrderPacks(onHand: number, reorderLevel: number, maxStock: number, packSize: number): number {
  const target = maxStock > 0 ? maxStock : reorderLevel * 2;
  const need = target - Math.max(0, onHand);
  if (need <= 0) return onHand <= reorderLevel ? 1 : 0;
  return Math.max(1, Math.ceil(need / Math.max(1, packSize)));
}

/** Split base units into packs + loose units. */
export function splitPacks(units: number, packSize: number): { packs: number; loose: number } {
  const size = Math.max(1, packSize);
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  return { packs: sign * Math.floor(abs / size), loose: sign * (abs % size) };
}
