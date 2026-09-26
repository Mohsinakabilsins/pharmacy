import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ReturnCreateSchema, ReturnListSchema } from '@shared/schemas/sales';
import type { ReturnDetail, ReturnRow } from '@shared/types/sales';
import type { Paged } from '@shared/types/common';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { prorate } from '@shared/calc/returns';
import { daysBetween, localDayRangeToUtc, toLocalDate } from '@shared/dates';
import { sum } from '@shared/money';
import { audit } from '../../core/audit';
import { all, can, get, requirePermission, run, today, transaction, type ServiceContext } from '../../core/context';
import { AppError, invalid, notFound, rule } from '../../core/errors';
import { overrides, type OverrideStore } from '../../core/overrides';
import { nextNumber } from '../../core/sequences';
import { getSettings } from '../../core/settings';
import { Where } from '../../core/sql';
import { applyMovement } from '../inventory/inventory.service';
import { customerBalance, openCashSessionId, postCustomerTxn } from '../finance/ledger';

type ReturnInput = z.output<typeof ReturnCreateSchema>;

/**
 * Process a return against an invoice (docs/BUSINESS_RULES.md §8). Amounts are prorated
 * cumulatively; restocked units go back to the original batch; disposed units are written off.
 */
export function createReturn(ctx: ServiceContext, input: ReturnInput, store: OverrideStore = overrides): ReturnDetail {
  const user = requirePermission(ctx, 'returns.manage');
  const settings = getSettings(ctx);
  const id = transaction(ctx, () => {
    const sale = get<{ id: number; invoice_no: string; status: string; customer_id: number | null; created_at: string; round_off: number; total: number; credit_amount: number }>(
      ctx,
      'SELECT id, invoice_no, status, customer_id, created_at, round_off, total, credit_amount FROM sales WHERE id = ?',
      input.saleId,
    );
    if (!sale) throw notFound('Sale');
    if (sale.status === 'VOID') throw rule('This sale has been voided — nothing can be returned');

    const age = daysBetween(toLocalDate(new Date(sale.created_at)), today(ctx));
    let overrideBy: string | null = null;
    if (settings.sales.returnWindowDays > 0 && age > settings.sales.returnWindowDays) {
      if (!can(ctx, 'returns.override')) {
        const g = store.consume(input.overrideToken, 'returns.override');
        overrideBy = g.grantedByName;
      }
    }
    if (input.refundMethod === 'CUSTOMER_ACCOUNT' && !sale.customer_id) throw invalid('Refund to customer account requires a sale linked to a customer');
    const sessionId = openCashSessionId(ctx);
    if (input.refundMethod === 'CASH' && !sessionId && settings.sales.requireOpenShift) {
      throw new AppError('SHIFT_REQUIRED', 'Open a cash shift to refund cash');
    }

    const saleItems = all<{
      id: number; product_id: number; batch_id: number; product_name: string; batch_number: string; quantity: number; returned_quantity: number;
      line_total: number; tax_amount: number; cost_amount: number;
    }>(ctx, 'SELECT id, product_id, batch_id, product_name, batch_number, quantity, returned_quantity, line_total, tax_amount, cost_amount FROM sale_items WHERE sale_id = ?', sale.id);
    const byId = new Map(saleItems.map((i) => [i.id, i]));

    // merge duplicate lines for the same sale item
    const requested = new Map<number, { quantity: number; restock: boolean }>();
    for (const r of input.items) {
      const prev = requested.get(r.saleItemId);
      if (prev && prev.restock !== r.restock) throw invalid('Split restock/dispose of the same item into separate returns');
      requested.set(r.saleItemId, { quantity: (prev?.quantity ?? 0) + r.quantity, restock: r.restock });
    }

    const lines: Array<{ item: (typeof saleItems)[number]; quantity: number; restock: boolean; amount: number; tax: number; cost: number }> = [];
    const fieldErrors: Record<string, string> = {};
    for (const [saleItemId, r] of requested) {
      const item = byId.get(saleItemId);
      if (!item) throw invalid('An item does not belong to this invoice');
      const returnable = item.quantity - item.returned_quantity;
      if (r.quantity > returnable) {
        fieldErrors[`items.${saleItemId}`] = `${item.product_name}: only ${returnable} can be returned`;
        continue;
      }
      lines.push({
        item,
        quantity: r.quantity,
        restock: r.restock,
        amount: prorate(item.line_total, item.quantity, item.returned_quantity, r.quantity),
        tax: prorate(item.tax_amount, item.quantity, item.returned_quantity, r.quantity),
        cost: prorate(item.cost_amount, item.quantity, item.returned_quantity, r.quantity),
      });
    }
    if (Object.keys(fieldErrors).length) throw invalid(Object.values(fieldErrors)[0], fieldErrors);
    if (lines.length === 0) throw invalid('Select at least one item to return');

    // does this return complete the invoice? then refund the round-off as well
    const completes = saleItems.every((i) => {
      const r = requested.get(i.id);
      return i.quantity - i.returned_quantity - (r?.quantity ?? 0) === 0;
    });
    const subtotal = sum(lines.map((l) => l.amount));
    const taxTotal = sum(lines.map((l) => l.tax));
    const roundOff = completes ? sale.round_off : 0;
    const total = subtotal + roundOff;
    const costTotal = sum(lines.filter((l) => l.restock).map((l) => l.cost));

    const returnNo = nextNumber(ctx, 'return');
    const now = ctx.now().toISOString();
    const res = run(
      ctx,
      `INSERT INTO sale_returns (uuid, return_no, sale_id, customer_id, cash_session_id, refund_method, subtotal, tax_total, round_off, total, cost_total,
         reason, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), returnNo, sale.id, sale.customer_id, sessionId, input.refundMethod, subtotal,
      taxTotal, roundOff, total, costTotal, input.reason, input.notes, user.id, now,
    );
    const returnId = Number(res.lastInsertRowid);
    const insItem = ctx.sqlite.prepare(
      `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, batch_id, quantity, amount, tax_amount, cost_amount, restock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of lines) {
      insItem.run(returnId, l.item.id, l.item.product_id, l.item.batch_id, l.quantity, l.amount, l.tax, l.cost, l.restock ? 1 : 0);
      run(ctx, 'UPDATE sale_items SET returned_quantity = returned_quantity + ? WHERE id = ?', l.quantity, l.item.id);
      applyMovement(ctx, {
        batchId: l.item.batch_id,
        type: 'SALE_RETURN',
        quantity: l.quantity,
        referenceType: 'sale_return',
        referenceId: returnId,
        note: `${returnNo} against ${sale.invoice_no}`,
        allowNegative: true,
      });
      if (!l.restock) {
        applyMovement(ctx, {
          batchId: l.item.batch_id,
          type: 'WRITE_OFF',
          quantity: -l.quantity,
          referenceType: 'sale_return',
          referenceId: returnId,
          note: `Disposed returned stock (${returnNo}): ${input.reason}`,
          allowNegative: true,
        });
      }
    }
    if (input.refundMethod === 'CUSTOMER_ACCOUNT' && sale.customer_id) {
      postCustomerTxn(ctx, sale.customer_id, {
        type: 'RETURN_CREDIT',
        amount: -total,
        referenceType: 'sale_return',
        referenceId: returnId,
        description: `Return ${returnNo} against ${sale.invoice_no}`,
      });
    }
    audit(ctx, {
      action: 'SALE_RETURN',
      entityType: 'sale_return',
      entityId: returnId,
      description: `Return ${returnNo} against ${sale.invoice_no}: ${lines.length} item(s), refund ${total / 100} via ${PAYMENT_METHOD_LABELS[input.refundMethod]} — ${input.reason}${overrideBy ? ` (outside return window, authorised by ${overrideBy})` : ''}`,
      details: {
        items: lines.map((l) => ({ saleItemId: l.item.id, quantity: l.quantity, restock: l.restock, amount: l.amount })),
        customerBalanceAfter: sale.customer_id ? customerBalance(ctx, sale.customer_id) : null,
      },
      severity: lines.some((l) => !l.restock) ? 'WARNING' : 'INFO',
    });
    return returnId;
  });
  return getReturn(ctx, id);
}

const RETURN_SELECT = `r.id, r.return_no AS returnNo, r.created_at AS createdAt, r.sale_id AS saleId, s.invoice_no AS invoiceNo, c.name AS customerName,
  r.refund_method AS refundMethod, r.total, (SELECT COUNT(*) FROM sale_return_items i WHERE i.return_id = r.id) AS itemCount, r.reason,
  u.full_name AS createdByName`;
const RETURN_FROM = `sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.created_by LEFT JOIN customers c ON c.id = r.customer_id`;

export function listReturns(ctx: ServiceContext, q: z.output<typeof ReturnListSchema>): Paged<ReturnRow> & { totalAmount: number } {
  const w = new Where();
  if (q.from || q.to) {
    const range = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('r.created_at >= ? AND r.created_at < ?', range.start, range.end);
  }
  w.search(q.search, ['r.return_no', 's.invoice_no', 'c.name', 'r.reason']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const agg = get<{ n: number; amt: number }>(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(r.total), 0) AS amt FROM ${RETURN_FROM}${where}`, ...w.params)!;
  const rows = all<ReturnRow>(ctx, `SELECT ${RETURN_SELECT} FROM ${RETURN_FROM}${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows, total: agg.n, page: q.page, pageSize: q.pageSize, totalAmount: agg.amt };
}

export function getReturn(ctx: ServiceContext, id: number): ReturnDetail {
  const row = get<ReturnDetail>(
    ctx,
    `SELECT ${RETURN_SELECT}, r.subtotal, r.tax_total AS taxTotal, r.round_off AS roundOff, r.cost_total AS costTotal, r.notes FROM ${RETURN_FROM} WHERE r.id = ?`,
    id,
  );
  if (!row) throw notFound('Return');
  row.items = all(
    ctx,
    `SELECT i.id, i.sale_item_id AS saleItemId, si.product_name AS productName, si.batch_number AS batchNumber, si.expiry_date AS expiryDate,
            i.quantity, si.pack_size AS packSize, p.unit_name AS unitName, i.amount, i.tax_amount AS taxAmount, i.restock
     FROM sale_return_items i JOIN sale_items si ON si.id = i.sale_item_id JOIN products p ON p.id = i.product_id WHERE i.return_id = ? ORDER BY i.id`,
    id,
  );
  for (const i of row.items) i.restock = !!i.restock;
  if (!can(ctx, 'inventory.cost_view')) row.costTotal = null;
  return row;
}
