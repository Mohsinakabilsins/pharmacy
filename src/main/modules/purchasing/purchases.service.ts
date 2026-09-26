import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { PurchaseCalcSchema, PurchaseDraftSchema, PurchaseListSchema, PurchasePostSchema } from '@shared/schemas/purchasing';
import type { PurchaseDetail, PurchaseItemDetail, PurchaseRow, PurchaseTotals } from '@shared/types/purchasing';
import type { Paged } from '@shared/types/common';
import { calculatePurchase, reverseWeightedAverageCost } from '@shared/calc/purchase';
import { isExpired } from '@shared/calc/stock';
import { lineAmount } from '@shared/money';
import { audit } from '../../core/audit';
import { all, get, requirePermission, run, today, transaction, type ServiceContext } from '../../core/context';
import { AppError, conflict, invalid, notFound, rule } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { Where } from '../../core/sql';
import { applyMovement, receiveIntoBatch } from '../inventory/inventory.service';
import { postSupplierTxn, supplierBalance } from '../finance/ledger';
import { recordSupplierPayment, voidPaymentInternal } from '../finance/payments.service';

function packSizes(ctx: ServiceContext, productIds: number[]): Map<number, number> {
  if (productIds.length === 0) return new Map();
  const unique = Array.from(new Set(productIds));
  const rows = all<{ id: number; pack_size: number }>(ctx, `SELECT id, pack_size FROM products WHERE id IN (${unique.map(() => '?').join(',')})`, ...unique);
  const map = new Map(rows.map((r) => [r.id, r.pack_size]));
  for (const id of unique) if (!map.has(id)) throw notFound(`Product #${id}`);
  return map;
}

/** Live totals for the purchase editor — calculated in the main process. */
export function calculatePurchaseTotals(ctx: ServiceContext, input: z.output<typeof PurchaseCalcSchema>): PurchaseTotals {
  const sizes = packSizes(ctx, input.items.map((i) => i.productId));
  const result = calculatePurchase({
    lines: input.items.map((i, idx) => ({
      key: String(idx),
      quantity: i.quantity,
      bonusQuantity: i.bonusQuantity,
      packSize: sizes.get(i.productId)!,
      costPrice: i.costPrice,
      discountBp: i.discountBp,
      discountAmount: i.discountAmount,
      taxRateBp: i.taxRateBp,
    })),
    invoiceDiscount: input.invoiceDiscount,
    otherCharges: input.otherCharges,
  });
  return {
    rows: result.rows.map((r) => ({ gross: r.gross, discount: r.discount, tax: r.tax, lineTotal: r.lineTotal, landedCostPrice: r.landedCostPrice })),
    subtotal: result.subtotal,
    discountTotal: result.discountTotal,
    taxTotal: result.taxTotal,
    linesTotal: result.linesTotal,
    invoiceDiscount: result.invoiceDiscount,
    otherCharges: result.otherCharges,
    total: result.total,
  };
}

type DraftInput = z.output<typeof PurchaseDraftSchema>;

