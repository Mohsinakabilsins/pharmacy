import { app, session, shell, type BrowserWindow } from 'electron';

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

function isDevServer(url: string): boolean {
  if (!DEV_URL) return false;
  try {
    return new URL(url).origin === new URL(DEV_URL).origin;
  } catch {
    return false;
  }
}

/**
 * Session-wide hardening: deny all permission requests and block every network request that
 * is not the local dev server. The app is offline-first by design; nothing should reach out.
 */
export function hardenSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const allowed = isDevServer(details.url) || details.url.startsWith('devtools://');
    if (!allowed) console.warn(`[security] blocked outbound request: ${details.url}`);
    callback({ cancel: !allowed });
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      // Only allow opening local help/documentation in the system browser if explicitly https and user-initiated
      if (url.startsWith('mailto:')) shell.openExternal(url).catch(() => undefined);
      return { action: 'deny' };
    });
  });
}

export function guardNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current && !isDevServer(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isDevServer(url) && !url.startsWith('file://')) event.preventDefault();
  });
}
