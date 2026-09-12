/**
 * Google OAuth2 PKCE flow for Google Contacts access.
 *
 * Setup:
 *  1. Create a project at https://console.cloud.google.com/
 *  2. Enable the "People API"
 *  3. Create an OAuth2 "Web Application" client
 *  4. Add your app origin to "Authorised JavaScript origins"
 *  5. Set VITE_GOOGLE_CLIENT_ID in your .env
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPES = 'https://www.googleapis.com/auth/contacts.readonly';
const REDIRECT_URI = `${window.location.origin}/auth/google/callback`;

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Same key builder used by GoogleAuthCallback.tsx to hand back the result. */
export function oauthResultKey(state: string): string {
  return `google_oauth_result_${state}`;
}

/**
 * Opens a popup for Google OAuth2 PKCE flow and resolves with the access_token.
 * Rejects if the popup is closed or if CLIENT_ID is not configured.
 */
export async function requestGoogleAccessToken(): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error(
      'VITE_GOOGLE_CLIENT_ID non configuré. ' +
      'Ajoutez votre Client ID Google OAuth2 dans le fichier .env.'
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  // localStorage, not sessionStorage: sessionStorage is scoped per top-level
  // browsing context, copied to a popup only when the popup's *initial*
  // navigation target is same-origin as the opener. Here the popup navigates
  // straight to accounts.google.com (cross-origin from the start), so no copy
  // ever happens — when it later lands back on our own /auth/google/callback,
  // that's its first visit to our origin in this popup, and sessionStorage
  // reads back empty there, failing the CSRF check every time. localStorage
  // has no such per-context copy step: it's the same store for every
  // same-origin window, popup included.
  localStorage.setItem('google_oauth_verifier', verifier);
  localStorage.setItem('google_oauth_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  // Open popup centered on screen
  const width = 500;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  const popup = window.open(
    authUrl,
    'google_oauth',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
  );

  if (!popup) {
    throw new Error('Le popup a été bloqué. Autorisez les popups pour ce site.');
  }

  const resultKey = oauthResultKey(state);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('storage', storageHandler);
      localStorage.removeItem(resultKey);
      fn();
    };

    const applyResult = (raw: string) => {
      try {
        const data = JSON.parse(raw);
        if (data.error) finish(() => reject(new Error(data.error)));
        else finish(() => resolve(data.access_token as string));
      } catch {
        finish(() => reject(new Error('Réponse de connexion Google illisible')));
      }
    };

    // Primary channel: window.opener + postMessage. This is what most OAuth
    // popup flows rely on, but it silently breaks whenever the opener/popup
    // relationship gets severed by a Cross-Origin-Opener-Policy mismatch
    // anywhere along the redirect chain through accounts.google.com — a class
    // of failure that showed up repeatedly here and is effectively impossible
    // to fully rule out from this side alone (it depends on headers set by a
    // third party's pages too, not just ours).
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'google_oauth_token') return;
      if (event.data.error) finish(() => reject(new Error(event.data.error)));
      else finish(() => resolve(event.data.access_token as string));
    };
    window.addEventListener('message', messageHandler);

    // Fallback channel: localStorage, shared unconditionally by every
    // same-origin window regardless of opener/COOP state. The 'storage' event
    // fires on this (listening) window whenever another same-origin window
    // writes to localStorage — the popup writing its result is exactly that.
    const storageHandler = (event: StorageEvent) => {
      if (event.key === resultKey && event.newValue) applyResult(event.newValue);
    };
    window.addEventListener('storage', storageHandler);

    // Belt-and-braces: also poll localStorage directly (some browsers are
    // inconsistent about firing 'storage' for same-tab-group writes), and
    // detect the popup closing without ever producing a result either way.
    const poll = setInterval(() => {
      const raw = localStorage.getItem(resultKey);
      if (raw) { applyResult(raw); return; }
      if (popup.closed) finish(() => reject(new Error('Connexion annulée')));
    }, 500);
  });
}
