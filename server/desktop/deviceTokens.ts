// Appareils de synchronisation desktop (Explorateur Windows, Finder macOS) et leurs jetons.
// Voir docs/desktop-sync-contract.md, section 3.1.
//
// Le client natif ne détient JAMAIS de JWT Supabase : l'application Electron, connectée,
// enregistre l'appareil et lui remet un jeton `ds_at_…`. Même famille que `mcp_at_`,
// `tg_at_` et `mail_at_` (résolus dans le middleware /api de server.ts), avec deux
// différences voulues :
//  * le jeton est rattaché à la PERSONNE, pas à un cabinet : le cabinet se désigne à chaque
//    requête par `X-Tenant-Id`, revérifié contre les adhésions ;
//  * il ne donne accès qu'à /api/desktop/v1 (restriction posée dans server.ts), pas à l'API
//    entière comme un jeton MCP.
// Seul le SHA-256 du jeton est stocké ; il n'est rendu qu'une fois, à l'enregistrement.
import crypto from 'crypto';
import { hashToken } from '../telegramBot';

export const DEVICE_TOKEN_PREFIX = 'ds_at_';
/** Durée de vie glissante : repoussée à chaque usage, au plus une fois par heure. */
export const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;
const MAX_DEVICES_PER_USER = 20;

export type DevicePlatform = 'windows' | 'macos';
const PLATFORMS: readonly DevicePlatform[] = ['windows', 'macos'];

export interface DeviceInput {
  name: string;
  platform: DevicePlatform;
  appVersion: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

/** Valide le corps d'un enregistrement. Rend un message d'erreur, jamais d'exception. */
export function parseDeviceInput(body: any): { input: DeviceInput } | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return { error: "Le nom de l'appareil est requis (80 caractères au plus)." };
  const platform = body?.platform;
  if (!PLATFORMS.includes(platform)) return { error: "La plateforme doit être « windows » ou « macos »." };
  const rawVersion = body?.appVersion;
  if (rawVersion != null && (typeof rawVersion !== 'string' || rawVersion.length > 40)) {
    return { error: 'Version de l\'application invalide.' };
  }
  return { input: { name, platform, appVersion: rawVersion ? String(rawVersion).trim() || null : null } };
}

function toInfo(row: any): DeviceInfo {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    expiresAt: row.expires_at,
  };
}

export class TooManyDevicesError extends Error {
  constructor() {
    super(`Vous avez déjà ${MAX_DEVICES_PER_USER} appareils enregistrés : révoquez-en un avant d'en ajouter.`);
    this.name = 'TooManyDevicesError';
  }
}

/** Enregistre un appareil. Le jeton en clair n'est rendu qu'ici. */
export async function issueDevice(
  supabaseAdmin: any,
  userId: string,
  input: DeviceInput,
): Promise<{ device: DeviceInfo; token: string }> {
  const { data: existing, error: listError } = await supabaseAdmin
    .from('desktop_devices').select('id').eq('user_id', userId).is('revoked_at', null);
  if (listError) throw listError;
  if ((existing || []).length >= MAX_DEVICES_PER_USER) throw new TooManyDevicesError();

  const token = `${DEVICE_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  const row = {
    id: `dev_${crypto.randomBytes(9).toString('hex')}`,
    user_id: userId,
    name: input.name,
    platform: input.platform,
    app_version: input.appVersion,
    token_hash: hashToken(token),
    created_at: new Date(now).toISOString(),
    last_seen_at: null,
    expires_at: new Date(now + DEVICE_TOKEN_TTL_MS).toISOString(),
    revoked_at: null,
  };
  const { error } = await supabaseAdmin.from('desktop_devices').insert(row);
  if (error) throw error;
  return { device: toInfo(row), token };
}

export type ResolvedDevice =
  | { status: 'ok'; deviceId: string; userId: string }
  | { status: 'revoked' }
  | { status: 'expired' };

/**
 * Résout un jeton. `null` pour un jeton inconnu ou mal formé (même réponse que pour un
 * JWT invalide) ; `revoked` et `expired` sont distingués pour que le client natif sache
 * qu'il doit effacer ses données locales plutôt que réessayer.
 */
export async function resolveDeviceToken(supabaseAdmin: any, token: string): Promise<ResolvedDevice | null> {
  if (!token || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const { data: row } = await supabaseAdmin
    .from('desktop_devices').select('*').eq('token_hash', hashToken(token)).maybeSingle();
  if (!row) return null;
  if (row.revoked_at) return { status: 'revoked' };
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return { status: 'expired' };

  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (now - seen > LAST_SEEN_REFRESH_MS) {
    // Meilleur effort : une écriture qui échoue ne doit pas refuser un appareil valide.
    await supabaseAdmin.from('desktop_devices')
      .update({ last_seen_at: new Date(now).toISOString(), expires_at: new Date(now + DEVICE_TOKEN_TTL_MS).toISOString() })
      .eq('id', row.id).then(() => undefined, () => undefined);
  }
  return { status: 'ok', deviceId: row.id, userId: row.user_id };
}

export async function listDevices(supabaseAdmin: any, userId: string): Promise<DeviceInfo[]> {
  const { data, error } = await supabaseAdmin
    .from('desktop_devices').select('*').eq('user_id', userId).is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toInfo);
}

/** Révoque un appareil de la personne. Faux s'il n'existe pas ou n'est pas le sien. */
export async function revokeDevice(supabaseAdmin: any, userId: string, deviceId: string): Promise<boolean> {
  const { data: row } = await supabaseAdmin
    .from('desktop_devices').select('id, revoked_at').eq('id', deviceId).eq('user_id', userId).maybeSingle();
  if (!row) return false;
  if (row.revoked_at) return true;
  const { error } = await supabaseAdmin.from('desktop_devices')
    .update({ revoked_at: new Date().toISOString() }).eq('id', deviceId).eq('user_id', userId);
  if (error) throw error;
  return true;
}
