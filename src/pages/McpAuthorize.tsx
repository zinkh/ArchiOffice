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
import { IconBan, IconCheck, IconPlugConnected } from '@tabler/icons-react';

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
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-6 text-[var(--tblr-text)] shadow-[var(--tblr-shadow)]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tblr-surface-2)] text-[var(--tblr-primary)]">
            <IconPlugConnected className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-base font-bold tracking-tight">{t('mcp_authorize_title')}</h1>
          <p className="mt-2 text-sm text-[var(--tblr-muted)]">{t('mcp_authorize_description')}</p>
        </div>
        {missing ? (
          <p role="alert" className="mt-6 text-center text-sm font-medium text-[var(--tblr-danger)]">{t('mcp_authorize_invalid_request')}</p>
        ) : (
          <>
            <ul className="mt-6 divide-y divide-[var(--tblr-border)] overflow-hidden rounded-lg border border-[var(--tblr-border)] text-left text-sm">
              <li className="flex gap-3 px-3 py-2.5"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--tblr-primary)]" aria-hidden="true" />{t('mcp_authorize_scope_read')}</li>
              <li className="flex gap-3 px-3 py-2.5"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--tblr-primary)]" aria-hidden="true" />{t('mcp_authorize_scope_write')}</li>
              <li className="flex gap-3 px-3 py-2.5"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--tblr-primary)]" aria-hidden="true" />{t('mcp_authorize_scope_drafts')}</li>
              <li className="flex gap-3 bg-[var(--tblr-surface-2)] px-3 py-2.5 font-medium"><IconBan className="mt-0.5 h-4 w-4 shrink-0 text-[var(--tblr-danger)]" aria-hidden="true" />{t('mcp_authorize_scope_never')}</li>
            </ul>
            {error && <p role="alert" className="mt-4 text-sm font-medium text-[var(--tblr-danger)]">{error}</p>}
            <button
              type="button"
              onClick={handleAuthorize}
              disabled={loading}
              className="btn btn-primary mt-6 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t('mcp_authorize_connecting') : t('mcp_authorize_confirm')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
