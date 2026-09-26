import { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type PaperKind = '58mm' | '80mm' | 'A4' | 'A4-landscape' | 'label';

async function withDocument<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'pharmadesk-print-'));
  const file = join(dir, 'document.html');
  writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, offscreen: false },
  });
  try {
    await win.loadFile(file);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function contentHeightMm(win: BrowserWindow): Promise<number> {
  const px = (await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) as number;
  return Math.ceil((px * 25.4) / 96) + 6;
}

/** Print HTML on a named printer (or the system default). */
export async function printHtml(html: string, opts: { paper: PaperKind; deviceName?: string; silent?: boolean; copies?: number }): Promise<boolean> {
  return withDocument(html, async (win) => {
    let pageSize: Electron.WebContentsPrintOptions['pageSize'] = 'A4';
    if (opts.paper === '58mm' || opts.paper === '80mm') {
      const width = opts.paper === '58mm' ? 58_000 : 80_000;
      const heightMm = Math.max(80, await contentHeightMm(win));
      pageSize = { width, height: heightMm * 1000 };
    }
    return new Promise<boolean>((resolve, reject) => {
      win.webContents.print(
        {
          silent: !!opts.silent,
          deviceName: opts.deviceName || undefined,
          printBackground: true,
          copies: opts.copies ?? 1,
          margins: { marginType: opts.paper === '58mm' || opts.paper === '80mm' || opts.paper === 'label' ? 'none' : 'default' },
          landscape: opts.paper === 'A4-landscape',
          pageSize,
        },
        (success, failureReason) => {
          if (success) resolve(true);
          else if (failureReason === 'cancelled' || failureReason === 'Print job canceled') resolve(false);
          else reject(new Error(failureReason || 'Printing failed'));
        },
      );
    });
  });
}

/** Render HTML to a PDF buffer, honouring CSS @page sizes. */
export async function htmlToPdf(html: string, opts: { paper: PaperKind }): Promise<Buffer> {
  return withDocument(html, async (win) => {
    const thermal = opts.paper === '58mm' || opts.paper === '80mm';
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: opts.paper === 'A4-landscape',
      pageSize: thermal ? { width: opts.paper === '58mm' ? 2.28 : 3.15, height: Math.max(3.2, (await contentHeightMm(win)) / 25.4) } : 'A4',
      margins: thermal ? { top: 0, bottom: 0, left: 0, right: 0 } : undefined,
    });
    return Buffer.from(data);
  });
}
