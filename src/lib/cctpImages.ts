// ── Localisations et illustrations des articles de CCTP ─────────────────────
// Deux aides qui s'enrichissent à mesure qu'on renseigne le CCTP : les
// localisations déjà saisies (dans tout le document) sont reproposées sur les
// articles suivants, et une illustration ajoutée reprend la localisation de
// son article comme légende. Logique pure ; l'envoi des fichiers est dans
// cctpImagesUpload.ts.
import type { DPGF, ImageArticle, Ligne } from '../types/dpgf';

const normaliser = (v: string) => v.trim().replace(/\s+/g, ' ');
const cle = (v: string) => normaliser(v).toLocaleLowerCase('fr');

function parcourir(lignes: Ligne[], visite: (l: Ligne) => void): void {
  for (const l of lignes) {
    visite(l);
    if (l.children?.length) parcourir(l.children, visite);
  }
}

/**
 * Les localisations déjà utilisées dans le document, les plus fréquentes
 * d'abord (à égalité, ordre alphabétique). « SdB  étage » et « sdb étage »
 * comptent pour une seule, écrite comme elle l'a été le plus souvent.
 */
export function localisationsConnues(doc: Pick<DPGF, 'lots'>): string[] {
  const parCle = new Map<string, { total: number; ecritures: Map<string, number> }>();
  for (const lot of doc.lots) {
    for (const chap of lot.chapitres) {
      parcourir(chap.lignes, l => {
        const valeur = normaliser(l.localisation ?? '');
        if (!valeur) return;
        const entree = parCle.get(cle(valeur)) ?? { total: 0, ecritures: new Map() };
        entree.total += 1;
        entree.ecritures.set(valeur, (entree.ecritures.get(valeur) ?? 0) + 1);
        parCle.set(cle(valeur), entree);
      });
    }
  }
  return [...parCle.values()]
    .map(e => ({
      total: e.total,
      nom: [...e.ecritures.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0],
    }))
    .sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr'))
    .map(e => e.nom);
}

/** Nouvelle illustration : la légende part de la localisation de l'article. */
export function nouvelleImage(
  fichier: { id: string; documentId?: string; fileUrl: string },
  ligne: Pick<Ligne, 'localisation'>,
): ImageArticle {
  return { ...fichier, legende: normaliser(ligne.localisation ?? '') };
}

/** Images d'un article, sans celles dont la référence de fichier est vide. */
export function imagesDeLigne(ligne: Pick<Ligne, 'images'>): ImageArticle[] {
  return (ligne.images ?? []).filter(i => !!i.fileUrl);
}

export function retirerImage(images: ImageArticle[] | undefined, id: string): ImageArticle[] {
  return (images ?? []).filter(i => i.id !== id);
}

export function legendeImage(images: ImageArticle[] | undefined, id: string, legende: string): ImageArticle[] {
  return (images ?? []).map(i => (i.id === id ? { ...i, legende } : i));
}
