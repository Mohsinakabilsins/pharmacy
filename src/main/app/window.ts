import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { guardNavigation } from './security';

export function createMainWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: Math.min(1600, Math.max(1280, Math.round(width * 0.92))),
    height: Math.min(1000, Math.max(760, Math.round(height * 0.92))),
    minWidth: 1180,
    minHeight: 700,
    show: false,
    title: 'PharmaDesk',
    backgroundColor: dark ? '#0b0f14' : '#f6f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#9aa4b2' : '#475569', height: 44 },
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  guardNavigation(win);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

export function applyTitleBarTheme(win: BrowserWindow, theme: 'light' | 'dark'): void {
  try {
    win.setTitleBarOverlay({ color: '#00000000', symbolColor: theme === 'dark' ? '#9aa4b2' : '#475569', height: 44 });
  } catch {
    /* not supported on this platform */
  }
  win.setBackgroundColor(theme === 'dark' ? '#0b0f14' : '#f6f7f9');
}
