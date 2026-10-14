// ── Recherche dans un document PRO (CCTP, DPGF, estimation, DQE, BPU) ───────
// Logique pure, partagée par la fenêtre de recherche (ProSearch) : le même
// arbre lots > chapitres > articles sert les cinq documents, la recherche
// parcourt donc l'arbre tel quel et rend, pour chaque trouvaille, de quoi
// l'atelier ouvert la déplier, la sélectionner et la montrer.
import type { Ligne } from '../types/dpgf';

export type ChampTrouve = 'numero' | 'designation' | 'localisation' | 'cctp';

export interface Trouvaille {
  /** Identifiant du lot, du chapitre ou de l'article trouvé (unique dans le document). */
  id: string;
  kind: 'lot' | 'chapitre' | 'ligne';
  lotIdx: number;
  chapIdx?: number;
  lignePath?: number[];
  lotId: string;
  chapId?: string;
  /** Identifiants des articles parents, du premier niveau au parent direct. */
  ancetresIds: string[];
  numero: string;
  libelle: string;
  /** « 02 Menuiseries › 3 Description des ouvrages » : où l'élément se trouve. */
  contexte: string;
  champ: ChampTrouve;
  /** Passage où la recherche a porté, quand ce n'est pas le libellé (localisation, texte du CCTP). */
  extrait?: string;
}

/** Position d'une trouvaille à montrer, relue par l'atelier ouvert. `nonce` rejoue le même choix. */
export type CibleRecherche = Trouvaille & { nonce: number };

interface DocumentRecherche {
  lots: Array<{
    id: string; numero: string; titre: string; cctpDescription?: string;
    chapitres: Array<{ id: string; numero: string; titre: string; cctpOnly?: boolean; cctpDescription?: string; lignes: Ligne[] }>;
  }>;
}

export interface OptionsRecherche {
  /** Cherche aussi dans les textes du CCTP et montre les éléments réservés au CCTP. */
  cctp?: boolean;
  max?: number;
}

/** Minuscules sans accents, caractère par caractère : les positions restent alignées sur le texte d'origine. */
export function normaliser(texte: string): string {
  let out = '';
  for (const c of texte) {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
    out += n.length === c.length ? n : (n[0] ?? c);
  }
  return out;
}

export const termesDe = (requete: string): string[] => normaliser(requete).split(/\s+/).filter(Boolean);

const contientTous = (texte: string | undefined, termes: string[]) => {
  if (!texte) return false;
  const n = normaliser(texte);
  return termes.every(t => n.includes(t));
};

/** Passage de `texte` autour du premier terme trouvé, sur une ligne. */
export function extraitAutour(texte: string, termes: string[], largeur = 90): string {
  const plat = texte.replace(/\s+/g, ' ').trim();
  const n = normaliser(plat);
  const pos = termes.map(t => n.indexOf(t)).filter(p => p >= 0).sort((a, b) => a - b)[0] ?? 0;
  const debut = Math.max(0, pos - Math.floor(largeur / 3));
  const fin = Math.min(plat.length, debut + largeur);
  return `${debut > 0 ? '…' : ''}${plat.slice(debut, fin)}${fin < plat.length ? '…' : ''}`;
}

/** Découpe `texte` en morceaux, ceux qui portent un terme étant marqués (accents et casse ignorés). */
export function surligner(texte: string, termes: string[]): Array<{ texte: string; trouve: boolean }> {
  if (!termes.length) return [{ texte, trouve: false }];
  const n = normaliser(texte);
  const marque = new Array<boolean>(texte.length).fill(false);
  for (const t of termes) {
    for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + t.length)) {
      for (let k = i; k < i + t.length; k++) marque[k] = true;
    }
  }
  const out: Array<{ texte: string; trouve: boolean }> = [];
  for (let i = 0; i < texte.length; i++) {
    const dernier = out[out.length - 1];
    if (dernier && dernier.trouve === marque[i]) dernier.texte += texte[i];
    else out.push({ texte: texte[i], trouve: marque[i] });
  }
  return out;
}

/**
 * Cherche `requete` (tous les mots, dans n'importe quel ordre) dans les
 * numéros, intitulés, localisations et, pour le CCTP, les textes techniques.
 * Un numéro qui commence par la requête passe devant, puis les intitulés qui
 * la contiennent le plus tôt.
 */
