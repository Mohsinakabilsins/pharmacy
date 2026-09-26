import { z } from 'zod';
import { zOptionalDate, zOptionalId, zPage } from './common';

export const ReportParamsSchema = z.object({
  from: zOptionalDate,
  to: zOptionalDate,
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  supplierId: zOptionalId,
  categoryId: zOptionalId,
  userId: zOptionalId,
  productId: zOptionalId,
  threshold: z.number().min(0).max(100_000).optional().nullable(),
  days: z.number().int().min(1).max(730).optional().nullable(),
  limit: z.number().int().min(1).max(1000).optional().nullable(),
});

export const ReportRunSchema = z.object({
  reportId: z.string().min(1).max(60),
  params: ReportParamsSchema.prefault({}),
});

export const ReportExportSchema = ReportRunSchema.extend({
  format: z.enum(['csv', 'xlsx', 'pdf', 'print']),
});

export const AuditListSchema = zPage.extend({
  from: zOptionalDate,
  to: zOptionalDate,
  userId: zOptionalId,
  action: z.string().max(60).optional().nullable(),
  entityType: z.string().max(60).optional().nullable(),
  severity: z.enum(['all', 'INFO', 'WARNING', 'CRITICAL']).default('all'),
  search: z.string().max(100).optional(),
});
