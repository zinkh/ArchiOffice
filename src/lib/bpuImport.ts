// ── Réimport d'un bordereau chiffré par une entreprise ───────────────────────
// Un candidat renvoie rarement le fichier tel qu'on le lui a envoyé : il
// réordonne, insère des lignes, renomme des désignations, fusionne des
// cellules, scinde par lot en plusieurs feuilles, ou retape tout dans son
// propre gabarit. Le rapprochement procède donc par cascade, du plus sûr au
// plus approximatif, et ne conclut jamais seul : rien n'est écrit sans
// validation explicite.
//
// Aucune formule n'est évaluée ici. evalFormula (components/pro/treeOps.ts) est
// réservé aux cellules saisies par l'utilisateur : il rend 0 en cas d'échec, ce
// qui transformerait « l'entreprise n'a pas chiffré ce poste » en « elle a
// chiffré 0 € » — autre chose au moment de classer les offres.
import type { BPU, BPULigne } from '../types/bpu';
import { forEachLigne } from '../components/pro/treeOps';
import { SHEET_META, BPU_SHEET_SCHEMA } from './bpuExport';

/** Garde-fou sur un fichier fourni par un tiers. */
const MAX_ROWS_PAR_FEUILLE = 20000;
const MAX_FEUILLES = 50;

// ── Nombres ───────────────────────────────────────────────────────────────────

const NON_CHIFFRE = new Set([
  '', '-', '–', '—', 'néant', 'neant', 'pm', 'p.m.', 'p.m', 'pour mémoire',
  'pour memoire', 'sans objet', 'so', 's.o.', 'n/a', 'na', 'nc',
]);

/**
 * Lit un montant écrit par un tiers, dans n'importe laquelle des formes
 * courantes : « 1 234,56 », « 1.234,56 », « 1234.56 », « 12,50 €/m² ».
 *
 * Rend `null`, et jamais 0, quand rien n'a été chiffré : « pour mémoire » est
 * une réponse légitime d'entreprise, pas un prix de zéro euro.
 */
export function parseFrenchNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;

  let s = String(value).trim();
  if (NON_CHIFFRE.has(s.toLowerCase())) return null;

  // Espaces de toutes obédiences, insécables compris, et bruit monétaire.
  s = s.replace(/[\s   ]/g, '')
       .replace(/€|EUR|euros?|HT|TTC/gi, '')
       .replace(/\/[a-zA-Zµ²³]+\d?/g, '')   // « /m² », « /ml »
       .trim();
  if (!s || NON_CHIFFRE.has(s.toLowerCase())) return null;

  const negatif = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^[-+(]|\)$/g, '');

  const dernierPoint = s.lastIndexOf('.');
  const derniereVirgule = s.lastIndexOf(',');

  if (dernierPoint >= 0 && derniereVirgule >= 0) {
    // Les deux présents : le dernier séparateur est le décimal.
    const dec = Math.max(dernierPoint, derniereVirgule);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1).replace(/[.,]/g, '');
  } else if (derniereVirgule >= 0) {
    s = s.replace(/,/g, '.');
  } else if (dernierPoint >= 0) {
    // Un point seul : décimal, sauf s'il s'agit d'un groupement de milliers.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }

  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negatif ? -n : n;
}

// ── Normalisations ────────────────────────────────────────────────────────────

/** « m² » et « m2 » désignent la même unité, « m³ » et « m3 » aussi. */
const EXPOSANTS: Record<string, string> = {
  '\u00b9': '1', '\u00b2': '2', '\u00b3': '3',
  '\u2074': '4', '\u2075': '5', '\u2076': '6',
  '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u2070': '0',
};

export function normalizeText(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u00b9\u00b2\u00b3\u2070\u2074-\u2079]/g, c => EXPOSANTS[c] ?? c)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // accents
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** « 1.02.3 » et « 1.2.3 » désignent le même article. */
export function normalizeNumero(s: unknown): string {
  return String(s ?? '').trim()
    .replace(/[^\dA-Za-z.\-_]/g, '')
    .split(/[.\-_]/).filter(Boolean)
    .map(seg => /^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg.toLowerCase())
    .join('.');
}

/** Similarité de Dice sur les mots, entre 0 et 1. */
export function diceSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let commun = 0;
  for (const t of ta) if (tb.has(t)) commun++;
  return (2 * commun) / (ta.size + tb.size);
}

// ── Détection des colonnes ────────────────────────────────────────────────────

