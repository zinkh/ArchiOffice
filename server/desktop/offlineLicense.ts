import crypto from 'node:crypto';
import { hasActiveDriveSubscription } from './driveAccess';

export const MAX_OFFLINE_SECONDS = 72 * 60 * 60;
const ISSUER = 'archioffice-drive';
const AUDIENCE = 'archioffice-drive-agent';
export interface LicenseIdentity { userId: string; tenantId: string; deviceId: string }
export interface OfflineClaims extends LicenseIdentity {
  iss: string; aud: string; feature: 'archioffice_drive'; iat: number; exp: number;
}
const unavailable = () => Object.assign(new Error('L’autorisation hors connexion n’est pas configurée sur le serveur.'),
  { status: 503, code: 'DRIVE_LICENSE_UNAVAILABLE' });

/** Server only. No automatic key generation: restarts must not change trust. */
export function signOfflineLicense(identity: LicenseIdentity, tenant: any, now = Date.now()) {
  if (!hasActiveDriveSubscription(tenant, now)) {
    throw Object.assign(new Error('Un abonnement payant actif est requis.'), { status: 402, code: 'DRIVE_SUBSCRIPTION_REQUIRED' });
  }
  const pem = process.env.DRIVE_LICENSE_PRIVATE_KEY;
  const kid = process.env.DRIVE_LICENSE_KEY_ID;
  if (!pem || !kid || !/^[a-zA-Z0-9_-]{1,64}$/.test(kid)) throw unavailable();
  let key: crypto.KeyObject;
  try { key = crypto.createPrivateKey(pem); } catch { throw unavailable(); }
  if (key.asymmetricKeyType !== 'ed25519') throw unavailable();
  const iat = Math.floor(now / 1000);
  const exp = Math.min(iat + MAX_OFFLINE_SECONDS, Math.floor(Date.parse(tenant.trial_ends_at) / 1000));
  if (exp <= iat) throw unavailable();
  const claims: OfflineClaims = { userId: identity.userId, tenantId: identity.tenantId, deviceId: identity.deviceId, iss: ISSUER, aud: AUDIENCE, feature: 'archioffice_drive', iat, exp };
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return { license: `${header}.${payload}.${signature}`, expiresAt: new Date(exp * 1000).toISOString(), keyId: kid };
}

/** Trust keys must be provisioned independently, never accepted from the license response.
 * Caller must retain a trusted last-seen time and refuse clock rollback. No file deletion. */
export function verifyOfflineLicense(token: string, identity: LicenseIdentity,
  trustedKeys: Record<string, string>, now = Date.now(), lastSeenAt = now): OfflineClaims | null {
  try {
    if (!Number.isFinite(now) || !Number.isFinite(lastSeenAt) || now < lastSeenAt || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT' || typeof header.kid !== 'string'
      || !Object.hasOwn(trustedKeys, header.kid)) return null;
    const key = crypto.createPublicKey(trustedKeys[header.kid]);
    if (key.asymmetricKeyType !== 'ed25519'
      || !crypto.verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null;
    const c = JSON.parse(Buffer.from(p, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    if (c.iss !== ISSUER || c.aud !== AUDIENCE || c.feature !== 'archioffice_drive'
      || c.userId !== identity.userId || c.tenantId !== identity.tenantId || c.deviceId !== identity.deviceId
      || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp)
      || c.iat > seconds || c.exp <= seconds || c.exp <= c.iat || c.exp - c.iat > MAX_OFFLINE_SECONDS) return null;
    return c;
  } catch { return null; }
}
