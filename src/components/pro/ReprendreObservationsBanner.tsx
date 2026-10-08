import { useCallback, useEffect, useState } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { compterReprenables } from '../../lib/observationsReserves';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import type { Observation } from '../../types';

interface Props {
  projectId: string;
  /** Appelé une fois les réserves créées, pour relire la liste des réserves de l'AOR. */
  onReservesChanged?: () => void;
}

/**
 * Reprise en bloc des observations « à lever » de la DET en réserves de l'OPR.
 * Se fait à l'approche de la réception, donc depuis l'onglet AOR. Rien ne
 * s'affiche tant qu'aucune observation n'est à reprendre.
 */
export function ReprendreObservationsBanner({ projectId, onReservesChanged }: Props) {
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const [aReprendre, setAReprendre] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const observations = await apiFetch<Observation[]>(`/api/projects/${projectId}/observations`);
      setAReprendre(compterReprenables(Array.isArray(observations) ? observations : []));
    } catch (err) {
      console.error(err);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const reprendre = async () => {
    const confirmed = await confirmAction({
      title: `Reprendre ${aReprendre} observation${aReprendre > 1 ? 's' : ''} à lever en réserves de l'AOR ?`,
      message: "À faire à l'approche de la réception : chaque observation « à lever » encore ouverte devient une réserve de l'OPR. Les observations restent dans les comptes-rendus et ne sont jamais reprises deux fois.",
      confirmLabel: 'Reprendre en réserves',
      cancelLabel: 'Annuler',
      tone: 'primary',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ created: unknown[] }>(`/api/projects/${projectId}/observations/to-reserves`, { method: 'POST' });
      const n = res.created.length;
      setMessage({ tone: 'ok', text: `${n} réserve${n > 1 ? 's' : ''} créée${n > 1 ? 's' : ''} dans l'AOR.` });
      onReservesChanged?.();
      await refresh();
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'La reprise en réserves a échoué.' });
    } finally {
      setBusy(false);
    }
  };

  if (aReprendre === 0 && !message) return null;

  return (
    <div className="space-y-2">
      {aReprendre > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        >
          <p className="text-sm text-[var(--tblr-text)]">
            {aReprendre} observation{aReprendre > 1 ? 's' : ''} de la DET à lever {aReprendre > 1 ? 'peuvent' : 'peut'} être reprise{aReprendre > 1 ? 's' : ''} en réserve{aReprendre > 1 ? 's' : ''} de l'OPR.
          </p>
          <button
            type="button"
            onClick={() => void reprendre()}
            disabled={busy}
            className="flex items-center gap-1.5 min-h-11 px-3 py-1.5 text-sm font-semibold border border-[var(--tblr-border)] rounded-lg hover:bg-[var(--tblr-surface-2)] disabled:opacity-50 transition-colors text-[var(--tblr-text)]"
            title="Les observations « à lever » encore ouvertes deviennent des réserves de l'AOR"
          >
            <IconArrowRight size={15} /> Reprendre les {aReprendre} à lever en réserves AOR
          </button>
        </div>
      )}
      {message && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2 rounded-lg border text-sm ${message.tone === 'ok'
            ? 'border-[var(--tblr-border)] text-[var(--tblr-text)]'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-xs underline shrink-0">Fermer</button>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
