// ── Atelier DOE (onglet AOR) : règles partagées écran / serveur ──────────────
// Fonctions pures. L'écran (src/components/aor/), les routes cabinet et le
// portail public (server/routes/doeAtelier*.ts), la relance automatique et les
// PDF lisent les mêmes pièces attendues, statuts et règles de relance.
//
// Principe : rien ne se saisit deux fois. Le statut d'une entreprise, la
// complétude de son dossier et le calendrier de relance se DÉDUISENT des
// documents reçus (table documents, doc_type = 'DOE'), de la demande envoyée
// (doe_requests) et du dernier visa émis (doe_visas).

import {
  MAX_DEPOT_OCTETS, MAX_FICHIER_OCTETS, MAX_FICHIERS_PAR_DEPOT, extensionDe, formatOctets,
} from './consultationDepot';

// ── Pièces attendues d'un DOE ────────────────────────────────────────────────

export type DoePieceKey =
  | 'plans_execution'
  | 'notices'
  | 'fiches_techniques'
  | 'pv_essais'
  | 'attestations'
  | 'garanties'
  | 'autre';

export interface DoePiece {
  key: DoePieceKey;
  label: string;
  description: string;
  /** Mots (sans accent, minuscules) qui trahissent la pièce dans un nom de fichier ou un texte. */
  motsCles: string[];
  /** Exigée par défaut pour qu'un dossier soit complet. */
  requiseParDefaut: boolean;
}

export const DOE_PIECES: DoePiece[] = [
  {
    key: 'plans_execution', label: "Plans conformes à l'exécution",
    description: 'Plans de récolement, schémas et calepinages tels que réalisés.',
    motsCles: ['recolement', 'plan', 'conforme a l execution', 'conformes a l execution', 'calepinage', 'schema', 'synoptique', 'dwg', 'dxf'],
    requiseParDefaut: true,
  },
  {
    key: 'notices', label: "Notices de fonctionnement et d'entretien",
    description: "Notices d'utilisation, de fonctionnement, d'entretien et de maintenance des ouvrages et équipements.",
    motsCles: ['notice', 'entretien', 'maintenance', 'fonctionnement', 'utilisation', 'manuel', 'mode d emploi', 'exploitation'],
    requiseParDefaut: true,
  },
  {
    key: 'fiches_techniques', label: 'Fiches techniques et références des matériaux',
    description: 'Fiches produits, avis techniques, FDES, références des matériaux et équipements mis en œuvre.',
    motsCles: ['fiche technique', 'fiches techniques', 'avis technique', 'atec', 'fds', 'fdes', 'datasheet', 'reference materiau', 'references', 'descriptif produit'],
    requiseParDefaut: true,
  },
  {
    key: 'pv_essais', label: "PV d'essais et de contrôles",
    description: "Procès-verbaux d'essais, d'épreuves, de réglages, rapports de contrôle technique et Consuel.",
    motsCles: ['pv', 'proces verbal', 'essai', 'essais', 'epreuve', 'controle', 'consuel', 'etancheite', 'reglage', 'mise en service', 'rapport', 'qualigaz', 'conformite'],
    requiseParDefaut: true,
  },
  {
    key: 'attestations', label: 'Attestations',
    description: 'Attestations de conformité, de formation, de mise en œuvre, assurances décennales.',
    motsCles: ['attestation', 'decennale', 'assurance', 'certificat de conformite', 'declaration de conformite', 'qualification'],
    requiseParDefaut: false,
  },
  {
    key: 'garanties', label: 'Garanties',
    description: "Certificats et conditions de garantie des fabricants et de l'entreprise.",
    motsCles: ['garantie', 'garanties', 'certificat de garantie', 'sav'],
    requiseParDefaut: true,
  },
  {
    key: 'autre', label: 'Autres documents',
    description: "Tout autre document utile à l'exploitation de l'ouvrage.",
    motsCles: [],
    requiseParDefaut: false,
  },
];

