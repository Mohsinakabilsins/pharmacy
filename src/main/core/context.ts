import type { PermissionKey } from '@shared/permissions';
import { toLocalDate } from '@shared/dates';
import type { Db, Sqlite } from './db';
import { AppError, forbidden } from './errors';

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  roleName: string;
  permissions: ReadonlySet<string>;
}

export interface ServiceContext {
  db: Db;
  sqlite: Sqlite;
  user: SessionUser | null;
  now: () => Date;
}

export function requireUser(ctx: ServiceContext): SessionUser {
  if (!ctx.user) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue');
  return ctx.user;
}

export function can(ctx: ServiceContext, key: PermissionKey): boolean {
  return !!ctx.user && ctx.user.permissions.has(key);
}

export function requirePermission(ctx: ServiceContext, key: PermissionKey): SessionUser {
  const user = requireUser(ctx);
  if (!user.permissions.has(key)) throw forbidden();
  return user;
}

export function nowIso(ctx: ServiceContext): string {
  return ctx.now().toISOString();
}

export function today(ctx: ServiceContext): string {
  return toLocalDate(ctx.now());
}

/**
 * Run `fn` atomically. better-sqlite3 is a single synchronous connection, so every statement
 * issued through ctx.db / ctx.sqlite inside `fn` is part of the transaction. Nested calls
 * join the outer transaction. Throwing rolls everything back.
 */
export function transaction<T>(ctx: ServiceContext, fn: () => T): T {
  if (ctx.sqlite.inTransaction) return fn();
  return ctx.sqlite.transaction(fn).immediate();
}

/** Typed helpers for raw SQL (reports and hot paths). */
export function all<T>(ctx: ServiceContext, sql: string, ...params: unknown[]): T[] {
  return ctx.sqlite.prepare(sql).all(...params) as T[];
}

export function get<T>(ctx: ServiceContext, sql: string, ...params: unknown[]): T | undefined {
  return ctx.sqlite.prepare(sql).get(...params) as T | undefined;
}

export function run(ctx: ServiceContext, sql: string, ...params: unknown[]) {
  return ctx.sqlite.prepare(sql).run(...params);
}
