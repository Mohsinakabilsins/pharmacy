/** Error codes shared by main and renderer. */
export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'LOCKED'
  | 'SESSION_LOCKED'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'EXPIRED_STOCK'
  | 'QUOTE_CHANGED'
  | 'OVERRIDE_REQUIRED'
  | 'SHIFT_REQUIRED'
  | 'PRESCRIPTION_REQUIRED'
  | 'PROTECTED_RECORD'
  | 'BUSINESS_RULE'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'CANCELLED'
  | 'INTERNAL';

export interface AppErrorShape {
  code: ErrorCode;
  message: string;
  /** Field-level validation messages keyed by dotted path. */
  fields?: Record<string, string>;
  /** Extra machine-readable data, e.g. the permission an override needs. */
  data?: Record<string, unknown>;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };
