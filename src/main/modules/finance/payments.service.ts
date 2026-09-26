import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { CustomerPaymentSchema, PaymentListSchema, SupplierPaymentSchema } from '@shared/schemas/finance';
import type { PaymentRow } from '@shared/types/finance';
import type { Paged } from '@shared/types/common';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { audit } from '../../core/audit';
import { all, get, requireUser, run, transaction, type ServiceContext } from '../../core/context';
import { notFound, rule } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { Where } from '../../core/sql';
import { customerBalance, openCashSessionId, postCustomerTxn, postSupplierTxn, supplierBalance } from './ledger';

type PartyMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET' | 'CHEQUE';

export interface SupplierPaymentWrite {
  supplierId: number;
  amount: number;
  method: PartyMethod;
  reference?: string | null;
  paymentDate: string;
  notes?: string | null;
  purchaseId?: number | null;
}

/** Record a payment to a supplier (joins the caller's transaction). Returns the payment id. */
export function recordSupplierPayment(ctx: ServiceContext, p: SupplierPaymentWrite): { id: number; paymentNo: string } {
  const user = requireUser(ctx);
  return transaction(ctx, () => {
    const s = get<{ name: string }>(ctx, 'SELECT name FROM suppliers WHERE id = ?', p.supplierId);
    if (!s) throw notFound('Supplier');
    const paymentNo = nextNumber(ctx, 'payment');
    const sessionId = p.method === 'CASH' ? openCashSessionId(ctx) : null;
    const res = run(
      ctx,
      `INSERT INTO payments (uuid, payment_no, direction, supplier_id, purchase_id, amount, method, reference, payment_date, notes, cash_session_id, status, created_by, created_at)
       VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
      randomUUID(),
      paymentNo,
      p.supplierId,
      p.purchaseId ?? null,
      p.amount,
      p.method,
      p.reference ?? null,
      p.paymentDate,
      p.notes ?? null,
      sessionId,
      user.id,
      ctx.now().toISOString(),
    );
    const id = Number(res.lastInsertRowid);
    postSupplierTxn(ctx, p.supplierId, {
      type: 'PAYMENT',
      amount: -p.amount,
      date: p.paymentDate,
      referenceType: 'payment',
      referenceId: id,
      description: `Payment ${paymentNo} (${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ''})`,
    });
    audit(ctx, {
      action: 'PAYMENT_CREATE',
      entityType: 'payment',
      entityId: id,
      description: `Paid ${s.name} ${p.amount / 100} via ${PAYMENT_METHOD_LABELS[p.method]} (${paymentNo})`,
      details: { ...p },
    });
    return { id, paymentNo };
  });
}

export function createSupplierPayment(ctx: ServiceContext, input: z.output<typeof SupplierPaymentSchema>): PaymentRow {
  const { id } = recordSupplierPayment(ctx, input);
  return getPayment(ctx, id);
}

export function createCustomerPayment(ctx: ServiceContext, input: z.output<typeof CustomerPaymentSchema>): PaymentRow {
  const user = requireUser(ctx);
  const id = transaction(ctx, () => {
    const c = get<{ name: string }>(ctx, 'SELECT name FROM customers WHERE id = ?', input.customerId);
    if (!c) throw notFound('Customer');
    const balance = customerBalance(ctx, input.customerId);
    if (input.amount > balance) {
      throw rule(`Amount exceeds the customer's outstanding balance (${(balance / 100).toFixed(2)})`);
    }
    const paymentNo = nextNumber(ctx, 'payment');
    const sessionId = input.method === 'CASH' ? openCashSessionId(ctx) : null;
    const res = run(
      ctx,
      `INSERT INTO payments (uuid, payment_no, direction, customer_id, amount, method, reference, payment_date, notes, cash_session_id, status, created_by, created_at)
       VALUES (?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
      randomUUID(),
      paymentNo,
      input.customerId,
      input.amount,
      input.method,
      input.reference,
      input.paymentDate,
      input.notes,
      sessionId,
      user.id,
      ctx.now().toISOString(),
    );
    const newId = Number(res.lastInsertRowid);
    postCustomerTxn(ctx, input.customerId, {
      type: 'PAYMENT',
      amount: -input.amount,
      date: input.paymentDate,
      referenceType: 'payment',
      referenceId: newId,
      description: `Receipt ${paymentNo} (${PAYMENT_METHOD_LABELS[input.method]})`,
    });
    audit(ctx, {
      action: 'PAYMENT_CREATE',
      entityType: 'payment',
      entityId: newId,
      description: `Received ${input.amount / 100} from ${c.name} via ${PAYMENT_METHOD_LABELS[input.method]} (${paymentNo})`,
      details: input,
    });
    return newId;
  });
  return getPayment(ctx, id);
}

/** Void a payment (joins caller's transaction). Reverses the ledger entry. */
export function voidPaymentInternal(ctx: ServiceContext, id: number, reason: string): void {
  const user = requireUser(ctx);
  const p = get<{ id: number; payment_no: string; direction: 'IN' | 'OUT'; supplier_id: number | null; customer_id: number | null; amount: number; status: string }>(
    ctx,
    'SELECT id, payment_no, direction, supplier_id, customer_id, amount, status FROM payments WHERE id = ?',
    id,
  );
  if (!p) throw notFound('Payment');
  if (p.status === 'VOID') throw rule('This payment is already void');
  const now = ctx.now().toISOString();
  run(ctx, "UPDATE payments SET status = 'VOID', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?", user.id, now, reason, id);
  if (p.direction === 'OUT' && p.supplier_id) {
    postSupplierTxn(ctx, p.supplier_id, { type: 'PAYMENT_VOID', amount: p.amount, referenceType: 'payment', referenceId: id, description: `Void of ${p.payment_no}: ${reason}` });
  } else if (p.direction === 'IN' && p.customer_id) {
    postCustomerTxn(ctx, p.customer_id, { type: 'PAYMENT_VOID', amount: p.amount, referenceType: 'payment', referenceId: id, description: `Void of ${p.payment_no}: ${reason}` });
  }
  audit(ctx, { action: 'PAYMENT_VOID', entityType: 'payment', entityId: id, description: `Voided payment ${p.payment_no} — ${reason}`, severity: 'WARNING' });
}

export function voidPayment(ctx: ServiceContext, id: number, reason: string): PaymentRow {
  transaction(ctx, () => voidPaymentInternal(ctx, id, reason));
  return getPayment(ctx, id);
}

const PAYMENT_SELECT = `p.id, p.payment_no AS paymentNo, p.direction, COALESCE(s.name, c.name) AS partyName, p.supplier_id AS supplierId,
  p.customer_id AS customerId, pu.purchase_no AS purchaseNo, p.amount, p.method, p.reference, p.payment_date AS paymentDate, p.notes,
  p.status, u.full_name AS createdByName, p.created_at AS createdAt, p.void_reason AS voidReason`;
const PAYMENT_FROM = `payments p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN purchases pu ON pu.id = p.purchase_id LEFT JOIN users u ON u.id = p.created_by`;

export function getPayment(ctx: ServiceContext, id: number): PaymentRow {
  const row = get<PaymentRow>(ctx, `SELECT ${PAYMENT_SELECT} FROM ${PAYMENT_FROM} WHERE p.id = ?`, id);
  if (!row) throw notFound('Payment');
  return row;
}

export function listPayments(ctx: ServiceContext, q: z.output<typeof PaymentListSchema>): Paged<PaymentRow> & { amountTotal: number } {
  const w = new Where();
  if (q.direction !== 'all') w.add('p.direction = ?', q.direction);
  if (q.status !== 'all') w.add('p.status = ?', q.status);
  w.addIf(q.supplierId, 'p.supplier_id = ?', q.supplierId);
  w.addIf(q.customerId, 'p.customer_id = ?', q.customerId);
  w.addIf(q.from, 'p.payment_date >= ?', q.from);
  w.addIf(q.to, 'p.payment_date <= ?', q.to);
  w.search(q.search, ['p.payment_no', 's.name', 'c.name', 'p.reference']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const agg = get<{ n: number; amt: number }>(
    ctx,
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'POSTED' THEN p.amount END), 0) AS amt FROM ${PAYMENT_FROM}${where}`,
    ...w.params,
  )!;
  const rows = all<PaymentRow>(
    ctx,
    `SELECT ${PAYMENT_SELECT} FROM ${PAYMENT_FROM}${where} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`,
    ...w.params,
    q.pageSize,
    (q.page - 1) * q.pageSize,
  );
  return { rows, total: agg.n, page: q.page, pageSize: q.pageSize, amountTotal: agg.amt };
}

export { supplierBalance, customerBalance };
