export interface SessionInfo {
  user: {
    id: number;
    username: string;
    fullName: string;
    roleId: number;
    roleName: string;
  };
  permissions: string[];
  mustChangePassword: boolean;
  locked: boolean;
  startedAt: string;
  autoLockMinutes: number;
}

export interface OverrideResult {
  token: string;
  grantedBy: string;
  permission: string;
  expiresAt: string;
}

export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  phone: string | null;
  roleId: number;
  roleName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export interface BootstrapInfo {
  pharmacyName: string;
  logo: string;
  language: 'en' | 'ur';
  version: string;
  firstRun: boolean;
  hasData: boolean;
  defaultAdminActive: boolean;
}
