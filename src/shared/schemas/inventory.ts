import { z } from 'zod';
import { zDate, zId, zMoney, zOptionalDate, zOptionalId, zOptionalText, zPage, zPositiveQty, zRequiredText } from './common';

export const zBatchNumber = z
  .string()
  .trim()
  .min(1, 'Batch number is required')
  .max(40, 'Batch number is too long')
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''));

export const BatchListSchema = zPage.extend({
  productId: zOptionalId,
  search: z.string().max(100).optional(),
  status: z.enum(['all', 'in_stock', 'sellable', 'expired', 'expiring', 'blocked', 'depleted']).default('in_stock'),
  supplierId: zOptionalId,
  sort: z.enum(['expiry', 'product', 'quantity', 'received']).default('expiry'),
});

export const ProductBatchesSchema = z.object({ productId: zId, includeEmpty: z.boolean().default(false) });

export const BatchUpdateSchema = z.object({
  id: zId,
  salePrice: zMoney.optional(),
  costPrice: zMoney.optional(),
  location: zOptionalText(60),
  status: z.enum(['ACTIVE', 'QUARANTINED', 'RECALLED']).optional(),
  expiryDate: zDate.optional(),
  manufactureDate: zOptionalDate,
  reason: zRequiredText('Reason', 300),
});

export const OpeningStockSchema = z.object({
  productId: zId,
  batchNumber: zBatchNumber,
  manufactureDate: zOptionalDate,
  expiryDate: zDate,
  quantity: zPositiveQty,
  costPrice: zMoney,
  salePrice: zMoney,
  location: zOptionalText(60),
  notes: zOptionalText(300),
});

export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGED', 'EXPIRED', 'LOST', 'RETURN_TO_SUPPLIER', 'OTHER'] as const;

export const StockAdjustSchema = z
  .object({
    batchId: zId,
    direction: z.enum(['IN', 'OUT']),
    reason: z.enum(ADJUSTMENT_REASONS),
    quantity: zPositiveQty,
    notes: zOptionalText(300),
    supplierId: zOptionalId,
    supplierCredit: zMoney.default(0),
  })
  .superRefine((v, ctx) => {
    if (v.direction === 'IN' && v.reason !== 'COUNT_CORRECTION' && v.reason !== 'OTHER') {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Stock increases must be count corrections or other' });
    }
    if (v.reason === 'RETURN_TO_SUPPLIER' && v.supplierCredit > 0 && !v.supplierId) {
      ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Select the supplier giving the credit' });
    }
    if ((v.reason === 'OTHER' || v.reason === 'COUNT_CORRECTION') && !v.notes) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Please explain the adjustment' });
    }
  });

export const AdjustmentListSchema = zPage.extend({
  from: zOptionalDate,
  to: zOptionalDate,
  reason: z.enum([...ADJUSTMENT_REASONS, 'OPENING_STOCK']).optional().nullable(),
  search: z.string().max(100).optional(),
});

export const MovementListSchema = zPage.extend({
  productId: zOptionalId,
  batchId: zOptionalId,
  type: z.string().max(30).optional().nullable(),
  from: zOptionalDate,
  to: zOptionalDate,
  search: z.string().max(100).optional(),
});

export const ExpiryQuerySchema = z.object({
  bucket: z.enum(['ALL', 'EXPIRED', 'D30', 'D60', 'D90', 'LATER']).default('ALL'),
  search: z.string().max(100).optional(),
  supplierId: zOptionalId,
  categoryId: zOptionalId,
  includeZero: z.boolean().default(false),
});

export const ReorderQuerySchema = z.object({
  filter: z.enum(['all', 'out', 'low', 'reorder']).default('all'),
  search: z.string().max(100).optional(),
  supplierId: zOptionalId,
  categoryId: zOptionalId,
});
