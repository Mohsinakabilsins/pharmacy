import { ZodError } from 'zod';
import type { AppErrorShape, ErrorCode } from '@shared/errors';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found`);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', message);
export const rule = (message: string, data?: Record<string, unknown>) => new AppError('BUSINESS_RULE', message, undefined, data);
export const invalid = (message: string, fields?: Record<string, string>) => new AppError('VALIDATION', message, fields);
export const conflict = (message: string) => new AppError('CONFLICT', message);

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

const UNIQUE_MESSAGES: Array<[RegExp, string]> = [
  [/users.*username|users_username_uq/i, 'That username is already taken'],
  [/products\.barcode|products_barcode/i, 'Another product already uses this barcode'],
  [/products\.code|products_code/i, 'Another product already uses this product code'],
  [/batches_product_batch_uq|batches\.product_id, batches\.batch_number/i, 'This batch number already exists for the product'],
  [/categories_name_uq/i, 'A category with this name already exists'],
  [/manufacturers_name_uq/i, 'A manufacturer with this name already exists'],
  [/suppliers_name_uq/i, 'A supplier with this name already exists'],
  [/purchases_supplier_invoice_uq/i, 'This supplier invoice number has already been posted for the supplier'],
  [/cash_sessions_one_open_uq/i, 'A shift is already open'],
  [/expense_categories_name_uq/i, 'An expense category with this name already exists'],
  [/roles\.name|roles_name/i, 'A role with this name already exists'],
  [/customers\.code/i, 'Another customer already uses this code'],
];

/** Normalise any thrown value into a serialisable error shape. */
export function toErrorShape(err: unknown): AppErrorShape {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, fields: err.fields, data: err.data };
  }
  if (err instanceof ZodError) {
    const fields = zodFields(err);
    const first = Object.values(fields)[0];
    return { code: 'VALIDATION', message: first ? `Please check the form: ${first}` : 'Invalid input', fields };
  }
  const e = err as { code?: string; message?: string };
  const message = e?.message ?? String(err);
  if (message.includes('PROTECTED_RECORD')) {
    return {
      code: 'PROTECTED_RECORD',
      message: message.replace(/^.*PROTECTED_RECORD:\s*/, '').replace(/^\w/, (c) => c.toUpperCase()),
    };
  }
  if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || e?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    const hit = UNIQUE_MESSAGES.find(([re]) => re.test(message));
    return { code: 'CONFLICT', message: hit ? hit[1] : 'This record conflicts with an existing one' };
  }
  if (e?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { code: 'CONFLICT', message: 'This record is referenced by other records and cannot be changed this way' };
  }
  if (e?.code === 'SQLITE_CONSTRAINT_CHECK') {
    return { code: 'VALIDATION', message: 'A value is outside the allowed range' };
  }
  if (e?.code === 'SQLITE_BUSY') {
    return { code: 'INTERNAL', message: 'The database is busy. Please try again.' };
  }
  return { code: 'INTERNAL', message: 'An unexpected error occurred. The operation was not completed.' };
}
