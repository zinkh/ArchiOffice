// Étude de faisabilité d'une proposition : logique pure partagée par l'écran
// (src/components/proposal/FeasibilityStudy.tsx), les exports PDF/Word
// (src/lib/feasibilityExport.ts) et le serveur, qui en tire le contexte donné
// à l'IA (server/routes/proposalFeasibilityAi.ts). Aucune dépendance au
// navigateur ni à Express : testée seule (src/lib/__tests__/feasibilityBlocks.test.ts).
import type { Proposal } from '../types';

/** Extrait de carte inséré dans une rubrique (image = ligne `documents`). */
export interface FeasibilityIllustration {
  document_id: string;
  file_url: string;
  layer: string;
  scale: number;
  caption: string;
  captured_at: string;
}

export interface FeasibilitySection {
  id: string;
  proposal_id: string;
  title: string;
  content: string;
  instructions: string;
  illustrations: FeasibilityIllustration[];
  status: 'a_rediger' | 'redige';
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Données publiques du terrain, relues côté serveur (server/feasibilitySiteData.ts).
 * Chaque bloc est facultatif : un service public indisponible laisse son champ
 * à null sans priver l'étude des autres.
 */
export interface FeasibilitySiteData {
  address: { label: string; lat: number; lon: number; citycode: string; city: string } | null;
  plu: {
    libelle: string;
    libelong: string;
    typezone: string;
    destdomi: string | null;
    urlfic: string | null;
    datappro: string | null;
    document: { nom: string | null; typedoc: string | null } | null;
  } | null;
  risques: { url: string; risques_naturels: string[]; risques_technologiques: string[] } | null;
  monuments: Array<{ nom: string; statut: string; commune: string; distance_m: number }> | null;
}

export const EMPTY_SITE_DATA: FeasibilitySiteData = { address: null, plu: null, risques: null, monuments: null };

/**
 * Plan type d'une étude de faisabilité, posé par « Préremplir les rubriques »
 * sans appel à l'IA. L'architecte reste libre de renommer, supprimer ou ajouter.
 */
export const DEFAULT_FEASIBILITY_TITLES = [
  "Objet de l'étude",
  'Situation et site',
  'Analyse urbanistique (PLU)',
  'Servitudes et risques',
  'Patrimoine et ABF',
  'Programme',
  'Capacité constructible et scénarios',
  'Contraintes réglementaires (ERP, accessibilité, RE2020)',
  'Estimation sommaire',
  'Calendrier prévisionnel',
  'Conclusions et recommandations',
];

/** Rayon de recherche des monuments historiques : le périmètre de protection usuel des abords. */
export const MONUMENTS_RADIUS_M = 500;

export type FeasibilityBlockKind =
  | 'terrain' | 'urbanisme' | 'risques' | 'patrimoine' | 'programme' | 'erp' | 'enveloppe';

export const FEASIBILITY_BLOCK_KINDS: FeasibilityBlockKind[] = [
  'terrain', 'urbanisme', 'risques', 'patrimoine', 'programme', 'erp', 'enveloppe',
];

const clean = (v: unknown): string => (v == null ? '' : String(v).trim());

/** « 1 250 000 € », espace normale (les polices standard de jsPDF ne savent pas placer l'espace fine). */
export function formatEuros(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, ' ')} €`;
}

/** Ajoute l'unité m² à une surface saisie sans unité. */
function withM2(value: unknown): string {
  const v = clean(value);
  if (!v) return '';
  return /m²|m2/i.test(v) ? v : `${v} m²`;
}

function lines(title: string, rows: Array<[string, string]>): string {
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0) return '';
  return [title, ...filled.map(([k, v]) => `- ${k} : ${v}`)].join('\n');
}

type ProposalLike = Partial<Proposal> & { construction_cost?: number | string | null };

function terrainAddress(p: ProposalLike): string {
  return [clean(p.adresse_terrain), clean(p.cp_ville_terrain)].filter(Boolean).join(', ');
}

/**
 * Bloc de texte prêt à insérer dans une rubrique. Rend une chaîne vide quand
 * aucune donnée n'est disponible : l'écran le signale plutôt que d'insérer un
 * titre sans contenu.
 */
export function buildFeasibilityBlock(kind: FeasibilityBlockKind, p: ProposalLike, site: FeasibilitySiteData = EMPTY_SITE_DATA): string {
  switch (kind) {
    case 'terrain':
      return lines('Terrain', [
        ['Adresse', terrainAddress(p) || clean(site.address?.label)],
        ['Références cadastrales', clean(p.ref_cadastrale)],
        ['Surface de la parcelle', withM2(p.surface_parcelle)],
      ]);
    case 'urbanisme': {
      const plu = site.plu;
      const zone = plu ? [plu.libelle, plu.libelong].filter(Boolean).join(' : ') : clean(p.zone_plu);
      const doc = plu?.document ? [plu.document.typedoc, plu.document.nom].filter(Boolean).join(' ') : '';
      return lines('Urbanisme', [
        ['Zone', zone],
        ['Document en vigueur', doc],
        ['Destination dominante', clean(plu?.destdomi)],
        ['Approbation', plu?.datappro ? new Date(plu.datappro).toLocaleDateString('fr-FR') : ''],
        ['Règlement', clean(plu?.urlfic)],
      ]);
    }
    case 'risques': {
      const r = site.risques;
      if (!r) return '';
      const nat = r.risques_naturels.join(', ');
      const tech = r.risques_technologiques.join(', ');
      return lines('Risques (Géorisques)', [
        ['Risques naturels', nat || 'aucun risque naturel recensé'],
        ['Risques technologiques', tech || 'aucun risque technologique recensé'],
        ['Rapport', clean(r.url)],
      ]);
    }
    case 'patrimoine': {
      const m = site.monuments;
      if (!m) return '';
      if (m.length === 0) return `Patrimoine\n- Aucun monument historique recensé à moins de ${MONUMENTS_RADIUS_M} m.`;
      return [
        `Patrimoine (monuments historiques à moins de ${MONUMENTS_RADIUS_M} m)`,
        ...m.map(x => `- ${x.nom}${x.statut ? ` (${x.statut})` : ''}, à ${Math.round(x.distance_m)} m`),
        "- Le terrain est susceptible d'être situé dans les abords d'un monument historique : avis de l'Architecte des Bâtiments de France à prévoir.",
      ].join('\n');
    }
    case 'programme':
      return lines('Programme', [
        ['Opération', clean(p.title)],
        ['Type de projet', [clean(p.type_projet), clean(p.categorie_projet)].filter(Boolean).join(', ')],
        ['État avant travaux', clean(p.avant_trav)],
        ['État après travaux', clean(p.apres_trav)],
        ['Surface de plancher', withM2(p.surface_plancher)],
        ['Surface de plancher créée en extension', withM2(p.surface_plancher_ext)],
        ['Description', clean(p.projet_detail) || clean(p.description)],
      ]);
    case 'erp':
      return lines('Établissement recevant du public', [
        ['Établissement', clean(p.nom_etablissement)],
        ['Type et catégorie', clean(p.type_et_cat)],
        ['Surface ERP', withM2(p.surface_erp)],
        ['Surface ERT', withM2(p.surface_ert)],
        ['Effectif public', clean(p.effectif_public)],
        ['Effectif personnel', clean(p.effectif_personnel)],
      ]);
    case 'enveloppe':
      return lines('Enveloppe financière', [
        ['Coût prévisionnel des travaux HT', formatEuros(p.construction_cost)],
        ['Honoraires de maîtrise d\'œuvre HT', formatEuros(p.amount)],
      ]);
  }
}

/** Ajoute un bloc à la fin d'un texte, séparé par une ligne vide. */
export function appendBlock(content: string, block: string): string {
  const base = content.replace(/\s+$/, '');
  const add = block.trim();
  if (!add) return content;
  return base ? `${base}\n\n${add}` : add;
}

/**
 * Tout ce que l'on sait du projet et du site, en texte, pour le contexte de
 * l'IA. Les blocs vides sont omis : le modèle ne doit pas voir « Zone : »
 * sans valeur et la compléter lui-même.
 */
export function feasibilityContextForPrompt(p: ProposalLike, site: FeasibilitySiteData): string {
  return FEASIBILITY_BLOCK_KINDS
    .map(kind => buildFeasibilityBlock(kind, p, site))
    .filter(Boolean)
    .join('\n\n');
}

/** Normalise une liste d'illustrations reçue d'un client (ou relue en base). */
export function sanitizeIllustrations(raw: unknown): FeasibilityIllustration[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter(x => typeof x.document_id === 'string' && typeof x.file_url === 'string')
    .slice(0, 20)
    .map(x => ({
      document_id: String(x.document_id).slice(0, 100),
      file_url: String(x.file_url).slice(0, 1000),
      layer: clean(x.layer).slice(0, 60),
      scale: Number.isFinite(Number(x.scale)) ? Math.round(Number(x.scale)) : 0,
      caption: clean(x.caption).slice(0, 300),
      captured_at: clean(x.captured_at).slice(0, 40) || new Date().toISOString(),
    }));
}

// ── Exports (page de garde, nom de fichier) ─────────────────────────────────

function sanitizeFilename(name: string): string {
  return (name || 'etude').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
}

export function feasibilityFilename(p: ProposalLike, ext: 'pdf' | 'docx'): string {
  return `Etude_faisabilite_${sanitizeFilename(p.reference || '')}_${sanitizeFilename(p.title || '')}.${ext}`.replace(/_+/g, '_');
}

/** Lignes d'identification de l'opération sur la page de garde (vides omises). */
export function feasibilityCoverFields(p: ProposalLike): Array<[string, string]> {
  const terrain = [p.adresse_terrain, p.cp_ville_terrain].filter(Boolean).join(', ');
  const client = p.is_entreprise ? (p.nom_societe || p.client_name) : (p.client_name || p.representant);
  const rows: Array<[string, string]> = [
    ['Opération', p.title || ''],
    ["Maître d'ouvrage", client || ''],
    ['Terrain', terrain],
    ['Références cadastrales', p.ref_cadastrale || ''],
    ['Référence', p.reference || ''],
  ];
  return rows.filter(([, v]) => String(v).trim());
}

// Le texte rédigé (souvent par l'IA) porte du balisage Markdown et des guillemets
// droits : *texte* et "texte" deviennent des guillemets français, **texte** perd
// son balisage. Les espaces des guillemets sont insécables pour ne jamais être
// séparés du mot qu'ils entourent.
const NBSP = '\u00A0';
export function typographie(text: string): string {
  return text
    .replace(/\*\*(\S(?:[^*\n]*?\S)?)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*(\S(?:[^*\n]*?\S)?)\*(?![*\w])/g, `$1«${NBSP}$2${NBSP}»`)
    .replace(/"([^"\n]+)"/g, `«${NBSP}$1${NBSP}»`)
    .replace(/\u202F/g, ' ');
}
