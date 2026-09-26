import { z } from 'zod';
import {
  zDate,
  zId,
  zMoney,
  zOptionalDate,
  zOptionalId,
  zOptionalText,
  zPage,
  zPartyPaymentMethod,
  zPaymentMethod,
  zPositiveMoney,
  zRequiredText,
} from './common';

export const ExpenseCategorySaveSchema = z.object({
  id: zId.optional(),
  name: zRequiredText('Name', 60),
  isActive: z.boolean().default(true),
});

export const ExpenseCreateSchema = z.object({
  expenseDate: zDate,
  categoryId: zId,
  amount: zPositiveMoney,
  description: zRequiredText('Description', 300),
  paymentMethod: zPaymentMethod.default('CASH'),
  reference: zOptionalText(80),
});

export const ExpenseListSchema = zPage.extend({
  from: zOptionalDate,
  to: zOptionalDate,
  categoryId: zOptionalId,
  status: z.enum(['all', 'POSTED', 'VOID']).default('POSTED'),
  search: z.string().max(100).optional(),
});

export const SupplierPaymentSchema = z.object({
  supplierId: zId,
  amount: zPositiveMoney,
  method: zPartyPaymentMethod.default('CASH'),
  reference: zOptionalText(80),
  paymentDate: zDate,
  notes: zOptionalText(300),
});

export const CustomerPaymentSchema = z.object({
  customerId: zId,
  amount: zPositiveMoney,
  method: zPartyPaymentMethod.default('CASH'),
  reference: zOptionalText(80),
  paymentDate: zDate,
  notes: zOptionalText(300),
});

export const PaymentListSchema = zPage.extend({
  direction: z.enum(['all', 'IN', 'OUT']).default('all'),
  supplierId: zOptionalId,
  customerId: zOptionalId,
  from: zOptionalDate,
  to: zOptionalDate,
  status: z.enum(['all', 'POSTED', 'VOID']).default('all'),
  search: z.string().max(100).optional(),
});

export const CashOpenSchema = z.object({ openingCash: zMoney, notes: zOptionalText(300) });

export const CashAdjustSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: zPositiveMoney,
  reason: zRequiredText('Reason', 200),
});

export const CashCloseSchema = z.object({
  countedCash: zMoney,
  denominations: z.record(z.string(), z.number().int().min(0).max(100_000)).optional().nullable(),
  notes: zOptionalText(500),
});

export const CashListSchema = zPage.extend({ from: zOptionalDate, to: zOptionalDate });
