import type { Paged } from '@shared/types/common';
import type { ServiceContext } from './context';

/** Escape LIKE wildcards; use with `ESCAPE '\\'`. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Split a free-text query into lower-case tokens. */
export function tokens(q: string | null | undefined): string[] {
  return (q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Convert 0/1 columns into booleans in place. */
export function bools<T>(rows: T[], ...keys: (keyof T)[]): T[] {
  for (const r of rows) for (const k of keys) (r as Record<string, unknown>)[k as string] = !!r[k];
  return rows;
}

export function bool1<T>(row: T | undefined, ...keys: (keyof T)[]): T | undefined {
  if (row) bools([row], ...keys);
  return row;
}

/** Run a paged query. `sql` must not contain LIMIT/OFFSET; `where` params are shared with the count. */
export function paged<T>(
  ctx: ServiceContext,
  opts: { select: string; from: string; where?: string; orderBy?: string; params?: unknown[]; page: number; pageSize: number },
): Paged<T> {
  const where = opts.where ? ` WHERE ${opts.where}` : '';
  const params = opts.params ?? [];
  const total = (ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${opts.from}${where}`).get(...params) as { n: number }).n;
  const rows = ctx.sqlite
    .prepare(`SELECT ${opts.select} FROM ${opts.from}${where}${opts.orderBy ? ` ORDER BY ${opts.orderBy}` : ''} LIMIT ? OFFSET ?`)
    .all(...params, opts.pageSize, (opts.page - 1) * opts.pageSize) as T[];
  return { rows, total, page: opts.page, pageSize: opts.pageSize };
}

/** Builder for AND-ed WHERE fragments with positional params. */
export class Where {
  parts: string[] = [];
  params: unknown[] = [];
  add(fragment: string, ...params: unknown[]): this {
    this.parts.push(fragment);
    this.params.push(...params);
    return this;
  }
  addIf(cond: unknown, fragment: string, ...params: unknown[]): this {
    if (cond !== undefined && cond !== null && cond !== '' && cond !== false) this.add(fragment, ...params);
    return this;
  }
  /** Every token must match at least one of `columns`. */
  search(q: string | null | undefined, columns: string[]): this {
    for (const t of tokens(q)) {
      const like = `%${likeEscape(t)}%`;
      this.add(`(${columns.map((c) => `lower(${c}) LIKE ? ESCAPE '\\'`).join(' OR ')})`, ...columns.map(() => like));
    }
    return this;
  }
  toString(): string {
    return this.parts.join(' AND ');
  }
  get sql(): string | undefined {
    return this.parts.length ? this.parts.join(' AND ') : undefined;
  }
}
