import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestEnv, MIGRATIONS, type TestEnv } from './helpers';
import { makeProduct, makeSupplier, openShift, receive, sell } from './fixtures';
import { financialMetrics } from '@main/modules/reports/financials';
import { runReport, listReports } from '@main/modules/reports/reports.service';
import { dashboard } from '@main/modules/dashboard/dashboard.service';
import { createExpense } from '@main/modules/finance/expenses.service';
import { createReturn } from '@main/modules/sales/returns.service';
import { getSale } from '@main/modules/sales/sales.service';
import { adjustStock, productBatches } from '@main/modules/inventory/inventory.service';
import { backupFileName, createBackup, inspectBackupFile, swapDatabaseFile, uniqueBackupPath } from '@main/modules/backup/backup.service';
import { changePassword, login, loadSessionUser } from '@main/modules/auth/auth.service';
import { createUser, saveRole, updateUser, listRoles } from '@main/modules/auth/users.service';
import { closeDatabase, openDatabase } from '@main/core/db';
import { bootstrapDatabase } from '@main/db/bootstrap';
import { ReturnCreateSchema } from '@shared/schemas/sales';
import { StockAdjustSchema } from '@shared/schemas/inventory';
import { UserCreateSchema } from '@shared/schemas/auth';
import { ReportParamsSchema } from '@shared/schemas/reports';

let env: TestEnv;
afterEach(() => env?.cleanup());

describe('profit and financial reports', () => {
  it('computes revenue, COGS from batch cost, returns, losses and net result', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx); // pack 10
    const s = makeSupplier(ctx);
    receive(ctx, s.id, [
      { productId: p.id, batchNumber: 'A', expiryDate: '2027-01-31', quantity: 20, costPrice: 6000, salePrice: 10000 },
      { productId: p.id, batchNumber: 'B', expiryDate: '2027-12-31', quantity: 50, costPrice: 8000, salePrice: 10000 },
    ]);
    openShift(ctx);
    const { result } = sell(ctx, [{ productId: p.id, quantity: 30 }]); // 20 from A (cost 12000) + 10 from B (cost 8000); revenue 30000
    const sale = getSale(ctx, result.saleId);
    const itemB = sale.items.find((i) => i.batchNumber === 'B')!;
    createReturn(ctx, ReturnCreateSchema.parse({ saleId: sale.id, items: [{ saleItemId: itemB.id, quantity: 5 }], refundMethod: 'CASH', reason: 'x' })); // −5000 revenue, −4000 COGS
    createExpense(ctx, { expenseDate: '2026-09-27', categoryId: 1, amount: 2500, description: 'Rent share', paymentMethod: 'CASH', reference: null });
    const batchB = productBatches(ctx, p.id).find((b) => b.batchNumber === 'B')!;
    adjustStock(ctx, StockAdjustSchema.parse({ batchId: batchB.id, direction: 'OUT', reason: 'DAMAGED', quantity: 10 })); // loss 8000

    const m = financialMetrics(ctx, '2026-09-27', '2026-09-27');
    expect(m.grossSales).toBe(30000);
    expect(m.netSales).toBe(30000);
    expect(m.returns).toBe(5000);
    expect(m.revenue).toBe(25000);
    expect(m.cogsSold).toBe(20000);
    expect(m.cogsReturned).toBe(4000);
    expect(m.cogs).toBe(16000);
    expect(m.grossProfit).toBe(9000);
    expect(m.inventoryLosses).toBe(8000);
    expect(m.expenses).toBe(2500);
    expect(m.netOperatingResult).toBe(9000 - 8000 - 2500);

    const pl = runReport(ctx, 'profit-loss', ReportParamsSchema.parse({ from: '2026-09-27', to: '2026-09-27' }));
    expect(pl.statement?.find((l) => l.label === 'Gross profit')?.value).toBe(9000);
    expect(pl.statement?.at(-1)?.value).toBe(-1500);
  });

  it('runs every report without error and hides cost from users without permission', () => {
    env = createTestEnv();
    const { ctx } = env;
    const p = makeProduct(ctx);
    const s = makeSupplier(ctx);
    receive(ctx, s.id, [{ productId: p.id, batchNumber: 'A', expiryDate: '2027-01-31', quantity: 100, costPrice: 6000, salePrice: 10000 }], { paid: 1000 });
    openShift(ctx);
    sell(ctx, [{ productId: p.id, quantity: 12 }]);
    for (const def of listReports(ctx)) {
      const res = runReport(ctx, def.id, ReportParamsSchema.parse({ from: '2026-09-01', to: '2026-09-30' }));
      expect(res.title).toBe(def.title);
      expect(Array.isArray(res.rows)).toBe(true);
    }
    const role = env.handle.sqlite.prepare("SELECT id FROM roles WHERE name = 'Pharmacist'").get() as { id: number };
    const u = createUser(ctx, UserCreateSchema.parse({ username: 'pharm', fullName: 'Pharm One', roleId: role.id, password: 'pharma123' }));
    const pharm = env.as(loadSessionUser(ctx, u.id));
    const summary = runReport(pharm, 'sales-summary', ReportParamsSchema.parse({ from: '2026-09-01', to: '2026-09-30' }));
    expect(summary.columns.find((c) => c.key === 'grossProfit')).toBeUndefined();
    expect(() => runReport(pharm, 'profit-loss', ReportParamsSchema.parse({}))).toThrow(/permission/);
    const d = dashboard(pharm);
    expect(d.kpis.grossProfitToday).toBeNull();
    expect(d.kpis.salesToday).toBe(12000);
  });
});

