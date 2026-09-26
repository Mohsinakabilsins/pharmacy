import { isExpired } from './stock';

export interface FefoBatch {
  id: number;
  expiryDate: string;
  quantityOnHand: number;
  status: 'ACTIVE' | 'QUARANTINED' | 'RECALLED';
}

export interface FefoAllocation {
  batchId: number;
  quantity: number;
  expired: boolean;
}

export interface FefoPlan {
  allocations: FefoAllocation[];
  /** Units that could not be covered by available stock. */
  shortfall: number;
  /** Reason when a manually chosen batch cannot be used at all. */
  blocked?: 'NOT_FOUND' | 'QUARANTINED' | 'RECALLED';
}

/**
 * First-Expiry-First-Out allocation.
 *  - automatic: sellable batches (ACTIVE, not expired, qty > 0) ordered by expiry then id
 *  - manual (`batchId`): only that batch; expired batches are allowed but flagged
 *  - `allowNegative`: remaining shortfall is taken from the last usable batch
 */
export function planFefo(
  batches: FefoBatch[],
  quantity: number,
  today: string,
  opts: { batchId?: number | null; allowNegative?: boolean } = {},
): FefoPlan {
  if (quantity <= 0) return { allocations: [], shortfall: 0 };

  if (opts.batchId) {
    const b = batches.find((x) => x.id === opts.batchId);
    if (!b) return { allocations: [], shortfall: quantity, blocked: 'NOT_FOUND' };
    if (b.status !== 'ACTIVE') return { allocations: [], shortfall: quantity, blocked: b.status };
    const available = Math.max(0, b.quantityOnHand);
    const take = opts.allowNegative ? quantity : Math.min(quantity, available);
    const allocations = take > 0 ? [{ batchId: b.id, quantity: take, expired: isExpired(b.expiryDate, today) }] : [];
    return { allocations, shortfall: quantity - take };
  }

  const candidates = batches
    .filter((b) => b.status === 'ACTIVE' && b.quantityOnHand > 0 && !isExpired(b.expiryDate, today))
    .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : a.id - b.id));

  const allocations: FefoAllocation[] = [];
  let remaining = quantity;
  for (const b of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.quantityOnHand);
    allocations.push({ batchId: b.id, quantity: take, expired: false });
    remaining -= take;
  }
  if (remaining > 0 && opts.allowNegative) {
    const fallback =
      allocations[allocations.length - 1]?.batchId ??
      batches
        .filter((b) => b.status === 'ACTIVE' && !isExpired(b.expiryDate, today))
        .sort((a, b) => (a.expiryDate < b.expiryDate ? 1 : -1))[0]?.id;
    if (fallback) {
      const existing = allocations.find((a) => a.batchId === fallback);
      if (existing) existing.quantity += remaining;
      else allocations.push({ batchId: fallback, quantity: remaining, expired: false });
      remaining = 0;
    }
  }
  return { allocations, shortfall: remaining };
}
