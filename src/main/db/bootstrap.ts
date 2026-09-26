import { randomUUID } from 'node:crypto';
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS } from '@shared/permissions';
import type { Sqlite } from '../core/db';
import { SEQUENCE_DEFAULTS } from '../core/sequences';
import { hashPassword } from '../modules/auth/password';

export const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', fullName: 'Administrator' };

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salaries',
  'Transport',
  'Maintenance',
  'Internet & Phone',
  'Water & Gas',
  'Stationery & Printing',
  'Cleaning',
  'Taxes & Fees',
  'Miscellaneous',
];

export interface BootstrapResult {
  firstRun: boolean;
}

/**
 * Idempotent start-up initialisation: permission catalogue, default roles, Administrator
 * permissions, default admin user, sequences and expense categories.
 */
export function bootstrapDatabase(sqlite: Sqlite): BootstrapResult {
  let firstRun = false;
  sqlite.transaction(() => {
    const upsertPerm = sqlite.prepare(
      `INSERT INTO permissions (key, module, label) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET module = excluded.module, label = excluded.label`,
    );
    for (const [key, p] of Object.entries(PERMISSIONS)) upsertPerm.run(key, p.module, p.label);
    // remove permissions that no longer exist in code
    const placeholders = ALL_PERMISSIONS.map(() => '?').join(',');
    sqlite.prepare(`DELETE FROM role_permissions WHERE permission_key NOT IN (${placeholders})`).run(...ALL_PERMISSIONS);
    sqlite.prepare(`DELETE FROM permissions WHERE key NOT IN (${placeholders})`).run(...ALL_PERMISSIONS);

    const roleCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }).n;
    if (roleCount === 0) {
      const insRole = sqlite.prepare('INSERT INTO roles (name, description, is_system) VALUES (?, ?, ?)');
      const insRp = sqlite.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
      for (const r of DEFAULT_ROLES) {
        const id = Number(insRole.run(r.name, r.description, r.isSystem ? 1 : 0).lastInsertRowid);
        const perms = r.permissions === 'ALL' ? ALL_PERMISSIONS : r.permissions;
        for (const p of perms) insRp.run(id, p);
      }
    }
    // Administrator always holds every permission (including newly added ones)
    const admin = sqlite.prepare('SELECT id FROM roles WHERE name = ?').get(ADMIN_ROLE_NAME) as { id: number } | undefined;
    const adminRoleId =
      admin?.id ??
      Number(sqlite.prepare('INSERT INTO roles (name, description, is_system) VALUES (?, ?, 1)').run(ADMIN_ROLE_NAME, 'Owner / administrator — full access').lastInsertRowid);
    sqlite.prepare('UPDATE roles SET is_system = 1 WHERE id = ?').run(adminRoleId);
    const insAdminPerm = sqlite.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of ALL_PERMISSIONS) insAdminPerm.run(adminRoleId, p);

    const userCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    if (userCount === 0) {
      firstRun = true;
      sqlite
        .prepare(
          `INSERT INTO users (uuid, username, full_name, password_hash, role_id, must_change_password)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .run(randomUUID(), DEFAULT_ADMIN.username, DEFAULT_ADMIN.fullName, hashPassword(DEFAULT_ADMIN.password), adminRoleId);
      sqlite
        .prepare(`INSERT INTO audit_logs (action, entity_type, description, severity) VALUES ('SYSTEM_INIT', 'system', ?, 'INFO')`)
        .run('Database initialised with default administrator account');
    }

    const insSeq = sqlite.prepare('INSERT OR IGNORE INTO sequences (key, prefix, next_value, padding) VALUES (?, ?, 1, ?)');
    for (const [key, d] of Object.entries(SEQUENCE_DEFAULTS)) insSeq.run(key, d.prefix, d.padding);

    const expCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM expense_categories').get() as { n: number }).n;
    if (expCount === 0) {
      const ins = sqlite.prepare('INSERT INTO expense_categories (name) VALUES (?)');
      for (const c of DEFAULT_EXPENSE_CATEGORIES) ins.run(c);
    }
  })();
  return { firstRun };
}
