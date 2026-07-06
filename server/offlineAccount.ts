import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface LocalAccount {
  userId: string;
  tenantId: string;
  email: string;
  agencyName: string;
  passwordHash: string;
}

interface AdminUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

function getDataDir(): string {
  const dir = process.env.OFFLINE_DATA_DIR || path.join(process.cwd(), '.offline-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function jwtSecretPath(): string {
  return path.join(getDataDir(), 'jwt-secret.txt');
}

function localAccountPath(): string {
  return path.join(getDataDir(), 'local-account.json');
}

function adminUsersPath(): string {
  return path.join(getDataDir(), 'auth-users.json');
}

export function getOrCreateJwtSecret(): string {
  const p = jwtSecretPath();
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(p, secret, { mode: 0o600 });
  return secret;
}

export function signLocalJwt(userId: string): string {
  return jwt.sign({ sub: userId }, getOrCreateJwtSecret(), { expiresIn: '30d' });
}

export function verifyLocalJwt(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, getOrCreateJwtSecret()) as { sub: string };
  } catch {
    return null;
  }
}

export function readLocalAccount(): LocalAccount | null {
  const p = localAccountPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeLocalAccount(account: LocalAccount): void {
  fs.writeFileSync(localAccountPath(), JSON.stringify(account, null, 2), { mode: 0o600 });
}

export function readAdminUsers(): AdminUser[] {
  const p = adminUsersPath();
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeAdminUsers(users: AdminUser[]): void {
  fs.writeFileSync(adminUsersPath(), JSON.stringify(users, null, 2), { mode: 0o600 });
}

export function storageDir(bucket: string): string {
  const dir = path.join(getDataDir(), 'storage', bucket);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** GoTrue-shaped user object (matches auth-js's `User` interface) for the local account. */
export function goTrueUserFromAccount(account: LocalAccount) {
  return {
    id: account.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    email_confirmed_at: new Date(0).toISOString(),
    app_metadata: { provider: 'local' },
    user_metadata: { name: account.agencyName },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

export { getDataDir };
export type { AdminUser };