export const DOE_PIECE_LABELS: Record<DoePieceKey, string> =
  Object.fromEntries(DOE_PIECES.map(p => [p.key, p.label])) as Record<DoePieceKey, string>;

export function pieceConnue(valeur: unknown): valeur is DoePieceKey {
  return typeof valeur === 'string' && DOE_PIECES.some(p => p.key === valeur);
}

/** Pièces exigées : celles choisies dans les réglages, à défaut les pièces exigées par défaut. */
export function piecesRequises(choix?: unknown): DoePieceKey[] {
  if (Array.isArray(choix)) {
    const valides = choix.filter(pieceConnue).filter((k, i, a) => a.indexOf(k) === i);
    if (valides.length) return valides;
  }
  return DOE_PIECES.filter(p => p.requiseParDefaut).map(p => p.key);
}

// ── Avis et statuts ──────────────────────────────────────────────────────────

/** Avis du maître d'œuvre sur un document (stocké dans documents.validation_status). */
export type DoeAvisDocument = 'pending' | 'approved' | 'commented' | 'rejected';

export const DOE_AVIS_DOCUMENT_LABELS: Record<DoeAvisDocument, string> = {
  pending: 'À analyser',
  approved: 'Favorable',
  commented: 'Avec observations',
  rejected: 'Défavorable',
};

export function avisDocument(valeur: unknown): DoeAvisDocument {
  return valeur === 'approved' || valeur === 'commented' || valeur === 'rejected' ? valeur : 'pending';
}

/** Avis d'un visa, au vocabulaire du maître d'œuvre (jamais « validé »). */
export type DoeAvisVisa = 'favorable' | 'avec_observations' | 'defavorable';

export const DOE_AVIS_VISA_LABELS: Record<DoeAvisVisa, string> = {
  favorable: 'Favorable',
  avec_observations: 'Favorable avec observations',
  defavorable: 'Défavorable',
};

export function avisVisaValide(valeur: unknown): valeur is DoeAvisVisa {
  return valeur === 'favorable' || valeur === 'avec_observations' || valeur === 'defavorable';
}

export type DoeStatut =
  | 'a_solliciter'
  | 'sollicitee'
  | 'partiel'
  | 'a_analyser'
  | 'a_corriger'
  | 'conforme'
  | 'vise';

export const DOE_STATUT_LABELS: Record<DoeStatut, string> = {
  a_solliciter: 'À solliciter',
  sollicitee: 'Sollicitée',
  partiel: 'Dossier incomplet',
  a_analyser: 'À analyser',
  a_corriger: 'À corriger',
  conforme: 'Conforme, à viser',
  vise: 'Visé',
};

export interface DoeDocument {
  id: string;
  name: string;
  /** Pièce attendue à laquelle le document répond ; absent = non classé. */
  doe_piece?: string | null;
  validation_status?: string | null;
  validation_comments?: string | null;
  uploaded_at?: string | null;
  size_bytes?: number | null;
  file_url?: string | null;
}

export interface Couverture {
  /** Pièces exigées pour lesquelles aucun document recevable (non défavorable) n'existe. */
  manquantes: DoePieceKey[];
  /** Pièces exigées couvertes par au moins un document favorable. */
  validees: DoePieceKey[];
  /** Pièces exigées couvertes, mais dont aucun document n'est encore favorable. */
  enAttente: DoePieceKey[];
  requises: DoePieceKey[];
  /** Documents non classés. */
  nonClasses: string[];
  /** Part des pièces exigées couvertes, 0 à 1. */
  taux: number;
}

