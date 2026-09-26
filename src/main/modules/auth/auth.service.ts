import type { SessionInfo } from '@shared/types/auth';
import type { PermissionKey } from '@shared/permissions';
import { audit } from '../../core/audit';
import { get, all, run, transaction, requireUser, type ServiceContext, type SessionUser } from '../../core/context';
import { AppError, invalid } from '../../core/errors';
import { getSettings } from '../../core/settings';
import type { ActiveSession } from '../../core/session';
import { hashPassword, passwordPolicyError, verifyPassword } from './password';

interface UserRecord {
  id: number;
  username: string;
  full_name: string;
  password_hash: string;
  role_id: number;
  role_name: string;
  is_active: number;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
}

const USER_SQL = `SELECT u.id, u.username, u.full_name, u.password_hash, u.role_id, r.name AS role_name, u.is_active,
  u.must_change_password, u.failed_attempts, u.locked_until
  FROM users u JOIN roles r ON r.id = u.role_id`;

export function loadSessionUser(ctx: ServiceContext, userId: number): SessionUser | null {
  const u = get<UserRecord>(ctx, `${USER_SQL} WHERE u.id = ?`, userId);
  if (!u || !u.is_active) return null;
  const perms = all<{ permission_key: string }>(ctx, 'SELECT permission_key FROM role_permissions WHERE role_id = ?', u.role_id);
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    roleId: u.role_id,
    roleName: u.role_name,
    permissions: new Set(perms.map((p) => p.permission_key)),
  };
}

export function toSessionInfo(ctx: ServiceContext, s: ActiveSession): SessionInfo {
  return {
    user: { id: s.user.id, username: s.user.username, fullName: s.user.fullName, roleId: s.user.roleId, roleName: s.user.roleName },
    permissions: Array.from(s.user.permissions),
    mustChangePassword: s.mustChangePassword,
    locked: s.locked,
    startedAt: s.startedAt,
    autoLockMinutes: getSettings(ctx).security.autoLockMinutes,
  };
}

/**
 * Verify credentials with lockout protection. Returns the user record on success.
 * Failed attempts are counted and audit-logged.
 */