function writeItems(ctx: ServiceContext, purchaseId: number, input: DraftInput) {
  const sizes = packSizes(ctx, input.items.map((i) => i.productId));
  const calc = calculatePurchase({
    lines: input.items.map((i, idx) => ({
      key: String(idx),
      quantity: i.quantity,
      bonusQuantity: i.bonusQuantity,
      packSize: sizes.get(i.productId)!,
      costPrice: i.costPrice,
      discountBp: i.discountBp,
      discountAmount: i.discountAmount,
      taxRateBp: i.taxRateBp,
    })),
    invoiceDiscount: input.invoiceDiscount,
    otherCharges: input.otherCharges,
  });
  run(ctx, 'DELETE FROM purchase_items WHERE purchase_id = ?', purchaseId);
  const ins = ctx.sqlite.prepare(
    `INSERT INTO purchase_items (purchase_id, line_no, product_id, batch_number, manufacture_date, expiry_date, quantity, bonus_quantity,
       cost_price, sale_price, discount_bp, discount_amount, tax_rate_bp, tax_amount, line_total, landed_cost_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  input.items.forEach((i, idx) => {
    const r = calc.rows[idx];
    ins.run(
      purchaseId, idx + 1, i.productId, i.batchNumber, i.manufactureDate, i.expiryDate, i.quantity, i.bonusQuantity, i.costPrice,
      i.salePrice, i.discountBp, r.discount, i.taxRateBp, r.tax, r.lineTotal, r.landedCostPrice,
    );
  });
  return calc;
}

export function savePurchaseDraft(ctx: ServiceContext, input: DraftInput): PurchaseDetail {
  const user = requirePermission(ctx, 'purchases.manage');
  const id = transaction(ctx, () => {
    const supplier = get<{ name: string; is_active: number }>(ctx, 'SELECT name, is_active FROM suppliers WHERE id = ?', input.supplierId);
    if (!supplier) throw notFound('Supplier');
    const now = ctx.now().toISOString();
    let purchaseId = input.id;
    if (purchaseId) {
      const existing = get<{ status: string; purchase_no: string }>(ctx, 'SELECT status, purchase_no FROM purchases WHERE id = ?', purchaseId);
      if (!existing) throw notFound('Purchase');
      if (existing.status !== 'DRAFT') throw rule('Only draft purchases can be edited. Void the purchase and enter it again.');
      run(
        ctx,
        `UPDATE purchases SET supplier_id = ?, supplier_invoice_no = ?, invoice_date = ?, due_date = ?, invoice_discount = ?, other_charges = ?,
           notes = ?, updated_at = ? WHERE id = ?`,
        input.supplierId, input.supplierInvoiceNo, input.invoiceDate, input.dueDate, input.invoiceDiscount, input.otherCharges, input.notes, now, purchaseId,
      );
      audit(ctx, { action: 'PURCHASE_UPDATE', entityType: 'purchase', entityId: purchaseId, description: `Updated draft purchase ${existing.purchase_no} (${input.items.length} items)` });
    } else {
      const no = nextNumber(ctx, 'purchase');
      const res = run(
        ctx,
        `INSERT INTO purchases (uuid, purchase_no, supplier_id, supplier_invoice_no, invoice_date, due_date, status, invoice_discount, other_charges,
           notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
        randomUUID(), no, input.supplierId, input.supplierInvoiceNo, input.invoiceDate, input.dueDate, input.invoiceDiscount, input.otherCharges,
        input.notes, user.id, now, now,
      );
      purchaseId = Number(res.lastInsertRowid);
      audit(ctx, { action: 'PURCHASE_CREATE', entityType: 'purchase', entityId: purchaseId, description: `Created draft purchase ${no} from ${supplier.name}` });
    }
    const calc = writeItems(ctx, purchaseId, input);
    run(
      ctx,
      'UPDATE purchases SET subtotal = ?, discount_total = ?, tax_total = ?, total = ?, invoice_discount = ?, other_charges = ? WHERE id = ?',
      calc.subtotal, calc.discountTotal, calc.taxTotal, calc.total, calc.invoiceDiscount, calc.otherCharges, purchaseId,
    );
    return purchaseId;
  });
  return getPurchase(ctx, id);
}

