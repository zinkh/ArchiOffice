// Historique annuler / rétablir d'un document de l'espace PRO (voir src/lib/docHistory.ts).
// La pile vit dans une ref (elle ne doit pas relancer l'éditeur à chaque modification) ; seul l'état
// « peut annuler / peut rétablir » déclenche un rendu, pour griser ou activer les boutons.
import { useCallback, useEffect, useRef, useState } from 'react';
import { annuler, enregistrer, historiqueVide, retablir, type Historique } from '../lib/docHistory';

export interface DocHistory<T> {
  /** À appeler à chaque modification faite par l'utilisateur, avec le document d'avant et celui d'après. */
  enregistrer: (avant: T | null, apres: T) => void;
  /** Renvoie le document à restaurer (à poser sans l'enregistrer de nouveau), `null` s'il n'y a rien à annuler. */
  annuler: (courant: T | null) => T | null;
  retablir: (courant: T | null) => T | null;
  /** Oublie tout : document relu depuis le serveur, version restaurée, conflit résolu. */
  vider: () => void;
  peutAnnuler: boolean;
  peutRetablir: boolean;
}

/** `cle` identifie le document (l'affaire) : en changer repart d'un historique vide. */
export function useDocHistory<T>(cle: string): DocHistory<T> {
  const pile = useRef<Historique<T>>(historiqueVide<T>());
  const [etat, setEtat] = useState({ annuler: false, retablir: false });

  const publier = useCallback(() => {
    const suivant = { annuler: pile.current.passe.length > 0, retablir: pile.current.futur.length > 0 };
    setEtat(prev => (prev.annuler === suivant.annuler && prev.retablir === suivant.retablir ? prev : suivant));
  }, []);

  const vider = useCallback(() => {
    pile.current = historiqueVide<T>();
    publier();
  }, [publier]);

  useEffect(() => { vider(); }, [cle, vider]);

  return {
    enregistrer: useCallback((avant, apres) => {
      if (!avant) return;
      pile.current = enregistrer(pile.current, avant, apres, Date.now());
      publier();
    }, [publier]),
    annuler: useCallback(courant => {
      if (!courant) return null;
      const r = annuler(pile.current, courant);
      if (!r) return null;
      pile.current = r.historique;
      publier();
      return r.cible;
    }, [publier]),
    retablir: useCallback(courant => {
      if (!courant) return null;
      const r = retablir(pile.current, courant);
      if (!r) return null;
      pile.current = r.historique;
      publier();
      return r.cible;
    }, [publier]),
    vider,
    peutAnnuler: etat.annuler,
    peutRetablir: etat.retablir,
  };
}
