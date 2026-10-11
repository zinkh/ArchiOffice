// ── Textes automatiques du CCTP ──────────────────────────────────────────────
// Une description technique peut citer l'opération, l'adresse, le lot... par
// une variable `{{cle}}`, remplacée à l'export : le texte reste juste si le
// nom du lot ou l'adresse change. Une variable inconnue reste telle quelle ;
// une variable connue mais sans valeur devient « [… à renseigner] », visible
// dans le document plutôt qu'un vide silencieux.

/** Données de l'opération, communes à tout le document. */
export interface ContexteCctp {
  operation?: string;
  reference?: string;
  adresse?: string;
  maitreOuvrage?: string;
  parcelle?: string;
  zonePlu?: string;
  surface?: string;
  agence?: string;
}

/** Position dans l'arbre de l'élément dont on résout le texte. */
export interface NoeudCctp {
  lotNumero?: string;
  lotTitre?: string;
  chapitreNumero?: string;
  chapitreTitre?: string;
  articleNumero?: string;
  articleDesignation?: string;
  localisation?: string;
  /** Libellés des bâtiments concernés. */
  batiments?: string[];
}

export interface VariableCctp {
  cle: string;
  libelle: string;
  groupe: 'operation' | 'arbre' | 'divers';
  valeur: (c: ContexteCctp, n: NoeudCctp, date: Date) => string | undefined;
}

const dateLongue = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export const VARIABLES_CCTP: VariableCctp[] = [
  { cle: 'operation', libelle: "Nom de l'opération", groupe: 'operation', valeur: c => c.operation },
  { cle: 'reference', libelle: "Numéro de l'affaire", groupe: 'operation', valeur: c => c.reference },
  { cle: 'adresse', libelle: 'Adresse du projet', groupe: 'operation', valeur: c => c.adresse },
  { cle: 'maitre_ouvrage', libelle: "Maître d'ouvrage", groupe: 'operation', valeur: c => c.maitreOuvrage },
  { cle: 'parcelle', libelle: 'Références cadastrales', groupe: 'operation', valeur: c => c.parcelle },
  { cle: 'zone_plu', libelle: 'Zone du PLU', groupe: 'operation', valeur: c => c.zonePlu },
  { cle: 'surface', libelle: 'Surface du projet', groupe: 'operation', valeur: c => c.surface },
  { cle: 'lot', libelle: 'Lot (numéro et intitulé)', groupe: 'arbre', valeur: (_c, n) => [n.lotNumero && `Lot ${n.lotNumero}`, n.lotTitre].filter(Boolean).join(' · ') || undefined },
  { cle: 'lot_numero', libelle: 'Numéro du lot', groupe: 'arbre', valeur: (_c, n) => n.lotNumero },
  { cle: 'lot_titre', libelle: 'Intitulé du lot', groupe: 'arbre', valeur: (_c, n) => n.lotTitre },
  { cle: 'chapitre', libelle: 'Intitulé du chapitre', groupe: 'arbre', valeur: (_c, n) => n.chapitreTitre },
  { cle: 'article', libelle: "Intitulé de l'article", groupe: 'arbre', valeur: (_c, n) => n.articleDesignation },
  { cle: 'numero', libelle: "Numéro de l'élément", groupe: 'arbre', valeur: (_c, n) => n.articleNumero ?? n.chapitreNumero ?? n.lotNumero },
  { cle: 'localisation', libelle: "Localisation de l'article", groupe: 'arbre', valeur: (_c, n) => n.localisation },
  { cle: 'batiments', libelle: 'Bâtiments concernés', groupe: 'arbre', valeur: (_c, n) => n.batiments?.length ? n.batiments.join(', ') : undefined },
  { cle: 'agence', libelle: "Nom de l'agence", groupe: 'divers', valeur: c => c.agence },
  { cle: 'date', libelle: "Date du jour", groupe: 'divers', valeur: (_c, _n, d) => dateLongue(d) },
];

const PAR_CLE = new Map(VARIABLES_CCTP.map(v => [v.cle, v]));

/** Remplace chaque `{{cle}}` connue ; une clé inconnue n'est jamais touchée. */
export function resoudreVariables(texte: string, contexte: ContexteCctp, noeud: NoeudCctp, date: Date = new Date()): string {
  if (!texte.includes('{{')) return texte;
  return texte.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (brut, cle: string) => {
    const v = PAR_CLE.get(cle);
    if (!v) return brut;
    return v.valeur(contexte, noeud, date)?.trim() || `[${v.libelle.toLowerCase()} à renseigner]`;
  });
}

export const jeton = (cle: string) => `{{${cle}}}`;
