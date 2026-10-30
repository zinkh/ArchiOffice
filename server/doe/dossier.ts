// Lecture de l'état de l'atelier DOE d'une opération : les entreprises (déduites
// des lots), leurs demandes, leurs documents, leurs visas et le statut qui en
// découle. Une seule lecture, partagée par l'écran, la relance automatique, le
// visa et l'archive : le statut n'est JAMAIS stocké, il se recalcule ici.
import {
  DOE_PIECES, archivePrete, avisSuggere, couvertureDossier, piecesRequises, prochaineRelance,
  statutEntreprise, syntheseOperation,
  type Couverture, type DoeAvisVisa, type DoePieceKey, type DoeStatut, type SyntheseDoe,
} from '../../src/lib/doeAtelier';
import { contactLabel } from '../../src/lib/crDiffusion';

/** Une instance dont la base n'a pas joué migrate_doe_atelier.sql lit un atelier vide. */
export function tableAbsente(error: any): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205'
    || /does not exist|schema cache|could not find the table/i.test(String(error.message || ''));
}

export interface ReglagesDoe {
  deadline_at: string | null;
  instructions: string | null;
  required_pieces: DoePieceKey[] | null;
  reminder_enabled: boolean;
  reminder_interval_days: number;
  reminder_max: number;
}

export const REGLAGES_DOE_PAR_DEFAUT: ReglagesDoe = {
  deadline_at: null,
  instructions: null,
  required_pieces: null,
  reminder_enabled: true,
  reminder_interval_days: 7,
  reminder_max: 4,
};

export interface LotDoe {
  id: string;
  lot_number: string;
  lot_title: string;
}

export const libelleLot = (l: LotDoe): string => `Lot ${l.lot_number} ${l.lot_title}`.replace(/\s+/g, ' ').trim();

export interface EntrepriseDossier {
  /** contact_id du lot, à défaut le nom : la convention de documents.contact_id. */
  key: string;
  nom: string;
  contact_id: string | null;
  email: string | null;
  lots: LotDoe[];
  /** Demande active (lien en cours), jamais le haché du jeton. */
  request: any | null;
  documents: any[];
  visas: any[];
  visa: any | null;
  statut: DoeStatut;
  couverture: Couverture;
  avis_suggere: DoeAvisVisa;
  prochaine_relance: string | null;
}

export interface DossierDoe {
  disponible: boolean;
  reglages: ReglagesDoe;
  requises: DoePieceKey[];
  entreprises: EntrepriseDossier[];
  /** Documents DOE sans entreprise identifiée. */
  non_affectes: any[];
  synthese: SyntheseDoe;
  archive_prete: boolean;
}

const parDate = (champ: string) => (a: any, b: any) =>
  new Date(a[champ] || 0).getTime() - new Date(b[champ] || 0).getTime();

