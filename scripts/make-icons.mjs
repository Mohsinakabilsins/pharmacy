/**
 * Renders build/icon.svg to the PNG/ICO files used by the window and the Windows installer.
 * ICO entries embed PNG data (supported since Windows Vista).
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8');
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath });

async function render(size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

writeFileSync(join(root, 'build', 'icon.png'), await render(512));
writeFileSync(join(root, 'resources', 'icon.png'), await render(256));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const s of sizes) images.push(await render(s));
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e);
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2);
  dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, dir, ...images]));
console.log('Icons written: build/icon.png, build/icon.ico, resources/icon.png');