export function couvertureDossier(documents: DoeDocument[], requises: DoePieceKey[]): Couverture {
  const manquantes: DoePieceKey[] = [];
  const validees: DoePieceKey[] = [];
  const enAttente: DoePieceKey[] = [];
  for (const piece of requises) {
    const deLaPiece = documents.filter(d => d.doe_piece === piece);
    const recevables = deLaPiece.filter(d => avisDocument(d.validation_status) !== 'rejected');
    if (recevables.length === 0) manquantes.push(piece);
    else if (recevables.some(d => avisDocument(d.validation_status) === 'approved')) validees.push(piece);
    else enAttente.push(piece);
  }
  const couvertes = requises.length - manquantes.length;
  return {
    manquantes, validees, enAttente, requises,
    nonClasses: documents.filter(d => !pieceConnue(d.doe_piece)).map(d => d.id),
    taux: requises.length ? couvertes / requises.length : 1,
  };
}

export interface VisaResume {
  avis: DoeAvisVisa;
  issued_at: string;
}

export interface EntrepriseDoe {
  /** Une demande a été envoyée à l'entreprise. */
  sollicitee: boolean;
  documents: DoeDocument[];
  requises: DoePieceKey[];
  /** Dernier visa émis pour l'entreprise. */
  visa?: VisaResume | null;
}

/**
 * Statut déduit, jamais saisi. Un visa n'est valable que pour le dossier qu'il a
 * visé : un document déposé après son émission rouvre l'analyse.
 */
export function statutEntreprise(e: EntrepriseDoe): DoeStatut {
  const docs = e.documents;
  if (!e.sollicitee && docs.length === 0) return 'a_solliciter';
  if (docs.length === 0) return 'sollicitee';

  const apresVisa = e.visa
    ? docs.some(d => d.uploaded_at && new Date(d.uploaded_at).getTime() > new Date(e.visa!.issued_at).getTime())
    : false;
  // Un visa défavorable n'achève rien : l'entreprise doit corriger ou compléter.
  if (e.visa && !apresVisa) return e.visa.avis === 'defavorable' ? 'a_corriger' : 'vise';

  const couverture = couvertureDossier(docs, e.requises);
  if (docs.some(d => avisDocument(d.validation_status) === 'pending')) {
    return couverture.manquantes.length ? 'partiel' : 'a_analyser';
  }
  if (couverture.manquantes.length) return 'partiel';
  if (docs.some(d => avisDocument(d.validation_status) === 'rejected' || avisDocument(d.validation_status) === 'commented')) {
    return 'a_corriger';
  }
  return 'conforme';
}

/** Avis proposé pour le visa : l'architecte le confirme ou le change. */
export function avisSuggere(documents: DoeDocument[], requises: DoePieceKey[]): DoeAvisVisa {
  const c = couvertureDossier(documents, requises);
  if (c.manquantes.length) return 'defavorable';
  const recevables = documents.filter(d => avisDocument(d.validation_status) !== 'rejected');
  if (recevables.some(d => avisDocument(d.validation_status) !== 'approved')) return 'avec_observations';
  if (documents.some(d => avisDocument(d.validation_status) === 'rejected')) return 'avec_observations';
  return 'favorable';
}

// ── Relances automatiques ────────────────────────────────────────────────────

export interface ReglagesRelance {
  reminder_enabled?: boolean | null;
  /** Jours entre deux relances. */
  reminder_interval_days?: number | null;
  /** Nombre maximal de relances par entreprise. */
  reminder_max?: number | null;
}

export const RELANCE_INTERVALLE_DEFAUT = 7;
export const RELANCE_MAX_DEFAUT = 4;
export const RELANCE_INTERVALLE_MIN = 2;
export const RELANCE_INTERVALLE_MAX = 60;
export const RELANCE_MAX_BORNE = 10;

export function intervalleRelance(r: ReglagesRelance | null | undefined): number {
  const n = Number(r?.reminder_interval_days);
  if (!Number.isFinite(n) || n <= 0) return RELANCE_INTERVALLE_DEFAUT;
  return Math.min(RELANCE_INTERVALLE_MAX, Math.max(RELANCE_INTERVALLE_MIN, Math.round(n)));
}

