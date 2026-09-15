// Écran de consentement de la liaison MCP (Gemini "Connected Apps → Custom
// apps for Spark", voir packages/archioffice-agents/src/server/mcp/*.ts).
// Gemini navigue ici en GET (redirigé par le serveur OAuth minimal côté
// backend, /oauth/mcp/authorize) car il n'a aucun moyen de porter le JWT
// Supabase de l'architecte — c'est la session déjà ouverte dans CE navigateur
// qui authentifie, exactement comme n'importe quelle autre page protégée.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/lib/api';
import { IconPlugConnected } from '@tabler/icons-react';

export default function McpAuthorize() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method') || 'S256';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state');

  const missing = !clientId || !redirectUri || !codeChallenge;

  const handleAuthorize = async () => {
    setLoading(true);
    setError(null);
    try {
      const { redirect_to } = await apiFetch<{ redirect_to: string }>('/api/mcp/authorize', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId, redirect_uri: redirectUri,
          code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod,
          scope, state,
        }),
      });
      window.location.href = redirect_to;
    } catch (e: any) {
      setError(e.message || t('mcp_authorize_error'));
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-16 px-4">
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <IconPlugConnected className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t('mcp_authorize_title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('mcp_authorize_description')}</p>
        {missing ? (
          <p className="mt-4 text-sm text-destructive">{t('mcp_authorize_invalid_request')}</p>
        ) : (
          <>
            <ul className="mt-4 space-y-1 text-left text-sm text-muted-foreground">
              <li>• {t('mcp_authorize_scope_projects')}</li>
              <li>• {t('mcp_authorize_scope_tasks')}</li>
              <li>• {t('mcp_authorize_scope_invoices')}</li>
            </ul>
            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
            <button
              onClick={handleAuthorize}
              disabled={loading}
              className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? t('mcp_authorize_connecting') : t('mcp_authorize_confirm')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
