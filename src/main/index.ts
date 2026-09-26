import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MainEventName, MainEvents } from '@shared/contract';
import { closeDatabase, openDatabase, type DatabaseHandle } from './core/db';
import { SessionManager } from './core/session';
import { Router } from './core/router';
import { audit } from './core/audit';
import type { ServiceContext } from './core/context';
import { getSettings, invalidateSettings } from './core/settings';
import { bootstrapDatabase } from './db/bootstrap';
import { loadDemoData } from './db/seed';
import { createHandlers, type MainEnv } from './ipc/handlers';
import { logout, toSessionInfo } from './modules/auth/auth.service';
import { backupDue, createBackup, pruneAutoBackups, swapDatabaseFile } from './modules/backup/backup.service';
import { htmlToPdf, printHtml } from './printing/printer';
import { hardenSession } from './app/security';
import { applyTitleBarTheme, createMainWindow } from './app/window';

const PRODUCT_NAME = 'PharmaDesk';
app.setName(PRODUCT_NAME);
if (process.env.PHARMADESK_USER_DATA) app.setPath('userData', process.env.PHARMADESK_USER_DATA);
// Native date pickers follow the Chromium locale; day-first dates match Pakistani usage.
app.commandLine.appendSwitch('lang', 'en-GB');

// A single instance only: SQLite must be owned by one process.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const dataDir = join(app.getPath('userData'), 'data');
const dbPath = join(dataDir, 'pharmacy.db');
const migrationsFolder = app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle');
const defaultBackupDir = join(app.getPath('documents'), 'PharmaDesk Backups');

let handle: DatabaseHandle;
let mainWindow: BrowserWindow | null = null;
let quitting = false;
const sessions = new SessionManager();

function migrationCount(): number {
  try {
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    return journal.entries.length;
  } catch {
    return readdirSync(migrationsFolder).filter((f) => f.endsWith('.sql')).length;
  }
}

function systemContext(): ServiceContext {
  return { db: handle.db, sqlite: handle.sqlite, user: sessions.get()?.user ?? null, now: () => new Date() };
}

function emit<E extends MainEventName>(event: E, payload: MainEvents[E]) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pharmacy:event', event, payload);
}

function openDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  handle = openDatabase(dbPath, migrationsFolder);
  bootstrapDatabase(handle.sqlite);
  invalidateSettings(handle.sqlite);
}

async function runAutoBackup(kind: 'AUTO' | 'EXIT') {
  const ctx = systemContext();
  const s = getSettings(ctx).backup;
  const dir = s.directory || defaultBackupDir;
  try {
    const row = await createBackup(ctx, dir, kind);
    pruneAutoBackups(ctx, dir, s.keepLast);
    emit('backup.completed', row);
  } catch (err) {
    emit('backup.failed', { message: (err as Error).message });
  }
}

function startSchedulers() {
  // idle auto-lock
  setInterval(() => {
    if (!handle) return;
    const minutes = getSettings(systemContext()).security.autoLockMinutes;
    if (sessions.checkIdle(minutes)) {
      const s = sessions.get();
      if (s) audit({ ...systemContext(), user: s.user }, { action: 'AUTO_LOCK', entityType: 'user', entityId: s.user.id, description: `Session locked after ${minutes} minutes of inactivity` });
    }
  }, 20_000);
  // automatic backups
  setInterval(() => {
    if (handle && backupDue(systemContext())) void runAutoBackup('AUTO');
  }, 10 * 60_000);
  setTimeout(() => {
    if (handle && backupDue(systemContext())) void runAutoBackup('AUTO');
  }, 90_000);
}

async function restore(ctx: ServiceContext, filePath: string) {
  const s = getSettings(ctx).backup;
  const safetyDir = join(s.directory || defaultBackupDir, 'pre-restore');
  await createBackup(ctx, safetyDir, 'PRE_RESTORE');
  audit(ctx, { action: 'RESTORE_START', entityType: 'backup', description: `Restoring database from ${filePath}`, severity: 'CRITICAL' });
  const session = sessions.get();
  if (session) logout(ctx, session, 'RESTORE');
  sessions.set(null);
  closeDatabase(handle);
  try {
    swapDatabaseFile(filePath, dbPath);
  } finally {
    openDb();
  }
  audit(systemContext(), {
    action: 'RESTORE',
    entityType: 'backup',
    description: `Database restored from ${filePath} by ${ctx.user?.fullName ?? 'unknown'} (safety copy saved in ${safetyDir})`,
    severity: 'CRITICAL',
    userId: null,
    username: ctx.user?.username ?? null,
  });
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 800);
}

