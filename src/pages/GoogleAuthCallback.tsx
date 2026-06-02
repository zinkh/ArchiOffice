/**
 * OAuth2 callback page — opened in a popup by googleAuth.ts.
 * Exchanges the authorization code for an access_token via the backend,
 * then posts the token to the opener and closes the popup.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function GoogleAuthCallback() {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState('Connexion en cours…');

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');

        if (error) throw new Error(error);
        if (!code) throw new Error('Code d\'autorisation manquant');

        const savedState = sessionStorage.getItem('google_oauth_state');
        const verifier = sessionStorage.getItem('google_oauth_verifier');
        sessionStorage.removeItem('google_oauth_state');
        sessionStorage.removeItem('google_oauth_verifier');

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

        setStatus('done');
        setMessage('Connexion réussie, fermeture…');

        window.opener?.postMessage({ type: 'google_oauth_token', access_token }, window.location.origin);
        setTimeout(() => window.close(), 800);
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'Erreur de connexion');
        window.opener?.postMessage({ type: 'google_oauth_token', error: err.message }, window.location.origin);
        setTimeout(() => window.close(), 3000);
      }
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', gap: 12 }}>
      {status === 'loading' && <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
      {status === 'done' && <div style={{ fontSize: 32 }}>✓</div>}
      {status === 'error' && <div style={{ fontSize: 32 }}>✗</div>}
      <p style={{ color: status === 'error' ? '#dc2626' : '#374151' }}>{message}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
