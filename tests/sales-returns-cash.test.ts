import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers';
import { makeCustomer, makeProduct, makeSupplier, openShift, receive, sell } from './fixtures';
import { productBatches, integrityCheck } from '@main/modules/inventory/inventory.service';
import { getSale, voidSale, buildQuote, completeSale, holdBill, listHeldBills, resumeHeldBill } from '@main/modules/sales/sales.service';
import { createReturn } from '@main/modules/sales/returns.service';
import { closeCashSession, currentCashSession, addCashAdjustment } from '@main/modules/finance/cash.service';
import { createExpense } from '@main/modules/finance/expenses.service';
import { createCustomerPayment } from '@main/modules/finance/payments.service';
import { getCustomer } from '@main/modules/customers/customers.service';
import { authorizeOverride, loadSessionUser } from '@main/modules/auth/auth.service';
import { createUser } from '@main/modules/auth/users.service';
import { updateSettingsSection } from '@main/core/settings';
import { overrides } from '@main/core/overrides';
import { ReturnCreateSchema, SaleCompleteSchema } from '@shared/schemas/sales';
import { UserCreateSchema } from '@shared/schemas/auth';

let env: TestEnv;
afterEach(() => env?.cleanup());

function setup() {
  env = createTestEnv();
  const { ctx } = env;
  const p = makeProduct(ctx); // pack of 10, Rs 100 / strip
  const s = makeSupplier(ctx);
  receive(ctx, s.id, [
    { productId: p.id, batchNumber: 'LATE', expiryDate: '2027-12-31', quantity: 50, costPrice: 8000, salePrice: 11000 },
    { productId: p.id, batchNumber: 'EARLY', expiryDate: '2027-01-31', quantity: 20, costPrice: 7000, salePrice: 10000 },
  ]);
  openShift(ctx, 100000);
  return { ctx, p, s };
}

