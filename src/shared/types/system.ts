import type { AppSettings } from '../settings';

export interface AppInfo {
  version: string;
  productName: string;
  dbPath: string;
  dbSizeBytes: number;
  dataDir: string;
  platform: string;
  electron: string;
  node: string;
  sqlite: string;
  packaged: boolean;
  migrations: number;
}

export interface AuditRow {
  id: number;
  createdAt: string;
  userId: number | null;
  username: string | null;
  fullName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  details: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export type BackupKind = 'MANUAL' | 'AUTO' | 'PRE_RESTORE' | 'EXIT';

export interface BackupLogRow {
  id: number;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  kind: BackupKind;
  status: 'SUCCESS' | 'FAILED';
  integrity: string | null;
  error: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface BackupFileInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  pharmacyName: string | null;
  lastActivityAt: string | null;
  migrations: number;
  counts: { products: number; batches: number; sales: number; purchases: number; customers: number; suppliers: number };
  integrity: string;
  compatible: boolean;
  problem: string | null;
}

export interface BackupStatus {
  settings: AppSettings['backup'];
  defaultDirectory: string;
  effectiveDirectory: string;
  last: BackupLogRow | null;
  lastSuccess: BackupLogRow | null;
  logs: BackupLogRow[];
  dbPath: string;
  dbSizeBytes: number;
  nextAutoAt: string | null;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface PrintResult {
  /** Rendered HTML for in-app preview. */
  html?: string;
  printed?: boolean;
  filePath?: string | null;
  /** Suggested paper width for the preview frame. */
  paper?: '58mm' | '80mm' | 'A4' | 'label';
}
