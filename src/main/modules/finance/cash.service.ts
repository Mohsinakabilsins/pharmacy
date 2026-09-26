import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { CashAdjustSchema, CashCloseSchema, CashListSchema, CashOpenSchema } from '@shared/schemas/finance';
import type { CashSessionDetail, CashSessionRow, CashSummary } from '@shared/types/finance';
import type { Paged } from '@shared/types/common';
import { localDayRangeToUtc } from '@shared/dates';
import { audit } from '../../core/audit';
import { all, get, requireUser, run, transaction, type ServiceContext } from '../../core/context';
import { conflict, notFound, rule } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { Where } from '../../core/sql';

const ROW_SELECT = `cs.id, cs.session_no AS sessionNo, cs.status, uo.full_name AS openedByName, cs.opened_at AS openedAt,
  uc.full_name AS closedByName, cs.closed_at AS closedAt, cs.opening_cash AS openingCash, cs.expected_cash AS expectedCash,
  cs.counted_cash AS countedCash, cs.variance`;
const ROW_FROM = `cash_sessions cs JOIN users uo ON uo.id = cs.opened_by LEFT JOIN users uc ON uc.id = cs.closed_by`;

/**
 * Compute the drawer summary for a session from source documents (docs/BUSINESS_RULES.md §12).
 * Records voided after the session closed still count for that session (historical truth).
 */
export function computeCashSummary(ctx: ServiceContext, sessionId: number): CashSummary {
  const s = get<{ opening_cash: number; closed_at: string | null }>(ctx, 'SELECT opening_cash, closed_at FROM cash_sessions WHERE id = ?', sessionId);
  if (!s) throw notFound('Cash session');
  const closedAt = s.closed_at;
  const liveStatus = (alias: string) =>
    closedAt ? `(${alias}.status = 'POSTED' OR (${alias}.status = 'VOID' AND ${alias}.voided_at > '${closedAt}'))` : `${alias}.status = 'POSTED'`;
  const n = (sql: string, ...params: unknown[]) => get<{ v: number }>(ctx, sql, ...params)!.v;

  const cashSales = n(
    `SELECT COALESCE(SUM(sp.amount), 0) AS v FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
     WHERE sa.cash_session_id = ? AND sp.method = 'CASH'`,
    sessionId,
  );
  const voidReversals = n(
    `SELECT COALESCE(SUM(sp.amount), 0) AS v FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
     WHERE sa.void_cash_session_id = ? AND sa.status = 'VOID' AND sp.method = 'CASH'`,
    sessionId,
  );
  const cashRefunds = n(`SELECT COALESCE(SUM(total), 0) AS v FROM sale_returns WHERE cash_session_id = ? AND refund_method = 'CASH'`, sessionId);
  const customerReceipts = n(
    `SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p WHERE p.cash_session_id = ? AND p.direction = 'IN' AND p.method = 'CASH' AND ${liveStatus('p')}`,
    sessionId,
  );
  const supplierPayments = n(
    `SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p WHERE p.cash_session_id = ? AND p.direction = 'OUT' AND p.method = 'CASH' AND ${liveStatus('p')}`,
    sessionId,
  );
  const cashExpenses = n(
    `SELECT COALESCE(SUM(e.amount), 0) AS v FROM expenses e WHERE e.cash_session_id = ? AND e.payment_method = 'CASH' AND ${liveStatus('e')}`,
    sessionId,
  );
  const adjustmentsIn = n(`SELECT COALESCE(SUM(amount), 0) AS v FROM cash_adjustments WHERE cash_session_id = ? AND direction = 'IN'`, sessionId);
  const adjustmentsOut = n(`SELECT COALESCE(SUM(amount), 0) AS v FROM cash_adjustments WHERE cash_session_id = ? AND direction = 'OUT'`, sessionId);

  const nonCash = all<{ method: string; amount: number }>(
    ctx,
    `SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
     WHERE sa.cash_session_id = ? AND sa.status = 'COMPLETED' AND sp.method NOT IN ('CASH', 'CREDIT') GROUP BY sp.method ORDER BY amount DESC`,
    sessionId,
  );
  const sales = get<{ c: number; t: number; cr: number }>(
    ctx,
    `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t, COALESCE(SUM(credit_amount), 0) AS cr FROM sales WHERE cash_session_id = ? AND status = 'COMPLETED'`,
    sessionId,
  )!;
  const returns = get<{ c: number; t: number }>(ctx, `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM sale_returns WHERE cash_session_id = ?`, sessionId)!;

  const expectedCash =
    s.opening_cash + cashSales - voidReversals - cashRefunds + customerReceipts - cashExpenses - supplierPayments + adjustmentsIn - adjustmentsOut;
  return {
    openingCash: s.opening_cash,
    cashSales,
    cashRefunds,
    customerReceipts,
    cashExpenses,
    supplierPayments,
    adjustmentsIn,
    adjustmentsOut,
    voidReversals,
    expectedCash,
    nonCash,
    creditSales: sales.cr,
    salesCount: sales.c,
    salesTotal: sales.t,
    returnsCount: returns.c,
    returnsTotal: returns.t,
  };
}

