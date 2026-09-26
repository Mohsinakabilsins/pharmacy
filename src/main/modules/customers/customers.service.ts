import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AttachmentAddSchema,
  CustomerListSchema,
  CustomerSaveSchema,
  CustomerSearchSchema,
  PrescriptionListSchema,
  PrescriptionSaveSchema,
} from '@shared/schemas/customers';
import type { CustomerDetail, CustomerHit, CustomerRow, PrescriptionDetail, PrescriptionRow } from '@shared/types/customers';
import type { Paged } from '@shared/types/common';
import type { Ledger } from '@shared/types/purchasing';
import { localDayRangeToUtc } from '@shared/dates';
import { audit } from '../../core/audit';
import { all, get, requirePermission, run, today, transaction, type ServiceContext } from '../../core/context';
import { conflict, invalid, notFound } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { bools, likeEscape, tokens, Where } from '../../core/sql';
import { customerLedger, postCustomerTxn } from '../finance/ledger';

const CUSTOMER_SELECT = `c.id, c.code, c.name, c.phone, c.address, c.credit_limit AS creditLimit, c.is_active AS isActive,
  COALESCE((SELECT SUM(amount) FROM customer_transactions t WHERE t.customer_id = c.id), 0) AS balance,
  COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED'), 0) AS totalPurchases,
  (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED') AS visitCount,
  (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED') AS lastVisit`;

export function listCustomers(ctx: ServiceContext, q: z.output<typeof CustomerListSchema>): Paged<CustomerRow> & { totalReceivable: number } {
  const w = new Where();
  if (q.status !== 'all') w.add('c.is_active = ?', q.status === 'active' ? 1 : 0);
  w.search(q.search, ['c.name', 'c.phone', 'c.code']);
  const inner = `SELECT ${CUSTOMER_SELECT} FROM customers c${w.sql ? ` WHERE ${w.sql}` : ''}`;
  const bf = q.balance === 'receivable' ? ' WHERE balance > 0' : '';
  const agg = get<{ n: number; r: number }>(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS r FROM (${inner})${bf}`, ...w.params)!;
  const rows = all<CustomerRow>(ctx, `SELECT * FROM (${inner})${bf} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows: bools(rows, 'isActive'), total: agg.n, page: q.page, pageSize: q.pageSize, totalReceivable: agg.r };
}

export function searchCustomers(ctx: ServiceContext, q: z.output<typeof CustomerSearchSchema>): CustomerHit[] {
  const toks = tokens(q.query);
  if (toks.length === 0) {
    return all<CustomerHit>(
      ctx,
      `SELECT c.id, c.code, c.name, c.phone, c.credit_limit AS creditLimit,
              COALESCE((SELECT SUM(amount) FROM customer_transactions t WHERE t.customer_id = c.id), 0) AS balance
       FROM customers c WHERE c.is_active = 1
       ORDER BY (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id) DESC NULLS LAST, c.name LIMIT ?`,
      q.limit,
    );
  }
  const conds = toks.map(() => `(lower(c.name) LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR lower(c.code) LIKE ? ESCAPE '\\')`);
  const params = toks.flatMap((t) => {
    const like = `%${likeEscape(t)}%`;
    return [like, like, like];
  });
  return all<CustomerHit>(
    ctx,
    `SELECT c.id, c.code, c.name, c.phone, c.credit_limit AS creditLimit,
            COALESCE((SELECT SUM(amount) FROM customer_transactions t WHERE t.customer_id = c.id), 0) AS balance
     FROM customers c WHERE c.is_active = 1 AND ${conds.join(' AND ')} ORDER BY c.name COLLATE NOCASE LIMIT ?`,
    ...params,
    q.limit,
  );
}

export function getCustomer(ctx: ServiceContext, id: number): CustomerDetail {
  const row = get<CustomerDetail>(
    ctx,
    `SELECT ${CUSTOMER_SELECT}, c.notes, c.opening_balance AS openingBalance, c.created_at AS createdAt,
            (SELECT COUNT(*) FROM prescriptions p WHERE p.customer_id = c.id) AS prescriptionCount
     FROM customers c WHERE c.id = ?`,
    id,
  );
  if (!row) throw notFound('Customer');
  row.isActive = !!row.isActive;
  return row;
}

