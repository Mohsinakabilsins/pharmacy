import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AdjustmentListSchema,
  BatchListSchema,
  BatchUpdateSchema,
  ExpiryQuerySchema,
  MovementListSchema,
  OpeningStockSchema,
  ReorderQuerySchema,
  StockAdjustSchema,
} from '@shared/schemas/inventory';
import type {
  AdjustmentRow,
  BatchRow,
  ExpiryReport,
  ExpiryRow,
  ExpirySummaryBucket,
  IntegrityReport,
  MovementRow,
  MovementType,
  ReorderRow,
} from '@shared/types/inventory';
import type { Paged } from '@shared/types/common';
import { planFefo, type FefoBatch } from '@shared/calc/fefo';
import { daysToExpiry, expiryBucket, isExpired, stockStatus, suggestedOrderPacks, type ExpiryBucket } from '@shared/calc/stock';
import { weightedAverageCost } from '@shared/calc/purchase';
import { addDays, localDayRangeToUtc } from '@shared/dates';
import { lineAmount } from '@shared/money';
import { audit } from '../../core/audit';
import { all, can, get, requirePermission, requireUser, run, today, transaction, type ServiceContext } from '../../core/context';
import { AppError, conflict, forbidden, invalid, notFound } from '../../core/errors';
import { nextNumber } from '../../core/sequences';
import { getSettings } from '../../core/settings';
import { likeEscape, tokens, Where } from '../../core/sql';

/* ───────────────────────────── Movement primitive ───────────────────────────── */

export interface MovementInput {
  batchId: number;
  type: MovementType;
  /** Signed base units: + in, − out. */
  quantity: number;
  referenceType?: string | null;
  referenceId?: number | null;
  note?: string | null;
  /** Allow the batch balance to go below zero (settings / explicit). */
  allowNegative?: boolean;
}

export interface MovementResult {
  movementId: number;
  balanceAfter: number;
  unitCost: number;
  productId: number;
}

/**
 * The ONLY way stock quantities change. Updates the batch balance and appends the movement
 * in the caller's transaction. Rejects negative balances unless explicitly allowed.
 */
