import { SETTINGS_SECTIONS, SettingsSchemas, parseSection, type AppSettings, type SettingsSection } from '@shared/settings';
import type { Sqlite } from './db';
import type { ServiceContext } from './context';
import { audit, diff } from './audit';

const cache = new WeakMap<Sqlite, AppSettings>();

export function getSettings(ctx: Pick<ServiceContext, 'sqlite'>): AppSettings {
  const cached = cache.get(ctx.sqlite);
  if (cached) return cached;
  const rows = ctx.sqlite.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const key of SETTINGS_SECTIONS) {
    let raw: unknown = {};
    const stored = map.get(key);
    if (stored) {
      try {
        raw = JSON.parse(stored);
      } catch {
        raw = {};
      }
    }
    out[key] = parseSection(key, raw);
  }
  const settings = out as AppSettings;
  cache.set(ctx.sqlite, settings);
  return settings;
}

export function invalidateSettings(sqlite: Sqlite): void {
  cache.delete(sqlite);
}

export function updateSettingsSection<K extends SettingsSection>(
  ctx: ServiceContext,
  key: K,
  value: unknown,
  opts: { silent?: boolean } = {},
): AppSettings[K] {
  const current = getSettings(ctx)[key] as Record<string, unknown>;
  const parsed = SettingsSchemas[key].parse({ ...current, ...(value as object) }) as AppSettings[K];
  ctx.sqlite
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(key, JSON.stringify(parsed), ctx.now().toISOString(), ctx.user?.id ?? null);
  invalidateSettings(ctx.sqlite);
  if (!opts.silent) {
    const changes = diff(current, parsed as Record<string, unknown>);
    if ('logo' in changes) changes.logo = { from: '(image)', to: '(image)' };
    if (Object.keys(changes).length > 0) {
      audit(ctx, {
        action: 'SETTINGS_CHANGE',
        entityType: 'settings',
        entityId: key,
        description: `Changed ${key} settings (${Object.keys(changes).join(', ')})`,
        details: changes,
      });
    }
  }
  return parsed;
}
