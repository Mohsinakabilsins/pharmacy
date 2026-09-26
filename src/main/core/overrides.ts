import { randomBytes } from 'node:crypto';
import type { PermissionKey } from '@shared/permissions';
import { AppError } from './errors';

export interface OverrideGrant {
  token: string;
  permission: PermissionKey;
  grantedById: number;
  grantedByName: string;
  reason: string;
  expiresAt: number;
}

const TTL_MS = 2 * 60 * 1000;

/**
 * Single-use supervisor override tokens, held only in main-process memory.
 * A supervisor enters their credentials; the token authorises exactly one protected action.
 */
export class OverrideStore {
  private grants = new Map<string, OverrideGrant>();

  issue(permission: PermissionKey, grantedById: number, grantedByName: string, reason: string, now = Date.now()): OverrideGrant {
    this.prune(now);
    const token = randomBytes(18).toString('base64url');
    const grant = { token, permission, grantedById, grantedByName, reason, expiresAt: now + TTL_MS };
    this.grants.set(token, grant);
    return grant;
  }

  /** Validate and consume a token for `permission`. Throws when invalid. */
  consume(token: string | null | undefined, permission: PermissionKey, now = Date.now()): OverrideGrant {
    const grant = token ? this.grants.get(token) : undefined;
    if (!grant || grant.expiresAt < now || grant.permission !== permission) {
      if (grant && grant.expiresAt < now) this.grants.delete(grant.token);
      throw new AppError('OVERRIDE_REQUIRED', 'Supervisor authorisation is required for this action', undefined, { permission });
    }
    this.grants.delete(grant.token);
    return grant;
  }

  /** Validate without consuming (used by quotes). */
  peek(token: string | null | undefined, permission: PermissionKey, now = Date.now()): OverrideGrant | null {
    const grant = token ? this.grants.get(token) : undefined;
    if (!grant || grant.expiresAt < now || grant.permission !== permission) return null;
    return grant;
  }

  private prune(now: number) {
    for (const [k, g] of this.grants) if (g.expiresAt < now) this.grants.delete(k);
  }
}

export const overrides = new OverrideStore();