export function verifyCredentials(ctx: ServiceContext, username: string, password: string, purpose: 'LOGIN' | 'UNLOCK' | 'OVERRIDE'): UserRecord {
  const sec = getSettings(ctx).security;
  const u = get<UserRecord>(ctx, `${USER_SQL} WHERE u.username = ? COLLATE NOCASE`, username.trim());
  const nowMs = ctx.now().getTime();
  if (!u) {
    audit(ctx, { action: `${purpose}_FAILED`, entityType: 'user', description: `Failed ${purpose.toLowerCase()} for unknown user "${username}"`, severity: 'WARNING', userId: null, username });
    throw new AppError('UNAUTHENTICATED', 'Incorrect username or password');
  }
  if (!u.is_active) {
    audit(ctx, { action: `${purpose}_FAILED`, entityType: 'user', entityId: u.id, description: `Inactive account "${u.username}" attempted ${purpose.toLowerCase()}`, severity: 'WARNING', userId: u.id, username: u.username });
    throw new AppError('UNAUTHENTICATED', 'This account has been deactivated');
  }
  if (u.locked_until && Date.parse(u.locked_until) > nowMs) {
    const mins = Math.ceil((Date.parse(u.locked_until) - nowMs) / 60_000);
    throw new AppError('LOCKED', `Account temporarily locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  if (!verifyPassword(password, u.password_hash)) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= sec.maxFailedAttempts;
    const lockedUntil = lock ? new Date(nowMs + sec.lockoutMinutes * 60_000).toISOString() : null;
    run(ctx, 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', lock ? 0 : attempts, lockedUntil, u.id);
    audit(ctx, {
      action: `${purpose}_FAILED`,
      entityType: 'user',
      entityId: u.id,
      description: lock ? `Account "${u.username}" locked after ${attempts} failed attempts` : `Failed ${purpose.toLowerCase()} for "${u.username}" (attempt ${attempts})`,
      severity: lock ? 'CRITICAL' : 'WARNING',
      userId: u.id,
      username: u.username,
    });
    if (lock) throw new AppError('LOCKED', `Too many failed attempts. The account is locked for ${sec.lockoutMinutes} minutes.`);
    throw new AppError('UNAUTHENTICATED', 'Incorrect username or password');
  }
  if (u.failed_attempts > 0 || u.locked_until) run(ctx, 'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', u.id);
  return u;
}

export function login(ctx: ServiceContext, username: string, password: string): ActiveSession {
  // Credential verification commits its own failed-attempt bookkeeping (must not roll back).
  const u = verifyCredentials(ctx, username, password, 'LOGIN');
  return transaction(ctx, () => {
    const user = loadSessionUser(ctx, u.id)!;
    const now = ctx.now().toISOString();
    run(ctx, 'UPDATE users SET last_login_at = ? WHERE id = ?', now, u.id);
    const res = run(ctx, 'INSERT INTO user_sessions (user_id, started_at, last_activity_at) VALUES (?, ?, ?)', u.id, now, now);
    audit({ ...ctx, user }, { action: 'LOGIN', entityType: 'user', entityId: u.id, description: `${u.full_name} signed in` });
    return {
      user,
      sessionId: Number(res.lastInsertRowid),
      startedAt: now,
      lastActivity: ctx.now().getTime(),
      locked: false,
      mustChangePassword: !!u.must_change_password,
    };
  });
}

export function logout(ctx: ServiceContext, session: ActiveSession, reason: 'LOGOUT' | 'APP_EXIT' | 'RESTORE' = 'LOGOUT'): void {
  const now = ctx.now().toISOString();
  run(ctx, 'UPDATE user_sessions SET ended_at = ?, end_reason = ?, last_activity_at = ? WHERE id = ?', now, reason, now, session.sessionId);
  audit(ctx, { action: 'LOGOUT', entityType: 'user', entityId: session.user.id, description: `${session.user.fullName} signed out${reason !== 'LOGOUT' ? ` (${reason.toLowerCase().replace('_', ' ')})` : ''}` });
}

export function unlock(ctx: ServiceContext, session: ActiveSession, password: string): void {
  verifyCredentials(ctx, session.user.username, password, 'UNLOCK');
  audit(ctx, { action: 'UNLOCK', entityType: 'user', entityId: session.user.id, description: `${session.user.fullName} unlocked the session` });
}

export function changePassword(ctx: ServiceContext, currentPassword: string, newPassword: string): void {
  const user = requireUser(ctx);
  const sec = getSettings(ctx).security;
  const rec = get<UserRecord>(ctx, `${USER_SQL} WHERE u.id = ?`, user.id)!;
  if (!verifyPassword(currentPassword, rec.password_hash)) throw invalid('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
  const policy = passwordPolicyError(newPassword, sec.passwordMinLength);
  if (policy) throw invalid(policy, { newPassword: policy });
  if (verifyPassword(newPassword, rec.password_hash)) throw invalid('New password must be different from the current password', { newPassword: 'Choose a different password' });
  transaction(ctx, () => {
    run(ctx, 'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', hashPassword(newPassword), ctx.now().toISOString(), user.id);
    audit(ctx, { action: 'PASSWORD_CHANGE', entityType: 'user', entityId: user.id, description: `${user.fullName} changed their password` });
  });
}

/** Verify a supervisor's credentials and that they hold `permission`. */
export function authorizeOverride(ctx: ServiceContext, username: string, password: string, permission: PermissionKey, reason: string) {
  const u = verifyCredentials(ctx, username, password, 'OVERRIDE');
  const supervisor = loadSessionUser(ctx, u.id)!;
  if (!supervisor.permissions.has(permission)) {
    audit(ctx, { action: 'OVERRIDE_DENIED', entityType: 'user', entityId: u.id, description: `${u.full_name} lacks "${permission}" for an override`, severity: 'WARNING' });
    throw new AppError('FORBIDDEN', `${u.full_name} is not authorised to approve this action`);
  }
  audit(ctx, {
    action: 'SUPERVISOR_OVERRIDE',
    entityType: 'permission',
    entityId: permission,
    description: `${u.full_name} authorised "${permission}" for ${ctx.user?.fullName ?? 'the current user'}${reason ? ` — ${reason}` : ''}`,
    severity: 'WARNING',
    details: { supervisorId: u.id, permission, reason },
  });
  return supervisor;
}
