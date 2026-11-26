// Bandeau affiché quand l'enregistrement du CCTP / DPGF est refusé parce que le document stocké a
// changé depuis sa lecture (approbation d'une proposition d'un confrère, agent IA, autre onglet).
// Rien n'a été écrit. Les deux sorties mettent d'abord de côté la version qui perd, dans l'historique
// du dossier : aucune des deux ne peut faire perdre de travail.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ProConflictBanner({ onResolve }: { onResolve: (choice: 'reload' | 'overwrite') => Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (choice: 'reload' | 'overwrite') => {
    setBusy(true); setError(null);
    try {
      await onResolve(choice);
    } catch (e: any) {
      // La mise de côté a échoué : le conflit reste entier, rien n'a été remplacé.
      setError(e?.message || t('pro_conflict_error'));
    } finally { setBusy(false); }
  };

  return (
    <div role="alert" className="no-print shrink-0 border-b px-3 py-3 text-sm space-y-2"
      style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
      <p className="font-bold text-[var(--tblr-text)]">{t('pro_conflict_title')}</p>
      <p className="text-[var(--tblr-muted)]">{t('pro_conflict_body')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { void resolve('reload'); }} disabled={busy}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
          {t('pro_conflict_reload')}
        </button>
        <button type="button" onClick={() => { void resolve('overwrite'); }} disabled={busy}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] disabled:opacity-50">
          {t('pro_conflict_overwrite')}
        </button>
      </div>
      <p className="text-xs text-[var(--tblr-muted)]">{t('pro_conflict_safe')}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
