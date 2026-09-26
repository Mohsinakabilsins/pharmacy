import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, closeDatabase, type DatabaseHandle } from '@main/core/db';
import { bootstrapDatabase } from '@main/db/bootstrap';
import { loadSessionUser } from '@main/modules/auth/auth.service';
import type { ServiceContext, SessionUser } from '@main/core/context';

export const MIGRATIONS = resolve(__dirname, '../drizzle');

export interface TestEnv {
  handle: DatabaseHandle;
  dir: string;
  ctx: ServiceContext;
  clock: { now: Date };
  as: (user: SessionUser | null) => ServiceContext;
  cleanup: () => void;
}

/** Fresh migrated + bootstrapped database in a temp folder, signed in as the default admin. */
export function createTestEnv(opts: { now?: string } = {}): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'pharmadesk-test-'));
  const handle = openDatabase(join(dir, 'test.db'), MIGRATIONS);
  bootstrapDatabase(handle.sqlite);
  const clock = { now: new Date(opts.now ?? '2026-09-27T10:00:00+05:00') };
  const base = { db: handle.db, sqlite: handle.sqlite, now: () => clock.now, user: null as SessionUser | null };
  const admin = loadSessionUser(base, 1)!;
  const ctx: ServiceContext = { ...base, user: admin };
  return {
    handle,
    dir,
    ctx,
    clock,
    as: (user) => ({ ...base, user }),
    cleanup: () => {
      closeDatabase(handle);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
