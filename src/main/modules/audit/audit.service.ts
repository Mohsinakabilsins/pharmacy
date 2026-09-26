import type { z } from 'zod';
import type { AuditListSchema } from '@shared/schemas/reports';
import type { Paged } from '@shared/types/common';
import type { AuditRow } from '@shared/types/system';
import { localDayRangeToUtc } from '@shared/dates';
import { all, get, type ServiceContext } from '../../core/context';
import { Where } from '../../core/sql';

export function listAudit(ctx: ServiceContext, q: z.output<typeof AuditListSchema>): Paged<AuditRow> {
  const w = new Where();
  if (q.from || q.to) {
    const r = localDayRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2100-01-01');
    w.add('a.created_at >= ? AND a.created_at < ?', r.start, r.end);
  }
  w.addIf(q.userId, 'a.user_id = ?', q.userId);
  w.addIf(q.action, 'a.action = ?', q.action);
  w.addIf(q.entityType, 'a.entity_type = ?', q.entityType);
  if (q.severity !== 'all') w.add('a.severity = ?', q.severity);
  w.search(q.search, ['a.description', 'a.username', 'a.action']);
  const where = w.sql ? ` WHERE ${w.sql}` : '';
  const total = get<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM audit_logs a${where}`, ...w.params)!.n;
  const rows = all<AuditRow>(
    ctx,
    `SELECT a.id, a.created_at AS createdAt, a.user_id AS userId, a.username, u.full_name AS fullName, a.action, a.entity_type AS entityType,
            a.entity_id AS entityId, a.description, a.details, a.severity
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...w.params,
    q.pageSize,
    (q.page - 1) * q.pageSize,
  );
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export function auditActions(ctx: ServiceContext): string[] {
  return all<{ action: string }>(ctx, 'SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r) => r.action);
}