export function getCashSession(ctx: ServiceContext, id: number): CashSessionDetail {
  const row = get<CashSessionRow & { summary: string | null; denominations: string | null; closingNotes: string | null }>(
    ctx,
    `SELECT ${ROW_SELECT}, cs.summary, cs.denominations, cs.closing_notes AS closingNotes FROM ${ROW_FROM} WHERE cs.id = ?`,
    id,
  );
  if (!row) throw notFound('Cash session');
  const summary: CashSummary = row.status === 'CLOSED' && row.summary ? JSON.parse(row.summary) : computeCashSummary(ctx, id);
  const adjustments = all<CashSessionDetail['adjustments'][number]>(
    ctx,
    `SELECT a.id, a.direction, a.amount, a.reason, a.created_at AS createdAt, u.full_name AS userName
     FROM cash_adjustments a LEFT JOIN users u ON u.id = a.created_by WHERE a.cash_session_id = ? ORDER BY a.id`,
    id,
  );
  return {
    ...row,
    expectedCash: row.status === 'OPEN' ? summary.expectedCash : row.expectedCash,
    summary,
    denominations: row.denominations ? JSON.parse(row.denominations) : null,
    closingNotes: row.closingNotes,
    adjustments,
  };
}

export function currentCashSession(ctx: ServiceContext): CashSessionDetail | null {
  const open = get<{ id: number }>(ctx, "SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1");
  return open ? getCashSession(ctx, open.id) : null;
}

export function openCashSession(ctx: ServiceContext, input: z.output<typeof CashOpenSchema>): CashSessionDetail {
  const user = requireUser(ctx);
  const id = transaction(ctx, () => {
    if (get(ctx, "SELECT id FROM cash_sessions WHERE status = 'OPEN'")) throw conflict('A shift is already open. Close it before opening a new one.');
    const no = nextNumber(ctx, 'shift');
    const res = run(
      ctx,
      `INSERT INTO cash_sessions (uuid, session_no, status, opened_by, opened_at, opening_cash, closing_notes) VALUES (?, ?, 'OPEN', ?, ?, ?, ?)`,
      randomUUID(),
      no,
      user.id,
      ctx.now().toISOString(),
      input.openingCash,
      input.notes,
    );
    const newId = Number(res.lastInsertRowid);
    audit(ctx, { action: 'CASH_OPEN', entityType: 'cash_session', entityId: newId, description: `Opened shift ${no} with opening cash ${input.openingCash / 100}` });
    return newId;
  });
  return getCashSession(ctx, id);
}

export function addCashAdjustment(ctx: ServiceContext, input: z.output<typeof CashAdjustSchema>): CashSessionDetail {
  const user = requireUser(ctx);
  const open = get<{ id: number; session_no: string }>(ctx, "SELECT id, session_no FROM cash_sessions WHERE status = 'OPEN'");
  if (!open) throw rule('Open a shift before recording cash movements');
  transaction(ctx, () => {
    if (input.direction === 'OUT') {
      const summary = computeCashSummary(ctx, open.id);
      if (input.amount > summary.expectedCash) throw rule('Cash out exceeds the expected cash in the drawer');
    }
    const res = run(
      ctx,
      'INSERT INTO cash_adjustments (cash_session_id, direction, amount, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      open.id,
      input.direction,
      input.amount,
      input.reason,
      user.id,
      ctx.now().toISOString(),
    );
    audit(ctx, {
      action: 'CASH_ADJUST',
      entityType: 'cash_session',
      entityId: open.id,
      description: `Cash ${input.direction === 'IN' ? 'in' : 'out'} ${input.amount / 100} on ${open.session_no} — ${input.reason}`,
      details: { adjustmentId: Number(res.lastInsertRowid), ...input },
    });
  });
  return getCashSession(ctx, open.id);
}

export function closeCashSession(ctx: ServiceContext, input: z.output<typeof CashCloseSchema>): CashSessionDetail {
  const user = requireUser(ctx);
  const open = get<{ id: number; session_no: string }>(ctx, "SELECT id, session_no FROM cash_sessions WHERE status = 'OPEN'");
  if (!open) throw rule('There is no open shift to close');
  transaction(ctx, () => {
    const summary = computeCashSummary(ctx, open.id);
    const variance = input.countedCash - summary.expectedCash;
    run(
      ctx,
      `UPDATE cash_sessions SET status = 'CLOSED', closed_by = ?, closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?,
         denominations = ?, summary = ?, closing_notes = COALESCE(?, closing_notes) WHERE id = ?`,
      user.id,
      ctx.now().toISOString(),
      summary.expectedCash,
      input.countedCash,
      variance,
      input.denominations ? JSON.stringify(input.denominations) : null,
      JSON.stringify(summary),
      input.notes,
      open.id,
    );
    audit(ctx, {
      action: 'CASH_CLOSE',
      entityType: 'cash_session',
      entityId: open.id,
      description: `Closed shift ${open.session_no}: expected ${summary.expectedCash / 100}, counted ${input.countedCash / 100}, variance ${variance / 100}`,
      details: { summary, countedCash: input.countedCash, variance },
      severity: variance !== 0 ? 'WARNING' : 'INFO',
    });
  });
  return getCashSession(ctx, open.id);
}

export function listCashSessions(ctx: ServiceContext, q: z.output<typeof CashListSchema>): Paged<CashSessionRow> {
  const w = new Where();
  if (q.from || q.to) {
    const r = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('cs.opened_at >= ? AND cs.opened_at < ?', r.start, r.end);
  }
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM ${ROW_FROM}${where}`, ...w.params)!.n;
  const rows = all<CashSessionRow>(ctx, `SELECT ${ROW_SELECT} FROM ${ROW_FROM}${where} ORDER BY cs.id DESC LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  for (const r of rows) {
    if (r.status === 'OPEN') {
      r.expectedCash = computeCashSummary(ctx, r.id).expectedCash;
    }
  }
  return { rows, total, page: q.page, pageSize: q.pageSize };
}