function registerIpc() {
  const env: MainEnv = {
    sessions,
    version: app.getVersion(),
    productName: PRODUCT_NAME,
    packaged: app.isPackaged,
    dataDir,
    dbPath: () => dbPath,
    migrationCount,
    defaultBackupDir,
    versions: { electron: process.versions.electron, node: process.versions.node, sqlite: '' },
    dialogs: {
      chooseDirectory: async (title, defaultPath) => {
        const r = await dialog.showOpenDialog(mainWindow!, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
        return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
      },
      pickBackupFile: async (defaultPath) => {
        const r = await dialog.showOpenDialog(mainWindow!, {
          title: 'Choose a PharmaDesk backup to restore',
          defaultPath,
          properties: ['openFile'],
          filters: [{ name: 'PharmaDesk backup', extensions: ['db'] }],
        });
        return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
      },
      saveFile: async (defaultName, filters) => {
        const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: join(app.getPath('documents'), defaultName), filters });
        return r.canceled || !r.filePath ? null : r.filePath;
      },
    },
    showItemInFolder: (p) => shell.showItemInFolder(p),
    printers: async () => {
      const list = mainWindow ? await mainWindow.webContents.getPrintersAsync() : [];
      return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!(p as { isDefault?: boolean }).isDefault }));
    },
    print: (html, opts) => printHtml(html, opts),
    pdf: (html, opts) => htmlToPdf(html, opts),
    restore,
    emit,
    loadDemo: (ctx) => loadDemoData(ctx),
  };
  const router = new Router(
    {
      database: () => ({ db: handle.db, sqlite: handle.sqlite }),
      sessions,
      onError: (channel, err) => console.error(`[ipc] ${channel} failed:`, err),
    },
    createHandlers(env),
  );
  ipcMain.handle('pharmacy:invoke', async (event, channel: unknown, payload: unknown) => {
    // only accept calls from our own top-level renderer
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } };
    }
    if (typeof channel !== 'string') return { ok: false, error: { code: 'VALIDATION', message: 'Invalid channel' } };
    return router.dispatch(channel, payload);
  });
  ipcMain.on('pharmacy:theme', (event, theme: unknown) => {
    if (mainWindow && event.sender === mainWindow.webContents && (theme === 'light' || theme === 'dark')) applyTitleBarTheme(mainWindow, theme);
  });
  sessions.onChange((s) => emit('session.changed', s ? toSessionInfo(systemContext(), s) : null));
}

app.whenReady().then(() => {
  try {
    openDb();
  } catch (err) {
    dialog.showErrorBox('PharmaDesk could not open its database', `${(err as Error).message}\n\nDatabase: ${dbPath}\n\nRestore a backup or contact support.`);
    app.exit(1);
    return;
  }
  if (app.isPackaged) Menu.setApplicationMenu(null);
  hardenSession();
  registerIpc();
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  startSchedulers();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', (event) => {
  if (quitting || !handle) return;
  const ctx = systemContext();
  const s = getSettings(ctx).backup;
  const lastChange = (handle.sqlite.prepare('SELECT MAX(created_at) AS m FROM audit_logs').get() as { m: string | null }).m;
  const needsBackup = s.backupOnExit && lastChange && (!s.lastBackupAt || lastChange > s.lastBackupAt);
  quitting = true;
  if (needsBackup) {
    event.preventDefault();
    void runAutoBackup('EXIT').finally(() => {
      shutdown();
      app.quit();
    });
  } else {
    shutdown();
  }
});

function shutdown() {
  const s = sessions.get();
  if (s && handle) {
    try {
      logout(systemContext(), s, 'APP_EXIT');
    } catch {
      /* ignore */
    }
  }
  sessions.set(null);
  if (handle) closeDatabase(handle);
}

app.on('window-all-closed', () => {
  app.quit();
});
