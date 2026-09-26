/**
 * PharmaDesk database schema (SQLite via Drizzle ORM).
 *
 * Conventions (see docs/DATABASE.md):
 *  - money: INTEGER paisa · rates: INTEGER basis points · quantities: INTEGER base units
 *  - pack prices (cost_price / sale_price) are per pack
 *  - timestamps: ISO-8601 UTC text · business dates: YYYY-MM-DD text
 *  - financial documents are voided, never deleted
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const id = () => integer('id').primaryKey({ autoIncrement: true });
const uuid = () =>
  text('uuid')
    .notNull()
    .unique()
    .$defaultFn(() => randomUUID());
const createdAt = () => text('created_at').notNull().default(nowSql);
const updatedAt = () => text('updated_at').notNull().default(nowSql);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const money = (name: string) => integer(name).notNull().default(0);

/* ───────────────────────────── Security ───────────────────────────── */

export const roles = sqliteTable('roles', {
  id: id(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isSystem: bool('is_system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const permissions = sqliteTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  label: text('label').notNull(),
  description: text('description'),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const users = sqliteTable(
  'users',
  {
    id: id(),
    uuid: uuid(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),
    isActive: bool('is_active').notNull().default(true),
    mustChangePassword: bool('must_change_password').notNull().default(false),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_username_uq').on(sql`${t.username} COLLATE NOCASE`)],
);

export const userSessions = sqliteTable(
  'user_sessions',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    startedAt: text('started_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
    endedAt: text('ended_at'),
    endReason: text('end_reason'),
  },
  (t) => [index('user_sessions_user_idx').on(t.userId)],
);

/* ─────────────────────────── Configuration ─────────────────────────── */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
  updatedBy: integer('updated_by').references(() => users.id),
});

export const sequences = sqliteTable('sequences', {
  key: text('key').primaryKey(),
  prefix: text('prefix').notNull(),
  nextValue: integer('next_value').notNull().default(1),
  padding: integer('padding').notNull().default(6),
});

/* ───────────────────────────── Catalogue ───────────────────────────── */

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    uuid: uuid(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_name_uq').on(sql`${t.name} COLLATE NOCASE`)],
);

export const manufacturers = sqliteTable(
  'manufacturers',
  {
    id: id(),
    uuid: uuid(),
    name: text('name').notNull(),
    country: text('country'),
    phone: text('phone'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('manufacturers_name_uq').on(sql`${t.name} COLLATE NOCASE`)],
);

export const products = sqliteTable(
  'products',
  {
    id: id(),
    uuid: uuid(),
    code: text('code').notNull().unique(),
    barcode: text('barcode').unique(),
    brandName: text('brand_name').notNull(),
    genericName: text('generic_name'),
    manufacturerId: integer('manufacturer_id').references(() => manufacturers.id),
    categoryId: integer('category_id').references(() => categories.id),
    dosageForm: text('dosage_form'),
    strength: text('strength'),
    packSize: integer('pack_size').notNull().default(1),
    unitName: text('unit_name').notNull().default('Unit'),
    packName: text('pack_name').notNull().default('Pack'),
    allowLooseSale: bool('allow_loose_sale').notNull().default(true),
    requiresPrescription: bool('requires_prescription').notNull().default(false),
    isControlled: bool('is_controlled').notNull().default(false),
    storageLocation: text('storage_location'),
    storageCondition: text('storage_condition'),
    minStock: integer('min_stock').notNull().default(0),
    reorderLevel: integer('reorder_level').notNull().default(0),
    maxStock: integer('max_stock').notNull().default(0),
    defaultCostPrice: money('default_cost_price'),
    defaultSalePrice: money('default_sale_price'),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    isActive: bool('is_active').notNull().default(true),
    notes: text('notes'),
    searchText: text('search_text').notNull().default(''),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_brand_idx').on(t.brandName),
    index('products_generic_idx').on(t.genericName),
    index('products_category_idx').on(t.categoryId),
    index('products_manufacturer_idx').on(t.manufacturerId),
    index('products_active_idx').on(t.isActive),
    check('products_pack_size_ck', sql`${t.packSize} >= 1`),
    check('products_prices_ck', sql`${t.defaultCostPrice} >= 0 AND ${t.defaultSalePrice} >= 0`),
    check('products_levels_ck', sql`${t.minStock} >= 0 AND ${t.reorderLevel} >= 0 AND ${t.maxStock} >= 0`),
  ],
);

/* ───────────────────────────── Suppliers ───────────────────────────── */

export const suppliers = sqliteTable(
  'suppliers',
  {
    id: id(),
    uuid: uuid(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    ntn: text('ntn'),
    strn: text('strn'),
    drugLicenseNo: text('drug_license_no'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    openingBalance: money('opening_balance'),
    notes: text('notes'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('suppliers_name_uq').on(sql`${t.name} COLLATE NOCASE`)],
);

/* ───────────────────────────── Purchases ───────────────────────────── */

export const purchases = sqliteTable(
  'purchases',
  {
    id: id(),
    uuid: uuid(),
    purchaseNo: text('purchase_no').notNull().unique(),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierInvoiceNo: text('supplier_invoice_no'),
    invoiceDate: text('invoice_date').notNull(),
    dueDate: text('due_date'),
    status: text('status', { enum: ['DRAFT', 'POSTED', 'VOID'] }).notNull().default('DRAFT'),
    subtotal: money('subtotal'),
    discountTotal: money('discount_total'),
    invoiceDiscount: money('invoice_discount'),
    otherCharges: money('other_charges'),
    taxTotal: money('tax_total'),
    total: money('total'),
    paidAmount: money('paid_amount'),
    paymentMethod: text('payment_method'),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    postedBy: integer('posted_by').references(() => users.id),
    postedAt: text('posted_at'),
    voidedBy: integer('voided_by').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('purchases_supplier_idx').on(t.supplierId),
    index('purchases_date_idx').on(t.invoiceDate),
    index('purchases_status_idx').on(t.status),
    uniqueIndex('purchases_supplier_invoice_uq')
      .on(t.supplierId, sql`${t.supplierInvoiceNo} COLLATE NOCASE`)
      .where(sql`${t.status} = 'POSTED' AND ${t.supplierInvoiceNo} IS NOT NULL`),
  ],
);

/* ───────────────────────────── Inventory ───────────────────────────── */

export const batches = sqliteTable(
  'batches',
  {
    id: id(),
    uuid: uuid(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    batchNumber: text('batch_number').notNull(),
    manufactureDate: text('manufacture_date'),
    expiryDate: text('expiry_date').notNull(),
    costPrice: money('cost_price'),
    salePrice: money('sale_price'),
    quantityReceived: integer('quantity_received').notNull().default(0),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    purchaseId: integer('purchase_id').references(() => purchases.id),
    location: text('location'),
    status: text('status', { enum: ['ACTIVE', 'QUARANTINED', 'RECALLED'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('batches_product_batch_uq').on(t.productId, t.batchNumber),
    index('batches_fefo_idx').on(t.productId, t.expiryDate),
    index('batches_expiry_idx').on(t.expiryDate),
    check(
      'batches_dates_ck',
      sql`${t.manufactureDate} IS NULL OR ${t.expiryDate} > ${t.manufactureDate}`,
    ),
    check('batches_prices_ck', sql`${t.costPrice} >= 0 AND ${t.salePrice} >= 0`),
  ],
);

export const purchaseItems = sqliteTable(
  'purchase_items',
  {
    id: id(),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    batchId: integer('batch_id').references(() => batches.id),
    batchNumber: text('batch_number').notNull(),
    manufactureDate: text('manufacture_date'),
    expiryDate: text('expiry_date').notNull(),
    quantity: integer('quantity').notNull(),
    bonusQuantity: integer('bonus_quantity').notNull().default(0),
    costPrice: money('cost_price'),
    salePrice: money('sale_price'),
    discountBp: integer('discount_bp').notNull().default(0),
    discountAmount: money('discount_amount'),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxAmount: money('tax_amount'),
    lineTotal: money('line_total'),
    landedCostPrice: money('landed_cost_price'),
  },
  (t) => [
    index('purchase_items_purchase_idx').on(t.purchaseId),
    index('purchase_items_product_idx').on(t.productId),
    check('purchase_items_qty_ck', sql`${t.quantity} >= 0 AND ${t.bonusQuantity} >= 0`),
  ],
);

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    uuid: uuid(),
    batchId: integer('batch_id')
      .notNull()
      .references(() => batches.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    movementType: text('movement_type', {
      enum: [
        'OPENING',
        'PURCHASE',
        'PURCHASE_VOID',
        'SALE',
        'SALE_VOID',
        'SALE_RETURN',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT',
        'WRITE_OFF',
      ],
    }).notNull(),
    quantity: integer('quantity').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    unitCost: money('unit_cost'),
    referenceType: text('reference_type'),
    referenceId: integer('reference_id'),
    note: text('note'),
    userId: integer('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_batch_idx').on(t.batchId, t.createdAt),
    index('stock_movements_product_idx').on(t.productId, t.createdAt),
    index('stock_movements_ref_idx').on(t.referenceType, t.referenceId),
    index('stock_movements_created_idx').on(t.createdAt),
  ],
);

export const stockAdjustments = sqliteTable(
  'stock_adjustments',
  {
    id: id(),
    uuid: uuid(),
    adjustmentNo: text('adjustment_no').notNull().unique(),
    batchId: integer('batch_id')
      .notNull()
      .references(() => batches.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    direction: text('direction', { enum: ['IN', 'OUT'] }).notNull(),
    reason: text('reason', {
      enum: [
        'COUNT_CORRECTION',
        'DAMAGED',
        'EXPIRED',
        'LOST',
        'RETURN_TO_SUPPLIER',
        'OPENING_STOCK',
        'OTHER',
      ],
    }).notNull(),
    quantity: integer('quantity').notNull(),
    costValue: money('cost_value'),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_adjustments_batch_idx').on(t.batchId),
    index('stock_adjustments_created_idx').on(t.createdAt),
    check('stock_adjustments_qty_ck', sql`${t.quantity} > 0`),
  ],
);

/* ──────────────────────── Customers & prescriptions ──────────────────────── */

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    uuid: uuid(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    creditLimit: money('credit_limit'),
    openingBalance: money('opening_balance'),
    isActive: bool('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('customers_name_idx').on(t.name), index('customers_phone_idx').on(t.phone)],
);

export const prescriptions = sqliteTable(
  'prescriptions',
  {
    id: id(),
    uuid: uuid(),
    prescriptionNo: text('prescription_no').notNull().unique(),
    customerId: integer('customer_id').references(() => customers.id),
    patientName: text('patient_name').notNull(),
    patientAge: text('patient_age'),
    prescriberName: text('prescriber_name').notNull(),
    prescriberRegistration: text('prescriber_registration'),
    clinic: text('clinic'),
    prescriptionDate: text('prescription_date').notNull(),
    notes: text('notes'),
    status: text('status', { enum: ['ACTIVE', 'ARCHIVED'] }).notNull().default('ACTIVE'),
    recordedBy: integer('recorded_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('prescriptions_customer_idx').on(t.customerId),
    index('prescriptions_date_idx').on(t.prescriptionDate),
  ],
);

export const prescriptionItems = sqliteTable(
  'prescription_items',
  {
    id: id(),
    prescriptionId: integer('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id),
    medicineText: text('medicine_text').notNull(),
    quantity: integer('quantity'),
    instructions: text('instructions'),
  },
  (t) => [index('prescription_items_rx_idx').on(t.prescriptionId)],
);

export const prescriptionAttachments = sqliteTable(
  'prescription_attachments',
  {
    id: id(),
    prescriptionId: integer('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('prescription_attachments_rx_idx').on(t.prescriptionId)],
);

/* ─────────────────────────────── Cash ─────────────────────────────── */

export const cashSessions = sqliteTable(
  'cash_sessions',
  {
    id: id(),
    uuid: uuid(),
    sessionNo: text('session_no').notNull().unique(),
    status: text('status', { enum: ['OPEN', 'CLOSED'] }).notNull().default('OPEN'),
    openedBy: integer('opened_by')
      .notNull()
      .references(() => users.id),
    openedAt: text('opened_at').notNull(),
    openingCash: money('opening_cash'),
    closedBy: integer('closed_by').references(() => users.id),
    closedAt: text('closed_at'),
    expectedCash: integer('expected_cash'),
    countedCash: integer('counted_cash'),
    variance: integer('variance'),
    denominations: text('denominations'),
    summary: text('summary'),
    closingNotes: text('closing_notes'),
  },
  (t) => [
    uniqueIndex('cash_sessions_one_open_uq')
      .on(t.status)
      .where(sql`${t.status} = 'OPEN'`),
    index('cash_sessions_opened_idx').on(t.openedAt),
  ],
);

export const cashAdjustments = sqliteTable(
  'cash_adjustments',
  {
    id: id(),
    cashSessionId: integer('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    direction: text('direction', { enum: ['IN', 'OUT'] }).notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('cash_adjustments_session_idx').on(t.cashSessionId),
    check('cash_adjustments_amount_ck', sql`${t.amount} > 0`),
  ],
);

/* ─────────────────────────────── Sales ─────────────────────────────── */

export const sales = sqliteTable(
  'sales',
  {
    id: id(),
    uuid: uuid(),
    invoiceNo: text('invoice_no').notNull().unique(),
    customerId: integer('customer_id').references(() => customers.id),
    prescriptionId: integer('prescription_id').references(() => prescriptions.id),
    cashSessionId: integer('cash_session_id').references(() => cashSessions.id),
    status: text('status', { enum: ['COMPLETED', 'VOID'] }).notNull().default('COMPLETED'),
    subtotal: money('subtotal'),
    discountTotal: money('discount_total'),
    taxTotal: money('tax_total'),
    roundOff: money('round_off'),
    total: money('total'),
    paidTotal: money('paid_total'),
    cashTendered: money('cash_tendered'),
    changeDue: money('change_due'),
    creditAmount: money('credit_amount'),
    costTotal: money('cost_total'),
    itemCount: integer('item_count').notNull().default(0),
    notes: text('notes'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedBy: integer('voided_by').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
    voidCashSessionId: integer('void_cash_session_id').references(() => cashSessions.id),
  },
  (t) => [
    index('sales_created_idx').on(t.createdAt),
    index('sales_customer_idx').on(t.customerId),
    index('sales_session_idx').on(t.cashSessionId),
    index('sales_user_idx').on(t.createdBy),
    index('sales_status_idx').on(t.status),
  ],
);

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: id(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    lineNo: integer('line_no').notNull(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    batchId: integer('batch_id')
      .notNull()
      .references(() => batches.id),
    productName: text('product_name').notNull(),
    batchNumber: text('batch_number').notNull(),
    expiryDate: text('expiry_date').notNull(),
    packSize: integer('pack_size').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price'),
    unitCost: money('unit_cost'),
    grossAmount: money('gross_amount'),
    discountAmount: money('discount_amount'),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxAmount: money('tax_amount'),
    lineTotal: money('line_total'),
    costAmount: money('cost_amount'),
    returnedQuantity: integer('returned_quantity').notNull().default(0),
    expiredOverride: bool('expired_override').notNull().default(false),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId),
    index('sale_items_batch_idx').on(t.batchId),
    check('sale_items_qty_ck', sql`${t.quantity} > 0`),
    check('sale_items_returned_ck', sql`${t.returnedQuantity} >= 0 AND ${t.returnedQuantity} <= ${t.quantity}`),
  ],
);

export const salePayments = sqliteTable(
  'sale_payments',
  {
    id: id(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    method: text('method', {
      enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CREDIT'],
    }).notNull(),
    amount: integer('amount').notNull(),
    reference: text('reference'),
  },
  (t) => [index('sale_payments_sale_idx').on(t.saleId), index('sale_payments_method_idx').on(t.method)],
);

export const heldBills = sqliteTable('held_bills', {
  id: id(),
  label: text('label').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  payload: text('payload').notNull(),
  itemCount: integer('item_count').notNull().default(0),
  totalEstimate: money('total_estimate'),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const saleReturns = sqliteTable(
  'sale_returns',
  {
    id: id(),
    uuid: uuid(),
    returnNo: text('return_no').notNull().unique(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    customerId: integer('customer_id').references(() => customers.id),
    cashSessionId: integer('cash_session_id').references(() => cashSessions.id),
    refundMethod: text('refund_method', {
      enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CUSTOMER_ACCOUNT'],
    }).notNull(),
    subtotal: money('subtotal'),
    taxTotal: money('tax_total'),
    roundOff: money('round_off'),
    total: money('total'),
    costTotal: money('cost_total'),
    reason: text('reason').notNull(),
    notes: text('notes'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('sale_returns_sale_idx').on(t.saleId),
    index('sale_returns_created_idx').on(t.createdAt),
    index('sale_returns_session_idx').on(t.cashSessionId),
  ],
);

export const saleReturnItems = sqliteTable(
  'sale_return_items',
  {
    id: id(),
    returnId: integer('return_id')
      .notNull()
      .references(() => saleReturns.id),
    saleItemId: integer('sale_item_id')
      .notNull()
      .references(() => saleItems.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    batchId: integer('batch_id')
      .notNull()
      .references(() => batches.id),
    quantity: integer('quantity').notNull(),
    amount: money('amount'),
    taxAmount: money('tax_amount'),
    costAmount: money('cost_amount'),
    restock: bool('restock').notNull().default(true),
  },
  (t) => [
    index('sale_return_items_return_idx').on(t.returnId),
    index('sale_return_items_sale_item_idx').on(t.saleItemId),
    check('sale_return_items_qty_ck', sql`${t.quantity} > 0`),
  ],
);

/* ────────────────────────────── Finance ────────────────────────────── */

export const supplierTransactions = sqliteTable(
  'supplier_transactions',
  {
    id: id(),
    uuid: uuid(),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    txnDate: text('txn_date').notNull(),
    type: text('type', {
      enum: ['OPENING_BALANCE', 'PURCHASE', 'PURCHASE_VOID', 'PAYMENT', 'PAYMENT_VOID', 'ADJUSTMENT'],
    }).notNull(),
    amount: integer('amount').notNull(),
    referenceType: text('reference_type'),
    referenceId: integer('reference_id'),
    description: text('description'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('supplier_txn_supplier_idx').on(t.supplierId, t.txnDate)],
);

export const customerTransactions = sqliteTable(
  'customer_transactions',
  {
    id: id(),
    uuid: uuid(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    txnDate: text('txn_date').notNull(),
    type: text('type', {
      enum: [
        'OPENING_BALANCE',
        'SALE_CREDIT',
        'SALE_VOID',
        'RETURN_CREDIT',
        'PAYMENT',
        'PAYMENT_VOID',
        'ADJUSTMENT',
      ],
    }).notNull(),
    amount: integer('amount').notNull(),
    referenceType: text('reference_type'),
    referenceId: integer('reference_id'),
    description: text('description'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('customer_txn_customer_idx').on(t.customerId, t.txnDate)],
);

export const expenseCategories = sqliteTable(
  'expense_categories',
  {
    id: id(),
    name: text('name').notNull(),
    isActive: bool('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('expense_categories_name_uq').on(sql`${t.name} COLLATE NOCASE`)],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: id(),
    uuid: uuid(),
    expenseNo: text('expense_no').notNull().unique(),
    expenseDate: text('expense_date').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    amount: integer('amount').notNull(),
    description: text('description').notNull(),
    paymentMethod: text('payment_method', {
      enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET'],
    }).notNull(),
    reference: text('reference'),
    cashSessionId: integer('cash_session_id').references(() => cashSessions.id),
    status: text('status', { enum: ['POSTED', 'VOID'] }).notNull().default('POSTED'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedBy: integer('voided_by').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
  },
  (t) => [
    index('expenses_date_idx').on(t.expenseDate),
    index('expenses_category_idx').on(t.categoryId),
    index('expenses_session_idx').on(t.cashSessionId),
    check('expenses_amount_ck', sql`${t.amount} > 0`),
  ],
);

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    uuid: uuid(),
    paymentNo: text('payment_no').notNull().unique(),
    direction: text('direction', { enum: ['IN', 'OUT'] }).notNull(),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    customerId: integer('customer_id').references(() => customers.id),
    purchaseId: integer('purchase_id').references(() => purchases.id),
    amount: integer('amount').notNull(),
    method: text('method', { enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CHEQUE'] }).notNull(),
    reference: text('reference'),
    paymentDate: text('payment_date').notNull(),
    notes: text('notes'),
    cashSessionId: integer('cash_session_id').references(() => cashSessions.id),
    status: text('status', { enum: ['POSTED', 'VOID'] }).notNull().default('POSTED'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedBy: integer('voided_by').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
  },
  (t) => [
    index('payments_supplier_idx').on(t.supplierId),
    index('payments_customer_idx').on(t.customerId),
    index('payments_date_idx').on(t.paymentDate),
    index('payments_session_idx').on(t.cashSessionId),
    check('payments_amount_ck', sql`${t.amount} > 0`),
    check(
      'payments_party_ck',
      sql`(${t.direction} = 'OUT' AND ${t.supplierId} IS NOT NULL) OR (${t.direction} = 'IN' AND ${t.customerId} IS NOT NULL)`,
    ),
  ],
);

/* ─────────────────────────── Audit & operations ─────────────────────────── */

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    userId: integer('user_id').references(() => users.id),
    username: text('username'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    description: text('description').notNull(),
    details: text('details'),
    severity: text('severity', { enum: ['INFO', 'WARNING', 'CRITICAL'] }).notNull().default('INFO'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_user_idx').on(t.userId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const backupLogs = sqliteTable(
  'backup_logs',
  {
    id: id(),
    filePath: text('file_path').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    kind: text('kind', { enum: ['MANUAL', 'AUTO', 'PRE_RESTORE', 'EXIT'] }).notNull(),
    status: text('status', { enum: ['SUCCESS', 'FAILED'] }).notNull(),
    integrity: text('integrity'),
    error: text('error'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('backup_logs_created_idx').on(t.createdAt)],
);
