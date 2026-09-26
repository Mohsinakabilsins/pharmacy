import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers';
import { makeProduct, makeSupplier, receive } from './fixtures';
import { adjustStock, addOpeningStock, integrityCheck, listMovements, productBatches, expiryReport, reorderReport } from '@main/modules/inventory/inventory.service';
import { getPurchase, voidPurchase, savePurchaseDraft, postPurchase, deletePurchaseDraft } from '@main/modules/purchasing/purchases.service';
import { getSupplier, getSupplierLedger } from '@main/modules/purchasing/suppliers.service';
import { createSupplierPayment, voidPayment } from '@main/modules/finance/payments.service';
import { StockAdjustSchema, OpeningStockSchema, ExpiryQuerySchema, ReorderQuerySchema, MovementListSchema } from '@shared/schemas/inventory';
import { PurchaseDraftSchema } from '@shared/schemas/purchasing';

let env: TestEnv;
afterEach(() => env?.cleanup());

describe('purchasing', () => {
  it('posting creates batches, movements, supplier payable and payment', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx, 'Alpha Pharma', 100000);
    const purchase = receive(ctx, s.id, [{ productId: p.id, batchNumber: 'b-101', expiryDate: '2027-06-30', quantity: 100, bonusQuantity: 10, costPrice: 8000, salePrice: 10000 }], { paid: 50000, invoiceNo: 'INV-77' });
    expect(purchase.status).toBe('POSTED');
    expect(purchase.total).toBe(80000);
    const batches = productBatches(ctx, p.id);
    expect(batches).toHaveLength(1);
    expect(batches[0].batchNumber).toBe('B-101');
    expect(batches[0].quantityOnHand).toBe(110);
    // landed cost per pack = 80000 * 10 / 110 = 7273
    expect(batches[0].costPrice).toBe(7273);
    const supplier = getSupplier(ctx, s.id);
    expect(supplier.balance).toBe(100000 + 80000 - 50000);
    const ledger = getSupplierLedger(ctx, s.id);
    // ledger is ordered by transaction date (purchase invoice dated before the supplier was created)
    expect(ledger.entries.map((e) => e.type)).toEqual(['PURCHASE', 'OPENING_BALANCE', 'PAYMENT']);
    expect(ledger.closingBalance).toBe(130000);
    const movements = listMovements(ctx, MovementListSchema.parse({ productId: p.id }));
    expect(movements.rows[0].movementType).toBe('PURCHASE');
    expect(movements.rows[0].referenceNo).toBe(purchase.purchaseNo);
    expect(integrityCheck(ctx).mismatches).toHaveLength(0);
  });

  it('re-receiving a batch merges it with weighted average cost; mismatched expiry is rejected', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx, { packSize: 1, unitName: 'Bottle', packName: 'Bottle' });
    const s = makeSupplier(ctx);
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'X1', expiryDate: '2027-01-31', quantity: 10, costPrice: 1000, salePrice: 1500 }]);
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'X1', expiryDate: '2027-01-31', quantity: 10, costPrice: 1200, salePrice: 1600 }]);
    const [b] = productBatches(ctx, p.id);
    expect(b.quantityOnHand).toBe(20);
    expect(b.costPrice).toBe(1100);
    expect(b.salePrice).toBe(1600);
    expect(() => receive(ctx, s.id, [{ productId: p.id, batchNumber: 'X1', expiryDate: '2027-02-28', quantity: 5, costPrice: 1000, salePrice: 1500 }])).toThrow(/different expiry/);
  });

  it('rejects expired stock, duplicate supplier invoices and invalid dates', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx);
    expect(() => receive(ctx, s.id, [{ productId: p.id, batchNumber: 'OLD', expiryDate: '2026-09-01', quantity: 10, costPrice: 100, salePrice: 200 }])).toThrow(/expired/);
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'A', expiryDate: '2027-09-01', quantity: 10, costPrice: 100, salePrice: 200 }], { invoiceNo: 'S-1' });
    expect(() => receive(ctx, s.id, [{ productId: p.id, batchNumber: 'B', expiryDate: '2027-09-01', quantity: 10, costPrice: 100, salePrice: 200 }], { invoiceNo: 's-1' })).toThrow(/already posted/);
    expect(() =>
      savePurchaseDraft(
        ctx,
        PurchaseDraftSchema.parse({ supplierId: s.id, invoiceDate: '2026-09-20', items: [{ productId: p.id, batchNumber: 'C', manufactureDate: '2027-01-01', expiryDate: '2026-12-01', quantity: 1, costPrice: 1, salePrice: 2 }] }),
      ),
    ).toThrow(/Expiry must be after/);
  });

  it('voids an unconsumed purchase: stock, ledger and linked payment are reversed', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx);
    const purchase = receive(ctx, s.id, [{ productId: p.id, batchNumber: 'V1', expiryDate: '2027-06-30', quantity: 50, costPrice: 8000, salePrice: 10000 }], { paid: 10000 });
    const voided = voidPurchase(ctx, purchase.id, 'Entered twice');
    expect(voided.status).toBe('VOID');
    expect(productBatches(ctx, p.id, true)[0].quantityOnHand).toBe(0);
    expect(getSupplier(ctx, s.id).balance).toBe(0);
    expect(voided.payments[0].status).toBe('VOID');
    expect(integrityCheck(ctx).mismatches).toHaveLength(0);
    expect(() => voidPurchase(ctx, purchase.id, 'again')).toThrow(/Only posted/);
  });

  it('drafts can be deleted, posted purchases cannot (trigger + service)', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx);
    const draft = savePurchaseDraft(ctx, PurchaseDraftSchema.parse({ supplierId: s.id, invoiceDate: '2026-09-20', items: [{ productId: p.id, batchNumber: 'D', expiryDate: '2027-01-01', quantity: 1, costPrice: 1, salePrice: 2 }] }));
    deletePurchaseDraft(ctx, draft.id);
    expect(() => getPurchase(ctx, draft.id)).toThrow(/not found/);
    const d2 = savePurchaseDraft(ctx, PurchaseDraftSchema.parse({ supplierId: s.id, invoiceDate: '2026-09-20', items: [{ productId: p.id, batchNumber: 'E', expiryDate: '2027-01-01', quantity: 1, costPrice: 1, salePrice: 2 }] }));
    postPurchase(ctx, { id: d2.id, paidAmount: 0, paymentMethod: 'CASH', paymentReference: null });
    expect(() => deletePurchaseDraft(ctx, d2.id)).toThrow(/Only drafts/);
    expect(() => env.handle.sqlite.prepare('DELETE FROM purchases WHERE id = ?').run(d2.id)).toThrow(/PROTECTED_RECORD/);
  });

  it('supplier payments reduce balance and voiding restores it', () => {
    env = createTestEnv();
    const { ctx } = env;
    const s = makeSupplier(ctx, 'Beta', 50000);
    const pay = createSupplierPayment(ctx, { supplierId: s.id, amount: 20000, method: 'BANK_TRANSFER', reference: 'TRX1', paymentDate: '2026-09-27', notes: null });
    expect(getSupplier(ctx, s.id).balance).toBe(30000);
    voidPayment(ctx, pay.id, 'Bounced');
    expect(getSupplier(ctx, s.id).balance).toBe(50000);
  });
});

