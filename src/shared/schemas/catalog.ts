import { z } from 'zod';
import { zBp, zId, zMoney, zOptionalId, zOptionalText, zPage, zQty, zRequiredText } from './common';

export const CategorySaveSchema = z.object({
  id: zId.optional(),
  name: zRequiredText('Name', 80),
  description: zOptionalText(300),
  isActive: z.boolean().default(true),
});

export const ManufacturerSaveSchema = z.object({
  id: zId.optional(),
  name: zRequiredText('Name', 120),
  country: zOptionalText(60),
  phone: zOptionalText(40),
  isActive: z.boolean().default(true),
});

export const DOSAGE_FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Drops',
  'Injection',
  'Infusion',
  'Cream',
  'Ointment',
  'Gel',
  'Lotion',
  'Inhaler',
  'Sachet',
  'Powder',
  'Suppository',
  'Spray',
  'Solution',
  'Patch',
  'Device',
  'Surgical',
  'Baby care',
  'Personal care',
  'Other',
] as const;

export const ProductSaveSchema = z
  .object({
    id: zId.optional(),
    code: zOptionalText(30),
    barcode: zOptionalText(64),
    brandName: zRequiredText('Brand name', 160),
    genericName: zOptionalText(200),
    manufacturerId: zOptionalId,
    categoryId: zOptionalId,
    dosageForm: zOptionalText(60),
    strength: zOptionalText(60),
    packSize: z.number().int('Pack size must be a whole number').min(1, 'Pack size must be at least 1').max(10_000),
    unitName: zRequiredText('Unit name', 30),
    packName: zRequiredText('Pack name', 30),
    allowLooseSale: z.boolean().default(true),
    requiresPrescription: z.boolean().default(false),
    isControlled: z.boolean().default(false),
    storageLocation: zOptionalText(60),
    storageCondition: zOptionalText(80),
    minStock: zQty.default(0),
    reorderLevel: zQty.default(0),
    maxStock: zQty.default(0),
    defaultCostPrice: zMoney.default(0),
    defaultSalePrice: zMoney.default(0),
    taxRateBp: zBp.default(0),
    isActive: z.boolean().default(true),
    notes: zOptionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.maxStock > 0 && v.maxStock < v.reorderLevel) {
      ctx.addIssue({ code: 'custom', path: ['maxStock'], message: 'Maximum stock must be at least the reorder level' });
    }
    if (v.reorderLevel > 0 && v.reorderLevel < v.minStock) {
      ctx.addIssue({ code: 'custom', path: ['reorderLevel'], message: 'Reorder level should be at least the minimum stock' });
    }
  });

export const ProductListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  categoryId: zOptionalId,
  manufacturerId: zOptionalId,
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  stock: z.enum(['all', 'in_stock', 'low', 'out', 'reorder', 'expired']).default('all'),
  rx: z.enum(['all', 'rx', 'controlled']).default('all'),
  sort: z.enum(['name', 'code', 'stock', 'price', 'updated', 'expiry']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const ProductSearchSchema = z.object({
  query: z.string().max(100),
  limit: z.number().int().min(1).max(100).default(30),
  includeInactive: z.boolean().default(false),
});

export const BarcodeSchema = z.object({ barcode: z.string().trim().min(1).max(64) });

export const SetActiveSchema = z.object({ id: zId, isActive: z.boolean() });

export const LabelPrintSchema = z.object({
  items: z
    .array(z.object({ productId: zId, batchId: zOptionalId, copies: z.number().int().min(1).max(500) }))
    .min(1)
    .max(200),
  layout: z.enum(['38x25', '50x25', 'a4-40']).default('38x25'),
  showPrice: z.boolean().default(true),
  mode: z.enum(['preview', 'print']).default('preview'),
});
