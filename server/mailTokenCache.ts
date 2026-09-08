// Caches d'access token en mémoire pour les connexions OAuth (Gmail,
// Outlook, Google Calendar) — extraits de gmailSync.ts/outlookSync.ts/
// googleCalendarSync.ts (qui les déclaraient chacun localement) pour que
// server/routes/mailAccounts.ts et calendarAccounts.ts puissent les vider à
// la déconnexion d'un compte sans connaître les internes de ces fichiers.
//
// Clé = connection.id (pas connection.user_id comme avant le support
// multi-comptes) : deux comptes du même fournisseur pour un même utilisateur
// ne doivent pas se servir mutuellement leur jeton.
export const gmailAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();
export const outlookAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();
export const calendarAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearMailAccountCaches(accountId: string): void {
  gmailAccessTokenCache.delete(accountId);
  outlookAccessTokenCache.delete(accountId);
}
