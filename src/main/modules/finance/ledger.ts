import { randomUUID } from 'node:crypto';
import type { Ledger, LedgerEntry } from '@shared/types/purchasing';
import { all, get, run, today, type ServiceContext } from '../../core/context';

export type SupplierTxnType = 'OPENING_BALANCE' | 'PURCHASE' | 'PURCHASE_VOID' | 'PAYMENT' | 'PAYMENT_VOID' | 'ADJUSTMENT';
export type CustomerTxnType = 'OPENING_BALANCE' | 'SALE_CREDIT' | 'SALE_VOID' | 'RETURN_CREDIT' | 'PAYMENT' | 'PAYMENT_VOID' | 'ADJUSTMENT';

interface LedgerWrite<T> {
  type: T;
  amount: number;
  date?: string;
  referenceType?: string | null;
  referenceId?: number | null;
  description?: string | null;
}

/** Append a supplier ledger entry. Positive amount = more owed to the supplier. */
export function postSupplierTxn(ctx: ServiceContext, supplierId: number, e: LedgerWrite<SupplierTxnType>): void {
  if (e.amount === 0) return;
  run(
    ctx,
    `INSERT INTO supplier_transactions (uuid, supplier_id, txn_date, type, amount, reference_type, reference_id, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    supplierId,
    e.date ?? today(ctx),
    e.type,
    e.amount,
    e.referenceType ?? null,
    e.referenceId ?? null,
    e.description ?? null,
    ctx.user?.id ?? null,
    ctx.now().toISOString(),
  );
}

/** Append a customer ledger entry. Positive amount = customer owes more. */
export function postCustomerTxn(ctx: ServiceContext, customerId: number, e: LedgerWrite<CustomerTxnType>): void {
  if (e.amount === 0) return;
  run(
    ctx,
    `INSERT INTO customer_transactions (uuid, customer_id, txn_date, type, amount, reference_type, reference_id, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    customerId,
    e.date ?? today(ctx),
    e.type,
    e.amount,
    e.referenceType ?? null,
    e.referenceId ?? null,
    e.description ?? null,
    ctx.user?.id ?? null,
    ctx.now().toISOString(),
  );
}

export function supplierBalance(ctx: ServiceContext, supplierId: number): number {
  return get<{ b: number }>(ctx, 'SELECT COALESCE(SUM(amount), 0) AS b FROM supplier_transactions WHERE supplier_id = ?', supplierId)!.b;
}

export function customerBalance(ctx: ServiceContext, customerId: number): number {
  return get<{ b: number }>(ctx, 'SELECT COALESCE(SUM(amount), 0) AS b FROM customer_transactions WHERE customer_id = ?', customerId)!.b;
}

const REF_NO = `CASE t.reference_type
  WHEN 'purchase' THEN (SELECT purchase_no FROM purchases WHERE id = t.reference_id)
  WHEN 'payment' THEN (SELECT payment_no FROM payments WHERE id = t.reference_id)
  WHEN 'sale' THEN (SELECT invoice_no FROM sales WHERE id = t.reference_id)
  WHEN 'sale_return' THEN (SELECT return_no FROM sale_returns WHERE id = t.reference_id)
  WHEN 'adjustment' THEN (SELECT adjustment_no FROM stock_adjustments WHERE id = t.reference_id)
END`;

function buildLedger(ctx: ServiceContext, table: string, partyCol: string, id: number, from?: string | null, to?: string | null): Ledger {
  const opening = from
    ? get<{ b: number }>(ctx, `SELECT COALESCE(SUM(amount), 0) AS b FROM ${table} WHERE ${partyCol} = ? AND txn_date < ?`, id, from)!.b
    : 0;
  const params: unknown[] = [id];
  let where = `t.${partyCol} = ?`;
  if (from) {
    where += ' AND t.txn_date >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND t.txn_date <= ?';
    params.push(to);
  }
  const rows = all<Omit<LedgerEntry, 'balance'>>(
    ctx,
    `SELECT t.id, t.txn_date AS date, t.created_at AS createdAt, t.type, t.description, t.reference_type AS referenceType,
            t.reference_id AS referenceId, ${REF_NO} AS referenceNo, t.amount, u.full_name AS userName
     FROM ${table} t LEFT JOIN users u ON u.id = t.created_by WHERE ${where} ORDER BY t.txn_date, t.id`,
    ...params,
  );
  let balance = opening;
  let debit = 0;
  let credit = 0;
  const entries = rows.map((r) => {
    balance += r.amount;
    if (r.amount > 0) debit += r.amount;
    else credit -= r.amount;
    return { ...r, balance };
  });
  return { openingBalance: opening, entries, closingBalance: balance, totalDebit: debit, totalCredit: credit };
}

export function supplierLedger(ctx: ServiceContext, supplierId: number, from?: string | null, to?: string | null): Ledger {
  return buildLedger(ctx, 'supplier_transactions', 'supplier_id', supplierId, from, to);
}

export function customerLedger(ctx: ServiceContext, customerId: number, from?: string | null, to?: string | null): Ledger {
  return buildLedger(ctx, 'customer_transactions', 'customer_id', customerId, from, to);
}

export function openCashSessionId(ctx: ServiceContext): number | null {
  return get<{ id: number }>(ctx, "SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1")?.id ?? null;
}
