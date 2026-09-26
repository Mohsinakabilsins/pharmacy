import { z } from 'zod';
import { isIsoDate } from '../dates';
import { MAX_AMOUNT, MAX_QUANTITY } from '../money';

export const zId = z.number().int().positive();
export const zOptionalId = z.number().int().positive().nullable().optional();
/** Money in paisa. */
export const zMoney = z.number().int('Amount must be a whole number of paisa').min(0, 'Amount cannot be negative').max(MAX_AMOUNT, 'Amount is too large');
export const zPositiveMoney = zMoney.refine((v) => v > 0, 'Amount must be greater than zero');
export const zQty = z.number().int('Quantity must be a whole number').min(0).max(MAX_QUANTITY, 'Quantity is too large');
export const zPositiveQty = z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(MAX_QUANTITY, 'Quantity is too large');
export const zBp = z.number().int().min(0).max(10_000);
export const zDate = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');
export const zOptionalDate = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isIsoDate(v), 'Enter a valid date (YYYY-MM-DD)');
export const zText = (max = 200) => z.string().trim().max(max, `Maximum ${max} characters`);
export const zRequiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `Maximum ${max} characters`);
export const zOptionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Maximum ${max} characters`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const zPage = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(25),
});

export const zDateRange = z.object({
  from: zOptionalDate,
  to: zOptionalDate,
});

export const zPaymentMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET']);
export const zPartyPaymentMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CHEQUE']);
export const zSalePaymentMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CREDIT']);
export const zRefundMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CUSTOMER_ACCOUNT']);
export const zVoid = z.object({ id: zId, reason: zRequiredText('Reason', 300) });
export const zIdInput = z.object({ id: zId });
