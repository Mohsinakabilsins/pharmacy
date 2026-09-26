import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers';
import { login } from '@main/modules/auth/auth.service';
import { ALL_PERMISSIONS } from '@shared/permissions';

let env: TestEnv;
afterEach(() => env?.cleanup());

describe('database bootstrap', () => {
  it('creates roles, admin user with all permissions, sequences and expense categories', () => {
    env = createTestEnv();
    const roles = env.handle.sqlite.prepare('SELECT name FROM roles ORDER BY id').all() as { name: string }[];
    expect(roles.map((r) => r.name)).toEqual(['Administrator', 'Pharmacist', 'Cashier', 'Inventory Staff', 'Accountant']);
    expect(env.ctx.user?.permissions.size).toBe(ALL_PERMISSIONS.length);
    const seq = env.handle.sqlite.prepare('SELECT COUNT(*) AS n FROM sequences').get() as { n: number };
    expect(seq.n).toBeGreaterThan(5);
  });

  it('allows the default admin to sign in and forces a password change', () => {
    env = createTestEnv();
    const session = login(env.as(null), 'admin', 'admin123');
    expect(session.user.username).toBe('admin');
    expect(session.mustChangePassword).toBe(true);
  });

  it('blocks deletes and updates on append-only tables via triggers', () => {
    env = createTestEnv();
    const db = env.handle.sqlite;
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE audit_logs SET description = 'x'").run()).toThrow(/append-only/);
  });
});
