import { z } from 'zod';
import { MAX_AMOUNT } from '../money';
import { zDate, zId, zMoney, zOptionalDate, zOptionalId, zOptionalText, zPage, zRequiredText } from './common';

export const CustomerSaveSchema = z.object({
  id: zId.optional(),
  code: zOptionalText(20),
  name: zRequiredText('Name', 120),
  phone: zOptionalText(40),
  address: zOptionalText(300),
  notes: zOptionalText(500),
  creditLimit: zMoney.default(0),
  openingBalance: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT).default(0),
  isActive: z.boolean().default(true),
});

export const CustomerListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  balance: z.enum(['all', 'receivable']).default('all'),
});

export const CustomerSearchSchema = z.object({ query: z.string().max(100), limit: z.number().int().min(1).max(50).default(15) });

export const PrescriptionItemSchema = z.object({
  productId: zOptionalId,
  medicineText: zRequiredText('Medicine', 200),
  quantity: z.number().int().min(0).max(100_000).nullable().optional(),
  instructions: zOptionalText(300),
});

export const PrescriptionSaveSchema = z.object({
  id: zId.optional(),
  customerId: zOptionalId,
  patientName: zRequiredText('Patient name', 120),
  patientAge: zOptionalText(20),
  prescriberName: zRequiredText('Prescriber name', 120),
  prescriberRegistration: zOptionalText(60),
  clinic: zOptionalText(160),
  prescriptionDate: zDate,
  notes: zOptionalText(1000),
  items: z.array(PrescriptionItemSchema).max(50).default([]),
});

export const PrescriptionListSchema = zPage.extend({
  search: z.string().max(100).optional(),
  customerId: zOptionalId,
  from: zOptionalDate,
  to: zOptionalDate,
  status: z.enum(['all', 'ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});

export const AttachmentAddSchema = z.object({
  prescriptionId: zId,
  fileName: zRequiredText('File name', 200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(1).max(12_000_000, 'File is too large (max 8 MB)'),
});

export const PrescriptionStatusSchema = z.object({ id: zId, status: z.enum(['ACTIVE', 'ARCHIVED']) });
