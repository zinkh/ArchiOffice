// Encrypts secrets that must be stored server-side outside of Electron's
// reach (server/ipcCrypto.ts only works inside the packaged desktop app, via
// IPC to the main process — this server also runs standalone in Docker/SaaS,
// where that channel doesn't exist). Used for real mailbox passwords
// (server/routes/imapMailSync.ts) and, since the 2026-08 compliance audit,
// for the OAuth refresh tokens stored per connected integration (Gmail,
// Google Calendar, Outlook, Zoho — server/routes/*Sync.ts, zohoBooks.ts,
// zohoInvoice.ts): provider-side revocability reduces the blast radius of a
// leak but doesn't make plaintext storage of a live, long-lived credential
// acceptable, so these are encrypted at rest here too.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('MAIL_ENCRYPTION_KEY non configuré');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY doit être 32 octets encodés en base64 (ex. openssl rand -base64 32)');
  return key;
}

/** @returns base64-encoded "iv:authTag:ciphertext" */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** @param encoded as returned by encryptSecret */
export function decryptSecret(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Same as decryptSecret, but tolerates rows written before a given field was
 * encrypted (e.g. OAuth refresh tokens stored in plaintext prior to the
 * 2026-08 compliance pass) or a missing MAIL_ENCRYPTION_KEY: GCM auth-tag
 * verification fails deterministically on anything that isn't real
 * ciphertext, so falling back to the raw value on any decrypt error is safe
 * and lets already-connected integrations keep working until they next
 * rotate their token (which re-encrypts it via encryptSecret).
 */
export function decryptSecretMaybe(value: string | null | undefined): string {
  if (!value) return value || '';
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}
