// Réordonnancement des plans au pointeur (souris, doigt, appui long), sur le modèle de LotsManager.
// L'ordre se prévisualise pendant le geste et ne s'enregistre qu'au relâché.
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { startPressDrag } from '../lib/pressDrag';
import { deplacer } from '../lib/planOrder';

export function usePlanReorder(ids: string[], onCommit: (ids: string[]) => void) {
  const [apercu, setApercu] = useState<string[] | null>(null);
  const [tenu, setTenu] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const courant = useRef<string[]>(ids);
  courant.current = apercu ?? ids;

  const registerRow = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el); else rows.current.delete(id);
  }, []);

  const startReorder = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    const avant = courant.current.join();
    startPressDrag(e, {
      onLift: () => { setTenu(id); setApercu(courant.current); },
      onMove: ({ y }) => {
        const liste = courant.current;
        // Rang visé : nombre de lignes (hors celle tenue) dont le milieu est au-dessus du pointeur.
        let vers = 0;
        for (const autre of liste) {
          if (autre === id) continue;
          const r = rows.current.get(autre)?.getBoundingClientRect();
          if (r && y > r.top + r.height / 2) vers++;
        }
        const suite = deplacer(liste, id, vers);
        if (suite !== liste) { courant.current = suite; setApercu(suite); }
      },
      onEnd: ({ cancelled }) => {
        const final = courant.current;
        setTenu(null);
        setApercu(null);
        if (cancelled || final.join() === avant) return;
        onCommit(final);
      },
    });
  };

  return { ordre: apercu, tenu, registerRow, startReorder };
}
