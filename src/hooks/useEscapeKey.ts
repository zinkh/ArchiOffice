import { useEffect, useRef } from 'react';

/**
 * Ferme une fenêtre modale à la touche Échap tant qu'elle est ouverte.
 * `onEscape` est relu à chaque appui : pas besoin de le mémoïser.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  useEffect(() => { handlerRef.current = onEscape; });

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
