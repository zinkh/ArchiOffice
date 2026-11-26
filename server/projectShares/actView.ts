// Atelier ACT d'un confrère invité : la vue est construite CHAMP PAR CHAMP à partir de listes blanches,
// jamais en copiant `act_data` ni en retirant des champs d'une copie. Une colonne ou une clé ajoutée demain
// n'apparaît que si elle est ajoutée ici (même principe que documentView.ts pour le CCTP et le DPGF).
//
// Ce que voit le confrère : le suivi de la consultation (entreprises consultées et leur avancement), les
// critères, les offres et leurs montants, les attributions, les marchés constitués. Jamais : fiches contact des
// entreprises, fichiers du DCE et des offres, négociations détaillées, signatures, ni les colonnes financières des
// marchés (retenue, avance, révision). Les adresses e-mail des entreprises consultées ne sortent qu'avec le détail de
// l'atelier (`options.detail`, issue #688), avec une fiche RÉDUITE du contact rattaché (`contactCard.ts` : nom, identifiants,
// coordonnées de travail ; jamais ses notes ni le reste de la fiche).
import type { GuestContactCard } from './contactCard';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : []);

/** Une consultation peut arriver sous forme de chaîne JSON : on la lit sans jamais lever. */
function readConsultation(raw: unknown): Rec {
  if (isRec(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return isRec(parsed) ? parsed : {}; } catch { return {}; }
  }
  return {};
}

export const MARCHE_FIELDS = ['id', 'entreprise_nom', 'lot_numero', 'lot_titre', 'montant_ht', 'statut', 'statut_signature', 'date_os', 'duree_mois', 'date_signature'] as const;

export interface GuestActView {
  phase: string | null;
  lots: Array<{ id: string; name: string | null }>;
  criteres: Array<{ id: string; nom: string | null; poids: number | null }>;
  documents: Array<{ id: string; nom: string | null; type_doc: string | null; tous_lots: boolean; lots_ids: string[] }>;
  /** `email` et `emails_supplementaires` seulement quand le cabinet a coché le détail de l'ACT (issue #688), sinon absents. */
  entreprises: Array<{ id: string; nom: string | null; lots_ids: string[]; dce_transmis_le: string | null; relance_le: string | null; offre_recue_le: string | null; ne_repond_pas: boolean; email?: string | null; emails_supplementaires?: string | null; fiche?: GuestContactCard | null }>;
  offres: Array<{ id: string; lot_id: string | null; entreprise_id: string | null; montant_base: number | null; note_technique: number | null; conforme: boolean; motif_nc: string | null }>;
  attributions: Array<{ lot_id: string | null; entreprise_id: string | null; montant: number | null; directe: boolean }>;
  questions: Array<{ id: string; question: string | null; date_question: string | null; reponse: string | null; date_reponse: string | null }>;
  marches: Array<Record<string, unknown>>;
}

/** La vue ACT d'un confrère. `row` est la ligne `act_data` de l'affaire (ou null), `marches` ses lignes `marches_entreprises`. */
export function guestActView(row: unknown, marches: readonly unknown[], options: { detail?: boolean; contacts?: ReadonlyMap<string, GuestContactCard> } = {}): GuestActView {
  const act = isRec(row) ? row : {};
  const consultation = readConsultation(act.consultation);
  return {
    phase: text(act.act_phase, 40),
    lots: list(act.lots).map(l => ({ id: String(l.id ?? ''), name: text(l.name, 200) })).filter(l => l.id),
    criteres: list(consultation.criteres).map(c => ({ id: String(c.id ?? ''), nom: text(c.nom, 200), poids: num(c.poids) })).filter(c => c.id),
    documents: list(consultation.dce_documents).map(d => ({
      id: String(d.id ?? ''), nom: text(d.nom, 300), type_doc: text(d.type_doc, 40), tous_lots: bool(d.tous_lots), lots_ids: ids(d.lots_ids),
    })).filter(d => d.id),
    // Jamais la fiche complète du contact : seulement `fiche`, sa version réduite, et seulement avec le détail de l'ACT (issue
    // #688). La consultation de ces coordonnées est tracée par la route (RGPD).
    entreprises: list(consultation.entreprises).map(e => ({
      id: String(e.id ?? ''), nom: text(e.nom, 200), lots_ids: ids(e.lots_ids),
      dce_transmis_le: text(e.dce_transmis_le, 30), relance_le: text(e.relance_le, 30), offre_recue_le: text(e.offre_recue_le, 30),
      ne_repond_pas: bool(e.ne_repond_pas),
      ...(options.detail ? {
        email: text(e.email, 200), emails_supplementaires: text(e.emails_supplementaires, 500),
        // Fiche réduite (nom, identifiants, coordonnées de travail) du contact rattaché : jamais la fiche complète.
        fiche: (typeof e.contact_id === 'string' ? options.contacts?.get(e.contact_id) : undefined) ?? null,
      } : {}),
    })).filter(e => e.id),
    offres: list(consultation.offres).map(o => ({
      id: String(o.id ?? ''), lot_id: text(o.lot_id, 100), entreprise_id: text(o.entreprise_id, 100),
      montant_base: num(o.montant_base), note_technique: num(o.note_technique), conforme: o.conforme !== false, motif_nc: text(o.motif_nc, 500),
    })).filter(o => o.id),
    attributions: list(consultation.attributions).map(a => ({
      lot_id: text(a.lot_id, 100), entreprise_id: text(a.entreprise_id, 100), montant: num(a.montant), directe: bool(a.directe),
    })),
    // Les questions publiques seulement, sans l'entreprise qui les a posées : ce sont celles que toutes voient déjà.
    questions: list(consultation.questions).filter(q => q.publique === true).map(q => ({
      id: String(q.id ?? ''), question: text(q.question, 2000), date_question: text(q.date_question, 30),
      reponse: text(q.reponse, 2000), date_reponse: text(q.date_reponse, 30),
    })).filter(q => q.id),
    marches: marches.filter(isRec).map(m => Object.fromEntries(MARCHE_FIELDS.map(k => [k, m[k] ?? null]))),
  };
}
