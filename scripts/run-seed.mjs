/**
 * Loads the fictional sample pharmacy into the local database (only when it is empty).
 * Uses the same Electron main process and services as the app, so the data is fully consistent.
 *
 *   npm run seed:demo            # default user-data folder
 *   PHARMADESK_USER_DATA=/tmp/x npm run seed:demo
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  const build = spawnSync('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const electron = createRequire(import.meta.url)('electron');
const args = [root, '--seed-demo', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
const r = spawnSync(electron, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
process.exit(r.status ?? 1);