export function postPurchase(ctx: ServiceContext, input: z.output<typeof PurchasePostSchema>): PurchaseDetail {
  const user = requirePermission(ctx, 'purchases.manage');
  transaction(ctx, () => {
    const p = get<{ id: number; purchase_no: string; status: string; supplier_id: number; supplier_invoice_no: string | null; invoice_date: string; invoice_discount: number; other_charges: number }>(
      ctx,
      'SELECT id, purchase_no, status, supplier_id, supplier_invoice_no, invoice_date, invoice_discount, other_charges FROM purchases WHERE id = ?',
      input.id,
    );
    if (!p) throw notFound('Purchase');
    if (p.status !== 'DRAFT') throw rule(`Purchase ${p.purchase_no} is already ${p.status.toLowerCase()}`);
    const supplier = get<{ name: string }>(ctx, 'SELECT name FROM suppliers WHERE id = ?', p.supplier_id)!;
    if (p.supplier_invoice_no) {
      const dup = get<{ purchase_no: string }>(
        ctx,
        "SELECT purchase_no FROM purchases WHERE supplier_id = ? AND supplier_invoice_no = ? COLLATE NOCASE AND status = 'POSTED' AND id <> ?",
        p.supplier_id,
        p.supplier_invoice_no,
        p.id,
      );
      if (dup) throw conflict(`Supplier invoice ${p.supplier_invoice_no} was already posted as ${dup.purchase_no}`);
    }
    const items = all<{
      id: number; product_id: number; batch_number: string; manufacture_date: string | null; expiry_date: string; quantity: number;
      bonus_quantity: number; cost_price: number; sale_price: number; discount_bp: number; discount_amount: number; tax_rate_bp: number;
      brand_name: string; pack_size: number; product_active: number;
    }>(
      ctx,
      `SELECT pi.*, pr.brand_name, pr.pack_size, pr.is_active AS product_active FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
       WHERE pi.purchase_id = ? ORDER BY pi.line_no`,
      p.id,
    );
    if (items.length === 0) throw rule('Add at least one item before posting the purchase');
    const t = today(ctx);
    const errors: Record<string, string> = {};
    const seen = new Set<string>();
    items.forEach((i, idx) => {
      const k = `${i.product_id}:${i.batch_number}`;
      if (seen.has(k)) errors[`items.${idx}.batchNumber`] = `Batch ${i.batch_number} of ${i.brand_name} appears twice — combine the lines`;
      seen.add(k);
      if (isExpired(i.expiry_date, t)) errors[`items.${idx}.expiryDate`] = `${i.brand_name} batch ${i.batch_number} is already expired`;
      if (i.quantity + i.bonus_quantity <= 0) errors[`items.${idx}.quantity`] = `Enter a quantity for ${i.brand_name}`;
      if (i.sale_price <= 0) errors[`items.${idx}.salePrice`] = `Enter a selling price for ${i.brand_name}`;
    });
    if (Object.keys(errors).length) throw invalid(Object.values(errors)[0], errors);

    const calc = calculatePurchase({
      lines: items.map((i) => ({
        key: String(i.id),
        quantity: i.quantity,
        bonusQuantity: i.bonus_quantity,
        packSize: i.pack_size,
        costPrice: i.cost_price,
        discountBp: i.discount_bp,
        discountAmount: i.discount_amount,
        taxRateBp: i.tax_rate_bp,
      })),
      invoiceDiscount: p.invoice_discount,
      otherCharges: p.other_charges,
    });
    if (input.paidAmount > calc.total) throw invalid('Amount paid cannot exceed the invoice total', { paidAmount: 'Exceeds invoice total' });

    items.forEach((i, idx) => {
      const r = calc.rows[idx];
      const units = i.quantity + i.bonus_quantity;
      const received = receiveIntoBatch(ctx, {
        productId: i.product_id,
        batchNumber: i.batch_number,
        manufactureDate: i.manufacture_date,
        expiryDate: i.expiry_date,
        units,
        costPrice: r.landedCostPrice,
        salePrice: i.sale_price,
        supplierId: p.supplier_id,
        purchaseId: p.id,
      });
      applyMovement(ctx, {
        batchId: received.batchId,
        type: 'PURCHASE',
        quantity: units,
        referenceType: 'purchase',
        referenceId: p.id,
        note: `${p.purchase_no} from ${supplier.name}${i.bonus_quantity ? ` (incl. ${i.bonus_quantity} bonus)` : ''}`,
      });
      run(
        ctx,
        'UPDATE purchase_items SET batch_id = ?, discount_amount = ?, tax_amount = ?, line_total = ?, landed_cost_price = ? WHERE id = ?',
        received.batchId, r.discount, r.tax, r.lineTotal, r.landedCostPrice, i.id,
      );
      // keep product defaults at the latest purchase terms
      run(ctx, 'UPDATE products SET default_cost_price = ?, default_sale_price = ?, updated_at = ? WHERE id = ?', r.landedCostPrice, i.sale_price, ctx.now().toISOString(), i.product_id);
    });

    postSupplierTxn(ctx, p.supplier_id, {
      type: 'PURCHASE',
      amount: calc.total,
      date: p.invoice_date,
      referenceType: 'purchase',
      referenceId: p.id,
      description: `Purchase ${p.purchase_no}${p.supplier_invoice_no ? ` (inv. ${p.supplier_invoice_no})` : ''}`,
    });
    if (input.paidAmount > 0) {
      recordSupplierPayment(ctx, {
        supplierId: p.supplier_id,
        amount: input.paidAmount,
        method: input.paymentMethod,
        reference: input.paymentReference,
        paymentDate: t,
        notes: `Paid on posting ${p.purchase_no}`,
        purchaseId: p.id,
      });
    }
    run(
      ctx,
      `UPDATE purchases SET status = 'POSTED', subtotal = ?, discount_total = ?, tax_total = ?, total = ?, invoice_discount = ?, other_charges = ?,
         paid_amount = ?, payment_method = ?, posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?`,
      calc.subtotal, calc.discountTotal, calc.taxTotal, calc.total, calc.invoiceDiscount, calc.otherCharges, input.paidAmount,
      input.paidAmount > 0 ? input.paymentMethod : null, user.id, ctx.now().toISOString(), ctx.now().toISOString(), p.id,
    );
    audit(ctx, {
      action: 'PURCHASE_POST',
      entityType: 'purchase',
      entityId: p.id,
      description: `Posted purchase ${p.purchase_no} from ${supplier.name}: ${items.length} items, total ${calc.total / 100}, paid ${input.paidAmount / 100}`,
      details: { total: calc.total, paid: input.paidAmount, items: items.length },
    });
  });
  return getPurchase(ctx, input.id);
}