describe('backup and restore', () => {
  it('creates timestamped backups that never overwrite and restores data', async () => {
    env = createTestEnv();
    const { ctx } = env;
    expect(backupFileName(new Date(2026, 8, 27, 23, 55, 0))).toBe('PharmacyBackup_2026-09-27_235500.db');
    const dir = join(env.dir, 'usb');
    const b1 = await createBackup(ctx, dir, 'MANUAL');
    const b2 = await createBackup(ctx, dir, 'MANUAL'); // same second → suffix
    expect(b1.filePath).not.toBe(b2.filePath);
    expect(existsSync(b1.filePath) && existsSync(b2.filePath)).toBe(true);
    expect(b1.integrity).toBe('ok');
    expect(uniqueBackupPath(dir, b1.fileName)).not.toBe(b1.filePath);

    // add data after the backup, then restore the backup
    makeProduct(ctx, { brandName: 'After Backup' });
    const count = () => (env.handle.sqlite.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
    expect(count()).toBe(1);
    const info = inspectBackupFile(b1.filePath, 99);
    expect(info.compatible).toBe(true);
    expect(info.counts.products).toBe(0);

    const dbPath = env.handle.file;
    closeDatabase(env.handle);
    swapDatabaseFile(b1.filePath, dbPath);
    const reopened = openDatabase(dbPath, MIGRATIONS);
    bootstrapDatabase(reopened.sqlite);
    env.handle = reopened;
    expect(count()).toBe(0);
  });

  it('rejects files that are not PharmaDesk databases', () => {
    env = createTestEnv();
    const junk = join(env.dir, 'junk.db');
    writeFileSync(junk, 'hello world');
    expect(inspectBackupFile(junk, 10).problem).toMatch(/not a database/);
    expect(inspectBackupFile(join(env.dir, 'missing.db'), 10).problem).toMatch(/not found/);
  });

  it('reports a failed backup clearly', async () => {
    env = createTestEnv();
    await expect(createBackup(env.ctx, '', 'MANUAL')).rejects.toThrow(/Backup failed/);
    const log = env.handle.sqlite.prepare("SELECT status FROM backup_logs ORDER BY id DESC LIMIT 1").get() as { status: string };
    expect(log.status).toBe('FAILED');
  });
});

describe('authentication and permissions', () => {
  it('locks an account after repeated failures and records it', () => {
    env = createTestEnv();
    const anon = env.as(null);
    for (let i = 0; i < 4; i++) expect(() => login(anon, 'admin', 'wrong')).toThrow(/Incorrect/);
    expect(() => login(anon, 'admin', 'wrong')).toThrow(/locked/);
    expect(() => login(anon, 'admin', 'admin123')).toThrow(/locked/);
    env.clock.now = new Date(env.clock.now.getTime() + 16 * 60_000);
    expect(login(anon, 'admin', 'admin123').user.username).toBe('admin');
    const n = (env.handle.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'LOGIN_FAILED'").get() as { n: number }).n;
    expect(n).toBe(5);
  });

  it('enforces the password policy and stores only hashes', () => {
    env = createTestEnv();
    expect(() => changePassword(env.ctx, 'admin123', 'short')).toThrow(/at least/);
    expect(() => changePassword(env.ctx, 'admin123', 'onlyletters')).toThrow(/letters and numbers/);
    changePassword(env.ctx, 'admin123', 'NewSecure2026');
    const row = env.handle.sqlite.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as { password_hash: string };
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('NewSecure2026');
  });

  it('keeps the Administrator role complete and at least one admin active', () => {
    env = createTestEnv();
    const admin = listRoles(env.ctx).find((r) => r.isSystem)!;
    const saved = saveRole(env.ctx, { id: admin.id, name: admin.name, description: null, permissions: ['pos.access'] });
    expect(saved.permissions.length).toBeGreaterThan(40);
    expect(() => updateUser(env.ctx, { id: 1, fullName: 'Administrator', phone: null, roleId: 2, isActive: true })).toThrow(/At least one active administrator/);
  });

  it('custom roles restrict access to services', () => {
    env = createTestEnv();
    const role = saveRole(env.ctx, { name: 'Viewer', description: null, permissions: ['products.view'] });
    const u = createUser(env.ctx, UserCreateSchema.parse({ username: 'viewer', fullName: 'Viewer', roleId: role.id, password: 'viewer123' }));
    const viewer = env.as(loadSessionUser(env.ctx, u.id));
    expect(() => makeProduct(viewer)).toThrow(/permission/);
    expect(() => runReport(viewer, 'sales-summary', ReportParamsSchema.parse({}))).toThrow(/permission/);
  });
});
