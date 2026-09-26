import { z } from 'zod';

/**
 * Application settings. Each section is stored as one JSON row in the `settings` table.
 * Every field has a default so a fresh database works without configuration.
 */

const str = (max = 200) => z.string().trim().max(max);

export const PharmacySettingsSchema = z.object({
  name: str(120).min(1).default('My Pharmacy'),
  tagline: str(160).default(''),
  address: str(300).default(''),
  city: str(80).default(''),
  phone: str(60).default(''),
  email: str(120).default(''),
  licenseNo: str(80).default(''),
  ntn: str(40).default(''),
  /** Logo as a data URL (PNG/JPEG, resized client-side). */
  logo: z.string().max(400_000).default(''),
});

export const ReceiptSettingsSchema = z.object({
  paperWidth: z.enum(['58mm', '80mm']).default('80mm'),
  showLogo: z.boolean().default(true),
  showBatch: z.boolean().default(true),
  showExpiry: z.boolean().default(true),
  showGeneric: z.boolean().default(false),
  showCashier: z.boolean().default(true),
  showBarcode: z.boolean().default(true),
  headerNote: str(300).default(''),
  footerNote: str(500).default('Thank you for your visit. Get well soon!'),
  returnPolicy: str(300).default('Medicines once sold can be returned within 7 days with receipt, if unopened and stored properly.'),
  autoPrint: z.boolean().default(false),
  copies: z.number().int().min(1).max(3).default(1),
});

export const InvoiceSettingsSchema = z.object({
  title: str(60).default('TAX INVOICE'),
  terms: str(800).default(''),
  footer: str(300).default('This is a computer generated invoice.'),
});

export const CurrencySettingsSchema = z.object({
  code: str(8).default('PKR'),
  symbol: str(8).default('Rs'),
  decimals: z.union([z.literal(0), z.literal(2)]).default(2),
  symbolPosition: z.enum(['before', 'after']).default('before'),
});

export const LocaleSettingsSchema = z.object({
  language: z.enum(['en', 'ur']).default('en'),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MMM-yyyy']).default('dd/MM/yyyy'),
  numberLocale: z.enum(['en-PK', 'en-US', 'en-IN', 'en-GB']).default('en-PK'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
});

export const TaxSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['EXCLUSIVE', 'INCLUSIVE']).default('INCLUSIVE'),
  label: str(20).default('GST'),
  defaultRateBp: z.number().int().min(0).max(10_000).default(0),
  registrationNo: str(60).default(''),
  purchaseTaxIsCost: z.boolean().default(true),
});

export const InventorySettingsSchema = z.object({
  defaultMinStock: z.number().int().min(0).default(10),
  defaultReorderLevel: z.number().int().min(0).default(20),
  expiryWarningDays: z.number().int().min(1).max(730).default(90),
  allowNegativeStock: z.boolean().default(false),
  blockSaleWithinDays: z.number().int().min(0).max(365).default(0),
});

export const SalesSettingsSchema = z.object({
  requireOpenShift: z.boolean().default(true),
  roundingStep: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]).default(0),
  maxDiscountBp: z.number().int().min(0).max(10_000).default(1000),
  prescriptionEnforcement: z.enum(['off', 'warn', 'require']).default('warn'),
  allowCreditSales: z.boolean().default(true),
  returnWindowDays: z.number().int().min(0).max(365).default(7),
  defaultPaymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET']).default('CASH'),
  walkInLabel: str(40).default('Walk-in customer'),
});

export const BackupSettingsSchema = z.object({
  autoEnabled: z.boolean().default(true),
  intervalHours: z.number().int().min(1).max(168).default(24),
  directory: z.string().max(1000).default(''),
  keepLast: z.number().int().min(1).max(365).default(14),
  backupOnExit: z.boolean().default(true),
  lastBackupAt: z.string().default(''),
});

export const SecuritySettingsSchema = z.object({
  autoLockMinutes: z.number().int().min(0).max(240).default(15),
  passwordMinLength: z.number().int().min(6).max(64).default(8),
  maxFailedAttempts: z.number().int().min(3).max(20).default(5),
  lockoutMinutes: z.number().int().min(1).max(1440).default(15),
});

export const PrinterSettingsSchema = z.object({
  receiptPrinter: z.string().max(200).default(''),
  a4Printer: z.string().max(200).default(''),
  labelPrinter: z.string().max(200).default(''),
  silentPrint: z.boolean().default(false),
});

export const SettingsSchemas = {
  pharmacy: PharmacySettingsSchema,
  receipt: ReceiptSettingsSchema,
  invoice: InvoiceSettingsSchema,
  currency: CurrencySettingsSchema,
  locale: LocaleSettingsSchema,
  tax: TaxSettingsSchema,
  inventory: InventorySettingsSchema,
  sales: SalesSettingsSchema,
  backup: BackupSettingsSchema,
  security: SecuritySettingsSchema,
  printer: PrinterSettingsSchema,
} as const;

export type SettingsSection = keyof typeof SettingsSchemas;
export const SETTINGS_SECTIONS = Object.keys(SettingsSchemas) as SettingsSection[];

export type AppSettings = { [K in SettingsSection]: z.output<(typeof SettingsSchemas)[K]> };

export function defaultSettings(): AppSettings {
  const out = {} as Record<string, unknown>;
  for (const key of SETTINGS_SECTIONS) out[key] = SettingsSchemas[key].parse({});
  return out as AppSettings;
}

/** Merge a stored (possibly partial / older) value with defaults. */
export function parseSection<K extends SettingsSection>(key: K, raw: unknown): AppSettings[K] {
  const schema = SettingsSchemas[key];
  const result = schema.safeParse(raw ?? {});
  if (result.success) return result.data as AppSettings[K];
  // keep valid fields, fall back to defaults for invalid ones
  const defaults = schema.parse({}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...defaults };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const probe = schema.safeParse({ ...defaults, [k]: v });
      if (probe.success) merged[k] = v;
    }
  }
  return schema.parse(merged) as AppSettings[K];
}
