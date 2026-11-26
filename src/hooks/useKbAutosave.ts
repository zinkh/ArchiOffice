// Enregistrement automatique d'une page de la base de données du cabinet (PUT /api/kb/pages/:id).
// Même esprit que useProjectAutosave, mais générique : les modifications (titre, icône, contenu, valeurs
// de colonnes) s'accumulent, partent ensemble après un court silence, et un échec se rejoue tout seul.
// L'état est celui d'AutosaveIndicator. Un envoi est aussi fait au masquage de l'onglet et au démontage,
// pour ne perdre aucune frappe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { kbApi, type KbPagePatch } from '../lib/kbApi';
import type { AutosaveStatus } from './useProjectAutosave';

export const KB_AUTOSAVE_DELAY_MS = 1200;
export const KB_AUTOSAVE_RETRY_MS = 5000;

/** Fusionne deux modifications : les valeurs de colonnes se cumulent, le reste est remplacé. */
export function mergeKbPatch(base: KbPagePatch, next: KbPagePatch): KbPagePatch {
  const merged: KbPagePatch = { ...base, ...next };
  if (base.properties || next.properties) merged.properties = { ...(base.properties || {}), ...(next.properties || {}) };
  return merged;
}

export function useKbAutosave(pageId: string | null, onSaved?: (patch: KbPagePatch) => void) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const pending = useRef<KbPagePatch | null>(null);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef<string | null>(pageId);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const flush = useCallback((init?: RequestInit): Promise<void> => {
    clearTimer();
    const id = idRef.current;
    const patch = pending.current;
    if (!id || !patch) return inFlight.current;
    pending.current = null;
    setStatus('saving');
    // Les envois sont chaînés : jamais deux écritures de la même page en même temps.
    inFlight.current = inFlight.current.then(async () => {
      try {
        await kbApi.updatePage(id, patch, init);
        if (!pending.current) setStatus('saved');
        savedRef.current?.(patch);
      } catch {
        // On remet la saisie en attente (sans écraser une saisie plus récente) et on réessaie plus tard.
        pending.current = pending.current ? mergeKbPatch(patch, pending.current) : patch;
        setStatus('error');
        clearTimer();
        timer.current = setTimeout(() => { void flush(); }, KB_AUTOSAVE_RETRY_MS);
      }
    });
    return inFlight.current;
  }, []);

  const schedule = useCallback((patch: KbPagePatch) => {
    if (!idRef.current) return;
    pending.current = pending.current ? mergeKbPatch(pending.current, patch) : patch;
    setStatus('pending');
    clearTimer();
    timer.current = setTimeout(() => { void flush(); }, KB_AUTOSAVE_DELAY_MS);
  }, [flush]);

  // Changer de page envoie d'abord ce qui reste de la précédente.
  useEffect(() => {
    if (idRef.current !== pageId) {
      void flush({ keepalive: true });
      idRef.current = pageId;
      setStatus('idle');
    }
  }, [pageId, flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush({ keepalive: true }); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide as () => void);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide as () => void);
      void flush({ keepalive: true });
      clearTimer();
    };
  }, [flush]);

  return { status, schedule, saveNow: () => flush() };
}
