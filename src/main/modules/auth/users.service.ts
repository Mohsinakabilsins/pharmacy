import { randomUUID } from 'node:crypto';
import type { RoleRow, UserRow } from '@shared/types/auth';
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS } from '@shared/permissions';
import type { z } from 'zod';
import type { ResetPasswordSchema, RoleSaveSchema, UserCreateSchema, UserUpdateSchema } from '@shared/schemas/auth';
import { audit } from '../../core/audit';
import { all, get, run, transaction, type ServiceContext } from '../../core/context';
import { conflict, invalid, notFound, rule } from '../../core/errors';
import { getSettings } from '../../core/settings';
import { hashPassword, passwordPolicyError } from './password';

export function listUsers(ctx: ServiceContext): UserRow[] {
  return all<Record<string, unknown>>(
    ctx,
    `SELECT u.id, u.username, u.full_name, u.phone, u.role_id, r.name AS role_name, u.is_active, u.must_change_password,
            u.locked_until, u.last_login_at, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.is_active DESC, u.full_name`,
  ).map((r) => ({
    id: r.id as number,
    username: r.username as string,
    fullName: r.full_name as string,
    phone: (r.phone as string) ?? null,
    roleId: r.role_id as number,
    roleName: r.role_name as string,
    isActive: !!r.is_active,
    mustChangePassword: !!r.must_change_password,
    lockedUntil: (r.locked_until as string) ?? null,
    lastLoginAt: (r.last_login_at as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

function adminRoleId(ctx: ServiceContext): number {
  return get<{ id: number }>(ctx, 'SELECT id FROM roles WHERE name = ?', ADMIN_ROLE_NAME)!.id;
}

function activeAdminCount(ctx: ServiceContext, excludeUserId?: number): number {
  return get<{ n: number }>(
    ctx,
    'SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND is_active = 1 AND id <> ?',
    adminRoleId(ctx),
    excludeUserId ?? 0,
  )!.n;
}

export function createUser(ctx: ServiceContext, input: z.output<typeof UserCreateSchema>): UserRow {
  const policy = passwordPolicyError(input.password, getSettings(ctx).security.passwordMinLength);
  if (policy) throw invalid(policy, { password: policy });
  if (!get(ctx, 'SELECT id FROM roles WHERE id = ?', input.roleId)) throw notFound('Role');
  const id = transaction(ctx, () => {
    if (get(ctx, 'SELECT id FROM users WHERE username = ? COLLATE NOCASE', input.username)) throw conflict('That username is already taken');
    const now = ctx.now().toISOString();
    const res = run(
      ctx,
      `INSERT INTO users (uuid, username, full_name, phone, password_hash, role_id, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      input.username,
      input.fullName,
      input.phone,
      hashPassword(input.password),
      input.roleId,
      input.mustChangePassword ? 1 : 0,
      now,
      now,
    );
    const newId = Number(res.lastInsertRowid);
    audit(ctx, { action: 'USER_CREATE', entityType: 'user', entityId: newId, description: `Created user "${input.username}" (${input.fullName})`, details: { roleId: input.roleId } });
    return newId;
  });
  return listUsers(ctx).find((u) => u.id === id)!;
}

export function updateUser(ctx: ServiceContext, input: z.output<typeof UserUpdateSchema>): UserRow {
  const before = listUsers(ctx).find((u) => u.id === input.id);
  if (!before) throw notFound('User');
  const adminId = adminRoleId(ctx);
  const losingAdmin = before.roleId === adminId && before.isActive && (input.roleId !== adminId || !input.isActive);
  if (losingAdmin && activeAdminCount(ctx, input.id) === 0) throw rule('At least one active administrator is required');
  if (input.id === ctx.user?.id && !input.isActive) throw rule('You cannot deactivate your own account');
  transaction(ctx, () => {
    run(
      ctx,
      'UPDATE users SET full_name = ?, phone = ?, role_id = ?, is_active = ?, updated_at = ? WHERE id = ?',
      input.fullName,
      input.phone,
      input.roleId,
      input.isActive ? 1 : 0,
      ctx.now().toISOString(),
      input.id,
    );
    const changes: Record<string, unknown> = {};
    if (before.fullName !== input.fullName) changes.fullName = { from: before.fullName, to: input.fullName };
    if (before.roleId !== input.roleId) changes.roleId = { from: before.roleId, to: input.roleId };
    if (before.isActive !== input.isActive) changes.isActive = { from: before.isActive, to: input.isActive };
    if (before.phone !== input.phone) changes.phone = { from: before.phone, to: input.phone };
    audit(ctx, {
      action: before.isActive && !input.isActive ? 'USER_DEACTIVATE' : 'USER_UPDATE',
      entityType: 'user',
      entityId: input.id,
      description: `Updated user "${before.username}"`,
      details: changes,
      severity: changes.roleId ? 'WARNING' : 'INFO',
    });
  });
  return listUsers(ctx).find((u) => u.id === input.id)!;
}

export function resetPassword(ctx: ServiceContext, input: z.output<typeof ResetPasswordSchema>): void {
  const policy = passwordPolicyError(input.newPassword, getSettings(ctx).security.passwordMinLength);
  if (policy) throw invalid(policy, { newPassword: policy });
  const u = get<{ username: string }>(ctx, 'SELECT username FROM users WHERE id = ?', input.id);
  if (!u) throw notFound('User');
  transaction(ctx, () => {
    run(
      ctx,
      'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      hashPassword(input.newPassword),
      ctx.now().toISOString(),
      input.id,
    );
    audit(ctx, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: input.id, description: `Reset password for "${u.username}"`, severity: 'WARNING' });
  });
}

export function listRoles(ctx: ServiceContext): RoleRow[] {
  const roles = all<{ id: number; name: string; description: string | null; is_system: number; user_count: number }>(
    ctx,
    `SELECT r.id, r.name, r.description, r.is_system, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.is_active = 1) AS user_count
     FROM roles r ORDER BY r.is_system DESC, r.name`,
  );
  const perms = all<{ role_id: number; permission_key: string }>(ctx, 'SELECT role_id, permission_key FROM role_permissions');
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: !!r.is_system,
    userCount: r.user_count,
    permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission_key),
  }));
}

export function saveRole(ctx: ServiceContext, input: z.output<typeof RoleSaveSchema>): RoleRow {
  const perms = Array.from(new Set(input.permissions)).filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  const id = transaction(ctx, () => {
    const now = ctx.now().toISOString();
    if (input.id) {
      const before = listRoles(ctx).find((r) => r.id === input.id);
      if (!before) throw notFound('Role');
      if (before.isSystem) {
        if (input.name !== before.name) throw rule('The Administrator role cannot be renamed');
        // system role always keeps every permission
        perms.splice(0, perms.length, ...ALL_PERMISSIONS);
      }
      run(ctx, 'UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?', input.name, input.description, now, input.id);
      run(ctx, 'DELETE FROM role_permissions WHERE role_id = ?', input.id);
      const ins = ctx.sqlite.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
      for (const p of perms) ins.run(input.id, p);
      const added = perms.filter((p) => !before.permissions.includes(p));
      const removed = before.permissions.filter((p) => !perms.includes(p));
      audit(ctx, {
        action: 'ROLE_PERMISSIONS_CHANGE',
        entityType: 'role',
        entityId: input.id,
        description: `Updated role "${input.name}" (+${added.length} / −${removed.length} permissions)`,
        details: { added, removed },
        severity: 'WARNING',
      });
      return input.id;
    }
    if (get(ctx, 'SELECT id FROM roles WHERE name = ? COLLATE NOCASE', input.name)) throw conflict('A role with this name already exists');
    const res = run(ctx, 'INSERT INTO roles (name, description, is_system, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', input.name, input.description, now, now);
    const newId = Number(res.lastInsertRowid);
    const ins = ctx.sqlite.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of perms) ins.run(newId, p);
    audit(ctx, { action: 'ROLE_CREATE', entityType: 'role', entityId: newId, description: `Created role "${input.name}" with ${perms.length} permissions`, details: { permissions: perms } });
    return newId;
  });
  return listRoles(ctx).find((r) => r.id === id)!;
}

export function deleteRole(ctx: ServiceContext, id: number): void {
  const role = listRoles(ctx).find((r) => r.id === id);
  if (!role) throw notFound('Role');
  if (role.isSystem) throw rule('The Administrator role cannot be deleted');
  const users = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM users WHERE role_id = ?', id)!.n;
  if (users > 0) throw rule('This role is assigned to users. Reassign them before deleting the role.');
  transaction(ctx, () => {
    run(ctx, 'DELETE FROM role_permissions WHERE role_id = ?', id);
    run(ctx, 'DELETE FROM roles WHERE id = ?', id);
    audit(ctx, { action: 'ROLE_DELETE', entityType: 'role', entityId: id, description: `Deleted role "${role.name}"`, severity: 'WARNING' });
  });
}
