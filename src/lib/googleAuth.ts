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

  sessionStorage.setItem('google_oauth_verifier', verifier);
  sessionStorage.setItem('google_oauth_state', state);

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

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'google_oauth_token') return;
      window.removeEventListener('message', handler);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.access_token as string);
      }
    };
    window.addEventListener('message', handler);

    // Detect popup closed without completing
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener('message', handler);
        reject(new Error('Connexion annulée'));
      }
    }, 500);
  });
}
