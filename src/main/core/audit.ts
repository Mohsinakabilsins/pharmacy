import type { ServiceContext } from './context';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  description: string;
  details?: unknown;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Override the acting user (e.g. failed login attempts). */
  userId?: number | null;
  username?: string | null;
}

export function audit(ctx: ServiceContext, entry: AuditEntry): void {
  const userId = entry.userId !== undefined ? entry.userId : (ctx.user?.id ?? null);
  const username = entry.username !== undefined ? entry.username : (ctx.user?.username ?? null);
  ctx.sqlite
    .prepare(
      `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, description, details, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      username,
      entry.action,
      entry.entityType ?? null,
      entry.entityId == null ? null : String(entry.entityId),
      entry.description,
      entry.details === undefined ? null : JSON.stringify(entry.details),
      entry.severity ?? 'INFO',
      ctx.now().toISOString(),
    );
}

/** Compact before/after diff for audit details. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (k === 'updatedAt' || k === 'searchText' || k === 'passwordHash') continue;
    if (v !== undefined && JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = { from: before[k], to: v };
  }
  return out;
}
