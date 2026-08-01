// Shared by the Zoho Invoice and Zoho Books OAuth authorization-code flows
// (server/routes/zohoInvoice.ts, zohoBooks.ts). Their callback route is hit
// by a plain browser navigation from Zoho's consent screen — it can't carry
// our app's JWT, so the tenant has to be recovered from the OAuth `state`
// param instead. Using the bare tenantId as `state` (the previous approach)
// is a CSRF hole: anyone who learns a tenant's UUID could complete their own
// Zoho consent with `state=<that tenantId>` and bind their refresh_token to
// someone else's tenant. Issuing a random, single-use, short-lived nonce
// here and requiring the callback to present exactly that nonce closes it.
//
// Deliberately in-memory, not persisted: the whole authorization-code round
// trip completes within the same server process in well under the TTL
// below. Losing an in-flight "Connecter Zoho" attempt across a deploy/
// restart is an acceptable failure mode — the user just clicks it again.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const pendingStates = new Map<string, { tenantId: string; expiresAt: number }>();

function cleanupExpired() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

export function createOAuthState(tenantId: string): string {
  cleanupExpired();
  const state = crypto.randomUUID();
  pendingStates.set(state, { tenantId, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

// One-time use: returns the tenantId and removes the entry, or null if the
// state is missing, unknown, expired, or already consumed.
export function consumeOAuthState(state: string | undefined): string | null {
  if (!state) return null;
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry.tenantId;
}
