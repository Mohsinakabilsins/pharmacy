import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

/** scrypt password hash: `scrypt$N$r$p$salt$hash` (base64). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordPolicyError(password: string, minLength: number): string | null {
  if (password.length < minLength) return `Password must be at least ${minLength} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers';
  if (password.length > 128) return 'Password is too long';
  return null;
}
