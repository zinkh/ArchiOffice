import { useCallback, useEffect, useRef, useState } from 'react';
import { canAutosaveProject, projectSavePayload } from '../lib/projectDirty';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid';

/** Délai après la dernière frappe, comme la consultation ACT (ACTModule). */
const AUTOSAVE_DELAY_MS = 1200;
/** Nouvel essai après un échec (réseau coupé, serveur indisponible). */
const RETRY_DELAY_MS = 5000;
/** Limite d'un corps `keepalive` (64 Ko) : une fiche avec image de couverture la dépasse. */
const KEEPALIVE_MAX_CHARS = 60000;

interface ProjectLike { id: string; name?: unknown }

/**
 * Enregistrement automatique de la fiche affaire, qui remplace le bouton
 * Enregistrer : notes, avenants, jalons et consultation s'enregistraient déjà
 * seuls, la fiche était la dernière à attendre un clic.
 *
 * Trois garde-fous, sur le modèle d'ACTModule :
 * - rien n'est écrit tant que la fiche n'a pas été lue (`isDirty` reste faux
 *   sans version enregistrée de référence) ;
 * - les écritures sont chaînées, et c'est la fiche du moment de l'envoi qui
 *   part : une frappe pendant un enregistrement en déclenche un autre ;
 * - un échec relance une tentative après 5 s, et la fiche en attente est
 *   envoyée quand on quitte l'écran ou ferme l'onglet.
 */
export function useProjectAutosave<P extends ProjectLike>(
  project: P | null,
  isDirty: boolean,
  onSaved: (sent: P) => void,
) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const latestRef = useRef(project);
  const dirtyRef = useRef(isDirty);
  const onSavedRef = useRef(onSaved);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    latestRef.current = project;
    dirtyRef.current = isDirty;
    onSavedRef.current = onSaved;
  });

  const clearTimers = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
    debounceRef.current = null;
    retryRef.current = null;
  };

  const saveNow = useCallback((opts: { keepalive?: boolean } = {}) => {
    clearTimers();
    const run = async () => {
      const snapshot = latestRef.current;
      if (!snapshot || !dirtyRef.current) return;
      if (!canAutosaveProject(snapshot)) { setStatus('invalid'); return; }
      setStatus('saving');
      const body = JSON.stringify(projectSavePayload(snapshot as unknown as Record<string, unknown>));
      try {
        const res = await fetch(`/api/projects/${snapshot.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: !!opts.keepalive && body.length < KEEPALIVE_MAX_CHARS,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onSavedRef.current(snapshot);
        setStatus('saved');
      } catch (err) {
        console.error('Enregistrement automatique de la fiche impossible :', err);
        setStatus('error');
        // Plus de nouvel essai une fois l'écran quitté : l'envoi du départ a
        // déjà eu sa chance, et un minuteur orphelin réessaierait sans fin.
        if (!unmountedRef.current) retryRef.current = setTimeout(() => { void saveNow(); }, RETRY_DELAY_MS);
      }
    };
    chainRef.current = chainRef.current.then(run, run);
    return chainRef.current;
  }, []);

  // Une modification programme un enregistrement, repoussé à chaque frappe.
  useEffect(() => {
    if (!isDirty || !project) return;
    if (!canAutosaveProject(project)) { clearTimers(); setStatus('invalid'); return; }
    setStatus(prev => (prev === 'saving' ? prev : 'pending'));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveNow(); }, AUTOSAVE_DELAY_MS);
  }, [project, isDirty, saveNow]);

  // Quitter l'écran ou fermer l'onglet envoie la fiche en attente.
  useEffect(() => {
    const onPageHide = () => { if (dirtyRef.current) void saveNow({ keepalive: true }); };
    unmountedRef.current = false;
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unmountedRef.current = true;
      if (dirtyRef.current) void saveNow({ keepalive: true });
    };
  }, [saveNow]);

  return { status, saveNow };
}