export function rechercherDansDocument(doc: DocumentRecherche | null | undefined, requete: string, options: OptionsRecherche = {}): Trouvaille[] {
  const termes = termesDe(requete);
  if (!doc || !termes.length) return [];
  const { cctp = false, max = 60 } = options;
  const trouvees: Array<Trouvaille & { score: number }> = [];

  const classer = (numero: string, libelle: string, extra: number) => {
    const n = normaliser(numero);
    const l = normaliser(libelle);
    const premier = termes[0];
    if (n === premier) return 0 + extra;
    if (n.startsWith(premier)) return 1 + extra;
    if (l.startsWith(premier)) return 2 + extra;
    return 3 + extra;
  };

  doc.lots.forEach((lot, lotIdx) => {
    const lotContexte = `${lot.numero} ${lot.titre}`.trim();
    const lotChamp = [
      contientTous(`${lot.numero} ${lot.titre}`, termes) ? 'designation' as const : null,
      cctp && contientTous(lot.cctpDescription, termes) ? 'cctp' as const : null,
    ].find(Boolean);
    if (lotChamp) {
      trouvees.push({
        id: lot.id, kind: 'lot', lotIdx, lotId: lot.id, ancetresIds: [], numero: lot.numero, libelle: lot.titre,
        contexte: 'Lot', champ: lotChamp,
        extrait: lotChamp === 'cctp' ? extraitAutour(lot.cctpDescription ?? '', termes) : undefined,
        score: classer(lot.numero, lot.titre, 0),
      });
    }
    lot.chapitres.forEach((chap, chapIdx) => {
      if (chap.cctpOnly && !cctp) return;
      const chapContexte = `${lotContexte} › ${chap.numero} ${chap.titre}`.trim();
      const chapChamp = [
        contientTous(`${chap.numero} ${chap.titre}`, termes) ? 'designation' as const : null,
        cctp && contientTous(chap.cctpDescription, termes) ? 'cctp' as const : null,
      ].find(Boolean);
      if (chapChamp) {
        trouvees.push({
          id: chap.id, kind: 'chapitre', lotIdx, chapIdx, lotId: lot.id, chapId: chap.id, ancetresIds: [],
          numero: chap.numero, libelle: chap.titre, contexte: lotContexte, champ: chapChamp,
          extrait: chapChamp === 'cctp' ? extraitAutour(chap.cctpDescription ?? '', termes) : undefined,
          score: classer(chap.numero, chap.titre, 10),
        });
      }
      const parcourir = (lignes: Ligne[], prefixe: number[], ancetres: string[]) => {
        lignes.forEach((ligne, i) => {
          const chemin = [...prefixe, i];
          if (ligne.cctpOnly && !cctp) return;
          const champ =
            contientTous(`${ligne.numero} ${ligne.designation}`, termes) ? (contientTous(ligne.numero, termes) ? 'numero' as const : 'designation' as const)
            : contientTous(ligne.localisation, termes) ? 'localisation' as const
            : cctp && contientTous(ligne.cctpDescription, termes) ? 'cctp' as const
            : null;
          if (champ) {
            trouvees.push({
              id: ligne.id, kind: 'ligne', lotIdx, chapIdx, lignePath: chemin, lotId: lot.id, chapId: chap.id,
              ancetresIds: ancetres, numero: ligne.numero, libelle: ligne.designation, contexte: chapContexte, champ,
              extrait: champ === 'localisation' ? ligne.localisation : champ === 'cctp' ? extraitAutour(ligne.cctpDescription ?? '', termes) : undefined,
              score: classer(ligne.numero, ligne.designation, champ === 'cctp' ? 25 : champ === 'localisation' ? 20 : 20),
            });
          }
          if (ligne.children?.length) parcourir(ligne.children, chemin, [...ancetres, ligne.id]);
        });
      };
      parcourir(chap.lignes, [], []);
    });
  });

  // Tri stable : à score égal, l'ordre du document.
  return trouvees
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.score - b.t.score || a.i - b.i)
    .slice(0, max)
    .map(({ t }) => {
      const { score: _score, ...sans } = t;
      return sans;
    });
}

/** Clé de ligne positionnelle (celle de `rowKey`, treeOps) d'une trouvaille : lot, chapitre ou article. */
export const clePourCible = (c: Pick<Trouvaille, 'kind' | 'lotIdx' | 'chapIdx' | 'lignePath'>): string =>
  c.kind === 'lot' ? `lot-${c.lotIdx}`
    : c.kind === 'chapitre' ? `chap-${c.lotIdx}-${c.chapIdx}`
      : `ligne-${c.lotIdx}-${c.chapIdx}-${(c.lignePath ?? []).join('-')}`;