export function maxRelances(r: ReglagesRelance | null | undefined): number {
  const n = Number(r?.reminder_max);
  if (!Number.isFinite(n) || n < 0) return RELANCE_MAX_DEFAUT;
  return Math.min(RELANCE_MAX_BORNE, Math.round(n));
}

export interface DemandeDoe {
  sent_at?: string | null;
  last_reminder_at?: string | null;
  reminder_count?: number | null;
  revoked_at?: string | null;
  expires_at?: string | null;
  email?: string | null;
}

/** Une relance n'a de sens que tant que le dossier reste à compléter. */
export function relanceUtile(statut: DoeStatut): boolean {
  return statut === 'sollicitee' || statut === 'partiel' || statut === 'a_corriger';
}

/**
 * Date de la prochaine relance automatique, ou null quand il n'y en a plus à
 * faire (relances coupées, plafond atteint, lien révoqué ou expiré, demande non
 * envoyée, dossier qui n'attend plus l'entreprise, pas d'adresse).
 */
export function prochaineRelance(
  demande: DemandeDoe | null | undefined,
  reglages: ReglagesRelance | null | undefined,
  statut: DoeStatut,
): Date | null {
  if (!demande?.sent_at || !demande.email) return null;
  if (reglages?.reminder_enabled === false) return null;
  if (demande.revoked_at) return null;
  if (!relanceUtile(statut)) return null;
  if ((demande.reminder_count ?? 0) >= maxRelances(reglages)) return null;
  const base = new Date(demande.last_reminder_at || demande.sent_at);
  if (Number.isNaN(base.getTime())) return null;
  const prochaine = new Date(base.getTime() + intervalleRelance(reglages) * 24 * 3600 * 1000);
  if (demande.expires_at && prochaine.getTime() > new Date(demande.expires_at).getTime()) return null;
  return prochaine;
}

export function relanceDue(
  demande: DemandeDoe | null | undefined,
  reglages: ReglagesRelance | null | undefined,
  statut: DoeStatut,
  now: Date = new Date(),
): boolean {
  const p = prochaineRelance(demande, reglages, statut);
  return !!p && p.getTime() <= now.getTime();
}

/** Échéance d'un lien : date limite + 60 jours, ou 180 jours sans date limite. Jamais raccourcie. */
export const DOE_LIEN_MARGE_JOURS = 60;
export const DOE_LIEN_SANS_ECHEANCE_JOURS = 180;

export function expirationLienDoe(deadlineAt: string | null | undefined, now: Date = new Date()): Date {
  const jour = 24 * 3600 * 1000;
  const d = deadlineAt ? new Date(deadlineAt) : null;
  if (!d || Number.isNaN(d.getTime())) return new Date(now.getTime() + DOE_LIEN_SANS_ECHEANCE_JOURS * jour);
  return new Date(Math.max(d.getTime(), now.getTime()) + DOE_LIEN_MARGE_JOURS * jour);
}

// ── Classement et lecture d'un document ──────────────────────────────────────

const sansAccent = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface ClassementPiece {
  piece: DoePieceKey;
  /** 0 à 1 : prudence, jamais une certitude. */
  confiance: number;
  indices: string[];
}

/**
 * Pièce la plus probable d'après le nom du fichier (poids 3) et le début du
 * texte (poids 1, occurrences plafonnées). Rend null sans indice : un
 * document que l'on ne sait pas classer reste « non classé », jamais « autre ».
 */
