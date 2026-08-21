// Encrypts secrets that must be stored server-side outside of Electron's
// reach (server/ipcCrypto.ts only works inside the packaged desktop app, via
// IPC to the main process — this server also runs standalone in Docker/SaaS,
// where that channel doesn't exist). Used for real mailbox passwords
// (server/routes/imapMailSync.ts) — unlike an OAuth refresh_token, which is
// revocable from the provider's side and already stored in plaintext for
// Google Calendar (calendar_connections), a raw IMAP password is the actual
// account credential, so it gets encrypted at rest here.
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
