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
    <div className="mx-auto max-w-lg py-16 px-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
            <IconPlugConnected className="h-7 w-7 text-zinc-700 dark:text-zinc-200" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{t('mcp_authorize_title')}</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('mcp_authorize_description')}</p>
        </div>
        {missing ? (
          <p className="mt-6 text-center text-sm font-medium text-red-600 dark:text-red-400">{t('mcp_authorize_invalid_request')}</p>
        ) : (
          <>
            <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-left text-sm text-zinc-700 dark:divide-zinc-800 dark:border-zinc-800 dark:text-zinc-300">
              <li className="flex gap-3 px-4 py-3"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900 dark:text-white" />{t('mcp_authorize_scope_read')}</li>
              <li className="flex gap-3 px-4 py-3"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900 dark:text-white" />{t('mcp_authorize_scope_write')}</li>
              <li className="flex gap-3 px-4 py-3"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900 dark:text-white" />{t('mcp_authorize_scope_drafts')}</li>
              <li className="flex gap-3 bg-zinc-50 px-4 py-3 font-medium text-zinc-900 dark:bg-zinc-800/50 dark:text-white"><IconBan className="mt-0.5 h-4 w-4 shrink-0" />{t('mcp_authorize_scope_never')}</li>
            </ul>
            {error && <p className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleAuthorize}
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-white/40 dark:focus:ring-offset-zinc-900"
            >
              {loading ? t('mcp_authorize_connecting') : t('mcp_authorize_confirm')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