export function classerPiece(nom: string, texte?: string | null): ClassementPiece | null {
  const nomNorm = ` ${sansAccent(nom.replace(/\.[a-z0-9]{2,4}$/i, ''))} `;
  const texteNorm = texte ? ` ${sansAccent(texte.slice(0, 8000))} ` : '';
  let meilleur: { piece: DoePieceKey; score: number; indices: string[] } | null = null;

  for (const p of DOE_PIECES) {
    let score = 0;
    const indices: string[] = [];
    for (const mot of p.motsCles) {
      const motif = ` ${mot.trim()} `;
      if (nomNorm.includes(motif)) {
        score += 3;
        indices.push(`nom : « ${mot.trim()} »`);
      }
      if (texteNorm) {
        const occurrences = texteNorm.split(motif).length - 1;
        if (occurrences > 0) {
          score += Math.min(occurrences, 3);
          indices.push(`texte : « ${mot.trim()} »`);
        }
      }
    }
    if (score > 0 && (!meilleur || score > meilleur.score)) meilleur = { piece: p.key, score, indices };
  }
  if (!meilleur) return null;
  return { piece: meilleur.piece, confiance: Math.min(1, meilleur.score / 6), indices: meilleur.indices.slice(0, 4) };
}

export type AnomalieDoe =
  | 'texte_absent'
  | 'texte_court'
  | 'piece_non_reconnue'
  | 'piece_differente'
  | 'format_plan'
  | 'doublon';

export const DOE_ANOMALIE_LABELS: Record<AnomalieDoe, string> = {
  texte_absent: 'Aucun texte lisible : document scanné ou image, à ouvrir pour le contrôler.',
  texte_court: 'Très peu de texte : document peut-être incomplet.',
  piece_non_reconnue: "La nature du document n'a pas pu être reconnue : à classer.",
  piece_differente: "Le document semble relever d'une autre pièce que celle déclarée.",
  format_plan: 'Plan fourni dans un format modifiable ou propriétaire : demandez aussi un PDF.',
  doublon: 'Un autre document porte le même nom.',
};

export interface AnalyseDocument {
  classement: ClassementPiece | null;
  anomalies: AnomalieDoe[];
  /** Nombre de caractères de texte lus, null si le texte n'a pas été lu. */
  caracteres: number | null;
}

export function analyserDocument(
  doc: Pick<DoeDocument, 'id' | 'name' | 'doe_piece'>,
  texte: string | null | undefined,
  autres: Array<Pick<DoeDocument, 'id' | 'name'>> = [],
): AnalyseDocument {
  const classement = classerPiece(doc.name, texte);
  const anomalies: AnomalieDoe[] = [];
  const ext = (doc.name.split('.').pop() || '').toLowerCase();

  if (ext === 'dwg' || ext === 'dxf') anomalies.push('format_plan');
  const lisible = ['pdf', 'docx', 'xlsx', 'odt', 'ods'].includes(ext);
  let caracteres: number | null = null;
  if (lisible && texte !== undefined) {
    caracteres = (texte || '').trim().length;
    if (caracteres === 0) anomalies.push('texte_absent');
    else if (caracteres < 200 && doc.doe_piece !== 'plans_execution') anomalies.push('texte_court');
  }
  if (!classement && !pieceConnue(doc.doe_piece)) anomalies.push('piece_non_reconnue');
  if (classement && pieceConnue(doc.doe_piece) && doc.doe_piece !== 'autre'
    && classement.piece !== doc.doe_piece && classement.confiance >= 0.5) {
    anomalies.push('piece_differente');
  }
  const nomNorm = sansAccent(doc.name);
  if (autres.some(a => a.id !== doc.id && sansAccent(a.name) === nomNorm)) anomalies.push('doublon');
  return { classement, anomalies, caracteres };
}

// ── Suivi de l'ensemble de l'opération ───────────────────────────────────────

export interface SyntheseDoe {
  entreprises: number;
  aSolliciter: number;
  enAttente: number;
  aAnalyser: number;
  aCorriger: number;
  visees: number;
  /** Part des entreprises visées, 0 à 1. */
  avancement: number;
}

export function syntheseOperation(statuts: DoeStatut[]): SyntheseDoe {
  const n = (...s: DoeStatut[]) => statuts.filter(x => s.includes(x)).length;
  return {
    entreprises: statuts.length,
    aSolliciter: n('a_solliciter'),
    enAttente: n('sollicitee', 'partiel'),
    aAnalyser: n('a_analyser', 'conforme'),
    aCorriger: n('a_corriger'),
    visees: n('vise'),
    avancement: statuts.length ? n('vise') / statuts.length : 0,
  };
}

