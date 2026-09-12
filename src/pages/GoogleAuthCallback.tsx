/**
 * OAuth2 callback page — opened in a popup by googleAuth.ts.
 * Exchanges the authorization code for an access_token via the backend,
 * then posts the token to the opener and closes the popup.
 *
 * The popup used to auto-close on both success (800ms) and error (3000ms),
 * which made it impossible for a user to actually read what went wrong when
 * diagnosing a failed sync — by the time devtools was open on the popup, it
 * had already closed. On error, it now stays open with a manual "Fermer"
 * button and enough diagnostic detail (opener present?, code/state received?)
 * to tell which step failed without needing the browser console.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function GoogleAuthCallback() {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState('Connexion en cours…');
  const [diagnostic, setDiagnostic] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const diag: string[] = [];
      diag.push(`Fenêtre parente accessible (window.opener) : ${window.opener ? 'oui' : 'NON'}`);
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');
        diag.push(`Code d'autorisation reçu : ${code ? 'oui' : 'NON'}`);
        diag.push(`Paramètre state reçu : ${state ? 'oui' : 'NON'}`);

        if (error) throw new Error(`Google a renvoyé une erreur : ${error}`);
        if (!code) throw new Error('Code d\'autorisation manquant');

        // See googleAuth.ts for why this is localStorage and not sessionStorage.
        const savedState = localStorage.getItem('google_oauth_state');
        const verifier = localStorage.getItem('google_oauth_verifier');
        diag.push(`State attendu retrouvé en localStorage : ${savedState ? 'oui' : 'NON'}`);
        diag.push(`Verifier PKCE retrouvé en localStorage : ${verifier ? 'oui' : 'NON'}`);
        localStorage.removeItem('google_oauth_state');
        localStorage.removeItem('google_oauth_verifier');

        if (state !== savedState) throw new Error('State invalide (CSRF)');
        if (!verifier) throw new Error('Verifier PKCE manquant');

        // Exchange code for token on backend
        const { access_token } = await apiFetch<{ access_token: string }>(
          '/api/auth/google/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: window.location.origin + '/auth/google/callback' })
          }
        );
        diag.push('Échange du code contre un jeton auprès du serveur : réussi');

        setStatus('done');
        setMessage('Connexion réussie, fermeture…');
        setDiagnostic(diag);

        window.opener?.postMessage({ type: 'google_oauth_token', access_token }, window.location.origin);
        setTimeout(() => window.close(), 1500);
      } catch (err: any) {
        diag.push(`Erreur : ${err.message || err}`);
        setStatus('error');
        setMessage(err.message || 'Erreur de connexion');
        setDiagnostic(diag);
        window.opener?.postMessage({ type: 'google_oauth_token', error: err.message }, window.location.origin);
        // No auto-close here on purpose — see file header comment: a failed
        // attempt needs to stay on screen long enough to actually read.
      }
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', gap: 12, padding: 24 }}>
      {status === 'loading' && <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
      {status === 'done' && <div style={{ fontSize: 32 }}>✓</div>}
      {status === 'error' && <div style={{ fontSize: 32 }}>✗</div>}
      <p style={{ color: status === 'error' ? '#dc2626' : '#374151' }}>{message}</p>
      {status === 'error' && (
        <>
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, fontSize: 12, color: '#374151', maxWidth: 480, textAlign: 'left', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {diagnostic.join('\n')}
          </div>
          <button
            onClick={() => window.close()}
            style={{ marginTop: 8, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Fermer
          </button>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
