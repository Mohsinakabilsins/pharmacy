import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { APPLICATION_ID, type Sqlite } from '../../core/db';
import { audit } from '../../core/audit';
import type { ServiceContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { getSettings, updateSettingsSection } from '../../core/settings';
import type { BackupFileInfo, BackupKind, BackupLogRow } from '@shared/types/system';

export type { BackupFileInfo, BackupKind, BackupLogRow };

const pad = (n: number) => String(n).padStart(2, '0');

/** `PharmacyBackup_2026-09-27_235500.db` in local time. */
export function backupFileName(now: Date, prefix = 'PharmacyBackup'): string {
  return `${prefix}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
}

/** A path in `dir` that does not exist yet (never overwrites an existing backup). */
export function uniqueBackupPath(dir: string, fileName: string): string {
  let candidate = join(dir, fileName);
  let i = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, fileName.replace(/\.db$/, `_${i}.db`));
    i += 1;
  }
  return candidate;
}

function isSqliteFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(16);
    readSync(fd, buf, 0, 16, 0);
    closeSync(fd);
    return buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  }
}

function logBackup(ctx: ServiceContext, row: Omit<BackupLogRow, 'id' | 'createdByName' | 'createdAt'>) {
  ctx.sqlite
    .prepare(
      `INSERT INTO backup_logs (file_path, file_name, size_bytes, kind, status, integrity, error, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.filePath, row.fileName, row.sizeBytes, row.kind, row.status, row.integrity, row.error, ctx.user?.id ?? null, ctx.now().toISOString());
}

/**
 * Consistent online backup via SQLite's backup API (safe while the app is in use),
 * followed by an integrity check of the written file.
 */
export async function createBackup(ctx: ServiceContext, directory: string, kind: BackupKind): Promise<BackupLogRow> {
  const fileName = backupFileName(ctx.now());
  let target = '';
  try {
    if (!directory) throw new Error('No backup folder selected');
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    target = uniqueBackupPath(directory, fileName);
    await ctx.sqlite.backup(target);
    const check = new Database(target, { readonly: true, fileMustExist: true });
    const integrity = String(check.pragma('integrity_check', { simple: true }));
    check.close();
    if (integrity !== 'ok') throw new Error(`Integrity check failed on the backup file: ${integrity}`);
    const size = statSync(target).size;
    const row = { filePath: target, fileName: basename(target), sizeBytes: size, kind, status: 'SUCCESS' as const, integrity, error: null };
    logBackup(ctx, row);
    if (kind !== 'PRE_RESTORE') updateSettingsSection(ctx, 'backup', { lastBackupAt: ctx.now().toISOString() }, { silent: true });
    audit(ctx, { action: 'BACKUP_CREATE', entityType: 'backup', description: `${kind === 'MANUAL' ? 'Manual' : kind === 'AUTO' ? 'Automatic' : kind === 'EXIT' ? 'Exit' : 'Pre-restore'} backup saved to ${target} (${(size / 1024 / 1024).toFixed(2)} MB)` });
    return latestBackup(ctx)!;
  } catch (err) {
    const message = (err as Error).message;
    logBackup(ctx, { filePath: target || directory, fileName, sizeBytes: 0, kind, status: 'FAILED', integrity: null, error: message });
    audit(ctx, { action: 'BACKUP_FAILED', entityType: 'backup', description: `Backup failed: ${message}`, severity: 'CRITICAL' });
    if (target && existsSync(target)) {
      try {
        unlinkSync(target);
      } catch {
        /* ignore */
      }
    }
    throw new AppError('BACKUP_FAILED', `Backup failed: ${friendlyFsError(message)}`);
  }
}

function friendlyFsError(message: string): string {
  if (/EACCES|EPERM/.test(message)) return 'Access to the selected folder was denied. Choose another folder or check the drive is not write-protected.';
  if (/ENOSPC/.test(message)) return 'The selected drive is full.';
  if (/ENOENT/.test(message)) return 'The selected folder is not available. Is the USB drive connected?';
  return message;
}

export function latestBackup(ctx: ServiceContext): BackupLogRow | null {
  return (
    (ctx.sqlite
      .prepare(
        `SELECT b.id, b.file_path AS filePath, b.file_name AS fileName, b.size_bytes AS sizeBytes, b.kind, b.status, b.integrity, b.error,
                u.full_name AS createdByName, b.created_at AS createdAt
         FROM backup_logs b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC LIMIT 1`,
      )
      .get() as BackupLogRow | undefined) ?? null
  );
}

export function listBackupLogs(ctx: ServiceContext, limit = 30): BackupLogRow[] {
  return ctx.sqlite
    .prepare(
      `SELECT b.id, b.file_path AS filePath, b.file_name AS fileName, b.size_bytes AS sizeBytes, b.kind, b.status, b.integrity, b.error,
              u.full_name AS createdByName, b.created_at AS createdAt
       FROM backup_logs b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC LIMIT ?`,
    )
    .all(limit) as BackupLogRow[];
}

/** Delete old automatic backups in `directory`, keeping the newest `keep`. Manual backups are never pruned. */
export function pruneAutoBackups(ctx: ServiceContext, directory: string, keep: number): number {
  const rows = ctx.sqlite
    .prepare(`SELECT file_path AS filePath FROM backup_logs WHERE kind = 'AUTO' AND status = 'SUCCESS' ORDER BY id DESC`)
    .all() as { filePath: string }[];
  const inDir = rows.filter((r) => r.filePath.startsWith(directory) && existsSync(r.filePath));
  let removed = 0;
  for (const r of inDir.slice(keep)) {
    try {
      unlinkSync(r.filePath);
      removed += 1;
    } catch {
      /* ignore files in use */
    }
  }
  return removed;
}

/** Inspect a candidate backup without modifying it. */
export function inspectBackupFile(filePath: string, currentMigrationCount: number): BackupFileInfo {
  const empty = { products: 0, batches: 0, sales: 0, purchases: 0, customers: 0, suppliers: 0 };
  const base: BackupFileInfo = {
    filePath,
    fileName: basename(filePath),
    sizeBytes: existsSync(filePath) ? statSync(filePath).size : 0,
    pharmacyName: null,
    lastActivityAt: null,
    migrations: 0,
    counts: empty,
    integrity: 'unknown',
    compatible: false,
    problem: null,
  };
  if (!existsSync(filePath)) return { ...base, problem: 'File not found' };
  if (!isSqliteFile(filePath)) return { ...base, problem: 'This is not a database backup file' };
  let db: Sqlite | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const appId = db.pragma('application_id', { simple: true }) as number;
    if (appId !== APPLICATION_ID) return { ...base, problem: 'This database was not created by PharmaDesk' };
    const integrity = String(db.pragma('integrity_check', { simple: true }));
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    for (const t of ['products', 'batches', 'sales', 'users', 'stock_movements']) {
      if (!tables.has(t)) return { ...base, integrity, problem: `Backup is missing the "${t}" table` };
    }
    const migrations = tables.has('__drizzle_migrations') ? (db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n : 0;
    const count = (t: string) => (db!.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const pharmacy = db.prepare("SELECT value FROM settings WHERE key = 'pharmacy'").get() as { value: string } | undefined;
    let pharmacyName: string | null = null;
    try {
      pharmacyName = pharmacy ? (JSON.parse(pharmacy.value).name as string) : null;
    } catch {
      pharmacyName = null;
    }
    const last = db
      .prepare("SELECT MAX(x) AS m FROM (SELECT MAX(created_at) AS x FROM audit_logs UNION ALL SELECT MAX(created_at) FROM sales)")
      .get() as { m: string | null };
    const problem = integrity !== 'ok' ? `Integrity check failed: ${integrity}` : migrations > currentMigrationCount ? 'This backup was made by a newer version of PharmaDesk. Update the application first.' : null;
    return {
      ...base,
      pharmacyName,
      lastActivityAt: last.m,
      migrations,
      counts: { products: count('products'), batches: count('batches'), sales: count('sales'), purchases: count('purchases'), customers: count('customers'), suppliers: count('suppliers') },
      integrity,
      compatible: problem === null,
      problem,
    };
  } catch (err) {
    return { ...base, problem: `Cannot read backup: ${(err as Error).message}` };
  } finally {
    db?.close();
  }
}

/** Files that look like backups in a folder (for the restore picker). */
export function listBackupFiles(directory: string): Array<{ filePath: string; fileName: string; sizeBytes: number; modifiedAt: string }> {
  if (!directory || !existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((f) => /\.db$/i.test(f))
    .map((f) => {
      const p = join(directory, f);
      const st = statSync(p);
      return { filePath: p, fileName: f, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function backupDue(ctx: ServiceContext): boolean {
  const s = getSettings(ctx).backup;
  if (!s.autoEnabled) return false;
  if (!s.lastBackupAt) return true;
  return ctx.now().getTime() - Date.parse(s.lastBackupAt) >= s.intervalHours * 3_600_000;
}

/**
 * Swap the live database file for a validated backup. The caller must have closed the
 * live connection first; this copies to a temp file, removes WAL/SHM side files and renames
 * atomically, so a failure never leaves a half-written database.
 */
export function swapDatabaseFile(backupPath: string, dbPath: string): void {
  const tmp = `${dbPath}.restoring`;
  copyFileSync(backupPath, tmp);
  const verify = new Database(tmp, { readonly: true, fileMustExist: true });
  const ok = String(verify.pragma('integrity_check', { simple: true })) === 'ok';
  verify.close();
  if (!ok) {
    unlinkSync(tmp);
    throw new AppError('RESTORE_FAILED', 'The copied backup failed its integrity check. The current database was not changed.');
  }
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
  renameSync(tmp, dbPath);
}