interface VoidCheck {
  ok: boolean;
  reason: string | null;
}

function checkVoidable(ctx: ServiceContext, purchaseId: number): VoidCheck {
  const rows = all<{ batch_id: number; units: number; on_hand: number; brand_name: string; batch_number: string }>(
    ctx,
    `SELECT pi.batch_id, SUM(pi.quantity + pi.bonus_quantity) AS units, b.quantity_on_hand AS on_hand, pr.brand_name, b.batch_number
     FROM purchase_items pi JOIN batches b ON b.id = pi.batch_id JOIN products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = ? GROUP BY pi.batch_id`,
    purchaseId,
  );
  for (const r of rows) {
    if (r.on_hand < r.units) {
      return { ok: false, reason: `${r.brand_name} batch ${r.batch_number} has only ${r.on_hand} of ${r.units} received units left — stock has been sold or adjusted.` };
    }
  }
  return { ok: true, reason: null };
}

export function voidPurchase(ctx: ServiceContext, id: number, reason: string): PurchaseDetail {
  const user = requirePermission(ctx, 'purchases.void');
  transaction(ctx, () => {
    const p = get<{ id: number; purchase_no: string; status: string; supplier_id: number; total: number }>(
      ctx,
      'SELECT id, purchase_no, status, supplier_id, total FROM purchases WHERE id = ?',
      id,
    );
    if (!p) throw notFound('Purchase');
    if (p.status !== 'POSTED') throw rule('Only posted purchases can be voided');
    const check = checkVoidable(ctx, id);
    if (!check.ok) throw new AppError('BUSINESS_RULE', `Cannot void ${p.purchase_no}: ${check.reason}`);
    const items = all<{ batch_id: number; quantity: number; bonus_quantity: number; landed_cost_price: number }>(
      ctx,
      'SELECT batch_id, quantity, bonus_quantity, landed_cost_price FROM purchase_items WHERE purchase_id = ?',
      id,
    );
    for (const i of items) {
      const units = i.quantity + i.bonus_quantity;
      const b = get<{ quantity_on_hand: number; cost_price: number }>(ctx, 'SELECT quantity_on_hand, cost_price FROM batches WHERE id = ?', i.batch_id)!;
      const restoredCost = reverseWeightedAverageCost(b.quantity_on_hand, b.cost_price, units, i.landed_cost_price);
      applyMovement(ctx, { batchId: i.batch_id, type: 'PURCHASE_VOID', quantity: -units, referenceType: 'purchase', referenceId: id, note: `Void ${p.purchase_no}: ${reason}`, allowNegative: false });
      run(ctx, 'UPDATE batches SET cost_price = ?, quantity_received = quantity_received - ? WHERE id = ?', restoredCost, units, i.batch_id);
    }
    postSupplierTxn(ctx, p.supplier_id, { type: 'PURCHASE_VOID', amount: -p.total, referenceType: 'purchase', referenceId: id, description: `Void of ${p.purchase_no}: ${reason}` });
    const linkedPayments = all<{ id: number }>(ctx, "SELECT id FROM payments WHERE purchase_id = ? AND status = 'POSTED'", id);
    for (const pay of linkedPayments) voidPaymentInternal(ctx, pay.id, `Purchase ${p.purchase_no} voided`);
    run(ctx, "UPDATE purchases SET status = 'VOID', voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?", user.id, ctx.now().toISOString(), reason, ctx.now().toISOString(), id);
    audit(ctx, { action: 'PURCHASE_VOID', entityType: 'purchase', entityId: id, description: `Voided purchase ${p.purchase_no} (${p.total / 100}) — ${reason}`, severity: 'CRITICAL' });
  });
  return getPurchase(ctx, id);
}

export function deletePurchaseDraft(ctx: ServiceContext, id: number): void {
  requirePermission(ctx, 'purchases.manage');
  transaction(ctx, () => {
    const p = get<{ purchase_no: string; status: string }>(ctx, 'SELECT purchase_no, status FROM purchases WHERE id = ?', id);
    if (!p) throw notFound('Purchase');
    if (p.status !== 'DRAFT') {
      audit(ctx, { action: 'DELETE_ATTEMPT', entityType: 'purchase', entityId: id, description: `Attempted to delete ${p.status.toLowerCase()} purchase ${p.purchase_no}`, severity: 'WARNING' });
      throw rule('Only drafts can be deleted. Posted purchases must be voided.');
    }
    run(ctx, 'DELETE FROM purchase_items WHERE purchase_id = ?', id);
    run(ctx, 'DELETE FROM purchases WHERE id = ?', id);
    audit(ctx, { action: 'PURCHASE_DRAFT_DELETE', entityType: 'purchase', entityId: id, description: `Deleted draft purchase ${p.purchase_no}` });
  });
}

