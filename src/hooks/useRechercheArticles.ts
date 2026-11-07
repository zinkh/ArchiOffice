import { useEffect, useState } from 'react';
import type { ArticleBibliotheque } from '../types/library';
import { chercherArticles, MIN_CARACTERES_RECHERCHE, type DossierPropose } from '../lib/bibliothequeAutocompletion';

const DELAI_MS = 200;

/**
 * Les ouvrages de la bibliothèque qui correspondent à ce qui est tapé, après un court délai. `actif` faux : aucune
 * recherche (rien n'a encore été modifié, ou l'auto-complétion est coupée). Une réponse arrivée après une frappe
 * plus récente est ignorée ; une erreur de réseau donne simplement aucune proposition.
 */
export function useRechercheArticles(texte: string, actif: boolean, dossier: DossierPropose = 'ouvrages'): ArticleBibliotheque[] {
  const [articles, setArticles] = useState<ArticleBibliotheque[]>([]);
  useEffect(() => {
    const q = texte.trim();
    if (!actif || q.length < MIN_CARACTERES_RECHERCHE) { setArticles([]); return; }
    let perime = false;
    const minuteur = setTimeout(() => {
      chercherArticles(q, dossier)
        .then(res => { if (!perime) setArticles(Array.isArray(res) ? res : []); })
        .catch(() => { if (!perime) setArticles([]); });
    }, DELAI_MS);
    return () => { perime = true; clearTimeout(minuteur); };
  }, [texte, actif, dossier]);
  return articles;
}
