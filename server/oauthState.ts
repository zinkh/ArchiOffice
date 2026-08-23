// Shared by every OAuth authorization-code flow in the app: Zoho Invoice,
// Zoho Books (server/routes/zoho*.ts), Google Calendar, Gmail and Outlook
// (server/routes/{googleCalendarSync,gmailSync,outlookSync}.ts).
//
// Their callback routes are hit by a plain browser navigation from the
// provider's consent screen — it can't carry our app's JWT, so the tenant has
// to be recovered from the OAuth `state` param instead. Using the bare tenantId
// as `state` (the original approach) is a CSRF hole: anyone who learns a
// tenant's UUID could complete their own consent with `state=<that tenantId>`
// and bind their refresh_token to someone else's tenant. Issuing a random,
// single-use, short-lived nonce and requiring the callback to present exactly
// that nonce closes it.
//
// These nonces used to live in a per-process Map, on the stated assumption that
// "the whole authorization-code round trip completes within the same server
// process". That assumption is wrong in production. /api/<provider>/auth and
// the provider's redirect to /api/<provider>/callback are two independent HTTP
// requests; behind the load balancer they can land on different containers, and
// a deploy or restart between them drops the nonce either way. The callback
// then rejected a perfectly good grant as an expired request. They live in the
// `oauth_states` table now, so every instance sees the same nonces.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthStateData {
  tenantId: string;
  userId?: string;
  returnTo?: string;
}

// Set once at boot from server.ts. Kept as a module variable rather than
// threaded through every route's deps so the five call sites keep their current
// shape.
let store: any = null;

export function initOAuthStateStore(supabaseAdmin: any): void {
  store = supabaseAdmin;
}

// Fallback for the window between deploying this code and applying
// migrate_add_oauth_states.sql (and for any context that never initialises the
// store). Degrading to the old per-process behaviour is worse than the table,
// but far better than failing every "Connecter" click outright.
const pendingStates = new Map<string, OAuthStateData & { expiresAt: number }>();

function rememberLocally(state: string, data: OAuthStateData): void {
  const now = Date.now();
  for (const [key, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(key);
  }
  pendingStates.set(state, { ...data, expiresAt: now + STATE_TTL_MS });
}

function takeLocally(state: string): OAuthStateData | null {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return { tenantId: entry.tenantId, userId: entry.userId, returnTo: entry.returnTo };
}

/**
 * Mints a one-time nonce for an outbound consent URL.
 *
 * userId is set only by the per-user flows (Google Calendar, Gmail, Outlook —
 * each team member connects their own account); the per-tenant Zoho flows leave
 * it unset. returnTo lets a flow started from an arbitrary project/contact page
 * come back to it instead of a single hardcoded destination.
 */
export async function createOAuthState(tenantId: string, userId?: string, returnTo?: string): Promise<string> {
  const state = crypto.randomUUID();
  const data: OAuthStateData = { tenantId, userId, returnTo };

  if (!store) {
    console.warn('[oauthState] store not initialised — falling back to per-process state');
    rememberLocally(state, data);
    return state;
  }

  const { error } = await store.from('oauth_states').insert({
    state,
    tenant_id: tenantId,
    user_id: userId ?? null,
    return_to: returnTo ?? null,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  if (error) {
    console.error('[oauthState] could not persist state, falling back to per-process', error);
    rememberLocally(state, data);
    return state;
  }

  // Opportunistic sweep, unawaited: expired nonces are dead weight, and the
  // user is waiting on the redirect this call produces.
  Promise.resolve(store.from('oauth_states').delete().lt('expires_at', new Date().toISOString()))
    .catch(() => { /* best effort */ });

  return state;
}

/**
 * One-time use: returns the data behind `state` and removes it, or null if the
 * state is missing, unknown, expired, or already consumed.
 */
export async function consumeOAuthState(state: string | undefined): Promise<OAuthStateData | null> {
  if (!state) return null;

  // Check the local map first: it holds anything minted by this process while
  // the store was unavailable, and it's free.
  const local = takeLocally(state);
  if (local) return local;

  if (!store) return null;

  const { data } = await store
    .from('oauth_states')
    .select('tenant_id, user_id, return_to, expires_at')
    .eq('state', state)
    .maybeSingle();

  // Delete unconditionally — a presented nonce is spent whether or not it was
  // still valid, so a captured one can't be retried.
  await store.from('oauth_states').delete().eq('state', state);

  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return {
    tenantId: data.tenant_id,
    userId: data.user_id ?? undefined,
    returnTo: data.return_to ?? undefined,
  };
}

// OAuth providers report failures as short snake_case codes (invalid_client,
// invalid_code, access_denied, ...). A callback can't render an error page — it
// has to redirect the browser back into the SPA — so the reason travels as a
// query param. Pass only that shape through, so an upstream message can never
// inject arbitrary text (extra params, markup) into the URL the browser lands
// on; anything else degrades to a generic '1'.
export function oauthErrorParam(reason: unknown): string {
  const code = typeof reason === 'string' ? reason : '';
  return /^[a-z_]{1,40}$/.test(code) ? code : '1';
}
