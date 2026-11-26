// ── Additifs au DCE : une modification du dossier de consultation, tracée et notifiée ──
// Une révision (consultation.dce_revisions, jsonb) dit QUELLES pièces ont changé, sous quel indice et
// pourquoi. Elle ne contient aucun fichier : les fichiers restent ceux de l'affaire (leur indice et
// leur version viennent de la fiche du document, voir dceIndices.ts). Seules les entreprises qui ont
// déjà reçu le DCE et que ces pièces concernent sont à prévenir.
import type { EntrepriseSuivi } from './actEntreprises';

export interface PieceRevisee {
  /** Identifiant de la pièce dans consultation.dce_documents. */
  id: string;
  libelle: string;
  /** Indice de révision au moment de la publication (lu sur la fiche du document, modifiable). */
  indice?: string;
}

export interface DceRevision {
  id: string;
  /** Date de publication, AAAA-MM-JJ. */
  cree_le: string;
  motif: string;
  pieces: PieceRevisee[];
  /** Entreprises déjà prévenues par mail et date du dernier envoi. */
  notifiee_a?: string[];
  notifiee_le?: string;
}

/** Une pièce du DCE, avec les lots qu'elle concerne. */
export interface PieceDceCiblee { id: string; tous_lots: boolean; lots_ids: string[] }

export type ControleRevision =
  | { ok: true; motif: string; pieces: PieceRevisee[] }
  | { ok: false; raison: string };

export const MAX_MOTIF_REVISION = 1000;

/** Contrôle une publication : un motif, au moins une pièce, jamais deux fois la même. */
export function controlerRevision(motif: string, pieces: PieceRevisee[]): ControleRevision {
  const m = motif.replace(/\r\n/g, '\n').trim();
  if (!m) return { ok: false, raison: 'Indiquez le motif de la modification.' };
  if (m.length > MAX_MOTIF_REVISION) return { ok: false, raison: `Le motif ne peut pas dépasser ${MAX_MOTIF_REVISION} caractères.` };
  const vues = new Set<string>();
  const uniques = pieces.filter(p => !vues.has(p.id) && !!vues.add(p.id))
    .map(p => ({ id: p.id, libelle: p.libelle.trim() || 'Pièce du DCE', ...(p.indice?.trim() ? { indice: p.indice.trim() } : {}) }));
  if (uniques.length === 0) return { ok: false, raison: 'Cochez au moins une pièce modifiée.' };
  return { ok: true, motif: m, pieces: uniques };
}

/** Numéro d'un additif dans la liste (1 pour le premier publié). */
export function numeroRevision(revisions: DceRevision[], id: string): number {
  const i = revisions.findIndex(r => r.id === id);
  return i < 0 ? revisions.length + 1 : i + 1;
}

/**
 * Entreprises à prévenir d'un additif : celles qui ont déjà reçu le DCE (les autres le recevront
 * à jour), qui répondent, et dont un lot (ou toute la consultation) est touché par les pièces.
 */
export function entreprisesConcernees<E extends EntrepriseSuivi>(
  revision: Pick<DceRevision, 'pieces'>, piecesDce: PieceDceCiblee[], entreprises: E[],
): E[] {
  const touchees = piecesDce.filter(p => revision.pieces.some(r => r.id === p.id));
  return entreprises.filter(e => !!e.dce_transmis_le && !e.ne_repond_pas
    && touchees.some(p => p.tous_lots || p.lots_ids.some(id => e.lots_ids.includes(id))));
}

/** Marque l'entreprise comme prévenue, sans doublon ; garde la date du dernier envoi. */
export function marquerRevisionNotifiee(r: DceRevision, entrepriseId: string, aujourdhui: string): DceRevision {
  const deja = r.notifiee_a ?? [];
  return { ...r, notifiee_a: deja.includes(entrepriseId) ? deja : [...deja, entrepriseId], notifiee_le: aujourdhui };
}

/** Additif tel que le message le dit à l'entreprise (date mise en forme par l'appelant). */
export interface BlocAdditif {
  numero: number;
  date: string;
  motif: string;
  pieces: string[];
  /** Lien « j'ai bien reçu », propre à l'entreprise. */
  lienAccuse?: string;
}

export function blocAdditif(revision: DceRevision, numero: number, dateFr: string, lienAccuse?: string): BlocAdditif {
  return {
    numero, date: dateFr, motif: revision.motif, lienAccuse,
    pieces: revision.pieces.map(p => `${p.libelle}${p.indice ? ` (indice ${p.indice})` : ''}`),
  };
}

/** Les additifs qui concernent une entreprise (pour sa page de dépôt), du plus récent au plus ancien. */
export function additifsDeLentreprise(
  revisions: DceRevision[], piecesDce: PieceDceCiblee[], lotsEntreprise: string[],
): Array<{ revision: DceRevision; numero: number }> {
  return revisions
    .map((revision, i) => ({ revision, numero: i + 1 }))
    .filter(({ revision }) => piecesDce.some(p => revision.pieces.some(r => r.id === p.id) && (p.tous_lots || p.lots_ids.some(id => lotsEntreprise.includes(id)))))
    .reverse();
}