export function applyMovement(ctx: ServiceContext, m: MovementInput): MovementResult {
  if (!ctx.sqlite.inTransaction) throw new Error('applyMovement must run inside a transaction');
  if (!Number.isInteger(m.quantity) || m.quantity === 0) throw invalid('Movement quantity must be a non-zero whole number');
  const b = get<{ id: number; product_id: number; quantity_on_hand: number; cost_price: number; batch_number: string }>(
    ctx,
    'SELECT id, product_id, quantity_on_hand, cost_price, batch_number FROM batches WHERE id = ?',
    m.batchId,
  );
  if (!b) throw notFound('Batch');
  const balance = b.quantity_on_hand + m.quantity;
  const allowNegative = m.allowNegative ?? getSettings(ctx).inventory.allowNegativeStock;
  if (balance < 0 && !allowNegative) {
    throw new AppError('INSUFFICIENT_STOCK', `Not enough stock in batch ${b.batch_number} (available ${b.quantity_on_hand}, requested ${-m.quantity})`, undefined, {
      batchId: b.id,
      available: b.quantity_on_hand,
    });
  }
  const now = ctx.now().toISOString();
  run(ctx, 'UPDATE batches SET quantity_on_hand = ?, updated_at = ? WHERE id = ?', balance, now, b.id);
  const res = run(
    ctx,
    `INSERT INTO stock_movements (uuid, batch_id, product_id, movement_type, quantity, balance_after, unit_cost, reference_type, reference_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    b.id,
    b.product_id,
    m.type,
    m.quantity,
    balance,
    b.cost_price,
    m.referenceType ?? null,
    m.referenceId ?? null,
    m.note ?? null,
    ctx.user?.id ?? null,
    now,
  );
  return { movementId: Number(res.lastInsertRowid), balanceAfter: balance, unitCost: b.cost_price, productId: b.product_id };
}

/* ─────────────────────────────── Batch helpers ─────────────────────────────── */

export interface ReceiveBatchInput {
  productId: number;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string;
  units: number;
  costPrice: number;
  salePrice: number;
  supplierId?: number | null;
  purchaseId?: number | null;
  location?: string | null;
  allowExpired?: boolean;
}

/**
 * Create a batch or add to an existing batch with the same number (expiry must match;
 * cost becomes weighted average). Does NOT write the movement — the caller does, so the
 * movement type/reference is explicit. Returns the batch id and whether it was created.
 */
export function receiveIntoBatch(ctx: ServiceContext, input: ReceiveBatchInput): { batchId: number; created: boolean; previousCost: number | null } {
  const t = today(ctx);
  if (input.manufactureDate && input.expiryDate <= input.manufactureDate) throw invalid('Expiry date must be after the manufacturing date', { expiryDate: 'Must be after manufacturing date' });
  if (input.manufactureDate && input.manufactureDate > t) throw invalid('Manufacturing date cannot be in the future', { manufactureDate: 'Cannot be in the future' });
  if (!input.allowExpired && isExpired(input.expiryDate, t)) throw invalid(`Batch ${input.batchNumber} is already expired (${input.expiryDate})`, { expiryDate: 'Already expired' });
  const product = get<{ id: number; brand_name: string }>(ctx, 'SELECT id, brand_name FROM products WHERE id = ?', input.productId);
  if (!product) throw notFound('Product');
  const existing = get<{ id: number; expiry_date: string; quantity_on_hand: number; cost_price: number; sale_price: number; quantity_received: number }>(
    ctx,
    'SELECT id, expiry_date, quantity_on_hand, cost_price, sale_price, quantity_received FROM batches WHERE product_id = ? AND batch_number = ?',
    input.productId,
    input.batchNumber,
  );
  const now = ctx.now().toISOString();
  if (existing) {
    if (existing.expiry_date !== input.expiryDate) {
      throw conflict(`Batch ${input.batchNumber} of ${product.brand_name} already exists with expiry ${existing.expiry_date}. The same batch cannot have a different expiry date.`);
    }
    const newCost = weightedAverageCost(existing.quantity_on_hand, existing.cost_price, input.units, input.costPrice);
    run(
      ctx,
      'UPDATE batches SET cost_price = ?, sale_price = ?, quantity_received = quantity_received + ?, location = COALESCE(?, location), updated_at = ? WHERE id = ?',
      newCost,
      input.salePrice,
      input.units,
      input.location ?? null,
      now,
      existing.id,
    );
    if (existing.sale_price !== input.salePrice) {
      audit(ctx, {
        action: 'PRICE_CHANGE',
        entityType: 'batch',
        entityId: existing.id,
        description: `Sale price of ${product.brand_name} batch ${input.batchNumber} changed on receipt`,
        details: { salePrice: { from: existing.sale_price, to: input.salePrice } },
      });
    }
    return { batchId: existing.id, created: false, previousCost: existing.cost_price };
  }
  const res = run(
    ctx,
    `INSERT INTO batches (uuid, product_id, batch_number, manufacture_date, expiry_date, cost_price, sale_price, quantity_received, quantity_on_hand,
       supplier_id, purchase_id, location, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ACTIVE', ?, ?)`,
    randomUUID(),
    input.productId,
    input.batchNumber,
    input.manufactureDate,
    input.expiryDate,
    input.costPrice,
    input.salePrice,
    input.units,
    input.supplierId ?? null,
    input.purchaseId ?? null,
    input.location ?? null,
    now,
    now,
  );
  return { batchId: Number(res.lastInsertRowid), created: true, previousCost: null };
}

const BATCH_SELECT = `b.id, b.product_id AS productId, p.code AS productCode,
  p.brand_name || CASE WHEN p.strength IS NOT NULL AND p.strength <> '' THEN ' ' || p.strength ELSE '' END AS productName,
  p.generic_name AS genericName, b.batch_number AS batchNumber, b.manufacture_date AS manufactureDate, b.expiry_date AS expiryDate,
  b.cost_price AS costPrice, b.sale_price AS salePrice, b.quantity_received AS quantityReceived, b.quantity_on_hand AS quantityOnHand,
  p.pack_size AS packSize, p.unit_name AS unitName, p.pack_name AS packName, s.name AS supplierName, pu.purchase_no AS purchaseNo,
  COALESCE(b.location, p.storage_location) AS location, b.status, b.created_at AS createdAt`;

const BATCH_FROM = `batches b JOIN products p ON p.id = b.product_id LEFT JOIN suppliers s ON s.id = b.supplier_id
  LEFT JOIN purchases pu ON pu.id = b.purchase_id`;

function decorateBatches(ctx: ServiceContext, rows: BatchRow[]): BatchRow[] {
  const t = today(ctx);
  const showCost = can(ctx, 'inventory.cost_view');
  for (const r of rows) {
    r.isExpired = isExpired(r.expiryDate, t);
    r.daysToExpiry = daysToExpiry(r.expiryDate, t);
    r.expiryBucket = expiryBucket(r.expiryDate, t);
    r.valueRetail = r.isExpired ? 0 : lineAmount(Math.max(0, r.quantityOnHand), r.salePrice, r.packSize);
    r.valueCost = showCost ? lineAmount(Math.max(0, r.quantityOnHand), r.costPrice ?? 0, r.packSize) : null;
    if (!showCost) r.costPrice = null;
  }
  return rows;
}

export function listBatches(ctx: ServiceContext, q: z.output<typeof BatchListSchema>): Paged<BatchRow> {
  const t = today(ctx);
  const warn = addDays(t, getSettings(ctx).inventory.expiryWarningDays);
  const w = new Where();
  w.addIf(q.productId, 'b.product_id = ?', q.productId);
  w.addIf(q.supplierId, 'b.supplier_id = ?', q.supplierId);
  for (const tok of tokens(q.search)) {
    const like = `%${likeEscape(tok)}%`;
    w.add(`(p.search_text LIKE ? ESCAPE '\\' OR lower(b.batch_number) LIKE ? ESCAPE '\\')`, like, like);
  }
  switch (q.status) {
    case 'in_stock':
      w.add('b.quantity_on_hand <> 0');
      break;
    case 'sellable':
      w.add(`b.quantity_on_hand > 0 AND b.status = 'ACTIVE' AND b.expiry_date > ?`, t);
      break;
    case 'expired':
      w.add('b.quantity_on_hand > 0 AND b.expiry_date <= ?', t);
      break;
    case 'expiring':
      w.add('b.quantity_on_hand > 0 AND b.expiry_date > ? AND b.expiry_date <= ?', t, warn);
      break;
    case 'blocked':
      w.add(`b.status <> 'ACTIVE'`);
      break;
    case 'depleted':
      w.add('b.quantity_on_hand = 0');
      break;
  }
  const orderBy = {
    expiry: 'b.expiry_date, p.brand_name COLLATE NOCASE',
    product: 'p.brand_name COLLATE NOCASE, b.expiry_date',
    quantity: 'b.quantity_on_hand DESC',
    received: 'b.created_at DESC',
  }[q.sort];
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM ${BATCH_FROM}${where}`, ...w.params)!.n;
  const rows = all<BatchRow>(ctx, `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...w.params, q.pageSize, (q.page - 1) * q.pageSize);
  return { rows: decorateBatches(ctx, rows), total, page: q.page, pageSize: q.pageSize };
}

