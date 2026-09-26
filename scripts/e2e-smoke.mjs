/**
 * End-to-end smoke test: launches the built Electron app with a fresh data folder, signs in,
 * changes the default password, loads sample data, completes a real sale through the POS UI
 * and visits every screen — with ALL outbound network access blocked by the app itself.
 * Screenshots are written to ./test-results/screens.
 *
 *   npm run build && node scripts/e2e-smoke.mjs [--screens]
 */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shots = process.argv.includes('--screens');
const outDir = join(root, 'test-results', 'screens');
mkdirSync(outDir, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'pharmadesk-e2e-'));
const theme = process.argv.includes('--dark') ? 'dark' : 'light';

const app = await electron.launch({
  args: [root, '--no-sandbox'],
  env: { ...process.env, PHARMADESK_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const failures = [];
const blocked = [];
try {
  const page = await app.firstWindow();
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onCompleted({ urls: ['https://*/*', 'http://*/*'] }, () => undefined);
  });
  await page.setViewportSize({ width: 1500, height: 920 });
  await page.evaluate((t) => localStorage.setItem('pharmadesk.prefs', JSON.stringify({ state: { theme: t, sidebarCollapsed: false, density: 'comfortable' }, version: 0 })), theme);
  await page.reload();
  const snap = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(outDir, `${theme}-${name}.png`) });
  };

  // offline guarantee: the renderer must not be able to reach the internet
  const netResult = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' });
      return 'reached';
    } catch {
      return 'blocked';
    }
  });
  if (netResult !== 'blocked') failures.push('Outbound network request was not blocked');
  else blocked.push('https://example.com');

  await page.getByLabel('Username').fill('admin');
  await snap('01-login');
  await page.getByLabel('Password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Choose a new password').waitFor();
  await snap('02-change-password');
  await page.getByLabel('Current password').fill('admin123');
  await page.getByLabel('New password', { exact: true }).fill('Admin2026!');
  await page.getByLabel('Confirm new password').fill('Admin2026!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.waitForTimeout(500);

  const demo = await page.evaluate(() => window.pharmacy.invoke('demo.load'));
  if (!demo.ok || !demo.data.loaded) failures.push(`demo load failed: ${JSON.stringify(demo)}`);
  await page.reload();
  await page.waitForTimeout(1200);
  await snap('03-dashboard');

  // POS: sell a product through the UI
  await page.keyboard.press('F2');
  await page.waitForURL(/#\/pos/);
  await page.getByPlaceholder(/Scan a barcode/).fill('calmol');
  await page.waitForTimeout(500);
  await snap('04-pos-search');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder(/Scan a barcode/).fill('cetrizem');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await snap('05-pos-cart');
  await page.keyboard.press('F9');
  await page.getByText('Take payment').waitFor();
  await snap('06-pos-payment');
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await page.getByText('Sale completed').waitFor({ timeout: 10000 });
  await snap('07-pos-complete');
  await page.keyboard.press('Escape');

  const routes = ['sales', 'returns', 'customers', 'prescriptions', 'products', 'stock', 'expiry', 'reorder', 'purchases', 'purchases/new', 'suppliers', 'cash', 'expenses', 'payments', 'reports', 'users', 'audit', 'backup', 'settings'];
  let i = 8;
  for (const r of routes) {
    await page.evaluate((h) => (window.location.hash = `#/${h}`), r);
    await page.waitForTimeout(900);
    await snap(`${String(i++).padStart(2, '0')}-${r.replace('/', '-')}`);
  }
  const session = await page.evaluate(() => window.pharmacy.invoke('auth.session'));
  if (!session.ok || !session.data) failures.push('session lost during navigation');
} catch (err) {
  failures.push(`exception: ${err.stack || err.message}`);
} finally {
  await app.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
}

const relevant = failures.filter((f) => !/Autofill|DevTools|Electron Security|Content Security Policy/.test(f));
if (relevant.length) {
  console.error('E2E smoke test FAILED:\n' + relevant.join('\n'));
  process.exit(1);
}
console.log(`E2E smoke test passed (offline: outbound requests blocked ${blocked.length ? '✓' : '?'})${shots ? ` — screenshots in ${outDir}` : ''}`);
