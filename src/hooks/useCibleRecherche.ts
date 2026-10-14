import { useEffect, useRef } from 'react';
import type { CibleRecherche } from '../lib/proRecherche';

const DUREE_REPERE_MS = 1800;

/**
 * Quand une trouvaille est choisie dans la recherche, l'atelier ouvert la
 * déplie et la sélectionne (`appliquer`), puis ce hook la fait défiler dans la
 * vue et la repère un instant : l'élément porte `data-search-id`. Il n'existe
 * qu'après le rendu qui a déplié ses parents, d'où quelques images d'attente.
 */
export function useCibleRecherche(cible: CibleRecherche | null | undefined, appliquer: (cible: CibleRecherche) => void) {
  const appliquerRef = useRef(appliquer);
  appliquerRef.current = appliquer;

  useEffect(() => {
    if (!cible) return;
    appliquerRef.current(cible);
    let essais = 0;
    let image = 0;
    let retrait = 0;
    const chercher = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-search-id]'))
        .find(e => e.dataset.searchId === cible.id);
      if (el) {
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        el.setAttribute('data-search-flash', '');
        retrait = window.setTimeout(() => el.removeAttribute('data-search-flash'), DUREE_REPERE_MS);
        return;
      }
      if (++essais < 20) image = requestAnimationFrame(chercher);
    };
    image = requestAnimationFrame(chercher);
    return () => { cancelAnimationFrame(image); window.clearTimeout(retrait); };
  }, [cible]);
}
