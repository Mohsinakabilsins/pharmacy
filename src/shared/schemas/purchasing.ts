import { z } from 'zod';
import { zBatchNumber } from './inventory';
import {
  zBp,
  zDate,
  zId,
  zMoney,
  zOptionalDate,
  zOptionalId,
  zOptionalText,
  zPage,
  zPartyPaymentMethod,
  zQty,
  zRequiredText,
} from './common';
import { MAX_AMOUNT } from '../money';

export const SupplierSaveSchema = z.object({
  id: zId.optional(),
  name: zRequiredText('Supplier name', 120),
  contactPerson: zOptionalText(120),
  phone: zOptionalText(40),
  email: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  address: zOptionalText(300),
  city: zOptionalText(80),
  ntn: zOptionalText(40),
  strn: zOptionalText(40),
  drugLicenseNo: zOptionalText(60),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  openingBalance: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT).default(0),
  notes: zOptionalText(1000),
  isActive: z.boolean().default(true),
});

export const SupplierListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  balance: z.enum(['all', 'payable', 'advance']).default('all'),
});

export const LedgerQuerySchema = z.object({ id: zId, from: zOptionalDate, to: zOptionalDate });

export const PurchaseItemInputSchema = z
  .object({
    productId: zId,
    batchNumber: zBatchNumber,
    manufactureDate: zOptionalDate,
    expiryDate: zDate,
    quantity: zQty,
    bonusQuantity: zQty.default(0),
    costPrice: zMoney,
    salePrice: zMoney,
    discountBp: zBp.default(0),
    discountAmount: zMoney.default(0),
    taxRateBp: zBp.default(0),
  })
  .superRefine((v, ctx) => {
    if (v.quantity + v.bonusQuantity <= 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a quantity' });
    if (v.manufactureDate && v.expiryDate <= v.manufactureDate) {
      ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be after manufacturing date' });
    }
  });

export const PurchaseDraftSchema = z.object({
  id: zId.optional(),
  supplierId: zId,
  supplierInvoiceNo: zOptionalText(60),
  invoiceDate: zDate,
  dueDate: zOptionalDate,
  invoiceDiscount: zMoney.default(0),
  otherCharges: zMoney.default(0),
  notes: zOptionalText(1000),
  items: z.array(PurchaseItemInputSchema).max(500),
});

export const PurchaseCalcSchema = z.object({
  items: z
    .array(
      z.object({
        productId: zId,
        quantity: zQty,
        bonusQuantity: zQty.default(0),
        costPrice: zMoney,
        discountBp: zBp.default(0),
        discountAmount: zMoney.default(0),
        taxRateBp: zBp.default(0),
      }),
    )
    .max(500),
  invoiceDiscount: zMoney.default(0),
  otherCharges: zMoney.default(0),
});

export const PurchasePostSchema = z.object({
  id: zId,
  paidAmount: zMoney.default(0),
  paymentMethod: zPartyPaymentMethod.default('CASH'),
  paymentReference: zOptionalText(80),
});

export const PurchaseListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  supplierId: zOptionalId,
  status: z.enum(['all', 'DRAFT', 'POSTED', 'VOID']).default('all'),
  from: zOptionalDate,
  to: zOptionalDate,
});
