// Dossier partagé d'un message de consultation : fichier (zip ou autre) déposé dans les
// documents de l'affaire, ou lien externe, rendu accessible sur la page de dépôt de
// l'entreprise. Ces éléments ne partent PAS en pièce jointe (limite de 25 Mo par message) :
// le corps du message les cite, et ce module tient ce bloc de texte à jour quand la
// personne ajoute ou retire un élément (le corps reste un texte libre qu'elle peut modifier).

/** Élément partagé, tel qu'il est cité dans le message. */
export interface ElementDossierPartage {
  /** Identifiant de la pièce du DCE qui le porte. */
  id: string;
  libelle: string;
  /** Lien externe à citer en clair (https seulement) ; absent pour un fichier de l'affaire. */
  url?: string;
}

export const ENTETE_DOSSIER_PARTAGE = 'Dossier partagé, à télécharger sur votre espace de dépôt :';
export const ENTETE_DOSSIER_PARTAGE_LIENS = 'Dossier partagé, à télécharger depuis les liens suivants :';

/** Liens externes acceptés : https seulement, jamais javascript:, data: ni http:. */
export function lienExterneValide(brut: string): string | null {
  const texte = brut.trim();
  if (!texte || texte.length > 2000) return null;
  try {
    const u = new URL(texte);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

export const LIENS_EXTERNES_MAX = 20;
export const LIBELLE_LIEN_MAX = 200;

/**
 * Liens externes d'une pièce de la consultation, tels qu'ils sont rendus à l'entreprise : ce que le
 * jsonb contient n'est jamais cru (https seulement, libellé borné, 20 liens au plus).
 */
export function assainirLiensExternes(brut: unknown): Array<{ libelle: string; url: string }> {
  if (!Array.isArray(brut)) return [];
  const liens: Array<{ libelle: string; url: string }> = [];
  for (const l of brut) {
    if (!l || typeof l !== 'object') continue;
    const url = typeof (l as any).url === 'string' ? lienExterneValide((l as any).url) : null;
    if (!url) continue;
    const libelle = typeof (l as any).libelle === 'string' ? (l as any).libelle.trim().slice(0, LIBELLE_LIEN_MAX) : '';
    liens.push({ libelle: libelle || new URL(url).hostname, url });
    if (liens.length >= LIENS_EXTERNES_MAX) break;
  }
  return liens;
}

export const ligneDossier = (el: ElementDossierPartage): string =>
  `- ${el.libelle}${el.url ? ` : ${el.url}` : ''}`;

const estLigneElement = (l: string) => l.startsWith('- ');

/**
 * Ajoute l'élément sous l'en-tête du bloc (créé avant l'ancre, à défaut en fin de corps).
 * Sans effet si la ligne y figure déjà.
 */
export function ajouterAuCorps(corps: string, entete: string, el: ElementDossierPartage, ancre?: string): string {
  const ligne = ligneDossier(el);
  const lignes = corps.split('\n');
  if (lignes.includes(ligne)) return corps;

  const iEntete = lignes.indexOf(entete);
  if (iEntete >= 0) {
    let fin = iEntete;
    while (fin + 1 < lignes.length && estLigneElement(lignes[fin + 1])) fin += 1;
    lignes.splice(fin + 1, 0, ligne);
    return lignes.join('\n');
  }

  const bloc = [entete, ligne, ''];
  const iAncre = ancre ? lignes.findIndex(l => l.includes(ancre)) : -1;
  if (iAncre >= 0) {
    lignes.splice(iAncre, 0, ...bloc);
    return lignes.join('\n');
  }
  return `${corps.replace(/\s+$/, '')}\n\n${entete}\n${ligne}`;
}

/** Retire la ligne de l'élément, et l'en-tête quand le bloc se vide. */
export function retirerDuCorps(corps: string, entete: string, el: ElementDossierPartage): string {
  const ligne = ligneDossier(el);
  const lignes = corps.split('\n');
  const i = lignes.indexOf(ligne);
  if (i < 0) return corps;
  lignes.splice(i, 1);

  const iEntete = lignes.indexOf(entete);
  if (iEntete >= 0 && !(iEntete + 1 < lignes.length && estLigneElement(lignes[iEntete + 1]))) {
    // Bloc vide : l'en-tête part avec la ligne blanche qui le suit.
    lignes.splice(iEntete, lignes[iEntete + 1] === '' ? 2 : 1);
  }
  return lignes.join('\n');
}
