import { z } from 'zod';
import {
  zBp,
  zId,
  zMoney,
  zOptionalDate,
  zOptionalId,
  zOptionalText,
  zPage,
  zPositiveQty,
  zRefundMethod,
  zRequiredText,
  zSalePaymentMethod,
} from './common';

export const DiscountSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('PERCENT'), value: zBp }),
    z.object({ type: z.literal('AMOUNT'), value: zMoney }),
  ])
  .nullable()
  .optional();

export const CartLineSchema = z.object({
  key: z.string().min(1).max(40),
  productId: zId,
  quantity: zPositiveQty,
  batchId: zOptionalId,
  unitPrice: zMoney.nullable().optional(),
  discount: DiscountSchema,
});

export const SaleDraftSchema = z.object({
  lines: z.array(CartLineSchema).max(200),
  customerId: zOptionalId,
  invoiceDiscount: DiscountSchema,
  prescriptionId: zOptionalId,
  overrideTokens: z.array(z.string().max(100)).max(20).default([]),
});

export const SalePaymentSchema = z.object({
  method: zSalePaymentMethod,
  amount: zMoney,
  reference: zOptionalText(80),
});

export const SaleCompleteSchema = SaleDraftSchema.extend({
  payments: z.array(SalePaymentSchema).min(1, 'Add a payment').max(5),
  cashTendered: zMoney.default(0),
  expectedTotal: zMoney,
  notes: zOptionalText(300),
});

export const HoldBillSchema = z.object({
  label: z.string().trim().max(60).default(''),
  customerId: zOptionalId,
  draft: SaleDraftSchema,
  totalEstimate: zMoney.default(0),
});

export const SaleListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  from: zOptionalDate,
  to: zOptionalDate,
  userId: zOptionalId,
  customerId: zOptionalId,
  status: z.enum(['all', 'COMPLETED', 'VOID', 'RETURNED']).default('all'),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CREDIT']).nullable().optional(),
  mine: z.boolean().default(false),
});

export const InvoiceLookupSchema = z.object({ invoiceNo: z.string().trim().min(1).max(40) });

export const SaleVoidSchema = z.object({
  id: zId,
  reason: zRequiredText('Reason', 300),
  overrideToken: z.string().max(100).nullable().optional(),
});

export const ReturnItemInputSchema = z.object({
  saleItemId: zId,
  quantity: zPositiveQty,
  restock: z.boolean().default(true),
});

export const ReturnCreateSchema = z.object({
  saleId: zId,
  items: z.array(ReturnItemInputSchema).min(1, 'Select at least one item to return').max(200),
  refundMethod: zRefundMethod,
  reason: zRequiredText('Return reason', 300),
  notes: zOptionalText(300),
  overrideToken: z.string().max(100).nullable().optional(),
});

export const ReturnListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  from: zOptionalDate,
  to: zOptionalDate,
});

export const PrintSchema = z.object({
  id: zId,
  mode: z.enum(['preview', 'print', 'pdf']).default('preview'),
  format: z.enum(['receipt', 'a4']).default('receipt'),
});