/** All batches of a product ordered FEFO (for POS batch picker and product sheet). */
export function productBatches(ctx: ServiceContext, productId: number, includeEmpty = false): BatchRow[] {
  const rows = all<BatchRow>(
    ctx,
    `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM} WHERE b.product_id = ? ${includeEmpty ? '' : 'AND b.quantity_on_hand <> 0'} ORDER BY b.expiry_date, b.id`,
    productId,
  );
  return decorateBatches(ctx, rows);
}

export function getBatch(ctx: ServiceContext, id: number): BatchRow {
  const row = get<BatchRow>(ctx, `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM} WHERE b.id = ?`, id);
  if (!row) throw notFound('Batch');
  return decorateBatches(ctx, [row])[0];
}

export function updateBatch(ctx: ServiceContext, input: z.output<typeof BatchUpdateSchema>): BatchRow {
  requirePermission(ctx, 'batches.manage');
  const before = get<Record<string, unknown>>(ctx, 'SELECT b.*, p.brand_name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?', input.id);
  if (!before) throw notFound('Batch');
  const priceChange =
    (input.salePrice !== undefined && input.salePrice !== before.sale_price) || (input.costPrice !== undefined && input.costPrice !== before.cost_price);
  if (priceChange && !can(ctx, 'products.price_change')) throw forbidden('You do not have permission to change prices');
  const expiry = input.expiryDate ?? (before.expiry_date as string);
  const mfg = input.manufactureDate !== undefined ? input.manufactureDate : (before.manufacture_date as string | null);
  if (mfg && expiry <= mfg) throw invalid('Expiry date must be after the manufacturing date', { expiryDate: 'Must be after manufacturing date' });
  transaction(ctx, () => {
    const next = {
      sale_price: input.salePrice ?? before.sale_price,
      cost_price: input.costPrice ?? before.cost_price,
      location: input.location !== undefined ? input.location : before.location,
      status: input.status ?? before.status,
      expiry_date: expiry,
      manufacture_date: mfg,
    };
    run(
      ctx,
      'UPDATE batches SET sale_price = ?, cost_price = ?, location = ?, status = ?, expiry_date = ?, manufacture_date = ?, updated_at = ? WHERE id = ?',
      next.sale_price,
      next.cost_price,
      next.location,
      next.status,
      next.expiry_date,
      next.manufacture_date,
      ctx.now().toISOString(),
      input.id,
    );
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(next)) if (before[k] !== v) changes[k] = { from: before[k], to: v };
    if (Object.keys(changes).length) {
      const label = `${before.brand_name} batch ${before.batch_number}`;
      audit(ctx, {
        action: priceChange ? 'PRICE_CHANGE' : changes.status ? 'BATCH_STATUS_CHANGE' : 'BATCH_UPDATE',
        entityType: 'batch',
        entityId: input.id,
        description: `Updated ${label}: ${Object.keys(changes).join(', ')} — ${input.reason}`,
        details: { ...changes, reason: input.reason },
        severity: changes.expiry_date || priceChange || changes.status ? 'WARNING' : 'INFO',
      });
    }
  });
  return getBatch(ctx, input.id);
}