describe('POS sale', () => {
  it('deducts stock FEFO across batches, records items per batch, COGS and payments', () => {
    const { ctx, p } = setup();
    const { quote, result } = sell(ctx, [{ productId: p.id, quantity: 25 }], { tendered: 50000 });
    // 20 units from EARLY @ Rs100/strip = 20000, 5 units from LATE @ Rs110/strip = 5500
    expect(quote.lines[0].allocations.map((a) => [a.batchNumber, a.quantity])).toEqual([
      ['EARLY', 20],
      ['LATE', 5],
    ]);
    expect(result.total).toBe(25500);
    expect(result.changeDue).toBe(50000 - 25500);
    const sale = getSale(ctx, result.saleId);
    expect(sale.items).toHaveLength(2);
    expect(sale.costTotal).toBe(14000 + 4000);
    expect(sale.payments).toEqual([{ method: 'CASH', amount: 25500, reference: null }]);
    const batches = productBatches(ctx, p.id, true);
    expect(batches.find((b) => b.batchNumber === 'EARLY')!.quantityOnHand).toBe(0);
    expect(batches.find((b) => b.batchNumber === 'LATE')!.quantityOnHand).toBe(45);
    expect(integrityCheck(ctx).mismatches).toHaveLength(0);
  });

  it('rolls back completely when stock is insufficient', () => {
    const { ctx, p } = setup();
    expect(() => sell(ctx, [{ productId: p.id, quantity: 500 }])).toThrow();
    expect(productBatches(ctx, p.id).reduce((s, b) => s + b.quantityOnHand, 0)).toBe(70);
    const count = env.handle.sqlite.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('rejects the sale when the total changed after the quote', () => {
    const { ctx, p } = setup();
    const draft = { lines: [{ key: 'a', productId: p.id, quantity: 10 }], overrideTokens: [] };
    const q = buildQuote(ctx, SaleCompleteSchema.parse({ ...draft, payments: [{ method: 'CASH', amount: 0 }], expectedTotal: 0 })).quote;
    const input = SaleCompleteSchema.parse({ ...draft, payments: [{ method: 'CASH', amount: q.total + 100 }], cashTendered: q.total + 100, expectedTotal: q.total + 100 });
    expect(() => completeSale(ctx, input)).toThrow(/changed/);
  });

  it('requires an open shift', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    receive(ctx, makeSupplier(ctx).id, [{ productId: p.id, batchNumber: 'A', expiryDate: '2027-12-31', quantity: 10, costPrice: 1, salePrice: 2 }]);
    expect(() => sell(ctx, [{ productId: p.id, quantity: 1 }])).toThrow(/shift/i);
  });

  it('blocks expired batches unless a supervisor authorises, and audits the override', () => {
    const { ctx, p, s } = setup();
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'OLDIE', expiryDate: '2026-10-05', quantity: 10, costPrice: 5000, salePrice: 9000 }]);
    env.clock.now = new Date('2026-10-10T10:00:00+05:00'); // OLDIE is now expired
    const batchId = productBatches(ctx, p.id).find((b) => b.batchNumber === 'OLDIE')!.id;
    expect(() => sell(ctx, [{ productId: p.id, quantity: 2, batchId }])).toThrow(/authorisation/i);
    authorizeOverride(ctx, 'admin', 'admin123', 'sales.sell_expired', 'Customer insisted');
    const grant = overrides.issue('sales.sell_expired', 1, 'Administrator', 'test');
    const { result } = sell(ctx, [{ productId: p.id, quantity: 2, batchId }], { overrideTokens: [grant.token] });
    const sale = getSale(ctx, result.saleId);
    expect(sale.items[0].expiredOverride).toBe(true);
    const log = env.handle.sqlite.prepare("SELECT severity FROM audit_logs WHERE action = 'EXPIRED_STOCK_OVERRIDE'").get() as { severity: string };
    expect(log.severity).toBe('CRITICAL');
    // token is single use
    expect(() => sell(ctx, [{ productId: p.id, quantity: 1, batchId }], { overrideTokens: [grant.token] })).toThrow();
  });

  it('enforces discount permission limits for cashiers', () => {
    const { ctx, p } = setup();
    const cashierRole = env.handle.sqlite.prepare("SELECT id FROM roles WHERE name = 'Cashier'").get() as { id: number };
    const u = createUser(ctx, UserCreateSchema.parse({ username: 'cash1', fullName: 'Cashier One', roleId: cashierRole.id, password: 'cashier123' }));
    const cashier = env.as(loadSessionUser(ctx, u.id));
    // 5% within the default 10% limit
    expect(sell(cashier, [{ productId: p.id, quantity: 10, discount: { type: 'PERCENT', value: 500 } }]).result.total).toBe(9500);
    // 20% requires supervisor
    expect(() => sell(cashier, [{ productId: p.id, quantity: 10, discount: { type: 'PERCENT', value: 2000 } }])).toThrow(/authorisation/i);
    const grant = overrides.issue('sales.discount_unlimited', 1, 'Administrator', 'loyal customer');
    expect(sell(cashier, [{ productId: p.id, quantity: 10, discount: { type: 'PERCENT', value: 2000 } }], { overrideTokens: [grant.token] }).result.total).toBe(8000);
  });

  it('credit sales update the customer ledger and receipts reduce it', () => {
    const { ctx, p } = setup();
    const c = makeCustomer(ctx, 'Credit Customer', 1000000);
    const { result } = sell(ctx, [{ productId: p.id, quantity: 10 }], { customerId: c.id, credit: 4000 });
    expect(result.creditAmount).toBe(4000);
    expect(getCustomer(ctx, c.id).balance).toBe(4000);
    createCustomerPayment(ctx, { customerId: c.id, amount: 1500, method: 'CASH', reference: null, paymentDate: '2026-09-27', notes: null });
    expect(getCustomer(ctx, c.id).balance).toBe(2500);
    expect(() => createCustomerPayment(ctx, { customerId: c.id, amount: 999999, method: 'CASH', reference: null, paymentDate: '2026-09-27', notes: null })).toThrow(/exceeds/);
  });

  it('holds and resumes bills', () => {
    const { ctx, p } = setup();
    holdBill(ctx, { label: 'Mr Khan', customerId: null, draft: { lines: [{ key: 'a', productId: p.id, quantity: 3 }], overrideTokens: [] }, totalEstimate: 3000 });
    const held = listHeldBills(ctx);
    expect(held).toHaveLength(1);
    const draft = resumeHeldBill(ctx, held[0].id);
    expect(draft.lines[0].quantity).toBe(3);
    expect(listHeldBills(ctx)).toHaveLength(0);
  });

  it('voids a sale in the open shift, restoring stock to the same batches', () => {
    const { ctx, p } = setup();
    const { result } = sell(ctx, [{ productId: p.id, quantity: 25 }]);
    const voided = voidSale(ctx, result.saleId, 'Wrong customer');
    expect(voided.status).toBe('VOID');
    expect(productBatches(ctx, p.id).reduce((s, b) => s + b.quantityOnHand, 0)).toBe(70);
    expect(currentCashSession(ctx)!.summary.expectedCash).toBe(100000);
    expect(() => env.handle.sqlite.prepare('DELETE FROM sales').run()).toThrow(/PROTECTED_RECORD/);
  });
});

