import { z } from 'zod';
import { ALL_PERMISSIONS } from '../permissions';
import { zId, zOptionalText, zRequiredText } from './common';

export const LoginSchema = z.object({
  username: zRequiredText('Username', 60),
  password: z.string().min(1, 'Password is required').max(128),
});

export const UnlockSchema = z.object({ password: z.string().min(1, 'Password is required').max(128) });

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z.string().min(1, 'New password is required').max(128),
});

export const OverrideSchema = z.object({
  username: zRequiredText('Username', 60),
  password: z.string().min(1, 'Password is required').max(128),
  permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]),
  reason: z.string().trim().max(300).default(''),
});

const usernameRule = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore');

export const UserCreateSchema = z.object({
  username: usernameRule,
  fullName: zRequiredText('Full name', 120),
  phone: zOptionalText(40),
  roleId: zId,
  password: z.string().min(1, 'Password is required').max(128),
  mustChangePassword: z.boolean().default(true),
});

export const UserUpdateSchema = z.object({
  id: zId,
  fullName: zRequiredText('Full name', 120),
  phone: zOptionalText(40),
  roleId: zId,
  isActive: z.boolean(),
});

export const ResetPasswordSchema = z.object({
  id: zId,
  newPassword: z.string().min(1, 'Password is required').max(128),
});

export const RoleSaveSchema = z.object({
  id: zId.optional(),
  name: zRequiredText('Role name', 60),
  description: zOptionalText(200),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(200),
});
