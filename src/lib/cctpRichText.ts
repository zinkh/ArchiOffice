// ── Mise en forme simple des textes du CCTP ──────────────────────────────────
// Le texte technique d'un poste (`cctpDescription`) reste une chaîne : la mise
// en forme y est portée par quatre balises discrètes, lues par l'aperçu et les
// exports PDF / Word :
//   [b]gras[/b]   [i]italique[/i]   [u]souligné[/u]   [c=#b2242a]coloré[/c]
// Une chaîne reste donc exploitable telle quelle par la recherche, l'IA et le
// planning (`texteBrut` retire les balises). Une balise inconnue, mal formée ou
// jamais ouverte reste du texte ordinaire : rien n'est jamais perdu en silence.
// La couleur n'accepte que #rrggbb, jamais un nom ni un format libre.

export type BaliseRiche = 'b' | 'i' | 'u';

export interface StyleRiche {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** #rrggbb en minuscules. */
  color?: string;
}

export interface SegmentRiche extends StyleRiche {
  text: string;
}

/** Couleurs proposées : sobres d'abord, les couleurs vives pour une vraie alerte. */
export const COULEURS_CCTP: { hex: string; libelle: string }[] = [
  { hex: '#111827', libelle: 'Noir' },
  { hex: '#6b7280', libelle: 'Gris' },
  { hex: '#b2242a', libelle: 'Rouge' },
  { hex: '#c2410c', libelle: 'Orange' },
  { hex: '#15803d', libelle: 'Vert' },
  { hex: '#1d4ed8', libelle: 'Bleu' },
];

