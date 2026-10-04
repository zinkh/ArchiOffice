import { useCallback, useEffect, useRef } from 'react';

/**
 * Prévient avant de quitter une page qui porte des modifications non
 * enregistrées.
 *
 * L'application tourne sous `BrowserRouter` : `useBlocker` (réservé aux
 * routeurs « data ») n'y est pas disponible. On couvre donc les trois sorties
 * réellement empruntées :
 * - fermeture ou rechargement de l'onglet, et lien qui recharge toute la page
 *   (`beforeunload`) ;
 * - clic sur un lien interne (menu latéral, fil d'Ariane...) : écouté en phase
 *   de capture, AVANT le gestionnaire de `<Link>`, qui renonce à naviguer dès
 *   que l'événement porte `defaultPrevented` ;
 * - boutons de la page elle-même (Retour, Annuler), qui appellent
 *   `confirmDiscard()` avant de naviguer.
 */
export function useUnsavedChangesGuard(isDirty: boolean, message: string) {
  const dirtyRef = useRef(isDirty);
  const messageRef = useRef(message);
  useEffect(() => {
    dirtyRef.current = isDirty;
    messageRef.current = message;
  }, [isDirty, message]);

  const confirmDiscard = useCallback(
    () => !dirtyRef.current || window.confirm(messageRef.current),
    [],
  );

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Requis par Chrome et Electron pour afficher la boîte de confirmation.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      // Lien externe : `beforeunload` s'en charge. Même page (ancre, ?tab=) :
      // rien n'est perdu.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(messageRef.current)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [isDirty]);

  return { confirmDiscard };
}