export type ColonneKind = 'ref' | 'numero' | 'designation' | 'unite' | 'quantite' | 'prixUnitaire' | 'montant';

const VOCABULAIRE: Record<ColonneKind, string[]> = {
  ref: ['ref', 'reference', 'refbpu'],
  numero: ['n', 'no', 'num', 'numero', 'code', 'article', 'poste', 'repere'],
  designation: ['designation', 'libelle', 'description', 'intitule', 'ouvrage', 'nature des travaux'],
  unite: ['unite', 'u', 'un', 'unites'],
  quantite: ['quantite', 'qte', 'qt', 'quantites'],
  prixUnitaire: ['pu', 'p u', 'pu ht', 'prix unitaire', 'prix unitaire ht', 'px unit', 'prix u', 'prix unit'],
  montant: ['montant', 'total', 'total ht', 'montant ht', 'prix total'],
};

export type ColumnMap = Partial<Record<ColonneKind, number>>;

/** Repère la ligne d'en-tête et la place de chaque colonne. */
export function detectHeader(grid: any[][]): { headerRow: number; columns: ColumnMap } | null {
  const limite = Math.min(grid.length, 40);
  let best: { headerRow: number; columns: ColumnMap; score: number } | null = null;

  for (let r = 0; r < limite; r++) {
    const columns: ColumnMap = {};
    let score = 0;
    grid[r]?.forEach((cell, c) => {
      const n = normalizeText(cell);
      if (!n) return;
      for (const [kind, mots] of Object.entries(VOCABULAIRE) as [ColonneKind, string[]][]) {
        if (columns[kind] !== undefined) continue;
        if (mots.includes(n)) { columns[kind] = c; score += 2; return; }
        // Correspondance partielle : « P.U. HT (€) » contient « prix unitaire ».
        if (mots.some(m => m.length > 2 && n.includes(m))) { columns[kind] = c; score += 1; return; }
      }
    });
    // Il faut au moins de quoi désigner un article et lui porter un prix.
    const utilisable = columns.designation !== undefined
      && (columns.prixUnitaire !== undefined || columns.montant !== undefined);
    if (utilisable && (!best || score > best.score)) best = { headerRow: r, columns, score };
  }

  return best ? { headerRow: best.headerRow, columns: best.columns } : null;
}

// ── Rapprochement ─────────────────────────────────────────────────────────────

export type MatchMethod = 'ref' | 'numero' | 'designation' | 'approximatif' | 'aucun';
export type Confiance = 'exacte' | 'haute' | 'basse' | 'aucune';

export interface LigneImportee {
  feuille: string;
  rowIndex: number;
  ref: string;
  numero: string;
  designation: string;
  unite: string;
  quantite: number | null;
  prixUnitaire: number | null;
}

export interface Rapprochement {
  source: LigneImportee;
  articleId: string;
  articleNumero: string;
  articleDesignation: string;
  articleUnite: string;
  estimation: number;
  prixUnitaire: number | null;
  method: MatchMethod;
  confiance: Confiance;
  /** Écarts constatés avec le document de référence. */
  alertes: string[];
}

export interface ResultatImport {
  meta: { schemaVersion?: number; bpuId?: string; version?: string; correspond: boolean };
  rapprochements: Rapprochement[];
  /** Lignes du fichier qui n'ont pas trouvé d'article. */
  nonAppariees: LigneImportee[];
  /** Articles du bordereau qu'aucune ligne ne chiffre. */
  nonChiffres: { id: string; numero: string; designation: string }[];
  /** Montant total de l'offre, quantités du DQE à l'appui. */
  totalOffreHT: number;
}

const SEUIL_APPROX = 0.82;
const ECART_MIN_RUNNER_UP = 0.08;

interface ArticleRef {
  id: string; numero: string; designation: string; unite: string;
  quantite: number; prixUnitaire: number;
  refBpu?: string;
}

function indexArticles(bpu: BPU): ArticleRef[] {
  const out: ArticleRef[] = [];
  forEachLigne(bpu.lots, (l: BPULigne) => {
    // Un article parent porte la somme de ses enfants, il ne se chiffre pas.
    if (l.children?.length) return;
    out.push({
      id: l.id, numero: l.numero, designation: l.designation, unite: l.unite,
      quantite: l.quantite, prixUnitaire: l.prixUnitaire, refBpu: l.refBpu,
    });
  });
  return out;
}

/**
 * Rapproche les lignes lues des articles du bordereau.
 *
 * Cascade : référence exacte, puis numéro normalisé unique, puis désignation
 * normalisée unique, puis similarité approximative sous condition stricte.
 * Un article déjà pris par un rapprochement plus sûr ne peut pas être
 * revendiqué une seconde fois.
 */