/* ─────────────────────────── Opening stock & adjustments ─────────────────────────── */

export function addOpeningStock(ctx: ServiceContext, input: z.output<typeof OpeningStockSchema>): BatchRow {
  requirePermission(ctx, 'stock.opening');
  const batchId = transaction(ctx, () => {
    const product = get<{ brand_name: string; pack_size: number }>(ctx, 'SELECT brand_name, pack_size FROM products WHERE id = ?', input.productId);
    if (!product) throw notFound('Product');
    const received = receiveIntoBatch(ctx, {
      productId: input.productId,
      batchNumber: input.batchNumber,
      manufactureDate: input.manufactureDate,
      expiryDate: input.expiryDate,
      units: input.quantity,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
      location: input.location,
    });
    const adjNo = nextNumber(ctx, 'adjustment');
    const costValue = lineAmount(input.quantity, input.costPrice, product.pack_size);
    const adj = run(
      ctx,
      `INSERT INTO stock_adjustments (uuid, adjustment_no, batch_id, product_id, direction, reason, quantity, cost_value, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, 'IN', 'OPENING_STOCK', ?, ?, ?, ?, ?)`,
      randomUUID(),
      adjNo,
      received.batchId,
      input.productId,
      input.quantity,
      costValue,
      input.notes,
      ctx.user?.id ?? null,
      ctx.now().toISOString(),
    );
    applyMovement(ctx, {
      batchId: received.batchId,
      type: 'OPENING',
      quantity: input.quantity,
      referenceType: 'adjustment',
      referenceId: Number(adj.lastInsertRowid),
      note: input.notes ?? 'Opening stock',
    });
    audit(ctx, {
      action: 'STOCK_OPENING',
      entityType: 'batch',
      entityId: received.batchId,
      description: `Opening stock ${input.quantity} units of ${product.brand_name} batch ${input.batchNumber} (${adjNo})`,
      details: { quantity: input.quantity, costPrice: input.costPrice, salePrice: input.salePrice, expiryDate: input.expiryDate },
    });
    return received.batchId;
  });
  return getBatch(ctx, batchId);
}

const WRITE_OFF_REASONS = new Set(['DAMAGED', 'EXPIRED', 'LOST']);