const COULEUR = /^#[0-9a-fA-F]{6}$/;
const BALISE = /\[(\/)?(b|i|u|c)(?:=(#[0-9a-fA-F]{6}))?\]/g;
const BALISE_COULEUR = /\[c=#[0-9a-fA-F]{6}\]|\[\/c\]/g;

export const estCouleurValide = (v: string | undefined | null): v is string => !!v && COULEUR.test(v);

interface Pile { code: 'b' | 'i' | 'u' | 'c'; color?: string }

const styleDepuisPile = (pile: Pile[]): StyleRiche => {
  const s: StyleRiche = {};
  for (const p of pile) {
    if (p.code === 'c') s.color = p.color;
    else s[p.code] = true;
  }
  return s;
};

const memeStyle = (a: StyleRiche, b: StyleRiche) =>
  !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && a.color === b.color;

/** Découpe le texte en segments homogènes ; les retours à la ligne restent dans `text`. */
export function analyserRiche(texte: string): SegmentRiche[] {
  const segments: SegmentRiche[] = [];
  const pile: Pile[] = [];
  const pousser = (text: string) => {
    if (!text) return;
    const style = styleDepuisPile(pile);
    const dernier = segments.at(-1);
    if (dernier && memeStyle(dernier, style)) dernier.text += text;
    else segments.push({ ...style, text });
  };
  let curseur = 0;
  for (const m of texte.matchAll(BALISE)) {
    const [brut, fermante, code, couleur] = m;
    const debut = m.index ?? 0;
    pousser(texte.slice(curseur, debut));
    curseur = debut + brut.length;
    if (fermante) {
      // Une fermeture sans ouverture correspondante reste du texte.
      const rang = pile.map(p => p.code).lastIndexOf(code as Pile['code']);
      if (rang < 0 || couleur) { pousser(brut); continue; }
      pile.splice(rang, 1);
    } else if (code === 'c') {
      if (!couleur) { pousser(brut); continue; }
      // Une nouvelle couleur remplace la précédente plutôt que de l'empiler.
      const ancien = pile.findIndex(p => p.code === 'c');
      if (ancien >= 0) pile.splice(ancien, 1);
      pile.push({ code: 'c', color: couleur.toLowerCase() });
    } else {
      if (couleur) { pousser(brut); continue; }
      if (!pile.some(p => p.code === code)) pile.push({ code: code as Pile['code'] });
    }
  }
  pousser(texte.slice(curseur));
  return segments;
}

/** Les segments par paragraphe (un retour à la ligne = un paragraphe), style conservé. */
export function paragraphesRiches(texte: string): SegmentRiche[][] {
  const paragraphes: SegmentRiche[][] = [[]];
  for (const seg of analyserRiche(texte)) {
    seg.text.split('\n').forEach((morceau, i) => {
      if (i > 0) paragraphes.push([]);
      if (morceau) paragraphes[paragraphes.length - 1].push({ ...seg, text: morceau });
    });
  }
  return paragraphes;
}

/** Le texte sans aucune balise reconnue, pour la recherche, l'IA et le planning. */
export function texteBrut(texte: string | undefined | null): string {
  if (!texte || !texte.includes('[')) return texte ?? '';
  return analyserRiche(texte).map(s => s.text).join('');
}

export const contientMiseEnForme = (texte: string | undefined | null): boolean =>
  !!texte && texte.includes('[') && analyserRiche(texte).some(s => s.b || s.i || s.u || s.color);

// ── Édition (barre d'outils du champ) ────────────────────────────────────────

export interface EditionTexte {
  texte: string;
  debut: number;
  fin: number;
}

/**
 * Pose ou retire gras / italique / souligné sur la sélection. Si la sélection
 * est déjà entourée par la balise (ou la contient aux deux bouts), la balise
 * est retirée ; sans sélection, la paire est insérée et le curseur placé entre.
 */
export function basculerBalise(texte: string, debut: number, fin: number, code: BaliseRiche): EditionTexte {
  const ouv = `[${code}]`;
  const fer = `[/${code}]`;
  const choix = texte.slice(debut, fin);
  if (texte.slice(Math.max(0, debut - ouv.length), debut) === ouv && texte.slice(fin, fin + fer.length) === fer) {
    return {
      texte: texte.slice(0, debut - ouv.length) + choix + texte.slice(fin + fer.length),
      debut: debut - ouv.length, fin: fin - ouv.length,
    };
  }
  if (choix.length >= ouv.length + fer.length && choix.startsWith(ouv) && choix.endsWith(fer)) {
    const interieur = choix.slice(ouv.length, choix.length - fer.length);
    return { texte: texte.slice(0, debut) + interieur + texte.slice(fin), debut, fin: debut + interieur.length };
  }
  return {
    texte: texte.slice(0, debut) + ouv + choix + fer + texte.slice(fin),
    debut: debut + ouv.length, fin: fin + ouv.length,
  };
}

/** Pose une couleur sur la sélection ; `null` retire la couleur qui l'entoure. */
export function appliquerCouleur(texte: string, debut: number, fin: number, couleur: string | null): EditionTexte {
  if (couleur !== null && !estCouleurValide(couleur)) return { texte, debut, fin };
  const choix = texte.slice(debut, fin);
  const avant = texte.slice(0, debut).match(/\[c=#[0-9a-fA-F]{6}\]$/);
  const apres = texte.slice(fin).startsWith('[/c]');
  const ouv = couleur ? `[c=${couleur.toLowerCase()}]` : '';
  const fer = couleur ? '[/c]' : '';
  if (avant && apres) {
    // Déjà entourée : on remplace la couleur (ou on la retire).
    const base = debut - avant[0].length;
    return {
      texte: texte.slice(0, base) + ouv + choix + fer + texte.slice(fin + '[/c]'.length),
      debut: base + ouv.length, fin: base + ouv.length + choix.length,
    };
  }
  // Une couleur déjà posée à l'intérieur serait écrasée de toute façon.
  const interieur = choix.replace(BALISE_COULEUR, '');
  return {
    texte: texte.slice(0, debut) + ouv + interieur + fer + texte.slice(fin),
    debut: debut + ouv.length, fin: debut + ouv.length + interieur.length,
  };
}

// ── Mise en lignes (PDF) ─────────────────────────────────────────────────────

export interface MorceauLigne extends StyleRiche {
  text: string;
  /** Largeur mesurée, dans l'unité du mesureur. */
  largeur: number;
}

export type Mesureur = (texte: string, style: StyleRiche) => number;

/**
 * Coupe un paragraphe en lignes d'une largeur maximale, mot par mot : un mot
 * plus large que la ligne est déposé seul plutôt que coupé. Les espaces en
 * début de ligne issus d'une coupure sont supprimés.
 */
export function mettreEnLignes(paragraphe: SegmentRiche[], largeurMax: number, mesurer: Mesureur): MorceauLigne[][] {
  const lignes: MorceauLigne[][] = [[]];
  let x = 0;
  const courante = () => lignes[lignes.length - 1];
  for (const seg of paragraphe) {
    const { text, ...style } = seg;
    for (const mot of text.split(/(\s+)/)) {
      if (!mot) continue;
      const espace = /^\s+$/.test(mot);
      const w = mesurer(mot, style);
      if (!espace && x > 0 && x + w > largeurMax) {
        // Les espaces laissés en fin de ligne ne se dessinent pas.
        const fin = courante().at(-1);
        if (fin) {
          // L'espace est fusionné dans le dernier morceau de même style : on le rogne.
          const rogne = fin.text.replace(/\s+$/, '');
          if (!rogne) courante().pop();
          else if (rogne !== fin.text) {
            const { text: _t, largeur: _l, ...style } = fin;
            fin.text = rogne;
            fin.largeur = mesurer(rogne, style);
          }
        }
        lignes.push([]);
        x = 0;
      }
      if (espace && x === 0 && lignes.length > 1) continue;
      const l = courante();
      const precedent = l.at(-1);
      if (precedent && memeStyle(precedent, style)) {
        precedent.text += mot;
        precedent.largeur += w;
      } else {
        l.push({ ...style, text: mot, largeur: w });
      }
      x += w;
    }
  }
  return lignes;
}