/** Le dossier peut être transmis au maître d'ouvrage : toutes les entreprises sont visées. */
export function archivePrete(statuts: DoeStatut[]): boolean {
  return statuts.length > 0 && statuts.every(s => s === 'vise');
}

// ── Messages ─────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateLongue = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
};

export interface ParametresMessageDoe {
  cabinet: string;
  operation: string;
  entreprise: string;
  lien: string;
  /** Lots confiés à l'entreprise, déjà mis en forme (« Lot 02 Charpente »). */
  lots: string[];
  piecesAttendues: DoePieceKey[];
  /** Pièces encore manquantes (relance) ; absent = toutes. */
  piecesManquantes?: DoePieceKey[];
  deadlineAt?: string | null;
  instructions?: string | null;
  /** Observations du maître d'œuvre sur des documents refusés ou commentés. */
  observations?: string[];
  numeroRelance?: number;
}

function liste(items: string[]): string {
  return items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
}

function corpsMessage(p: ParametresMessageDoe, relance: boolean): string {
  const pieces = (relance && p.piecesManquantes?.length ? p.piecesManquantes : p.piecesAttendues)
    .map(k => DOE_PIECE_LABELS[k]);
  const limite = p.deadlineAt ? dateLongue(p.deadlineAt) : '';
  const enRetard = !!p.deadlineAt && new Date(p.deadlineAt).getTime() < Date.now();
  const intro = relance
    ? `<p>Sauf erreur de notre part, le dossier des ouvrages exécutés (DOE) de <strong>${esc(p.entreprise)}</strong> pour l'opération <strong>${esc(p.operation)}</strong> n'est pas encore complet.${
        enRetard ? ` La date de remise prévue (${esc(limite)}) est dépassée.` : limite ? ` Rappel : il est attendu pour le ${esc(limite)}.` : ''}</p>`
    : `<p>Les travaux de l'opération <strong>${esc(p.operation)}</strong> touchent à leur fin. Nous vous demandons de nous remettre le dossier des ouvrages exécutés (DOE) de <strong>${esc(p.entreprise)}</strong>${
        limite ? `, <strong>au plus tard le ${esc(limite)}</strong>` : ''}.</p>`;
  const lots = p.lots.length ? `<p>Lot${p.lots.length > 1 ? 's' : ''} concerné${p.lots.length > 1 ? 's' : ''} : ${esc(p.lots.join(' ; '))}.</p>` : '';
  const observations = p.observations?.length
    ? `<p><strong>Observations sur vos précédents envois :</strong></p>${liste(p.observations)}`
    : '';
  const consignes = p.instructions ? `<p style="white-space:pre-line">${esc(p.instructions)}</p>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Bonjour,</p>
${intro}
${lots}
<p>${relance && p.piecesManquantes?.length ? 'Pièces encore attendues' : 'Pièces attendues'} :</p>
${liste(pieces)}
${observations}
${consignes}
<p><a href="${esc(p.lien)}" style="display:inline-block;padding:10px 18px;background:#222;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Déposer mes documents</a></p>
<p style="color:#555;font-size:12px">Ce lien est personnel : ne le transmettez pas. Aucun compte n'est nécessaire. Formats acceptés : PDF, Word, Excel, ODS et ODT (plans en PDF).</p>
<p>Cordialement,<br>${esc(p.cabinet)}</p>
</div>`;
}

export function construireSollicitation(p: ParametresMessageDoe): { subject: string; html: string } {
  return { subject: `DOE à remettre : ${p.operation}`, html: corpsMessage(p, false) };
}

