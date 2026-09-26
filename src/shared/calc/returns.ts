import { mulDiv } from '../money';

/**
 * Cumulative proration so repeated partial returns sum exactly to the original amount:
 * round(total × (r + q) ÷ Q) − round(total × r ÷ Q).
 */
export function prorate(total: number, soldQty: number, alreadyReturned: number, returning: number): number {
  if (soldQty <= 0 || returning <= 0) return 0;
  return mulDiv(total, alreadyReturned + returning, soldQty) - mulDiv(total, alreadyReturned, soldQty);
}
