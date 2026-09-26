import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers';
import { Router } from '@main/core/router';
import { SessionManager } from '@main/core/session';
import { createHandlers, type MainEnv } from '@main/ipc/handlers';
import { CHANNELS } from '@shared/contract';
import { createUser } from '@main/modules/auth/users.service';
import { UserCreateSchema } from '@shared/schemas/auth';

let env: TestEnv;
afterEach(() => env?.cleanup());

function makeRouter(test: TestEnv) {
  const sessions = new SessionManager();
  const mainEnv = {
    sessions,
    version: 'test',
    productName: 'PharmaDesk',
    packaged: false,
    dataDir: test.dir,
    dbPath: () => test.handle.file,
    migrationCount: () => 2,
    defaultBackupDir: test.dir,
    versions: { electron: '-', node: process.versions.node, sqlite: '' },
    dialogs: { chooseDirectory: async () => null, pickBackupFile: async () => null, saveFile: async () => null },
    showItemInFolder: () => undefined,
    printers: async () => [],
    print: async () => true,
    pdf: async () => Buffer.from(''),
    restore: async () => undefined,
    emit: () => undefined,
    loadDemo: () => ({ loaded: false, message: '' }),
  } satisfies MainEnv;
  const router = new Router({ database: () => ({ db: test.handle.db, sqlite: test.handle.sqlite }), sessions, now: () => test.clock.now }, createHandlers(mainEnv));
  return { router, sessions };
}

describe('IPC router', () => {
  it('declares an input schema and access rule for every channel', () => {
    for (const [name, def] of Object.entries(CHANNELS)) {
      expect(def.input, name).toBeDefined();
      expect(def.access, name).toBeDefined();
    }
  });

  it('rejects unknown channels and unauthenticated calls', async () => {
    env = createTestEnv();
    const { router } = makeRouter(env);
    expect(await router.dispatch('fs.readFile', {})).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await router.dispatch('products.list', {})).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await router.dispatch('app.bootstrap')).toMatchObject({ ok: true });
  });

  it('forces a password change before other operations and validates input', async () => {
    env = createTestEnv();
    const { router } = makeRouter(env);
    const login = await router.dispatch('auth.login', { username: 'admin', password: 'admin123' });
    expect(login).toMatchObject({ ok: true, data: { mustChangePassword: true } });
    expect(await router.dispatch('dashboard.get')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await router.dispatch('auth.changePassword', { currentPassword: 'admin123', newPassword: 'Stronger2026' })).toMatchObject({ ok: true });
    expect(await router.dispatch('dashboard.get')).toMatchObject({ ok: true });
    const bad = await router.dispatch('products.save', { brandName: '', packSize: 0, unitName: 'Tab', packName: 'Box' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect((bad as { error: { fields: Record<string, string> } }).error.fields.brandName).toMatch(/required/);
  });

  it('enforces role permissions and screen lock', async () => {
    env = createTestEnv();
    const role = env.handle.sqlite.prepare("SELECT id FROM roles WHERE name = 'Cashier'").get() as { id: number };
    createUser(env.ctx, UserCreateSchema.parse({ username: 'cashier', fullName: 'Cashier', roleId: role.id, password: 'cashier123', mustChangePassword: false }));
    const { router, sessions } = makeRouter(env);
    expect(await router.dispatch('auth.login', { username: 'cashier', password: 'cashier123' })).toMatchObject({ ok: true });
    expect(await router.dispatch('users.list')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await router.dispatch('pos.held')).toMatchObject({ ok: true });
    sessions.lock();
    expect(await router.dispatch('pos.held')).toMatchObject({ ok: false, error: { code: 'SESSION_LOCKED' } });
    expect(await router.dispatch('auth.unlock', { password: 'wrong' })).toMatchObject({ ok: false });
    expect(await router.dispatch('auth.unlock', { password: 'cashier123' })).toMatchObject({ ok: true, data: { locked: false } });
    expect(await router.dispatch('pos.held')).toMatchObject({ ok: true });
  });
});
