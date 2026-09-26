import type { ServiceContext } from '@main/core/context';
import { overrides } from '@main/core/overrides';
import { saveCategory, saveManufacturer, saveProduct } from '@main/modules/catalog/catalog.service';
import { saveSupplier } from '@main/modules/purchasing/suppliers.service';
import { postPurchase, savePurchaseDraft } from '@main/modules/purchasing/purchases.service';
import { openCashSession } from '@main/modules/finance/cash.service';
import { saveCustomer } from '@main/modules/customers/customers.service';
import { completeSale, buildQuote } from '@main/modules/sales/sales.service';
import { ProductSaveSchema } from '@shared/schemas/catalog';
import { PurchaseDraftSchema, SupplierSaveSchema } from '@shared/schemas/purchasing';
import { SaleCompleteSchema } from '@shared/schemas/sales';
import { CustomerSaveSchema } from '@shared/schemas/customers';

export function makeProduct(ctx: ServiceContext, overridesInput: Partial<Parameters<typeof ProductSaveSchema.parse>[0]> = {}) {
  const cat = saveCategory(ctx, { name: `Cat ${Math.random().toString(36).slice(2, 7)}`, description: null, isActive: true });
  const man = saveManufacturer(ctx, { name: `Man ${Math.random().toString(36).slice(2, 7)}`, country: null, phone: null, isActive: true });
  return saveProduct(
    ctx,
    ProductSaveSchema.parse({
      brandName: 'Panadol',
      genericName: 'Paracetamol',
      strength: '500 mg',
      dosageForm: 'Tablet',
      packSize: 10,
      unitName: 'Tablet',
      packName: 'Strip',
      categoryId: cat.id,
      manufacturerId: man.id,
      defaultCostPrice: 8000,
      defaultSalePrice: 10000,
      minStock: 20,
      reorderLevel: 40,
      maxStock: 200,
      ...overridesInput,
    }),
  );
}

export function makeSupplier(ctx: ServiceContext, name = 'Sample Distributors', openingBalance = 0) {
  return saveSupplier(ctx, SupplierSaveSchema.parse({ name, openingBalance, paymentTermsDays: 30 }));
}

export function makeCustomer(ctx: ServiceContext, name = 'Test Customer', creditLimit = 0) {
  return saveCustomer(ctx, CustomerSaveSchema.parse({ name, phone: `0300${Math.floor(Math.random() * 1e7)}`, creditLimit }));
}

export interface PurchaseLine {
  productId: number;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  bonusQuantity?: number;
  costPrice: number;
  salePrice: number;
  manufactureDate?: string | null;
  discountBp?: number;
}

export function receive(ctx: ServiceContext, supplierId: number, lines: PurchaseLine[], opts: { paid?: number; invoiceNo?: string; invoiceDiscount?: number; otherCharges?: number } = {}) {
  const draft = savePurchaseDraft(
    ctx,
    PurchaseDraftSchema.parse({
      supplierId,
      supplierInvoiceNo: opts.invoiceNo ?? null,
      invoiceDate: '2026-09-20',
      invoiceDiscount: opts.invoiceDiscount ?? 0,
      otherCharges: opts.otherCharges ?? 0,
      items: lines.map((l) => ({ bonusQuantity: 0, manufactureDate: null, ...l })),
    }),
  );
  return postPurchase(ctx, { id: draft.id, paidAmount: opts.paid ?? 0, paymentMethod: 'CASH', paymentReference: null });
}

export function openShift(ctx: ServiceContext, openingCash = 500000) {
  return openCashSession(ctx, { openingCash, notes: null });
}

export interface SellLine {
  productId: number;
  quantity: number;
  batchId?: number | null;
  unitPrice?: number | null;
  discount?: { type: 'PERCENT' | 'AMOUNT'; value: number } | null;
}

/** Quote then complete a cash sale for the exact total. */
export function sell(
  ctx: ServiceContext,
  lines: SellLine[],
  opts: { customerId?: number | null; credit?: number; tendered?: number; invoiceDiscount?: { type: 'PERCENT' | 'AMOUNT'; value: number } | null; overrideTokens?: string[]; prescriptionId?: number | null } = {},
) {
  const draft = {
    lines: lines.map((l, i) => ({ key: `L${i}`, ...l })),
    customerId: opts.customerId ?? null,
    invoiceDiscount: opts.invoiceDiscount ?? null,
    prescriptionId: opts.prescriptionId ?? null,
    overrideTokens: opts.overrideTokens ?? [],
  };
  const quote = buildQuote(ctx, SaleCompleteSchema.parse({ ...draft, payments: [{ method: 'CASH', amount: 0 }], expectedTotal: 0 }), overrides).quote;
  const credit = opts.credit ?? 0;
  const cash = quote.total - credit;
  const payments = [
    ...(cash > 0 ? [{ method: 'CASH' as const, amount: cash, reference: null }] : []),
    ...(credit > 0 ? [{ method: 'CREDIT' as const, amount: credit, reference: null }] : []),
  ];
  const input = SaleCompleteSchema.parse({
    ...draft,
    payments: payments.length ? payments : [{ method: 'CASH', amount: 0 }],
    cashTendered: opts.tendered ?? cash,
    expectedTotal: quote.total,
  });
  return { quote, result: completeSale(ctx, input, overrides) };
}