describe('returns', () => {
  it('partial returns prorate exactly, restock the original batch and cannot exceed sold quantity', () => {
    const { ctx, p } = setup();
    const { result } = sell(ctx, [{ productId: p.id, quantity: 3, discount: { type: 'AMOUNT', value: 1000 } }]);
    // 3 tablets @ Rs100/strip of 10 = 3000 − 1000 discount = 2000
    expect(result.total).toBe(2000);
    const sale = getSale(ctx, result.saleId);
    const itemId = sale.items[0].id;
    const r1 = createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH', reason: 'Not needed' }));
    const r2 = createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH', reason: 'Not needed' }));
    const r3 = createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH', reason: 'Not needed' }));
    expect([r1.total, r2.total, r3.total]).toEqual([667, 666, 667]);
    expect(r1.total + r2.total + r3.total).toBe(2000);
    expect(() => createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH', reason: 'x' }))).toThrow(/only 0/);
    expect(productBatches(ctx, p.id).find((b) => b.batchNumber === 'EARLY')!.quantityOnHand).toBe(20);
    expect(integrityCheck(ctx).mismatches).toHaveLength(0);
  });

  it('disposed returns are written off and credit refunds reduce customer balance', () => {
    const { ctx, p } = setup();
    const c = makeCustomer(ctx, 'Acc Customer', 1000000);
    const { result } = sell(ctx, [{ productId: p.id, quantity: 10 }], { customerId: c.id, credit: 10000 });
    const sale = getSale(ctx, result.saleId);
    createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 5, restock: false }], refundMethod: 'CUSTOMER_ACCOUNT', reason: 'Damaged packaging' }));
    expect(getCustomer(ctx, c.id).balance).toBe(5000);
    expect(productBatches(ctx, p.id).find((b) => b.batchNumber === 'EARLY')!.quantityOnHand).toBe(10);
    const types = env.handle.sqlite.prepare("SELECT movement_type FROM stock_movements WHERE reference_type = 'sale_return' ORDER BY id").all() as { movement_type: string }[];
    expect(types.map((t) => t.movement_type)).toEqual(['SALE_RETURN', 'WRITE_OFF']);
  });

  it('refunds the round-off when the whole invoice is returned', () => {
    const { ctx, s } = setup();
    updateSettingsSection(ctx, 'sales', { roundingStep: 1000 });
    const syrup = makeProduct(ctx, { brandName: 'Brufen', packSize: 1, unitName: 'Bottle', packName: 'Bottle' });
    receive(ctx, s.id, [{ productId: syrup.id, batchNumber: 'BR', expiryDate: '2027-12-31', quantity: 10, costPrice: 20000, salePrice: 23550 }]);
    const { result } = sell(ctx, [{ productId: syrup.id, quantity: 1 }]); // Rs 235.50 → Rs 240 with a Rs 10 step
    expect(result.total).toBe(24000);
    const sale = getSale(ctx, result.saleId);
    expect(sale.roundOff).toBe(450);
    const ret = createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: 'CASH', reason: 'Changed mind' }));
    expect(ret.total).toBe(24000);
  });
});

describe('cash management', () => {
  it('computes expected cash from sales, refunds, expenses, payments and adjustments; closes with variance', () => {
    const { ctx, p } = setup(); // opening 1000.00
    const { result } = sell(ctx, [{ productId: p.id, quantity: 20 }], { tendered: 50000 }); // 20000 cash, change 30000
    const sale = getSale(ctx, result.saleId);
    createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 5 }], refundMethod: 'CASH', reason: 'x' })); // −5000
    createExpense(ctx, { expenseDate: '2026-09-27', categoryId: 1, amount: 3000, description: 'Tea', paymentMethod: 'CASH', reference: null }); // −3000
    addCashAdjustment(ctx, { direction: 'IN', amount: 10000, reason: 'Float top-up' }); // +10000
    addCashAdjustment(ctx, { direction: 'OUT', amount: 2000, reason: 'Owner withdrawal' }); // −2000
    const current = currentCashSession(ctx)!;
    expect(current.summary.cashSales).toBe(20000);
    expect(current.summary.cashRefunds).toBe(5000);
    expect(current.summary.expectedCash).toBe(100000 + 20000 - 5000 - 3000 + 10000 - 2000);
    const closed = closeCashSession(ctx, { countedCash: 119500, denominations: { '1000': 1 }, notes: null });
    expect(closed.status).toBe('CLOSED');
    expect(closed.variance).toBe(119500 - 120000);
    expect(currentCashSession(ctx)).toBeNull();
  });
});
