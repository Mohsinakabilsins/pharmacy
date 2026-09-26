import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CategorySaveSchema,
  ManufacturerSaveSchema,
  ProductListSchema,
  ProductSaveSchema,
  ProductSearchSchema,
} from '@shared/schemas/catalog';
import type { CategoryRow, ManufacturerRow, ProductDetail, ProductListRow, ProductSearchHit } from '@shared/types/catalog';
import type { Paged } from '@shared/types/common';
import { stockStatus } from '@shared/calc/stock';
import { addDays } from '@shared/dates';
import { audit } from '../../core/audit';
import { all, can, get, requirePermission, run, today, transaction, type ServiceContext } from '../../core/context';
import { conflict, forbidden, notFound } from '../../core/errors';
import { nextNumber, peekNumber } from '../../core/sequences';
import { bools, likeEscape, tokens, Where } from '../../core/sql';

/* ───────────────────────── Categories & manufacturers ───────────────────────── */

export function listCategories(ctx: ServiceContext, includeInactive = true): CategoryRow[] {
  return bools(
    all<CategoryRow>(
      ctx,
      `SELECT c.id, c.name, c.description, c.is_active AS isActive,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS productCount
       FROM categories c ${includeInactive ? '' : 'WHERE c.is_active = 1'} ORDER BY c.name COLLATE NOCASE`,
    ),
    'isActive',
  );
}