const ROW_SELECT = `p.id, p.purchase_no AS purchaseNo, p.supplier_id AS supplierId, s.name AS supplierName, p.supplier_invoice_no AS supplierInvoiceNo,
  p.invoice_date AS invoiceDate, p.due_date AS dueDate, p.status, (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS itemCount,
  p.total, p.paid_amount AS paidAmount, uc.full_name AS createdByName, p.posted_at AS postedAt, p.created_at AS createdAt`;
const ROW_FROM = `purchases p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users uc ON uc.id = p.created_by`;

export function listPurchases(ctx: ServiceContext, q: z.output<typeof PurchaseListSchema>): Paged<PurchaseRow> & { totalAmount: number } {
  const w = new Where();
  if (q.status !== 'all') w.add('p.status = ?', q.status);
  w.addIf(q.supplierId, 'p.supplier_id = ?', q.supplierId);
  w.addIf(q.from, 'p.invoice_date >= ?', q.from);
  w.addIf(q.to, 'p.invoice_date <= ?', q.to);
  w.search(q.search, ['p.purchase_no', 'p.supplier_invoice_no', 's.name']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const agg = get<{ n: number; amt: number }>(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'POSTED' THEN p.total END), 0) AS amt FROM ${ROW_FROM}${where}`, ...w.params)!;
  const rows = all<PurchaseRow>(ctx, `SELECT ${ROW_SELECT} FROM ${ROW_FROM}${where} ORDER BY p.invoice_date DESC, p.id DESC LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows, total: agg.n, page: q.page, pageSize: q.pageSize, totalAmount: agg.amt };
}

export function getPurchase(ctx: ServiceContext, id: number): PurchaseDetail {
  const row = get<PurchaseDetail>(
    ctx,
    `SELECT ${ROW_SELECT}, p.subtotal, p.discount_total AS discountTotal, p.invoice_discount AS invoiceDiscount, p.other_charges AS otherCharges,
            p.tax_total AS taxTotal, p.payment_method AS paymentMethod, p.notes, up.full_name AS postedByName, p.voided_at AS voidedAt,
            uv.full_name AS voidedByName, p.void_reason AS voidReason
     FROM ${ROW_FROM} LEFT JOIN users up ON up.id = p.posted_by LEFT JOIN users uv ON uv.id = p.voided_by WHERE p.id = ?`,
    id,
  );
  if (!row) throw notFound('Purchase');
  const items = all<PurchaseItemDetail>(
    ctx,
    `SELECT pi.id, pi.line_no AS lineNo, pi.product_id AS productId, pr.code AS productCode,
            pr.brand_name || CASE WHEN pr.strength IS NOT NULL AND pr.strength <> '' THEN ' ' || pr.strength ELSE '' END AS productName,
            pr.generic_name AS genericName, pr.pack_size AS packSize, pr.unit_name AS unitName, pr.pack_name AS packName, pi.batch_id AS batchId,
            pi.batch_number AS batchNumber, pi.manufacture_date AS manufactureDate, pi.expiry_date AS expiryDate, pi.quantity,
            pi.bonus_quantity AS bonusQuantity, pi.cost_price AS costPrice, pi.sale_price AS salePrice, pi.discount_bp AS discountBp,
            pi.discount_amount AS discountAmount, pi.tax_rate_bp AS taxRateBp, pi.tax_amount AS taxAmount, pi.line_total AS lineTotal,
            pi.landed_cost_price AS landedCostPrice
     FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.line_no`,
    id,
  );
  for (const i of items) i.gross = lineAmount(i.quantity, i.costPrice, i.packSize);
  const payments = all<PurchaseDetail['payments'][number]>(
    ctx,
    'SELECT id, payment_no AS paymentNo, amount, method, payment_date AS paymentDate, status FROM payments WHERE purchase_id = ? ORDER BY id',
    id,
  );
  const check = row.status === 'POSTED' ? checkVoidable(ctx, id) : { ok: false, reason: row.status === 'VOID' ? 'Already void' : 'Draft purchases are deleted, not voided' };
  return {
    ...row,
    items,
    payments,
    supplierBalance: supplierBalance(ctx, row.supplierId),
    canVoid: check.ok,
    voidBlockReason: check.reason,
  };
}