export function saveCustomer(ctx: ServiceContext, input: z.output<typeof CustomerSaveSchema>): CustomerDetail {
  requirePermission(ctx, 'customers.manage');
  const id = transaction(ctx, () => {
    const now = ctx.now().toISOString();
    if (input.phone) {
      const dup = get<{ name: string }>(ctx, 'SELECT name FROM customers WHERE phone = ? AND id <> ? AND is_active = 1', input.phone, input.id ?? 0);
      if (dup) throw conflict(`Phone number already registered to ${dup.name}`);
    }
    if (input.id) {
      const before = get<Record<string, unknown>>(ctx, 'SELECT * FROM customers WHERE id = ?', input.id);
      if (!before) throw notFound('Customer');
      const code = input.code || (before.code as string);
      if (code !== before.code && get(ctx, 'SELECT id FROM customers WHERE code = ? AND id <> ?', code, input.id)) throw conflict('Another customer already uses this code');
      run(
        ctx,
        `UPDATE customers SET code = ?, name = ?, phone = ?, address = ?, notes = ?, credit_limit = ?, opening_balance = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        code, input.name, input.phone, input.address, input.notes, input.creditLimit, input.openingBalance, input.isActive ? 1 : 0, now, input.id,
      );
      const delta = input.openingBalance - (before.opening_balance as number);
      if (delta !== 0) postCustomerTxn(ctx, input.id, { type: 'ADJUSTMENT', amount: delta, description: `Opening balance changed to ${input.openingBalance / 100}` });
      audit(ctx, { action: 'CUSTOMER_UPDATE', entityType: 'customer', entityId: input.id, description: `Updated customer "${input.name}"`, severity: delta ? 'WARNING' : 'INFO' });
      return input.id;
    }
    let code = input.code ?? '';
    if (code) {
      if (get(ctx, 'SELECT id FROM customers WHERE code = ?', code)) throw conflict('Another customer already uses this code');
    } else {
      do code = nextNumber(ctx, 'customer');
      while (get(ctx, 'SELECT id FROM customers WHERE code = ?', code));
    }
    const res = run(
      ctx,
      `INSERT INTO customers (uuid, code, name, phone, address, notes, credit_limit, opening_balance, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), code, input.name, input.phone, input.address, input.notes, input.creditLimit, input.openingBalance, input.isActive ? 1 : 0, now, now,
    );
    const newId = Number(res.lastInsertRowid);
    if (input.openingBalance) postCustomerTxn(ctx, newId, { type: 'OPENING_BALANCE', amount: input.openingBalance, description: 'Opening balance' });
    audit(ctx, { action: 'CUSTOMER_CREATE', entityType: 'customer', entityId: newId, description: `Created customer "${input.name}" (${code})` });
    return newId;
  });
  return getCustomer(ctx, id);
}

export function getCustomerLedger(ctx: ServiceContext, id: number, from?: string | null, to?: string | null): Ledger {
  if (!get(ctx, 'SELECT id FROM customers WHERE id = ?', id)) throw notFound('Customer');
  return customerLedger(ctx, id, from, to);
}

/* ─────────────────────────────── Prescriptions ─────────────────────────────── */

const RX_SELECT = `p.id, p.prescription_no AS prescriptionNo, p.prescription_date AS prescriptionDate, p.patient_name AS patientName,
  p.customer_id AS customerId, c.name AS customerName, p.prescriber_name AS prescriberName, p.clinic,
  (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = p.id) AS itemCount,
  (SELECT COUNT(*) FROM prescription_attachments a WHERE a.prescription_id = p.id) AS attachmentCount,
  (SELECT COUNT(*) FROM sales s WHERE s.prescription_id = p.id AND s.status = 'COMPLETED') AS salesCount,
  p.status, u.full_name AS recordedByName, p.created_at AS createdAt`;
const RX_FROM = `prescriptions p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.recorded_by`;

export function listPrescriptions(ctx: ServiceContext, q: z.output<typeof PrescriptionListSchema>): Paged<PrescriptionRow> {
  const w = new Where();
  if (q.status !== 'all') w.add('p.status = ?', q.status);
  w.addIf(q.customerId, 'p.customer_id = ?', q.customerId);
  w.addIf(q.from, 'p.prescription_date >= ?', q.from);
  w.addIf(q.to, 'p.prescription_date <= ?', q.to);
  w.search(q.search, ['p.prescription_no', 'p.patient_name', 'p.prescriber_name', 'c.name', 'c.phone']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM ${RX_FROM}${where}`, ...w.params)!.n;
  const rows = all<PrescriptionRow>(ctx, `SELECT ${RX_SELECT} FROM ${RX_FROM}${where} ORDER BY p.prescription_date DESC, p.id DESC LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export function getPrescription(ctx: ServiceContext, id: number): PrescriptionDetail {
  const row = get<PrescriptionDetail>(
    ctx,
    `SELECT ${RX_SELECT}, p.patient_age AS patientAge, p.prescriber_registration AS prescriberRegistration, p.notes FROM ${RX_FROM} WHERE p.id = ?`,
    id,
  );
  if (!row) throw notFound('Prescription');
  row.items = all(
    ctx,
    `SELECT i.id, i.product_id AS productId,
            pr.brand_name || CASE WHEN pr.strength IS NOT NULL THEN ' ' || pr.strength ELSE '' END AS productName,
            i.medicine_text AS medicineText, i.quantity, i.instructions
     FROM prescription_items i LEFT JOIN products pr ON pr.id = i.product_id WHERE i.prescription_id = ? ORDER BY i.id`,
    id,
  );
  row.attachments = all(ctx, 'SELECT id, file_name AS fileName, mime_type AS mimeType, size, created_at AS createdAt FROM prescription_attachments WHERE prescription_id = ? ORDER BY id', id);
  row.sales = all(ctx, 'SELECT id, invoice_no AS invoiceNo, created_at AS createdAt, total, status FROM sales WHERE prescription_id = ? ORDER BY id DESC', id);
  return row;
}

export function savePrescription(ctx: ServiceContext, input: z.output<typeof PrescriptionSaveSchema>): PrescriptionDetail {
  const user = requirePermission(ctx, 'prescriptions.manage');
  if (input.prescriptionDate > today(ctx)) throw invalid('Prescription date cannot be in the future', { prescriptionDate: 'Cannot be in the future' });
  const id = transaction(ctx, () => {
    if (input.customerId && !get(ctx, 'SELECT id FROM customers WHERE id = ?', input.customerId)) throw notFound('Customer');
    const now = ctx.now().toISOString();
    let rxId = input.id;
    if (rxId) {
      const before = get<{ prescription_no: string }>(ctx, 'SELECT prescription_no FROM prescriptions WHERE id = ?', rxId);
      if (!before) throw notFound('Prescription');
      run(
        ctx,
        `UPDATE prescriptions SET customer_id = ?, patient_name = ?, patient_age = ?, prescriber_name = ?, prescriber_registration = ?, clinic = ?,
           prescription_date = ?, notes = ?, updated_at = ? WHERE id = ?`,
        input.customerId ?? null, input.patientName, input.patientAge, input.prescriberName, input.prescriberRegistration, input.clinic,
        input.prescriptionDate, input.notes, now, rxId,
      );
      run(ctx, 'DELETE FROM prescription_items WHERE prescription_id = ?', rxId);
      audit(ctx, { action: 'PRESCRIPTION_UPDATE', entityType: 'prescription', entityId: rxId, description: `Updated prescription ${before.prescription_no}` });
    } else {
      const no = nextNumber(ctx, 'prescription');
      const res = run(
        ctx,
        `INSERT INTO prescriptions (uuid, prescription_no, customer_id, patient_name, patient_age, prescriber_name, prescriber_registration, clinic,
           prescription_date, notes, status, recorded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        randomUUID(), no, input.customerId ?? null, input.patientName, input.patientAge, input.prescriberName, input.prescriberRegistration,
        input.clinic, input.prescriptionDate, input.notes, user.id, now, now,
      );
      rxId = Number(res.lastInsertRowid);
      audit(ctx, { action: 'PRESCRIPTION_CREATE', entityType: 'prescription', entityId: rxId, description: `Recorded prescription ${no} for ${input.patientName}` });
    }
    const ins = ctx.sqlite.prepare('INSERT INTO prescription_items (prescription_id, product_id, medicine_text, quantity, instructions) VALUES (?, ?, ?, ?, ?)');
    for (const i of input.items) ins.run(rxId, i.productId ?? null, i.medicineText, i.quantity ?? null, i.instructions);
    return rxId;
  });
  return getPrescription(ctx, id);
}

export function setPrescriptionStatus(ctx: ServiceContext, id: number, status: 'ACTIVE' | 'ARCHIVED'): PrescriptionDetail {
  requirePermission(ctx, 'prescriptions.manage');
  transaction(ctx, () => {
    const p = get<{ prescription_no: string }>(ctx, 'SELECT prescription_no FROM prescriptions WHERE id = ?', id);
    if (!p) throw notFound('Prescription');
    run(ctx, 'UPDATE prescriptions SET status = ?, updated_at = ? WHERE id = ?', status, ctx.now().toISOString(), id);
    audit(ctx, { action: 'PRESCRIPTION_STATUS', entityType: 'prescription', entityId: id, description: `${status === 'ARCHIVED' ? 'Archived' : 'Restored'} prescription ${p.prescription_no}` });
  });
  return getPrescription(ctx, id);
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function addPrescriptionAttachment(ctx: ServiceContext, input: z.output<typeof AttachmentAddSchema>): PrescriptionDetail {
  const user = requirePermission(ctx, 'prescriptions.manage');
  const data = Buffer.from(input.dataBase64, 'base64');
  if (data.length === 0) throw invalid('The file is empty');
  if (data.length > MAX_ATTACHMENT_BYTES) throw invalid('File is too large (max 8 MB)');
  const signature = data.subarray(0, 4).toString('hex');
  const valid =
    (input.mimeType === 'image/jpeg' && signature.startsWith('ffd8')) ||
    (input.mimeType === 'image/png' && signature === '89504e47') ||
    (input.mimeType === 'application/pdf' && signature === '25504446') ||
    (input.mimeType === 'image/webp' && data.subarray(8, 12).toString() === 'WEBP');
  if (!valid) throw invalid('The file content does not match its type');
  transaction(ctx, () => {
    const p = get<{ prescription_no: string }>(ctx, 'SELECT prescription_no FROM prescriptions WHERE id = ?', input.prescriptionId);
    if (!p) throw notFound('Prescription');
    const res = run(
      ctx,
      'INSERT INTO prescription_attachments (prescription_id, file_name, mime_type, size, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.prescriptionId, input.fileName, input.mimeType, data.length, data, user.id, ctx.now().toISOString(),
    );
    audit(ctx, { action: 'PRESCRIPTION_ATTACH', entityType: 'prescription', entityId: input.prescriptionId, description: `Attached "${input.fileName}" to ${p.prescription_no}`, details: { attachmentId: Number(res.lastInsertRowid), size: data.length } });
  });
  return getPrescription(ctx, input.prescriptionId);
}

export function getPrescriptionAttachment(ctx: ServiceContext, id: number): { fileName: string; mimeType: string; dataBase64: string } {
  const row = get<{ file_name: string; mime_type: string; data: Buffer; prescription_id: number }>(
    ctx,
    'SELECT file_name, mime_type, data, prescription_id FROM prescription_attachments WHERE id = ?',
    id,
  );
  if (!row) throw notFound('Attachment');
  audit(ctx, { action: 'PRESCRIPTION_VIEW_ATTACHMENT', entityType: 'prescription', entityId: row.prescription_id, description: `Viewed attachment "${row.file_name}"` });
  return { fileName: row.file_name, mimeType: row.mime_type, dataBase64: row.data.toString('base64') };
}

export function removePrescriptionAttachment(ctx: ServiceContext, id: number): PrescriptionDetail {
  requirePermission(ctx, 'prescriptions.manage');
  const row = get<{ prescription_id: number; file_name: string }>(ctx, 'SELECT prescription_id, file_name FROM prescription_attachments WHERE id = ?', id);
  if (!row) throw notFound('Attachment');
  transaction(ctx, () => {
    run(ctx, 'DELETE FROM prescription_attachments WHERE id = ?', id);
    audit(ctx, { action: 'PRESCRIPTION_DETACH', entityType: 'prescription', entityId: row.prescription_id, description: `Removed attachment "${row.file_name}"`, severity: 'WARNING' });
  });
  return getPrescription(ctx, row.prescription_id);
}

export function customerSalesRange(from?: string | null, to?: string | null) {
  return from || to ? localDayRangeToUtc(from ?? '2000-01-01', to ?? '2100-01-01') : null;
}
