import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { SupplierListSchema, SupplierSaveSchema } from '@shared/schemas/purchasing';
import type { Ledger, SupplierDetail, SupplierRow } from '@shared/types/purchasing';
import type { Option, Paged } from '@shared/types/common';
import { audit } from '../../core/audit';
import { all, get, run, today, transaction, type ServiceContext } from '../../core/context';
import { conflict, notFound } from '../../core/errors';
import { bools, Where } from '../../core/sql';
import { postSupplierTxn, supplierLedger } from '../finance/ledger';

const SUPPLIER_SELECT = `s.id, s.name, s.contact_person AS contactPerson, s.phone, s.city, s.payment_terms_days AS paymentTermsDays,
  s.is_active AS isActive,
  COALESCE((SELECT SUM(amount) FROM supplier_transactions t WHERE t.supplier_id = s.id), 0) AS balance,
  (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'POSTED') AS purchaseCount,
  COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'POSTED'), 0) AS totalPurchases,
  (SELECT MAX(invoice_date) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'POSTED') AS lastPurchaseDate`;

export function listSuppliers(ctx: ServiceContext, q: z.output<typeof SupplierListSchema>): Paged<SupplierRow> & { totalPayable: number } {
  const w = new Where();
  if (q.status !== 'all') w.add('s.is_active = ?', q.status === 'active' ? 1 : 0);
  w.search(q.search, ['s.name', 's.contact_person', 's.phone', 's.city']);
  const inner = `SELECT ${SUPPLIER_SELECT} FROM suppliers s${w.sql ? ` WHERE ${w.sql}` : ''}`;
  const balanceFilter = q.balance === 'payable' ? ' WHERE balance > 0' : q.balance === 'advance' ? ' WHERE balance < 0' : '';
  const agg = get<{ n: number; payable: number }>(
    ctx,
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS payable FROM (${inner})${balanceFilter}`,
    ...w.params,
  )!;
  const rows = all<SupplierRow>(ctx, `SELECT * FROM (${inner})${balanceFilter} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows: bools(rows, 'isActive'), total: agg.n, page: q.page, pageSize: q.pageSize, totalPayable: agg.payable };
}

export function supplierOptions(ctx: ServiceContext): Option[] {
  return all<Option>(ctx, 'SELECT id, name FROM suppliers WHERE is_active = 1 ORDER BY name COLLATE NOCASE');
}

export function getSupplier(ctx: ServiceContext, id: number): SupplierDetail {
  const row = get<SupplierDetail>(
    ctx,
    `SELECT ${SUPPLIER_SELECT}, s.email, s.address, s.ntn, s.strn, s.drug_license_no AS drugLicenseNo, s.opening_balance AS openingBalance,
            s.notes, s.created_at AS createdAt,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.supplier_id = s.id AND p.status = 'POSTED'), 0) AS totalPaid
     FROM suppliers s WHERE s.id = ?`,
    id,
  );
  if (!row) throw notFound('Supplier');
  row.isActive = !!row.isActive;
  return row;
}

export function saveSupplier(ctx: ServiceContext, input: z.output<typeof SupplierSaveSchema>): SupplierDetail {
  const id = transaction(ctx, () => {
    if (get(ctx, 'SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND id <> ?', input.name, input.id ?? 0)) {
      throw conflict('A supplier with this name already exists');
    }
    const now = ctx.now().toISOString();
    if (input.id) {
      const before = get<Record<string, unknown>>(ctx, 'SELECT * FROM suppliers WHERE id = ?', input.id);
      if (!before) throw notFound('Supplier');
      run(
        ctx,
        `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, city = ?, ntn = ?, strn = ?, drug_license_no = ?,
           payment_terms_days = ?, opening_balance = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        input.name, input.contactPerson, input.phone, input.email, input.address, input.city, input.ntn, input.strn, input.drugLicenseNo,
        input.paymentTermsDays, input.openingBalance, input.notes, input.isActive ? 1 : 0, now, input.id,
      );
      const delta = input.openingBalance - (before.opening_balance as number);
      if (delta !== 0) {
        postSupplierTxn(ctx, input.id, {
          type: 'ADJUSTMENT',
          amount: delta,
          description: `Opening balance changed from ${(before.opening_balance as number) / 100} to ${input.openingBalance / 100}`,
        });
      }
      audit(ctx, {
        action: 'SUPPLIER_UPDATE',
        entityType: 'supplier',
        entityId: input.id,
        description: `Updated supplier "${input.name}"`,
        severity: delta !== 0 ? 'WARNING' : 'INFO',
        details: delta !== 0 ? { openingBalance: { from: before.opening_balance, to: input.openingBalance } } : undefined,
      });
      return input.id;
    }
    const res = run(
      ctx,
      `INSERT INTO suppliers (uuid, name, contact_person, phone, email, address, city, ntn, strn, drug_license_no, payment_terms_days,
         opening_balance, notes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), input.name, input.contactPerson, input.phone, input.email, input.address, input.city, input.ntn, input.strn,
      input.drugLicenseNo, input.paymentTermsDays, input.openingBalance, input.notes, input.isActive ? 1 : 0, now, now,
    );
    const newId = Number(res.lastInsertRowid);
    if (input.openingBalance !== 0) {
      postSupplierTxn(ctx, newId, { type: 'OPENING_BALANCE', amount: input.openingBalance, date: today(ctx), description: 'Opening balance' });
    }
    audit(ctx, { action: 'SUPPLIER_CREATE', entityType: 'supplier', entityId: newId, description: `Created supplier "${input.name}"` });
    return newId;
  });
  return getSupplier(ctx, id);
}

export function getSupplierLedger(ctx: ServiceContext, id: number, from?: string | null, to?: string | null): Ledger {
  if (!get(ctx, 'SELECT id FROM suppliers WHERE id = ?', id)) throw notFound('Supplier');
  return supplierLedger(ctx, id, from, to);
}