export function adjustStock(ctx: ServiceContext, input: z.output<typeof StockAdjustSchema>): AdjustmentRow {
  const user = requirePermission(ctx, 'stock.adjust');
  const id = transaction(ctx, () => {
    const b = get<{ id: number; product_id: number; batch_number: string; cost_price: number; quantity_on_hand: number; brand_name: string; pack_size: number }>(
      ctx,
      'SELECT b.id, b.product_id, b.batch_number, b.cost_price, b.quantity_on_hand, p.brand_name, p.pack_size FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?',
      input.batchId,
    );
    if (!b) throw notFound('Batch');
    if (input.direction === 'OUT' && input.quantity > b.quantity_on_hand) {
      throw new AppError('INSUFFICIENT_STOCK', `Cannot remove ${input.quantity} units — batch ${b.batch_number} holds ${b.quantity_on_hand}`);
    }
    const adjNo = nextNumber(ctx, 'adjustment');
    const costValue = lineAmount(input.quantity, b.cost_price, b.pack_size);
    const now = ctx.now().toISOString();
    const notes = [input.notes, input.reason === 'RETURN_TO_SUPPLIER' && input.supplierCredit > 0 ? `Supplier credit ${input.supplierCredit}` : null]
      .filter(Boolean)
      .join(' · ') || null;
    const res = run(
      ctx,
      `INSERT INTO stock_adjustments (uuid, adjustment_no, batch_id, product_id, direction, reason, quantity, cost_value, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      adjNo,
      b.id,
      b.product_id,
      input.direction,
      input.reason,
      input.quantity,
      costValue,
      notes,
      user.id,
      now,
    );
    const adjId = Number(res.lastInsertRowid);
    const type: MovementType = input.direction === 'IN' ? 'ADJUSTMENT_IN' : WRITE_OFF_REASONS.has(input.reason) ? 'WRITE_OFF' : 'ADJUSTMENT_OUT';
    applyMovement(ctx, {
      batchId: b.id,
      type,
      quantity: input.direction === 'IN' ? input.quantity : -input.quantity,
      referenceType: 'adjustment',
      referenceId: adjId,
      note: `${input.reason.replace(/_/g, ' ').toLowerCase()}${input.notes ? ` — ${input.notes}` : ''}`,
      allowNegative: false,
    });
    if (input.reason === 'RETURN_TO_SUPPLIER' && input.supplierCredit > 0 && input.supplierId) {
      const s = get<{ name: string }>(ctx, 'SELECT name FROM suppliers WHERE id = ?', input.supplierId);
      if (!s) throw notFound('Supplier');
      run(
        ctx,
        `INSERT INTO supplier_transactions (uuid, supplier_id, txn_date, type, amount, reference_type, reference_id, description, created_by, created_at)
         VALUES (?, ?, ?, 'ADJUSTMENT', ?, 'adjustment', ?, ?, ?, ?)`,
        randomUUID(),
        input.supplierId,
        today(ctx),
        -input.supplierCredit,
        adjId,
        `Credit for stock returned (${adjNo}: ${b.brand_name} ${b.batch_number} × ${input.quantity})`,
        user.id,
        now,
      );
    }
    audit(ctx, {
      action: 'STOCK_ADJUST',
      entityType: 'batch',
      entityId: b.id,
      description: `${input.direction === 'IN' ? 'Added' : 'Removed'} ${input.quantity} units of ${b.brand_name} batch ${b.batch_number} — ${input.reason.replace(/_/g, ' ').toLowerCase()} (${adjNo})`,
      details: { ...input, costValue },
      severity: input.direction === 'OUT' ? 'WARNING' : 'INFO',
    });
    return adjId;
  });
  return listAdjustments(ctx, { page: 1, pageSize: 1, id } as never).rows[0];
}

export function listAdjustments(ctx: ServiceContext, q: z.output<typeof AdjustmentListSchema> & { id?: number }): Paged<AdjustmentRow> {
  const w = new Where();
  w.addIf(q.id, 'a.id = ?', q.id);
  w.addIf(q.reason, 'a.reason = ?', q.reason);
  if (q.from || q.to) {
    const range = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('a.created_at >= ? AND a.created_at < ?', range.start, range.end);
  }
  w.search(q.search, ['p.brand_name', 'b.batch_number', 'a.adjustment_no']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const from = `stock_adjustments a JOIN products p ON p.id = a.product_id JOIN batches b ON b.id = a.batch_id LEFT JOIN users u ON u.id = a.created_by`;
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM ${from}${where}`, ...w.params)!.n;
  const rows = all<AdjustmentRow>(
    ctx,
    `SELECT a.id, a.adjustment_no AS adjustmentNo, a.created_at AS createdAt, a.product_id AS productId,
            p.brand_name || CASE WHEN p.strength IS NOT NULL THEN ' ' || p.strength ELSE '' END AS productName,
            b.batch_number AS batchNumber, a.direction, a.reason, a.quantity, p.pack_size AS packSize, a.cost_value AS costValue, a.notes,
            u.full_name AS userName
     FROM ${from}${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    ...w.params,
    q.pageSize,
    (q.page - 1) * q.pageSize,
  );
  if (!can(ctx, 'inventory.cost_view')) for (const r of rows) r.costValue = null;
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

/* ─────────────────────────────── Movement ledger ─────────────────────────────── */

export function listMovements(ctx: ServiceContext, q: z.output<typeof MovementListSchema>): Paged<MovementRow> {
  const w = new Where();
  w.addIf(q.productId, 'm.product_id = ?', q.productId);
  w.addIf(q.batchId, 'm.batch_id = ?', q.batchId);
  w.addIf(q.type, 'm.movement_type = ?', q.type);
  if (q.from || q.to) {
    const range = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('m.created_at >= ? AND m.created_at < ?', range.start, range.end);
  }
  w.search(q.search, ['p.brand_name', 'b.batch_number']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const from = `stock_movements m JOIN products p ON p.id = m.product_id JOIN batches b ON b.id = m.batch_id LEFT JOIN users u ON u.id = m.user_id`;
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM ${from}${where}`, ...w.params)!.n;
  const rows = all<MovementRow>(
    ctx,
    `SELECT m.id, m.created_at AS createdAt, m.movement_type AS movementType, m.product_id AS productId,
            p.brand_name || CASE WHEN p.strength IS NOT NULL THEN ' ' || p.strength ELSE '' END AS productName,
            m.batch_id AS batchId, b.batch_number AS batchNumber, m.quantity, m.balance_after AS balanceAfter, m.unit_cost AS unitCost,
            p.pack_size AS packSize, m.reference_type AS referenceType, m.reference_id AS referenceId, m.note, u.full_name AS userName,
            CASE m.reference_type
              WHEN 'sale' THEN (SELECT invoice_no FROM sales WHERE id = m.reference_id)
              WHEN 'purchase' THEN (SELECT purchase_no FROM purchases WHERE id = m.reference_id)
              WHEN 'sale_return' THEN (SELECT return_no FROM sale_returns WHERE id = m.reference_id)
              WHEN 'adjustment' THEN (SELECT adjustment_no FROM stock_adjustments WHERE id = m.reference_id)
            END AS referenceNo
     FROM ${from}${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    ...w.params,
    q.pageSize,
    (q.page - 1) * q.pageSize,
  );
  if (!can(ctx, 'inventory.cost_view')) for (const r of rows) r.unitCost = null;
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

/* ─────────────────────────────────── FEFO ─────────────────────────────────── */

export interface AllocatedBatch {
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  salePrice: number;
  costPrice: number;
  expired: boolean;
  available: number;
}

/** Load candidate batches and plan a FEFO (or manual) allocation for a product. */
export function allocate(
  ctx: ServiceContext,
  productId: number,
  quantity: number,
  opts: { batchId?: number | null; allowNegative?: boolean } = {},
): { allocations: AllocatedBatch[]; shortfall: number; blocked?: string } {
  const batches = all<FefoBatch & { batchNumber: string; salePrice: number; costPrice: number }>(
    ctx,
    `SELECT id, expiry_date AS expiryDate, quantity_on_hand AS quantityOnHand, status, batch_number AS batchNumber,
            sale_price AS salePrice, cost_price AS costPrice
     FROM batches WHERE product_id = ?`,
    productId,
  );
  const plan = planFefo(batches, quantity, today(ctx), {
    batchId: opts.batchId,
    allowNegative: opts.allowNegative ?? getSettings(ctx).inventory.allowNegativeStock,
  });
  const byId = new Map(batches.map((b) => [b.id, b]));
  return {
    allocations: plan.allocations.map((a) => {
      const b = byId.get(a.batchId)!;
      return {
        batchId: a.batchId,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        quantity: a.quantity,
        salePrice: b.salePrice,
        costPrice: b.costPrice,
        expired: a.expired,
        available: b.quantityOnHand,
      };
    }),
    shortfall: plan.shortfall,
    blocked: plan.blocked,
  };
}

/* ─────────────────────────────────── Expiry ─────────────────────────────────── */

export function expiryReport(ctx: ServiceContext, q: z.output<typeof ExpiryQuerySchema>): ExpiryReport {
  const t = today(ctx);
  const w = new Where();
  if (!q.includeZero) w.add('b.quantity_on_hand > 0');
  w.addIf(q.supplierId, 'b.supplier_id = ?', q.supplierId);
  w.addIf(q.categoryId, 'p.category_id = ?', q.categoryId);
  for (const tok of tokens(q.search)) {
    const like = `%${likeEscape(tok)}%`;
    w.add(`(p.search_text LIKE ? ESCAPE '\\' OR lower(b.batch_number) LIKE ? ESCAPE '\\')`, like, like);
  }
  const rows = all<ExpiryRow>(
    ctx,
    `SELECT b.id AS batchId, p.id AS productId, p.code AS productCode,
            p.brand_name || CASE WHEN p.strength IS NOT NULL AND p.strength <> '' THEN ' ' || p.strength ELSE '' END AS productName,
            p.generic_name AS genericName, c.name AS categoryName, b.batch_number AS batchNumber, b.expiry_date AS expiryDate,
            b.quantity_on_hand AS quantity, p.pack_size AS packSize, p.unit_name AS unitName,
            CAST(ROUND(b.quantity_on_hand * b.cost_price * 1.0 / p.pack_size) AS INTEGER) AS costValue,
            CAST(ROUND(b.quantity_on_hand * b.sale_price * 1.0 / p.pack_size) AS INTEGER) AS retailValue,
            s.name AS supplierName, COALESCE(b.location, p.storage_location) AS location, b.status
     FROM batches b JOIN products p ON p.id = b.product_id LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     ${w.sql ? `WHERE ${w.sql}` : ''} ORDER BY b.expiry_date, p.brand_name COLLATE NOCASE`,
    ...w.params,
  );
  const showCost = can(ctx, 'inventory.cost_view');
  const buckets: ExpiryBucket[] = ['EXPIRED', 'D30', 'D60', 'D90', 'LATER'];
  const summary: ExpirySummaryBucket[] = buckets.map((bucket) => ({ bucket, batches: 0, quantity: 0, costValue: showCost ? 0 : null, retailValue: 0 }));
  for (const r of rows) {
    r.daysToExpiry = daysToExpiry(r.expiryDate, t);
    r.bucket = expiryBucket(r.expiryDate, t);
    const s = summary[buckets.indexOf(r.bucket)];
    s.batches += 1;
    s.quantity += r.quantity;
    if (s.costValue !== null) s.costValue += r.costValue ?? 0;
    s.retailValue += r.retailValue;
    if (!showCost) r.costValue = null;
  }
  return { rows: q.bucket === 'ALL' ? rows : rows.filter((r) => r.bucket === q.bucket), summary, today: t };
}

/* ─────────────────────────────────── Reorder ─────────────────────────────────── */

export function reorderReport(ctx: ServiceContext, q: z.output<typeof ReorderQuerySchema>): ReorderRow[] {
  const t = today(ctx);
  const since30 = new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString();
  const since90 = new Date(ctx.now().getTime() - 90 * 86_400_000).toISOString();
  const w = new Where();
  w.add('p.is_active = 1');
  w.addIf(q.categoryId, 'p.category_id = ?', q.categoryId);
  for (const tok of tokens(q.search)) w.add(`p.search_text LIKE ? ESCAPE '\\'`, `%${likeEscape(tok)}%`);
  const rows = all<ReorderRow & { sold90: number }>(
    ctx,
    `WITH stock AS (
       SELECT product_id, SUM(CASE WHEN status = 'ACTIVE' AND expiry_date > ? THEN quantity_on_hand ELSE 0 END) AS onhand
       FROM batches GROUP BY product_id
     ), sold AS (
       SELECT si.product_id,
         SUM(CASE WHEN s.created_at >= ? THEN si.quantity - si.returned_quantity ELSE 0 END) AS sold30,
         SUM(si.quantity - si.returned_quantity) AS sold90
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'COMPLETED' AND s.created_at >= ? GROUP BY si.product_id
     ), lastp AS (
       SELECT pi.product_id, pu.supplier_id, pi.cost_price,
              ROW_NUMBER() OVER (PARTITION BY pi.product_id ORDER BY pu.invoice_date DESC, pu.id DESC) AS rn
       FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pu.status = 'POSTED'
     )
     SELECT p.id AS productId, p.code AS productCode,
            p.brand_name || CASE WHEN p.strength IS NOT NULL AND p.strength <> '' THEN ' ' || p.strength ELSE '' END AS productName,
            p.generic_name AS genericName, m.name AS manufacturerName, c.name AS categoryName, p.pack_size AS packSize,
            p.pack_name AS packName, p.unit_name AS unitName, COALESCE(st.onhand, 0) AS onHand, p.min_stock AS minStock,
            p.reorder_level AS reorderLevel, p.max_stock AS maxStock, COALESCE(sd.sold30, 0) AS soldLast30Days,
            COALESCE(sd.sold90, 0) AS sold90, lp.supplier_id AS lastSupplierId, su.name AS lastSupplierName,
            COALESCE(lp.cost_price, p.default_cost_price) AS lastCostPrice
     FROM products p
     LEFT JOIN stock st ON st.product_id = p.id
     LEFT JOIN sold sd ON sd.product_id = p.id
     LEFT JOIN lastp lp ON lp.product_id = p.id AND lp.rn = 1
     LEFT JOIN suppliers su ON su.id = lp.supplier_id
     LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${w.sql} AND COALESCE(st.onhand, 0) <= p.reorder_level
     ORDER BY COALESCE(st.onhand, 0) = 0 DESC, (COALESCE(st.onhand, 0) * 1.0 / MAX(p.reorder_level, 1)), p.brand_name COLLATE NOCASE`,
    t,
    since30,
    since90,
    ...w.params,
  );
  const showCost = can(ctx, 'inventory.cost_view');
  const out: ReorderRow[] = [];
  for (const r of rows) {
    r.status = stockStatus(r.onHand, r.minStock, r.reorderLevel, r.maxStock);
    if (q.filter === 'out' && r.status !== 'OUT_OF_STOCK') continue;
    if (q.filter === 'low' && r.status !== 'LOW_STOCK') continue;
    if (q.filter === 'reorder' && r.status !== 'REORDER') continue;
    if (q.supplierId && r.lastSupplierId !== q.supplierId) continue;
    r.avgMonthlySales = Math.round(r.sold90 / 3);
    r.suggestedPacks = suggestedOrderPacks(r.onHand, r.reorderLevel, r.maxStock, r.packSize);
    r.estimatedCost = showCost && r.lastCostPrice !== null ? r.suggestedPacks * r.lastCostPrice : null;
    if (!showCost) r.lastCostPrice = null;
    delete (r as Partial<typeof r>).sold90;
    out.push(r);
  }
  return out;
}

/* ─────────────────────────────── Integrity check ─────────────────────────────── */

export function integrityCheck(ctx: ServiceContext): IntegrityReport {
  requireUser(ctx);
  const rows = all<{ batchId: number; productName: string; batchNumber: string; onHand: number; ledger: number }>(
    ctx,
    `SELECT b.id AS batchId, p.brand_name AS productName, b.batch_number AS batchNumber, b.quantity_on_hand AS onHand,
            COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.batch_id = b.id), 0) AS ledger
     FROM batches b JOIN products p ON p.id = b.product_id`,
  );
  const mismatches = rows.filter((r) => r.onHand !== r.ledger);
  const report: IntegrityReport = {
    checkedBatches: rows.length,
    mismatches,
    negativeBatches: rows.filter((r) => r.onHand < 0).length,
    checkedAt: ctx.now().toISOString(),
  };
  audit(ctx, {
    action: 'INTEGRITY_CHECK',
    entityType: 'system',
    description: `Inventory integrity check: ${rows.length} batches, ${mismatches.length} mismatches`,
    severity: mismatches.length ? 'CRITICAL' : 'INFO',
  });
  return report;
}