export function saveCategory(ctx: ServiceContext, input: z.output<typeof CategorySaveSchema>): CategoryRow {
  const id = transaction(ctx, () => {
    const dup = get<{ id: number }>(ctx, 'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?', input.name, input.id ?? 0);
    if (dup) throw conflict('A category with this name already exists');
    const now = ctx.now().toISOString();
    if (input.id) {
      const before = get<{ name: string }>(ctx, 'SELECT name FROM categories WHERE id = ?', input.id);
      if (!before) throw notFound('Category');
      run(ctx, 'UPDATE categories SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?', input.name, input.description, input.isActive ? 1 : 0, now, input.id);
      if (before.name !== input.name) refreshSearchText(ctx, 'p.category_id = ?', input.id);
      audit(ctx, { action: 'CATEGORY_UPDATE', entityType: 'category', entityId: input.id, description: `Updated category "${input.name}"` });
      return input.id;
    }
    const res = run(ctx, 'INSERT INTO categories (uuid, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), input.name, input.description, input.isActive ? 1 : 0, now, now);
    audit(ctx, { action: 'CATEGORY_CREATE', entityType: 'category', entityId: Number(res.lastInsertRowid), description: `Created category "${input.name}"` });
    return Number(res.lastInsertRowid);
  });
  return listCategories(ctx).find((c) => c.id === id)!;
}

export function listManufacturers(ctx: ServiceContext, includeInactive = true): ManufacturerRow[] {
  return bools(
    all<ManufacturerRow>(
      ctx,
      `SELECT m.id, m.name, m.country, m.phone, m.is_active AS isActive,
              (SELECT COUNT(*) FROM products p WHERE p.manufacturer_id = m.id AND p.is_active = 1) AS productCount
       FROM manufacturers m ${includeInactive ? '' : 'WHERE m.is_active = 1'} ORDER BY m.name COLLATE NOCASE`,
    ),
    'isActive',
  );
}

export function saveManufacturer(ctx: ServiceContext, input: z.output<typeof ManufacturerSaveSchema>): ManufacturerRow {
  const id = transaction(ctx, () => {
    const dup = get<{ id: number }>(ctx, 'SELECT id FROM manufacturers WHERE name = ? COLLATE NOCASE AND id <> ?', input.name, input.id ?? 0);
    if (dup) throw conflict('A manufacturer with this name already exists');
    const now = ctx.now().toISOString();
    if (input.id) {
      const before = get<{ name: string }>(ctx, 'SELECT name FROM manufacturers WHERE id = ?', input.id);
      if (!before) throw notFound('Manufacturer');
      run(ctx, 'UPDATE manufacturers SET name = ?, country = ?, phone = ?, is_active = ?, updated_at = ? WHERE id = ?', input.name, input.country, input.phone, input.isActive ? 1 : 0, now, input.id);
      if (before.name !== input.name) refreshSearchText(ctx, 'p.manufacturer_id = ?', input.id);
      audit(ctx, { action: 'MANUFACTURER_UPDATE', entityType: 'manufacturer', entityId: input.id, description: `Updated manufacturer "${input.name}"` });
      return input.id;
    }
    const res = run(ctx, 'INSERT INTO manufacturers (uuid, name, country, phone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), input.name, input.country, input.phone, input.isActive ? 1 : 0, now, now);
    audit(ctx, { action: 'MANUFACTURER_CREATE', entityType: 'manufacturer', entityId: Number(res.lastInsertRowid), description: `Created manufacturer "${input.name}"` });
    return Number(res.lastInsertRowid);
  });
  return listManufacturers(ctx).find((m) => m.id === id)!;
}

/* ─────────────────────────────── Search text ─────────────────────────────── */

export function buildSearchText(p: {
  code: string;
  barcode?: string | null;
  brandName: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  manufacturerName?: string | null;
  categoryName?: string | null;
}): string {
  const strengthCompact = (p.strength ?? '').replace(/\s+/g, '');
  return [p.code, p.barcode, p.brandName, p.genericName, p.strength, strengthCompact, p.dosageForm, p.manufacturerName, p.categoryName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function refreshSearchText(ctx: ServiceContext, where: string, ...params: unknown[]) {
  const rows = all<{ id: number; code: string; barcode: string | null; brandName: string; genericName: string | null; strength: string | null; dosageForm: string | null; manufacturerName: string | null; categoryName: string | null }>(
    ctx,
    `SELECT p.id, p.code, p.barcode, p.brand_name AS brandName, p.generic_name AS genericName, p.strength, p.dosage_form AS dosageForm,
            m.name AS manufacturerName, c.name AS categoryName
     FROM products p LEFT JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where}`,
    ...params,
  );
  const upd = ctx.sqlite.prepare('UPDATE products SET search_text = ? WHERE id = ?');
  for (const r of rows) upd.run(buildSearchText(r), r.id);
}

/* ───────────────────────────────── Products ───────────────────────────────── */

const STOCK_CTE = `stock AS (
  SELECT b.product_id,
    SUM(CASE WHEN b.status = 'ACTIVE' AND b.expiry_date > @today THEN b.quantity_on_hand ELSE 0 END) AS sellable,
    SUM(CASE WHEN b.expiry_date <= @today THEN b.quantity_on_hand ELSE 0 END) AS expired,
    SUM(CASE WHEN b.status <> 'ACTIVE' AND b.expiry_date > @today THEN b.quantity_on_hand ELSE 0 END) AS blocked,
    MIN(CASE WHEN b.quantity_on_hand > 0 AND b.status = 'ACTIVE' AND b.expiry_date > @today THEN b.expiry_date END) AS nearest_expiry,
    SUM(CASE WHEN b.quantity_on_hand > 0 THEN 1 ELSE 0 END) AS batch_count,
    SUM(b.quantity_on_hand * b.cost_price) AS cost_value_units,
    SUM(CASE WHEN b.expiry_date > @today THEN b.quantity_on_hand * b.sale_price ELSE 0 END) AS retail_value_units
  FROM batches b GROUP BY b.product_id
)`;

const LIST_SELECT = `p.id, p.code, p.barcode, p.brand_name AS brandName, p.generic_name AS genericName, p.strength, p.dosage_form AS dosageForm,
  m.name AS manufacturerName, c.name AS categoryName, p.pack_size AS packSize, p.unit_name AS unitName, p.pack_name AS packName,
  p.requires_prescription AS requiresPrescription, p.is_controlled AS isControlled, p.is_active AS isActive,
  p.default_sale_price AS defaultSalePrice, p.default_cost_price AS defaultCostPrice, p.min_stock AS minStock,
  p.reorder_level AS reorderLevel, p.max_stock AS maxStock, COALESCE(s.sellable, 0) AS stockOnHand,
  COALESCE(s.expired, 0) AS expiredQty, s.nearest_expiry AS nearestExpiry, COALESCE(s.batch_count, 0) AS batchCount,
  p.storage_location AS storageLocation,
  CAST(ROUND(COALESCE(s.cost_value_units, 0) * 1.0 / p.pack_size) AS INTEGER) AS stockValueCost,
  CAST(ROUND(COALESCE(s.retail_value_units, 0) * 1.0 / p.pack_size) AS INTEGER) AS stockValueRetail`;

const LIST_FROM = `products p LEFT JOIN stock s ON s.product_id = p.id
  LEFT JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN categories c ON c.id = p.category_id`;

export function listProducts(ctx: ServiceContext, q: z.output<typeof ProductListSchema>): Paged<ProductListRow> {
  const w = new Where();
  if (q.status !== 'all') w.add('p.is_active = ?', q.status === 'active' ? 1 : 0);
  w.addIf(q.categoryId, 'p.category_id = ?', q.categoryId);
  w.addIf(q.manufacturerId, 'p.manufacturer_id = ?', q.manufacturerId);
  for (const t of tokens(q.search)) w.add(`p.search_text LIKE ? ESCAPE '\\'`, `%${likeEscape(t)}%`);
  if (q.rx === 'rx') w.add('p.requires_prescription = 1');
  if (q.rx === 'controlled') w.add('p.is_controlled = 1');
  switch (q.stock) {
    case 'in_stock':
      w.add('COALESCE(s.sellable, 0) > 0');
      break;
    case 'out':
      w.add('COALESCE(s.sellable, 0) <= 0');
      break;
    case 'low':
      w.add('COALESCE(s.sellable, 0) > 0 AND COALESCE(s.sellable, 0) <= p.min_stock');
      break;
    case 'reorder':
      w.add('COALESCE(s.sellable, 0) <= p.reorder_level');
      break;
    case 'expired':
      w.add('COALESCE(s.expired, 0) > 0');
      break;
  }
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  const orderBy = {
    name: `p.brand_name COLLATE NOCASE ${dir}, p.strength`,
    code: `p.code ${dir}`,
    stock: `stockOnHand ${dir}, p.brand_name COLLATE NOCASE`,
    price: `p.default_sale_price ${dir}`,
    updated: `p.updated_at ${dir}`,
    expiry: `nearestExpiry IS NULL, nearestExpiry ${dir}`,
  }[q.sort];

  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const named = { today: today(ctx) };
  const total = (ctx.sqlite.prepare(`WITH ${STOCK_CTE} SELECT COUNT(*) AS n FROM ${LIST_FROM}${where}`).get(named, ...w.params) as { n: number }).n;
  const rows = ctx.sqlite
    .prepare(`WITH ${STOCK_CTE} SELECT ${LIST_SELECT} FROM ${LIST_FROM}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(named, ...w.params, q.pageSize, (q.page - 1) * q.pageSize) as ProductListRow[];
  const showCost = can(ctx, 'inventory.cost_view');
  for (const r of rows) {
    r.requiresPrescription = !!r.requiresPrescription;
    r.isControlled = !!r.isControlled;
    r.isActive = !!r.isActive;
    r.stockStatus = stockStatus(r.stockOnHand, r.minStock, r.reorderLevel, r.maxStock);
    if (!showCost) {
      r.defaultCostPrice = null;
      r.stockValueCost = null;
    }
  }
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export function getProduct(ctx: ServiceContext, id: number): ProductDetail {
  const t = today(ctx);
  const p = get<Record<string, unknown>>(
    ctx,
    `SELECT p.*, m.name AS manufacturer_name, c.name AS category_name FROM products p
     LEFT JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    id,
  );
  if (!p) throw notFound('Product');
  const s = ctx.sqlite.prepare(`WITH ${STOCK_CTE} SELECT * FROM stock WHERE product_id = ?`).get({ today: t }, id) as Record<string, number | string | null> | undefined;
  const sold = get<{ qty: number; last: string | null }>(
    ctx,
    `SELECT COALESCE(SUM(CASE WHEN s.created_at >= ? THEN si.quantity - si.returned_quantity ELSE 0 END), 0) AS qty, MAX(s.created_at) AS last
     FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = ? AND s.status = 'COMPLETED'`,
    new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString(),
    id,
  )!;
  const lastPurchase = get<{ d: string | null }>(
    ctx,
    `SELECT MAX(pu.invoice_date) AS d FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.product_id = ? AND pu.status = 'POSTED'`,
    id,
  )!;
  const packSize = p.pack_size as number;
  const sellable = Number(s?.sellable ?? 0);
  const showCost = can(ctx, 'inventory.cost_view');
  return {
    id: p.id as number,
    uuid: p.uuid as string,
    code: p.code as string,
    barcode: (p.barcode as string) ?? null,
    brandName: p.brand_name as string,
    genericName: (p.generic_name as string) ?? null,
    manufacturerId: (p.manufacturer_id as number) ?? null,
    manufacturerName: (p.manufacturer_name as string) ?? null,
    categoryId: (p.category_id as number) ?? null,
    categoryName: (p.category_name as string) ?? null,
    dosageForm: (p.dosage_form as string) ?? null,
    strength: (p.strength as string) ?? null,
    packSize,
    unitName: p.unit_name as string,
    packName: p.pack_name as string,
    allowLooseSale: !!p.allow_loose_sale,
    requiresPrescription: !!p.requires_prescription,
    isControlled: !!p.is_controlled,
    storageLocation: (p.storage_location as string) ?? null,
    storageCondition: (p.storage_condition as string) ?? null,
    minStock: p.min_stock as number,
    reorderLevel: p.reorder_level as number,
    maxStock: p.max_stock as number,
    defaultCostPrice: showCost ? (p.default_cost_price as number) : null,
    defaultSalePrice: p.default_sale_price as number,
    taxRateBp: p.tax_rate_bp as number,
    isActive: !!p.is_active,
    notes: (p.notes as string) ?? null,
    createdAt: p.created_at as string,
    updatedAt: p.updated_at as string,
    stock: {
      sellable,
      expired: Number(s?.expired ?? 0),
      blocked: Number(s?.blocked ?? 0),
      total: sellable + Number(s?.expired ?? 0) + Number(s?.blocked ?? 0),
      valueCost: showCost ? Math.round(Number(s?.cost_value_units ?? 0) / packSize) : null,
      valueRetail: Math.round(Number(s?.retail_value_units ?? 0) / packSize),
      nearestExpiry: (s?.nearest_expiry as string) ?? null,
      status: stockStatus(sellable, p.min_stock as number, p.reorder_level as number, p.max_stock as number),
      soldLast30Days: sold.qty,
      lastSaleAt: sold.last,
      lastPurchaseAt: lastPurchase.d,
    },
  };
}

export function nextProductCode(ctx: ServiceContext): string {
  return peekNumber(ctx, 'product');
}

type ProductInput = z.output<typeof ProductSaveSchema>;

function normaliseBarcode(b: string | null): string | null {
  const v = (b ?? '').replace(/\s+/g, '');
  return v ? v : null;
}

export function saveProduct(ctx: ServiceContext, input: ProductInput): ProductDetail {
  const user = requirePermission(ctx, 'products.manage');
  const barcode = normaliseBarcode(input.barcode);
  const id = transaction(ctx, () => {
    if (input.manufacturerId && !get(ctx, 'SELECT id FROM manufacturers WHERE id = ?', input.manufacturerId)) throw notFound('Manufacturer');
    if (input.categoryId && !get(ctx, 'SELECT id FROM categories WHERE id = ?', input.categoryId)) throw notFound('Category');
    if (barcode) {
      const dup = get<{ id: number; brand_name: string }>(ctx, 'SELECT id, brand_name FROM products WHERE barcode = ? AND id <> ?', barcode, input.id ?? 0);
      if (dup) throw conflict(`Barcode already assigned to "${dup.brand_name}"`);
    }
    const now = ctx.now().toISOString();
    const names = get<{ m: string | null; c: string | null }>(
      ctx,
      'SELECT (SELECT name FROM manufacturers WHERE id = ?) AS m, (SELECT name FROM categories WHERE id = ?) AS c',
      input.manufacturerId ?? null,
      input.categoryId ?? null,
    )!;

    if (input.id) {
      const before = get<Record<string, unknown>>(ctx, 'SELECT * FROM products WHERE id = ?', input.id);
      if (!before) throw notFound('Product');
      const code = input.code?.trim() || (before.code as string);
      if (code !== before.code && get(ctx, 'SELECT id FROM products WHERE code = ? AND id <> ?', code, input.id)) throw conflict('Another product already uses this product code');
      const priceChanged = before.default_sale_price !== input.defaultSalePrice || before.default_cost_price !== input.defaultCostPrice;
      if (priceChanged && !can(ctx, 'products.price_change')) throw forbidden('You do not have permission to change prices');
      const searchText = buildSearchText({ ...input, code, barcode, manufacturerName: names.m, categoryName: names.c });
      run(
        ctx,
        `UPDATE products SET code = ?, barcode = ?, brand_name = ?, generic_name = ?, manufacturer_id = ?, category_id = ?, dosage_form = ?,
           strength = ?, pack_size = ?, unit_name = ?, pack_name = ?, allow_loose_sale = ?, requires_prescription = ?, is_controlled = ?,
           storage_location = ?, storage_condition = ?, min_stock = ?, reorder_level = ?, max_stock = ?, default_cost_price = ?,
           default_sale_price = ?, tax_rate_bp = ?, is_active = ?, notes = ?, search_text = ?, updated_at = ?
         WHERE id = ?`,
        code, barcode, input.brandName, input.genericName, input.manufacturerId ?? null, input.categoryId ?? null, input.dosageForm,
        input.strength, input.packSize, input.unitName, input.packName, input.allowLooseSale ? 1 : 0, input.requiresPrescription ? 1 : 0,
        input.isControlled ? 1 : 0, input.storageLocation, input.storageCondition, input.minStock, input.reorderLevel, input.maxStock,
        input.defaultCostPrice, input.defaultSalePrice, input.taxRateBp, input.isActive ? 1 : 0, input.notes, searchText, now, input.id,
      );
      const after: Record<string, unknown> = {
        code, barcode, brand_name: input.brandName, generic_name: input.genericName, manufacturer_id: input.manufacturerId ?? null,
        category_id: input.categoryId ?? null, dosage_form: input.dosageForm, strength: input.strength, pack_size: input.packSize,
        unit_name: input.unitName, pack_name: input.packName, allow_loose_sale: input.allowLooseSale ? 1 : 0,
        requires_prescription: input.requiresPrescription ? 1 : 0, is_controlled: input.isControlled ? 1 : 0,
        storage_location: input.storageLocation, storage_condition: input.storageCondition, min_stock: input.minStock,
        reorder_level: input.reorderLevel, max_stock: input.maxStock, default_cost_price: input.defaultCostPrice,
        default_sale_price: input.defaultSalePrice, tax_rate_bp: input.taxRateBp, is_active: input.isActive ? 1 : 0, notes: input.notes,
      };
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(after)) if (before[k] !== v) changes[k] = { from: before[k], to: v };
      if (before.pack_size !== input.packSize) {
        const hasStock = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM batches WHERE product_id = ? AND quantity_on_hand <> 0', input.id)!.n;
        if (hasStock > 0) throw conflict('Pack size cannot be changed while the product has stock. Adjust stock to zero first.');
      }
      if (Object.keys(changes).length) {
        audit(ctx, {
          action: 'PRODUCT_UPDATE',
          entityType: 'product',
          entityId: input.id,
          description: `Updated product "${input.brandName}" (${Object.keys(changes).join(', ')})`,
          details: changes,
        });
      }
      if (priceChanged) {
        audit(ctx, {
          action: 'PRICE_CHANGE',
          entityType: 'product',
          entityId: input.id,
          description: `Default prices changed for "${input.brandName}"`,
          details: {
            salePrice: { from: before.default_sale_price, to: input.defaultSalePrice },
            costPrice: { from: before.default_cost_price, to: input.defaultCostPrice },
          },
          severity: 'WARNING',
        });
      }
      return input.id;
    }

    let code = input.code?.trim() || '';
    if (code) {
      if (get(ctx, 'SELECT id FROM products WHERE code = ?', code)) throw conflict('Another product already uses this product code');
    } else {
      do code = nextNumber(ctx, 'product');
      while (get(ctx, 'SELECT id FROM products WHERE code = ?', code));
    }
    const searchText = buildSearchText({ ...input, code, barcode, manufacturerName: names.m, categoryName: names.c });
    const res = run(
      ctx,
      `INSERT INTO products (uuid, code, barcode, brand_name, generic_name, manufacturer_id, category_id, dosage_form, strength, pack_size,
         unit_name, pack_name, allow_loose_sale, requires_prescription, is_controlled, storage_location, storage_condition, min_stock,
         reorder_level, max_stock, default_cost_price, default_sale_price, tax_rate_bp, is_active, notes, search_text, created_by,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), code, barcode, input.brandName, input.genericName, input.manufacturerId ?? null, input.categoryId ?? null,
      input.dosageForm, input.strength, input.packSize, input.unitName, input.packName, input.allowLooseSale ? 1 : 0,
      input.requiresPrescription ? 1 : 0, input.isControlled ? 1 : 0, input.storageLocation, input.storageCondition, input.minStock,
      input.reorderLevel, input.maxStock, input.defaultCostPrice, input.defaultSalePrice, input.taxRateBp, input.isActive ? 1 : 0,
      input.notes, searchText, user.id, now, now,
    );
    const newId = Number(res.lastInsertRowid);
    audit(ctx, {
      action: 'PRODUCT_CREATE',
      entityType: 'product',
      entityId: newId,
      description: `Created product "${input.brandName}${input.strength ? ` ${input.strength}` : ''}" (${code})`,
      details: { salePrice: input.defaultSalePrice, costPrice: input.defaultCostPrice, packSize: input.packSize },
    });
    return newId;
  });
  return getProduct(ctx, id);
}

export function setProductActive(ctx: ServiceContext, id: number, isActive: boolean): ProductDetail {
  const p = get<{ brand_name: string; is_active: number }>(ctx, 'SELECT brand_name, is_active FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product');
  if (!!p.is_active !== isActive) {
    transaction(ctx, () => {
      run(ctx, 'UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?', isActive ? 1 : 0, ctx.now().toISOString(), id);
      audit(ctx, {
        action: isActive ? 'PRODUCT_ACTIVATE' : 'PRODUCT_DEACTIVATE',
        entityType: 'product',
        entityId: id,
        description: `${isActive ? 'Activated' : 'Deactivated'} product "${p.brand_name}"`,
      });
    });
  }
  return getProduct(ctx, id);
}

/* ─────────────────────────────── POS search ─────────────────────────────── */

const HIT_SELECT = `p.id, p.code, p.barcode, p.brand_name AS brandName, p.generic_name AS genericName, p.strength, p.dosage_form AS dosageForm,
  m.name AS manufacturerName, p.pack_size AS packSize, p.unit_name AS unitName, p.pack_name AS packName,
  p.allow_loose_sale AS allowLooseSale, p.requires_prescription AS requiresPrescription, p.is_controlled AS isControlled,
  p.is_active AS isActive, p.tax_rate_bp AS taxRateBp, p.storage_location AS storageLocation,
  COALESCE((SELECT SUM(b.quantity_on_hand) FROM batches b WHERE b.product_id = p.id AND b.status = 'ACTIVE' AND b.expiry_date > @today AND b.quantity_on_hand > 0), 0) AS sellableQty,
  COALESCE((SELECT SUM(b.quantity_on_hand) FROM batches b WHERE b.product_id = p.id AND b.expiry_date <= @today AND b.quantity_on_hand > 0), 0) AS expiredQty,
  (SELECT b.expiry_date FROM batches b WHERE b.product_id = p.id AND b.status = 'ACTIVE' AND b.expiry_date > @today AND b.quantity_on_hand > 0 ORDER BY b.expiry_date, b.id LIMIT 1) AS nearestExpiry,
  COALESCE((SELECT b.sale_price FROM batches b WHERE b.product_id = p.id AND b.status = 'ACTIVE' AND b.expiry_date > @today AND b.quantity_on_hand > 0 ORDER BY b.expiry_date, b.id LIMIT 1), p.default_sale_price) AS price`;

function mapHits(rows: ProductSearchHit[]): ProductSearchHit[] {
  return bools(rows, 'allowLooseSale', 'requiresPrescription', 'isControlled', 'isActive');
}

/**
 * Fast product search for the POS and pickers. Matches every token against the normalised
 * search text; exact barcode / code hits rank first, then brand / generic prefix matches.
 */
export function searchProducts(ctx: ServiceContext, input: z.output<typeof ProductSearchSchema>): ProductSearchHit[] {
  const q = input.query.trim();
  if (!q) return [];
  const toks = tokens(q);
  const conds = toks.map(() => `p.search_text LIKE ? ESCAPE '\\'`);
  const params = toks.map((t) => `%${likeEscape(t)}%`);
  if (!input.includeInactive) conds.push('p.is_active = 1');
  const lower = q.toLowerCase();
  const prefix = `${likeEscape(lower)}%`;
  const rows = ctx.sqlite
    .prepare(
      `WITH hits AS (
         SELECT p.id,
           CASE WHEN p.barcode = @q THEN 0 WHEN lower(p.code) = @lower THEN 1
                WHEN lower(p.brand_name) LIKE @prefix ESCAPE '\\' THEN 2
                WHEN lower(p.generic_name) LIKE @prefix ESCAPE '\\' THEN 3 ELSE 4 END AS rank
         FROM products p WHERE ${conds.join(' AND ')}
         ORDER BY rank, p.brand_name COLLATE NOCASE, p.strength LIMIT @limit
       )
       SELECT ${HIT_SELECT} FROM hits h JOIN products p ON p.id = h.id LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       ORDER BY h.rank, (sellableQty > 0) DESC, p.brand_name COLLATE NOCASE, p.strength`,
    )
    .all({ q, lower, prefix, limit: input.limit, today: today(ctx) }, ...params) as ProductSearchHit[];
  return mapHits(rows);
}

export function findByBarcode(ctx: ServiceContext, barcode: string): ProductSearchHit | null {
  const code = barcode.trim();
  const row = ctx.sqlite
    .prepare(
      `SELECT ${HIT_SELECT} FROM products p LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE p.barcode = @code OR lower(p.code) = lower(@code) ORDER BY (p.barcode = @code) DESC LIMIT 1`,
    )
    .get({ code, today: today(ctx) }) as ProductSearchHit | undefined;
  return row ? mapHits([row])[0] : null;
}

export function getSearchHit(ctx: ServiceContext, productId: number): ProductSearchHit | null {
  const row = ctx.sqlite
    .prepare(`SELECT ${HIT_SELECT} FROM products p LEFT JOIN manufacturers m ON m.id = p.manufacturer_id WHERE p.id = @id`)
    .get({ id: productId, today: today(ctx) }) as ProductSearchHit | undefined;
  return row ? mapHits([row])[0] : null;
}

/** Products expiring within `days` — convenience for dashboards. */
export function expiringCount(ctx: ServiceContext, days: number): number {
  const t = today(ctx);
  return get<{ n: number }>(
    ctx,
    `SELECT COUNT(DISTINCT product_id) AS n FROM batches WHERE quantity_on_hand > 0 AND expiry_date > ? AND expiry_date <= ?`,
    t,
    addDays(t, days),
  )!.n;
}