export async function chargerDossier(supabaseAdmin: any, tenantId: string, projectId: string): Promise<DossierDoe> {
  const lire = (table: string) => supabaseAdmin.from(table).select('*').eq('tenant_id', tenantId).eq('project_id', projectId);
  const [lotsR, docsR, reglagesR, requetesR, visasR] = await Promise.all([
    lire('project_lots'),
    lire('documents').eq('doc_type', 'DOE'),
    lire('doe_settings').maybeSingle(),
    lire('doe_requests').is('revoked_at', null),
    lire('doe_visas'),
  ]);
  if (lotsR.error) throw lotsR.error;
  if (docsR.error) throw docsR.error;
  const absente = [reglagesR, requetesR, visasR].some(r => tableAbsente(r.error));
  for (const r of [reglagesR, requetesR, visasR]) if (r.error && !tableAbsente(r.error)) throw r.error;

  const reglages: ReglagesDoe = { ...REGLAGES_DOE_PAR_DEFAUT, ...((reglagesR.data as any) || {}) };
  const requises = piecesRequises(reglages.required_pieces);
  const requetes: any[] = absente ? [] : (requetesR.data as any[]) || [];
  const visas: any[] = absente ? [] : ((visasR.data as any[]) || []).sort(parDate('issued_at')).reverse();
  const documents: any[] = ((docsR.data as any[]) || []).sort(parDate('uploaded_at'));

  // Les entreprises sont celles des lots : une par contact (ou nom) distinct.
  const parCle = new Map<string, EntrepriseDossier>();
  const creer = (key: string, nom: string, contactId: string | null): EntrepriseDossier => {
    let e = parCle.get(key);
    if (!e) {
      e = {
        key, nom, contact_id: contactId, email: null, lots: [], request: null, documents: [], visas: [], visa: null,
        statut: 'a_solliciter', couverture: couvertureDossier([], requises), avis_suggere: 'defavorable', prochaine_relance: null,
      };
      parCle.set(key, e);
    }
    return e;
  };
  for (const lot of (lotsR.data as any[]) || []) {
    const key = String(lot.contact_id || lot.contact_name || '').trim();
    if (!key) continue;
    const e = creer(key, lot.contact_name || key, lot.contact_id || null);
    e.lots.push({ id: lot.id, lot_number: String(lot.lot_number ?? ''), lot_title: String(lot.lot_title ?? '') });
  }
  for (const r of requetes) creer(r.entreprise_key, r.entreprise_nom, r.contact_id || null);
  const nonAffectes: any[] = [];
  for (const d of documents) {
    const key = String(d.contact_id || d.contact_name || '').trim();
    if (!key) { nonAffectes.push(d); continue; }
    creer(key, d.contact_name || key, null).documents.push(d);
  }
  for (const v of visas) creer(v.entreprise_key, v.entreprise_nom, null);

  // Adresses des fiches contact.
  const idsContacts = [...new Set([...parCle.values()].map(e => e.contact_id).filter((x): x is string => !!x))];
  const emailsContacts = new Map<string, string>();
  const nomsContacts = new Map<string, string>();
  if (idsContacts.length) {
    const { data } = await supabaseAdmin.from('contacts').select('id, email, name, company_name, first_name, last_name').eq('tenant_id', tenantId).in('id', idsContacts);
    for (const c of (data as any[]) || []) {
      if (c.email) emailsContacts.set(c.id, c.email);
      const libelle = contactLabel(c);
      if (libelle) nomsContacts.set(c.id, libelle);
    }
  }
  // Un lot rattaché à une fiche mais sans nom saisi retombait sur l'identifiant : on affiche le nom de la fiche.
  for (const e of parCle.values()) {
    const fiche = e.contact_id ? nomsContacts.get(e.contact_id) : null;
    if (fiche && (!e.nom || e.nom === e.key || e.nom === e.contact_id)) e.nom = fiche;
  }

  for (const e of parCle.values()) {
    e.lots.sort((a, b) => a.lot_number.localeCompare(b.lot_number, 'fr', { numeric: true }));
    e.request = requetes.find(r => r.entreprise_key === e.key) || null;
    e.visas = visas.filter(v => v.entreprise_key === e.key);
    e.visa = e.visas[0] || null;
    e.email = e.request?.email || (e.contact_id ? emailsContacts.get(e.contact_id) : null) || null;
    e.statut = statutEntreprise({
      sollicitee: !!e.request?.sent_at,
      documents: e.documents,
      requises,
      visa: e.visa ? { avis: e.visa.avis, issued_at: e.visa.issued_at } : null,
    });
    e.couverture = couvertureDossier(e.documents, requises);
    e.avis_suggere = avisSuggere(e.documents, requises);
    e.prochaine_relance = prochaineRelance(e.request ? { ...e.request, email: e.request.email || e.email } : null, reglages, e.statut)?.toISOString() ?? null;
  }

  const entreprises = [...parCle.values()].sort((a, b) =>
    (a.lots[0]?.lot_number ?? '￿').localeCompare(b.lots[0]?.lot_number ?? '￿', 'fr', { numeric: true })
    || a.nom.localeCompare(b.nom, 'fr'));
  const statuts = entreprises.map(e => e.statut);
  return {
    disponible: !absente,
    reglages,
    requises,
    entreprises,
    non_affectes: nonAffectes,
    synthese: syntheseOperation(statuts),
    archive_prete: archivePrete(statuts),
  };
}

/** Pièces à citer dans un message ou un visa : les pièces exigées puis toute autre pièce reçue, dans l'ordre du catalogue. */
export function piecesConcernees(e: Pick<EntrepriseDossier, 'documents'>, requises: DoePieceKey[]): DoePieceKey[] {
  const recues = new Set(e.documents.map(d => d.doe_piece).filter(Boolean));
  return DOE_PIECES.map(p => p.key).filter(k => requises.includes(k) || recues.has(k));
}

/** Vue d'une demande sans le haché du jeton : seule cette forme sort de l'API. */
export function demandePublique(r: any | null) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, expires_at: r.expires_at, last_opened_at: r.last_opened_at,
    sent_at: r.sent_at, last_reminder_at: r.last_reminder_at, reminder_count: r.reminder_count ?? 0,
  };
}
