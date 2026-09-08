// Rafraîchissement des jetons d'accès Gmail/Outlook, extrait de
// gmailSync.ts/outlookSync.ts pour que server/mailSend.ts (l'envoi unifié
// utilisé par /api/send-email) puisse s'en servir sans dupliquer la logique
// de refresh — en particulier la rotation du refresh_token Microsoft, qui
// doit être persistée à chaque appel ou la connexion cesse de fonctionner.
//
// Cache par connection.id (server/mailTokenCache.ts), pas par user_id : deux
// comptes du même fournisseur pour un même utilisateur ne doivent pas se
// servir mutuellement leur jeton.
import { gmailAccessTokenCache, outlookAccessTokenCache, calendarAccessTokenCache } from './mailTokenCache';
import { tenantScopedFrom } from './tenantScopedFrom';
import { encryptSecret, decryptSecretMaybe } from './secretsCrypto';

export async function getGmailAccessToken(account: any): Promise<string> {
  const now = Date.now();
  const cached = gmailAccessTokenCache.get(account.id);
  if (cached && cached.expiresAt > now + 60000) return cached.token;

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decryptSecretMaybe(account.refresh_token),
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data: any = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Google');
  gmailAccessTokenCache.set(account.id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

/** Même mécanique que getGmailAccessToken, cache et champ refresh_token séparés (calendar_connections, pas email_connections). */
export async function getGoogleCalendarAccessToken(connection: any): Promise<string> {
  const now = Date.now();
  const cached = calendarAccessTokenCache.get(connection.id);
  if (cached && cached.expiresAt > now + 60000) return cached.token;

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decryptSecretMaybe(connection.refresh_token),
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data: any = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Google');
  calendarAccessTokenCache.set(connection.id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

const OUTLOOK_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const OUTLOOK_SCOPE = 'offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send';

export async function getOutlookAccessToken(supabaseAdmin: any, account: any): Promise<string> {
  const now = Date.now();
  const cached = outlookAccessTokenCache.get(account.id);
  if (cached && cached.expiresAt > now + 60000) return cached.token;

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('AZURE_CLIENT_ID / AZURE_CLIENT_SECRET non configurés');

  const currentRefreshToken = decryptSecretMaybe(account.refresh_token);
  const resp = await fetch(`${OUTLOOK_AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: currentRefreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPE,
    }).toString(),
  });
  const data: any = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Microsoft');
  // Microsoft rotates refresh tokens on each use — persist the new one or
  // the connection stops working once the original expires/is revoked.
  if (data.refresh_token && data.refresh_token !== currentRefreshToken) {
    account.refresh_token = data.refresh_token;
    tenantScopedFrom(supabaseAdmin, account.tenant_id, 'email_connections')
      .update({ refresh_token: encryptSecret(data.refresh_token) }).eq('id', account.id)
      .then(() => {}, (err: any) => console.error('[Outlook refresh_token persist]', err.message));
  }
  outlookAccessTokenCache.set(account.id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}
