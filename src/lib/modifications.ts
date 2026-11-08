// Date et auteur de la dernière modification de chaque lot, chapitre et article du CCTP / DPGF.
//
// Un élément est « modifié » quand son CONTENU change (texte, désignation, quantité, prix, unité, images...),
// jamais pour un simple effet de bord :
//  - le numéro (une renumérotation après déplacement ou réordonnancement des lots change tous les numéros) ;
//  - le marqueur de rédaction (« en cours », « incomplet » ont déjà leur propre auteur et leur propre date) ;
//  - les totaux d'un parent, somme de ses enfants (sousTotal d'un lot, quantité et prix d'un article qui porte
//    des sous-articles) ;
//  - l'estampille elle-même.
// Les enfants sont jugés pour eux-mêmes : modifier un sous-article ne date pas son parent.
//
// Le même calcul sert l'écran (affichage immédiat, auteur = personne connectée) et le serveur, qui fait foi
// (sa date, le nom de la personne authentifiée, jamais ce que le client prétend) : un élément inchangé garde
// TOUJOURS l'estampille déjà enregistrée, quoi que porte le document reçu.
import type { Chapitre, DPGF, Ligne, Lot } from '../types/dpgf';

type Noeud = Lot | Chapitre | Ligne;

const ESTAMPILLE = ['modifieLe', 'modifiePar'] as const;
const COMMUN = new Set<string>([...ESTAMPILLE, 'numero', 'marqueur']);
const ENFANTS_LOT = new Set<string>([...COMMUN, 'chapitres', 'sousTotal']);
const ENFANTS_CHAPITRE = new Set<string>([...COMMUN, 'lignes']);
const ENFANTS_LIGNE = new Set<string>([...COMMUN, 'children']);
/** Chiffres d'un article qui porte des sous-articles : ils sont la somme de ses enfants. */
const CUMULS_LIGNE = new Set<string>(['quantite', 'prixUnitaire', 'prixTotal']);

/** Sérialisation à clés triées : deux objets de même contenu donnent la même chaîne, quel que soit l'ordre des clés. */
function stable(valeur: unknown): string {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur) ?? 'null';
  if (Array.isArray(valeur)) return `[${valeur.map(stable).join(',')}]`;
  const objet = valeur as Record<string, unknown>;
  const parties: string[] = [];
  for (const cle of Object.keys(objet).sort()) {
    if (objet[cle] !== undefined) parties.push(`${JSON.stringify(cle)}:${stable(objet[cle])}`);
  }
  return `{${parties.join(',')}}`;
}

function signature(noeud: Noeud, ignores: Set<string>, cumuls = false): string {
  const propre: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (ignores.has(cle) || (cumuls && CUMULS_LIGNE.has(cle))) continue;
    propre[cle] = valeur;
  }
  return stable(propre);
}

const signatureLot = (lot: Lot): string => signature(lot, ENFANTS_LOT);
const signatureChapitre = (chapitre: Chapitre): string => signature(chapitre, ENFANTS_CHAPITRE);
const signatureLigne = (ligne: Ligne): string => signature(ligne, ENFANTS_LIGNE, (ligne.children?.length ?? 0) > 0);

interface Ancien { signature: string; modifieLe?: string; modifiePar?: string }

function indexer(document: DPGF): Map<string, Ancien> {
  const index = new Map<string, Ancien>();
  const poser = (noeud: Noeud, sig: string) => {
    index.set(noeud.id, { signature: sig, modifieLe: noeud.modifieLe, modifiePar: noeud.modifiePar });
  };
  const lignes = (liste: Ligne[] | undefined) => {
    for (const ligne of liste ?? []) { poser(ligne, signatureLigne(ligne)); lignes(ligne.children); }
  };
  for (const lot of document.lots ?? []) {
    poser(lot, signatureLot(lot));
    for (const chapitre of lot.chapitres ?? []) { poser(chapitre, signatureChapitre(chapitre)); lignes(chapitre.lignes); }
  }
  return index;
}

/**
 * Rend `apres` avec l'estampille à jour : l'élément dont le contenu a changé (ou qui vient d'être créé) reçoit
 * `par` et `quand`, tout autre reprend celle de `avant`. Sans `avant` (document jamais enregistré), rien n'est
 * estampillé : dater toute une création n'apprendrait rien. Les éléments inchangés gardent leur identité
 * (même objet), pour ne pas relancer d'inutiles rendus.
 */
export function estamperModifications(avant: DPGF | null | undefined, apres: DPGF, par: string, quand: string): DPGF {
  if (!avant) return apres;
  const anciens = indexer(avant);

  const estampiller = <N extends Noeud>(noeud: N, sig: string, avecEnfants: (n: N) => N): N => {
    const ancien = anciens.get(noeud.id);
    const change = !ancien || ancien.signature !== sig;
    const modifieLe = change ? quand : ancien?.modifieLe;
    const modifiePar = change ? par : ancien?.modifiePar;
    const enfants = avecEnfants(noeud);
    if (enfants === noeud && noeud.modifieLe === modifieLe && noeud.modifiePar === modifiePar) return noeud;
    const resultat: N = { ...enfants };
    if (modifieLe === undefined) delete resultat.modifieLe; else resultat.modifieLe = modifieLe;
    if (modifiePar === undefined) delete resultat.modifiePar; else resultat.modifiePar = modifiePar;
    return resultat;
  };

  const lignes = (liste: Ligne[]): Ligne[] => {
    let change = false;
    const suite = liste.map(ligne => {
      const neuve = estampiller(ligne, signatureLigne(ligne), l => {
        if (!l.children?.length) return l;
        const enfants = lignes(l.children);
        return enfants === l.children ? l : { ...l, children: enfants };
      });
      if (neuve !== ligne) change = true;
      return neuve;
    });
    return change ? suite : liste;
  };

  let lotsChange = false;
  const lots = (apres.lots ?? []).map(lot => {
    const neuf = estampiller(lot, signatureLot(lot), l => {
      let chapitresChange = false;
      const chapitres = (l.chapitres ?? []).map(chapitre => {
        const nouveau = estampiller(chapitre, signatureChapitre(chapitre), c => {
          const suite = lignes(c.lignes ?? []);
          return suite === c.lignes ? c : { ...c, lignes: suite };
        });
        if (nouveau !== chapitre) chapitresChange = true;
        return nouveau;
      });
      return chapitresChange ? { ...l, chapitres } : l;
    });
    if (neuf !== lot) lotsChange = true;
    return neuf;
  });
  return lotsChange ? { ...apres, lots } : apres;
}
