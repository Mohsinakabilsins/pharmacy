import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type Sqlite = Database.Database;

/** SQLite application_id marking a PharmaDesk database ("PHDS"). */
export const APPLICATION_ID = 0x50484453;

export interface DatabaseHandle {
  sqlite: Sqlite;
  db: Db;
  file: string;
}

export function applyPragmas(sqlite: Sqlite, opts: { memory?: boolean } = {}): void {
  if (!opts.memory) sqlite.pragma('journal_mode = WAL');
  // FULL: committed transactions survive power loss (frequent in pharmacies) — worth the cost.
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('cache_size = -32000');
}

/** Open (or create) the database and apply pending migrations. */
export function openDatabase(file: string, migrationsFolder: string): DatabaseHandle {
  const memory = file === ':memory:';
  const sqlite = new Database(file);
  applyPragmas(sqlite, { memory });
  const appId = sqlite.pragma('application_id', { simple: true }) as number;
  if (appId !== 0 && appId !== APPLICATION_ID) {
    sqlite.close();
    throw new Error('The database file does not belong to PharmaDesk');
  }
  if (appId === 0) sqlite.pragma(`application_id = ${APPLICATION_ID}`);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, db, file };
}

export function closeDatabase(handle: DatabaseHandle): void {
  try {
    handle.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
  handle.sqlite.close();
}
