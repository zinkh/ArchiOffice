import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Barre défilante horizontale (onglets, étapes) sur un écran étroit :
 * - ramène l'élément actif dans la partie visible quand il change, sans faire
 *   défiler la page (on règle `scrollLeft` du conteneur, pas `scrollIntoView`) ;
 * - pose `data-fade-start` / `data-fade-end` sur le conteneur tant qu'il reste
 *   du contenu caché de ce côté, pour que la classe `.scroll-fade-x` estompe le
 *   bord et dise qu'il y a autre chose plus loin.
 */
export function useHorizontalScrollHints<T extends HTMLElement>(activeSelector: string, activeKey: unknown) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute('data-fade-start', el.scrollLeft > 2);
      el.toggleAttribute('data-fade-end', max - el.scrollLeft > 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const active = el.querySelector<HTMLElement>(activeSelector);
    if (!active) return;
    const box = el.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    const marge = 24;
    if (a.left < box.left + marge) el.scrollLeft += a.left - box.left - marge;
    else if (a.right > box.right - marge) el.scrollLeft += a.right - box.right + marge;
  }, [activeSelector, activeKey]);

  return ref;
}
