// Deux bandeaux de l'enregistrement du CCTP / DPGF / BPU, en complément de `ProConflictBanner` :
//  - `ProDraftBanner` : la saisie d'une session précédente, qui n'avait pas pu être envoyée, a été retrouvée.
//    Elle n'est jamais appliquée ni effacée d'office : la personne choisit, et dans les deux cas rien n'est perdu ;
//  - `ProSaveFailingBanner` : l'enregistrement échoue depuis un moment. Le petit indicateur de la barre ne
//    suffit pas : c'est pendant ces minutes que recharger la page fait perdre la saisie.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaveFailure } from '../../hooks/useAutosavedDoc';

const boite = 'no-print shrink-0 border-b px-3 py-3 text-sm space-y-2';
const styleBoite = { borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' } as const;
const boutonPlein = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50';
const boutonSimple = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] disabled:opacity-50';

export function ProDraftBanner({ enregistreLe, historique, onRestore, onDiscard }: {
  /** Instant de la dernière écriture du brouillon (ms depuis 1970). */
  enregistreLe: number;
  /** Vrai quand ce document a un historique où mettre la version de côté (le DPGF et le CCTP, pas le BPU). */
  historique: boolean;
  onRestore: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try {
      await action();
    } catch (e: any) {
      // La mise de côté a échoué : rien n'a été remplacé ni effacé.
      setError(e?.message || t('pro_draft_error'));
    } finally { setBusy(false); }
  };

  const date = new Date(enregistreLe).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div role="alert" className={boite} style={styleBoite}>
      <p className="font-bold text-[var(--tblr-text)]">{t('pro_draft_title')}</p>
      <p className="text-[var(--tblr-muted)]">{t('pro_draft_body', { date })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { void run(onRestore); }} disabled={busy} className={boutonPlein}>
          {t('pro_draft_restore')}
        </button>
        <button type="button" onClick={() => { void run(onDiscard); }} disabled={busy} className={boutonSimple}>
          {t('pro_draft_discard')}
        </button>
      </div>
      <p className="text-xs text-[var(--tblr-muted)]">{t(historique ? 'pro_draft_safe' : 'pro_draft_safe_no_history')}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Motif lisible d'un échec d'enregistrement : session expirée, serveur muet, ou le message du serveur. */
function motif(echec: SaveFailure | null, t: (cle: string) => string): string | null {
  if (!echec) return null;
  if (echec.code === 'SAVE_TIMEOUT' || echec.name === 'TimeoutError' || echec.name === 'AbortError') return t('pro_save_failing_timeout');
  if (echec.status === 401 || echec.status === 403) return t('pro_save_failing_auth');
  return echec.message || null;
}

export function ProSaveFailingBanner({ failingSince, lastError, onRetry }: {
  failingSince: number;
  lastError: SaveFailure | null;
  onRetry: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // La durée se met à jour toute seule : une minute d'échec et dix minutes d'échec ne se lisent pas pareil.
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), 15_000);
    return () => clearInterval(minuteur);
  }, []);

  const minutes = Math.floor((maintenant - failingSince) / 60_000);
  const raison = motif(lastError, t);
  const reessayer = async () => {
    setBusy(true);
    try { await onRetry(); } catch { /* l'échec est déjà affiché par ce bandeau */ } finally { setBusy(false); }
  };

  return (
    <div role="alert" className={boite} style={styleBoite}>
      <p className="font-bold text-[var(--tblr-text)]">
        {t('pro_save_failing_title')}
        {minutes >= 1 ? ` ${t('pro_save_failing_since', { minutes })}` : ''}
      </p>
      <p className="text-[var(--tblr-muted)]">{t('pro_save_failing_body')}</p>
      {raison && <p className="text-xs text-[var(--tblr-muted)]">{raison}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { void reessayer(); }} disabled={busy} className={boutonPlein}>
          {t('pro_save_failing_retry')}
        </button>
      </div>
    </div>
  );
}
