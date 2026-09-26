import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ExpenseCategorySaveSchema, ExpenseCreateSchema, ExpenseListSchema } from '@shared/schemas/finance';
import type { ExpenseCategoryRow, ExpenseList, ExpenseRow } from '@shared/types/finance';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { audit } from '../../core/audit';
import { all, get, requireUser, run, today, transaction, type ServiceContext } from '../../core/context';
import { conflict, invalid, notFound, rule } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { bools, Where } from '../../core/sql';
import { openCashSessionId } from './ledger';

export function listExpenseCategories(ctx: ServiceContext): ExpenseCategoryRow[] {
  return bools(
    all<ExpenseCategoryRow>(
      ctx,
      `SELECT c.id, c.name, c.is_active AS isActive, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expenseCount
       FROM expense_categories c ORDER BY c.name COLLATE NOCASE`,
    ),
    'isActive',
  );
}

export function saveExpenseCategory(ctx: ServiceContext, input: z.output<typeof ExpenseCategorySaveSchema>): ExpenseCategoryRow {
  const id = transaction(ctx, () => {
    if (get(ctx, 'SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE AND id <> ?', input.name, input.id ?? 0)) {
      throw conflict('An expense category with this name already exists');
    }
    if (input.id) {
      run(ctx, 'UPDATE expense_categories SET name = ?, is_active = ? WHERE id = ?', input.name, input.isActive ? 1 : 0, input.id);
      audit(ctx, { action: 'EXPENSE_CATEGORY_UPDATE', entityType: 'expense_category', entityId: input.id, description: `Updated expense category "${input.name}"` });
      return input.id;
    }
    const res = run(ctx, 'INSERT INTO expense_categories (name, is_active) VALUES (?, ?)', input.name, input.isActive ? 1 : 0);
    audit(ctx, { action: 'EXPENSE_CATEGORY_CREATE', entityType: 'expense_category', entityId: Number(res.lastInsertRowid), description: `Created expense category "${input.name}"` });
    return Number(res.lastInsertRowid);
  });
  return listExpenseCategories(ctx).find((c) => c.id === id)!;
}

const EXPENSE_SELECT = `e.id, e.expense_no AS expenseNo, e.expense_date AS expenseDate, e.category_id AS categoryId, c.name AS categoryName,
  e.amount, e.description, e.payment_method AS paymentMethod, e.reference, e.status, u.full_name AS createdByName,
  e.created_at AS createdAt, e.void_reason AS voidReason`;
const EXPENSE_FROM = `expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by`;

export function getExpense(ctx: ServiceContext, id: number): ExpenseRow {
  const row = get<ExpenseRow>(ctx, `SELECT ${EXPENSE_SELECT} FROM ${EXPENSE_FROM} WHERE e.id = ?`, id);
  if (!row) throw notFound('Expense');
  return row;
}

export function createExpense(ctx: ServiceContext, input: z.output<typeof ExpenseCreateSchema>): ExpenseRow {
  const user = requireUser(ctx);
  if (input.expenseDate > today(ctx)) throw invalid('Expense date cannot be in the future', { expenseDate: 'Cannot be in the future' });
  const id = transaction(ctx, () => {
    const cat = get<{ name: string; is_active: number }>(ctx, 'SELECT name, is_active FROM expense_categories WHERE id = ?', input.categoryId);
    if (!cat) throw notFound('Expense category');
    if (!cat.is_active) throw rule('This expense category is inactive');
    const expenseNo = nextNumber(ctx, 'expense');
    const sessionId = input.paymentMethod === 'CASH' && input.expenseDate === today(ctx) ? openCashSessionId(ctx) : null;
    const res = run(
      ctx,
      `INSERT INTO expenses (uuid, expense_no, expense_date, category_id, amount, description, payment_method, reference, cash_session_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
      randomUUID(),
      expenseNo,
      input.expenseDate,
      input.categoryId,
      input.amount,
      input.description,
      input.paymentMethod,
      input.reference,
      sessionId,
      user.id,
      ctx.now().toISOString(),
    );
    const newId = Number(res.lastInsertRowid);
    audit(ctx, {
      action: 'EXPENSE_CREATE',
      entityType: 'expense',
      entityId: newId,
      description: `Recorded ${cat.name} expense ${input.amount / 100} (${PAYMENT_METHOD_LABELS[input.paymentMethod]}) — ${input.description} (${expenseNo})`,
      details: input,
    });
    return newId;
  });
  return getExpense(ctx, id);
}

export function voidExpense(ctx: ServiceContext, id: number, reason: string): ExpenseRow {
  const user = requireUser(ctx);
  transaction(ctx, () => {
    const e = get<{ expense_no: string; status: string; amount: number }>(ctx, 'SELECT expense_no, status, amount FROM expenses WHERE id = ?', id);
    if (!e) throw notFound('Expense');
    if (e.status === 'VOID') throw rule('This expense is already void');
    run(ctx, "UPDATE expenses SET status = 'VOID', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?", user.id, ctx.now().toISOString(), reason, id);
    audit(ctx, { action: 'EXPENSE_VOID', entityType: 'expense', entityId: id, description: `Voided expense ${e.expense_no} (${e.amount / 100}) — ${reason}`, severity: 'WARNING' });
  });
  return getExpense(ctx, id);
}

export function listExpenses(ctx: ServiceContext, q: z.output<typeof ExpenseListSchema>): ExpenseList {
  const w = new Where();
  if (q.status !== 'all') w.add('e.status = ?', q.status);
  w.addIf(q.categoryId, 'e.category_id = ?', q.categoryId);
  w.addIf(q.from, 'e.expense_date >= ?', q.from);
  w.addIf(q.to, 'e.expense_date <= ?', q.to);
  w.search(q.search, ['e.description', 'e.expense_no', 'c.name', 'e.reference']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const agg = get<{ n: number; amt: number }>(
    ctx,
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN e.status = 'POSTED' THEN e.amount END), 0) AS amt FROM ${EXPENSE_FROM}${where}`,
    ...w.params,
  )!;
  const rows = all<ExpenseRow>(
    ctx,
    `SELECT ${EXPENSE_SELECT} FROM ${EXPENSE_FROM}${where} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`,
    ...w.params,
    q.pageSize,
    (q.page - 1) * q.pageSize,
  );
  const byCategory = all<{ categoryName: string; amount: number }>(
    ctx,
    `SELECT c.name AS categoryName, SUM(e.amount) AS amount FROM ${EXPENSE_FROM}${where ? `${where} AND` : ' WHERE'} e.status = 'POSTED'
     GROUP BY c.id ORDER BY amount DESC`,
    ...w.params,
  );
  return { rows, total: agg.n, page: q.page, pageSize: q.pageSize, amountTotal: agg.amt, byCategory };
}
