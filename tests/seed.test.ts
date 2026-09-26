import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers';
import { loadDemoData, ean13 } from '@main/db/seed';
import { integrityCheck } from '@main/modules/inventory/inventory.service';
import { listReports, runReport } from '@main/modules/reports/reports.service';
import { dashboard } from '@main/modules/dashboard/dashboard.service';
import { ReportParamsSchema } from '@shared/schemas/reports';

let env: TestEnv;
afterEach(() => env?.cleanup());

describe('demo data', () => {
  it('generates valid EAN-13 barcodes', () => {
    expect(ean13('400638133393')).toBe('4006381333931');
  });

  it('loads a consistent sample dataset through the real services', () => {
    env = createTestEnv({ now: '2026-09-27T16:00:00+05:00' });
    const res = loadDemoData(env.ctx, { days: 12 });
    expect(res.loaded).toBe(true);
    const n = (sql: string) => (env.handle.sqlite.prepare(sql).get() as { n: number }).n;
    expect(n('SELECT COUNT(*) AS n FROM products')).toBeGreaterThan(50);
    expect(n("SELECT COUNT(*) AS n FROM sales WHERE status = 'COMPLETED'")).toBeGreaterThan(100);
    expect(n("SELECT COUNT(*) AS n FROM batches WHERE expiry_date <= '2026-09-27' AND quantity_on_hand > 0")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) AS n FROM cash_sessions WHERE status = 'OPEN'")).toBe(1);
    expect(integrityCheck(env.ctx).mismatches).toHaveLength(0);
    for (const def of listReports(env.ctx)) {
      expect(() => runReport(env.ctx, def.id, ReportParamsSchema.parse({ from: '2026-09-01', to: '2026-09-27' }))).not.toThrow();
    }
    const d = dashboard(env.ctx);
    expect(d.kpis.productCount).toBeGreaterThan(50);
    expect(d.salesTrend).toHaveLength(30);
    expect(loadDemoData(env.ctx).loaded).toBe(false);
  }, 60_000);
});