describe('inventory adjustments & reports', () => {
  it('opening stock, write-off and count correction are traceable movements', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const batch = addOpeningStock(ctx, OpeningStockSchema.parse({ productId: p.id, batchNumber: 'op1', expiryDate: '2027-03-31', quantity: 40, costPrice: 8000, salePrice: 10000 }));
    expect(batch.quantityOnHand).toBe(40);
    adjustStock(ctx, StockAdjustSchema.parse({ batchId: batch.id, direction: 'OUT', reason: 'DAMAGED', quantity: 5 }));
    adjustStock(ctx, StockAdjustSchema.parse({ batchId: batch.id, direction: 'IN', reason: 'COUNT_CORRECTION', quantity: 2, notes: 'Found on shelf' }));
    expect(productBatches(ctx, p.id)[0].quantityOnHand).toBe(37);
    const mv = listMovements(ctx, MovementListSchema.parse({ batchId: batch.id }));
    expect(mv.rows.map((m) => m.movementType)).toEqual(['ADJUSTMENT_IN', 'WRITE_OFF', 'OPENING']);
    expect(() => adjustStock(ctx, StockAdjustSchema.parse({ batchId: batch.id, direction: 'OUT', reason: 'LOST', quantity: 100 }))).toThrow(/Cannot remove/);
    expect(integrityCheck(ctx).mismatches).toHaveLength(0);
  });

  it('never hides expired stock in the expiry report and buckets batches', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx);
    receive(ctx, s.id, [
      { productId: p.id, batchNumber: 'SOON', expiryDate: '2026-10-15', quantity: 10, costPrice: 8000, salePrice: 10000 },
      { productId: p.id, batchNumber: 'LATE', expiryDate: '2027-12-31', quantity: 10, costPrice: 8000, salePrice: 10000 },
    ]);
    // time passes: SOON expires
    env.clock.now = new Date('2026-10-20T10:00:00+05:00');
    const rep = expiryReport(ctx, ExpiryQuerySchema.parse({}));
    const expired = rep.summary.find((b) => b.bucket === 'EXPIRED')!;
    expect(expired.batches).toBe(1);
    expect(expired.quantity).toBe(10);
    expect(rep.rows.find((r) => r.batchNumber === 'SOON')?.bucket).toBe('EXPIRED');
  });

  it('flags products needing reorder', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx, { minStock: 20, reorderLevel: 40, maxStock: 200 });
    const s = makeSupplier(ctx);
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'R', expiryDate: '2027-12-31', quantity: 30, costPrice: 8000, salePrice: 10000 }]);
    const rows = reorderReport(ctx, ReorderQuerySchema.parse({}));
    const row = rows.find((r) => r.productId === p.id)!;
    expect(row.status).toBe('REORDER');
    expect(row.suggestedPacks).toBe(17);
    expect(row.lastSupplierName).toBe('Sample Distributors');
  });
});