export function rapprocher(lignes: LigneImportee[], bpu: BPU): Omit<ResultatImport, 'meta'> {
  const articles = indexArticles(bpu);
  const parRef = new Map<string, ArticleRef>();
  const parNumero = new Map<string, ArticleRef[]>();
  const parDesignation = new Map<string, ArticleRef[]>();

  for (const a of articles) {
    if (a.refBpu) parRef.set(a.refBpu.trim().toUpperCase(), a);
    const n = normalizeNumero(a.numero);
    if (n) (parNumero.get(n) ?? parNumero.set(n, []).get(n)!).push(a);
    const d = normalizeText(a.designation);
    if (d) (parDesignation.get(d) ?? parDesignation.set(d, []).get(d)!).push(a);
  }

  const pris = new Set<string>();
  const rapprochements: Rapprochement[] = [];
  const restantes: LigneImportee[] = [];

  const attacher = (source: LigneImportee, a: ArticleRef, method: MatchMethod, confiance: Confiance) => {
    pris.add(a.id);
    const alertes: string[] = [];
    if (source.unite && a.unite && normalizeText(source.unite) !== normalizeText(a.unite)) {
      alertes.push(`Unité différente : « ${source.unite} » au lieu de « ${a.unite} »`);
    }
    if (source.designation && normalizeText(source.designation) !== normalizeText(a.designation)) {
      alertes.push('Désignation modifiée par le candidat');
    }
    if (source.quantite != null && a.quantite && Math.abs(source.quantite - a.quantite) > 1e-6) {
      alertes.push(`Quantité modifiée : ${source.quantite} au lieu de ${a.quantite}`);
    }
    if (source.prixUnitaire == null) alertes.push('Poste non chiffré');
    else if (source.prixUnitaire === 0) alertes.push('Prix unitaire à zéro');
    else if (a.prixUnitaire > 0) {
      const ratio = source.prixUnitaire / a.prixUnitaire;
      if (ratio < 0.2 || ratio > 5) {
        alertes.push(`Prix très éloigné de l'estimation (x${ratio.toFixed(1)})`);
      }
    }
    rapprochements.push({
      source, articleId: a.id, articleNumero: a.numero, articleDesignation: a.designation,
      articleUnite: a.unite, estimation: a.prixUnitaire, prixUnitaire: source.prixUnitaire,
      method, confiance, alertes,
    });
  };

  // Passe 1 — référence exacte.
  let file = lignes;
  let suivantes: LigneImportee[] = [];
  for (const l of file) {
    const a = l.ref ? parRef.get(l.ref.trim().toUpperCase()) : undefined;
    if (a && !pris.has(a.id)) attacher(l, a, 'ref', 'exacte');
    else suivantes.push(l);
  }

  // Passe 2 — numéro normalisé, à condition qu'il soit unique.
  file = suivantes; suivantes = [];
  for (const l of file) {
    const candidats = (parNumero.get(normalizeNumero(l.numero)) ?? []).filter(a => !pris.has(a.id));
    if (candidats.length === 1) attacher(l, candidats[0], 'numero', 'haute');
    else suivantes.push(l);
  }

  // Passe 3 — désignation identique une fois normalisée, et unique.
  file = suivantes; suivantes = [];
  for (const l of file) {
    const candidats = (parDesignation.get(normalizeText(l.designation)) ?? []).filter(a => !pris.has(a.id));
    if (candidats.length === 1) attacher(l, candidats[0], 'designation', 'haute');
    else suivantes.push(l);
  }

  // Passe 4 — approximatif, sous conditions strictes : le meilleur candidat
  // doit être franchement devant le suivant, et l'unité doit concorder.
  file = suivantes;
  for (const l of file) {
    const scores = articles
      .filter(a => !pris.has(a.id))
      .map(a => ({ a, score: diceSimilarity(l.designation, a.designation) }))
      .sort((x, y) => y.score - x.score);

    const [meilleur, second] = scores;
    const uniteOk = !l.unite || !meilleur?.a.unite
      || normalizeText(l.unite) === normalizeText(meilleur.a.unite);

    if (meilleur && meilleur.score >= SEUIL_APPROX && uniteOk
        && (!second || meilleur.score - second.score >= ECART_MIN_RUNNER_UP)) {
      attacher(l, meilleur.a, 'approximatif', 'basse');
    } else {
      restantes.push(l);
    }
  }

  const nonChiffres = articles
    .filter(a => !pris.has(a.id))
    .map(a => ({ id: a.id, numero: a.numero, designation: a.designation }));

  const totalOffreHT = rapprochements.reduce((s, r) => {
    const a = articles.find(x => x.id === r.articleId);
    return s + (r.prixUnitaire != null && a ? r.prixUnitaire * a.quantite : 0);
  }, 0);

  return { rapprochements, nonAppariees: restantes, nonChiffres, totalOffreHT };
}

