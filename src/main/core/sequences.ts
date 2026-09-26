import type { ServiceContext } from './context';

export type SequenceKey =
  | 'sale'
  | 'purchase'
  | 'return'
  | 'expense'
  | 'payment'
  | 'adjustment'
  | 'shift'
  | 'prescription'
  | 'product'
  | 'customer';

export const SEQUENCE_DEFAULTS: Record<SequenceKey, { prefix: string; padding: number }> = {
  sale: { prefix: 'INV-', padding: 6 },
  purchase: { prefix: 'PUR-', padding: 6 },
  return: { prefix: 'RET-', padding: 6 },
  expense: { prefix: 'EXP-', padding: 6 },
  payment: { prefix: 'PAY-', padding: 6 },
  adjustment: { prefix: 'ADJ-', padding: 6 },
  shift: { prefix: 'SHF-', padding: 5 },
  prescription: { prefix: 'RX-', padding: 6 },
  product: { prefix: 'P', padding: 5 },
  customer: { prefix: 'C', padding: 5 },
};

function ensure(ctx: ServiceContext, key: SequenceKey) {
  const d = SEQUENCE_DEFAULTS[key];
  ctx.sqlite
    .prepare('INSERT OR IGNORE INTO sequences (key, prefix, next_value, padding) VALUES (?, ?, 1, ?)')
    .run(key, d.prefix, d.padding);
}

/** Issue the next document number. Must be called inside the document's transaction. */
export function nextNumber(ctx: ServiceContext, key: SequenceKey): string {
  ensure(ctx, key);
  const row = ctx.sqlite
    .prepare('UPDATE sequences SET next_value = next_value + 1 WHERE key = ? RETURNING prefix, next_value - 1 AS value, padding')
    .get(key) as { prefix: string; value: number; padding: number };
  return `${row.prefix}${String(row.value).padStart(row.padding, '0')}`;
}

/** Preview the next number without consuming it. */
export function peekNumber(ctx: ServiceContext, key: SequenceKey): string {
  ensure(ctx, key);
  const row = ctx.sqlite.prepare('SELECT prefix, next_value AS value, padding FROM sequences WHERE key = ?').get(key) as {
    prefix: string;
    value: number;
    padding: number;
  };
  return `${row.prefix}${String(row.value).padStart(row.padding, '0')}`;
}