export function construireRelance(p: ParametresMessageDoe): { subject: string; html: string } {
  const n = p.numeroRelance && p.numeroRelance > 1 ? ` (relance ${p.numeroRelance})` : ' (relance)';
  return { subject: `DOE à remettre : ${p.operation}${n}`, html: corpsMessage(p, true) };
}

export interface ParametresMessageVisa {
  cabinet: string;
  operation: string;
  entreprise: string;
  avis: DoeAvisVisa;
  observations?: string | null;
  lien: string;
  numero: string;
}

export function construireMessageVisa(p: ParametresMessageVisa): { subject: string; html: string } {
  const defavorable = p.avis === 'defavorable';
  const phrase = defavorable
    ? "Votre dossier ne peut pas être visé en l'état : merci de le compléter ou de le corriger à l'aide des observations ci-dessous, puis de le redéposer."
    : p.avis === 'avec_observations'
      ? 'Votre dossier est visé avec observations, que nous vous remercions de prendre en compte.'
      : 'Votre dossier est visé favorablement. Nous vous remercions de votre diligence.';
  return {
    subject: `Visa du DOE n° ${p.numero} (${DOE_AVIS_VISA_LABELS[p.avis]}) : ${p.operation}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Bonjour,</p>
<p>Le visa n° <strong>${esc(p.numero)}</strong> du dossier des ouvrages exécutés de <strong>${esc(p.entreprise)}</strong> pour l'opération <strong>${esc(p.operation)}</strong> est joint à ce message.</p>
<p><strong>Avis : ${esc(DOE_AVIS_VISA_LABELS[p.avis])}.</strong> ${esc(phrase)}</p>
${p.observations ? `<p style="white-space:pre-line">${esc(p.observations)}</p>` : ''}
${defavorable ? `<p><a href="${esc(p.lien)}" style="display:inline-block;padding:10px 18px;background:#222;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Déposer des documents</a></p>` : ''}
<p>Cordialement,<br>${esc(p.cabinet)}</p>
</div>`,
  };
}

export function numeroVisa(rang: number, annee: number): string {
  return `DOE-${annee}-${String(Math.max(1, Math.round(rang))).padStart(3, '0')}`;
}

// ── Archive transmise au maître d'ouvrage ────────────────────────────────────

export const ARCHIVE_DOSSIER_PLANS = "01 - Plans de la maitrise d'oeuvre";
export const ARCHIVE_DOSSIER_DOE = '02 - DOE des entreprises';
export const ARCHIVE_DOSSIER_VISAS = '03 - Visas';

/** Nom de fichier ou de dossier sûr dans une archive ZIP (aucun séparateur ni caractère réservé). */
export function nomSur(valeur: string, repli = 'document'): string {
  const net = valeur
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return net || repli;
}

export interface EntreeArchive {
  nom: string;
  dossier: string[];
}

/** Chemin d'un document dans l'archive, sans collision : un nom déjà pris reçoit un suffixe. */
export function cheminsArchive(entrees: EntreeArchive[]): string[] {
  const pris = new Set<string>();
  return entrees.map(e => {
    const dossier = e.dossier.map(s => nomSur(s, 'dossier')).join('/');
    const nom = nomSur(e.nom);
    const point = nom.lastIndexOf('.');
    const base = point > 0 ? nom.slice(0, point) : nom;
    const ext = point > 0 ? nom.slice(point) : '';
    let chemin = `${dossier}/${nom}`;
    let n = 2;
    while (pris.has(chemin.toLowerCase())) {
      chemin = `${dossier}/${base} (${n})${ext}`;
      n += 1;
    }
    pris.add(chemin.toLowerCase());
    return chemin;
  });
}

// ── Fichiers acceptés sur le portail ─────────────────────────────────────────
// Les formats bureautiques du dépôt des offres, plus les photos JPEG et PNG
// (un DOE en contient : ouvrages enterrés, étiquettes d'équipements). Les plans
// DWG et DXF restent refusés : un plan se remet en PDF.

export const DOE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'ods', 'odt', 'jpg', 'jpeg', 'png'] as const;
export type DoeExtension = (typeof DOE_EXTENSIONS)[number];

/** Valeur de l'attribut `accept` d'un champ de fichier. */
export const DOE_ACCEPT = DOE_EXTENSIONS.map(e => `.${e}`).join(',');

export const DOE_FORMATS_LIBELLE = 'PDF, Word (.docx), Excel (.xlsx), ODS, ODT, JPEG et PNG';

export function formatDoeAutorise(nom: string): boolean {
  return (DOE_EXTENSIONS as readonly string[]).includes(extensionDe(nom));
}

export type ControleDoe = { ok: true } | { ok: false; raison: string };

/** Contrôle sur ce que le navigateur sait avant l'envoi (nom et taille). Le serveur refait tout, octets compris. */
export function controlerFichiersDoe(fichiers: Array<{ name: string; size: number }>): ControleDoe {
  if (fichiers.length === 0) return { ok: false, raison: 'Aucun fichier sélectionné.' };
  if (fichiers.length > MAX_FICHIERS_PAR_DEPOT) {
    return { ok: false, raison: `${MAX_FICHIERS_PAR_DEPOT} fichiers au plus par dépôt.` };
  }
  for (const f of fichiers) {
    if (!formatDoeAutorise(f.name)) {
      return { ok: false, raison: `« ${f.name} » : format non accepté. Formats admis : ${DOE_FORMATS_LIBELLE}.` };
    }
    if (f.size <= 0) return { ok: false, raison: `« ${f.name} » est vide.` };
    if (f.size > MAX_FICHIER_OCTETS) {
      return { ok: false, raison: `« ${f.name} » dépasse ${formatOctets(MAX_FICHIER_OCTETS)} (${formatOctets(f.size)}).` };
    }
  }
  const total = fichiers.reduce((s, f) => s + f.size, 0);
  if (total > MAX_DEPOT_OCTETS) {
    return { ok: false, raison: `Ce dépôt dépasse ${formatOctets(MAX_DEPOT_OCTETS)} au total (${formatOctets(total)}).` };
  }
  return { ok: true };
}

// ── Accusé de dépôt ──────────────────────────────────────────────────────────

export interface ElementAccuseDoe {
  nom: string;
  pieceLabel?: string;
  tailleOctets?: number;
  sha256?: string;
}

export interface ParametresAccuseDoe {
  cabinet: string;
  operation: string;
  entreprise: string;
  recuLe: Date;
  elements: ElementAccuseDoe[];
}

/** Objet et corps HTML de l'accusé de réception d'un dépôt de DOE. */
export function construireAccuseDepotDoe(p: ParametresAccuseDoe): { subject: string; html: string } {
  const lignes = p.elements.map(e => {
    const detail = [e.pieceLabel, e.tailleOctets ? formatOctets(e.tailleOctets) : ''].filter(Boolean).join(' · ');
    const empreinte = e.sha256 ? `<br><span style="color:#666;font-size:12px">Empreinte SHA-256 : ${esc(e.sha256)}</span>` : '';
    return `<li><strong>${esc(e.nom)}</strong>${detail ? ` <span style="color:#444">(${esc(detail)})</span>` : ''}${empreinte}</li>`;
  }).join('');
  const quand = p.recuLe.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
  return {
    subject: `Accusé de réception de votre DOE : ${p.operation}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Bonjour,</p>
<p>${esc(p.cabinet)} accuse réception des documents déposés par <strong>${esc(p.entreprise)}</strong> pour le dossier des ouvrages exécutés de l'opération <strong>${esc(p.operation)}</strong>, le ${esc(quand)}.</p>
<ul>${lignes}</ul>
<p style="color:#555;font-size:12px">Ces documents vont maintenant être analysés par le maître d'œuvre. Vous serez prévenu si des pièces manquent ou doivent être corrigées. Vous pouvez compléter votre dépôt avec le même lien.</p>
</div>`,
  };
}