// ── Lecture du classeur ───────────────────────────────────────────────────────

/**
 * Résout les cellules fusionnées en recopiant la valeur du coin haut-gauche
 * dans toute la zone : sans cela une désignation fusionnée sur trois lignes
 * est lue vide sur deux d'entre elles.
 */
function resoudreFusions(grid: any[][], merges: any[] | undefined): any[][] {
  if (!merges?.length) return grid;
  const out = grid.map(r => [...(r ?? [])]);
  for (const m of merges) {
    const v = out[m.s.r]?.[m.s.c];
    if (v === undefined || v === '') continue;
    for (let r = m.s.r; r <= m.e.r && r < out.length; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (!out[r]) out[r] = [];
        if (out[r][c] === undefined || out[r][c] === '') out[r][c] = v;
      }
    }
  }
  return out;
}

/** Une ligne de structure (lot, chapitre) ne porte pas de prix. */
function estStructure(ref: string, prix: number | null, designation: string): boolean {
  if (ref.startsWith('#')) return true;
  return prix == null && !!designation && /^(lot|chapitre|sous[- ]?total|total)\b/i.test(designation.trim());
}

export interface FeuilleBrute {
  nom: string;
  grid: any[][];
  merges?: any[];
}

/** Analyse un classeur déjà lu. Séparé de la lecture pour rester testable. */
export function analyserClasseur(feuilles: FeuilleBrute[], bpu: BPU): ResultatImport {
  const meta: ResultatImport['meta'] = { correspond: true };

  const feuilleMeta = feuilles.find(f => f.nom === SHEET_META);
  if (feuilleMeta) {
    const kv = new Map(feuilleMeta.grid.map(r => [String(r?.[0] ?? ''), r?.[1]]));
    meta.schemaVersion = Number(kv.get('schema_version')) || undefined;
    meta.bpuId = kv.get('bpu_id') ? String(kv.get('bpu_id')) : undefined;
    meta.version = kv.get('version') ? String(kv.get('version')) : undefined;
    meta.correspond =
      (meta.bpuId === undefined || meta.bpuId === bpu.id)
      && (meta.schemaVersion === undefined || meta.schemaVersion === BPU_SHEET_SCHEMA);
  }

  const lignes: LigneImportee[] = [];

  for (const f of feuilles.slice(0, MAX_FEUILLES)) {
    if (f.nom === SHEET_META) continue;
    const grid = resoudreFusions(f.grid, f.merges).slice(0, MAX_ROWS_PAR_FEUILLE);
    const detected = detectHeader(grid);
    if (!detected) continue;
    const { headerRow, columns } = detected;

    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const at = (k: ColonneKind) => (columns[k] !== undefined ? row[columns[k]!] : undefined);

      const designation = String(at('designation') ?? '').trim();
      const ref = String(at('ref') ?? '').trim();
      const numero = String(at('numero') ?? '').trim();
      if (!designation && !ref && !numero) continue;

      const prixUnitaire = parseFrenchNumber(at('prixUnitaire'));
      if (estStructure(ref, prixUnitaire, designation)) continue;

      lignes.push({
        feuille: f.nom, rowIndex: r, ref, numero, designation,
        unite: String(at('unite') ?? '').trim(),
        quantite: parseFrenchNumber(at('quantite')),
        prixUnitaire,
      });
    }
  }

  return { meta, ...rapprocher(lignes, bpu) };
}

/** Lit un fichier renvoyé par une entreprise et le rapproche du bordereau. */
export async function parseOffreFile(file: File, bpu: BPU): Promise<ResultatImport> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  // Les valeurs calculées seulement : aucune formule du fichier n'est évaluée.
  const wb = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false });

  const feuilles: FeuilleBrute[] = wb.SheetNames.map(nom => {
    const ws = wb.Sheets[nom];
    return {
      nom,
      grid: XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: true, blankrows: false }),
      merges: (ws as any)['!merges'],
    };
  });

  return analyserClasseur(feuilles, bpu);
}
