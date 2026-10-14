// ── Marchés de travaux constitués depuis l'ACT ───────────────────────────────
// Logique pure (testée) de la phase « Marchés » : de l'attribution d'un lot aux
// quatre pièces du marché. Pas d'accès réseau ici.
//
//   - CCAP : un seul pour toute l'opération, jamais par entreprise ;
//   - CCTP : l'extrait du lot, sans quantité ni prix ;
//   - DPGF : celui du lot, aux prix de l'offre retenue, FIGÉS à la constitution
//     (`offre_snapshot`) : un DPGF modifié ensuite ne change pas le marché ;
//   - acte d'engagement : le formulaire PDF prérempli (entreprise, lot, prix).
import type { Contact, ProjectLot } from '../types';
import type { DPGF, Ligne, Lot, OffreDocument, PosteAjoute } from '../types/dpgf';
import { sumLigne, recomputeLot } from '../components/pro/treeOps';
import { totauxDocument } from '../components/pro/selectionOps';
import { filtrerPourExport } from './exportPerimetre';
import { montantPoste } from './postesAjoutes';
import { nomChamp, CHAMPS_ENTREPRISE, type CleEntreprise } from './actEngagementForm';

export type StatutSignature = 'a_constituer' | 'a_signer' | 'signe';
export type ModeSignature = 'papier' | 'electronique';

export const LIBELLE_STATUT: Record<StatutSignature, string> = {
  a_constituer: 'À constituer',
  a_signer: 'À signer',
  signe: 'Signé',
};

export interface AttributionLue { lot_id: string; entreprise_id: string; montant: number }
export interface EntrepriseConsultee { id: string; nom: string; contact_id?: string }

/** Offre retenue, figée dans le marché au moment de sa constitution. */
export interface SnapshotOffre {
  source: 'dpgf' | 'consultation';
  offre_id?: string;
  entreprise_nom: string;
  fige_le: string;
  /** articleId -> P.U. HT remis, limité aux articles du lot ; `null` : non chiffré. */
  prix: Record<string, number | null>;
  postes_ajoutes: PosteAjoute[];
  total_ht: number;
}

export interface MarcheActLu {
  id: string;
  act_lot_id?: string | null;
  act_entreprise_id?: string | null;
  contact_id?: string | null;
  entreprise_nom: string;
  lot_numero?: string;
  lot_titre?: string;
  montant_ht: number;
  tva_rate: number;
  offre_snapshot?: SnapshotOffre | null;
  statut_signature?: StatutSignature;
  mode_signature?: ModeSignature | null;
  date_signature?: string | null;
  acte_signe_document_id?: string | null;
}

export interface LigneMarche {
  lot: ProjectLot;
  entreprise: EntrepriseConsultee;
  /** Montant attribué dans l'ACT, au prix courant de la négociation. */
  montant: number;
  marche?: MarcheActLu;
  statut: StatutSignature;
  /** Écart entre l'attribution actuelle et le marché enregistré (null : aucun). */
  ecart: number | null;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Une ligne par lot attribué, avec le marché déjà constitué le cas échéant. */
export function lignesMarches(
  attributions: AttributionLue[],
  entreprises: EntrepriseConsultee[],
  lots: ProjectLot[],
  marches: MarcheActLu[],
): LigneMarche[] {
  const parLot = new Map(marches.filter(m => m.act_lot_id).map(m => [m.act_lot_id as string, m]));
  const resultat: LigneMarche[] = [];
  for (const a of attributions) {
    const lot = lots.find(l => l.id === a.lot_id);
    const entreprise = entreprises.find(e => e.id === a.entreprise_id);
    if (!lot || !entreprise) continue;
    const marche = parLot.get(lot.id);
    const ecart = marche && Math.abs(marche.montant_ht - a.montant) > 0.005 ? arrondi(a.montant - marche.montant_ht) : null;
    resultat.push({
      lot, entreprise, montant: a.montant, marche,
      statut: marche?.statut_signature ?? 'a_constituer',
      ecart,
    });
  }
  return resultat.sort((x, y) => x.lot.lot_number.localeCompare(y.lot.lot_number, 'fr', { numeric: true }));
}

/** Une ligne est à (re)constituer si elle n'a pas de marché, ou si l'attribution a changé et que le marché n'est pas signé. */
export function aConstituer(l: LigneMarche): boolean {
  if (!l.marche) return true;
  if (l.statut === 'signe') return false;
  return l.ecart !== null || l.marche.act_entreprise_id !== l.entreprise.id;
}

// ── Offre figée ──────────────────────────────────────────────────────────────

/** Identifiants des articles (feuilles et parents) d'un lot du document. */
function idsArticles(lot: Lot): Set<string> {
  const ids = new Set<string>();
  const parcourir = (lignes: Ligne[]) => lignes.forEach(l => { ids.add(l.id); if (l.children?.length) parcourir(l.children); });
  lot.chapitres.forEach(c => parcourir(c.lignes));
  return ids;
}

export function trouverLotDocument(doc: DPGF | null | undefined, lot: ProjectLot): Lot | undefined {
  if (!doc) return undefined;
  const numero = lot.lot_number.trim().toUpperCase();
  return doc.lots.find(l => l.projectLotId === lot.id)
    ?? doc.lots.find(l => l.numero.trim().toUpperCase() === numero);
}

/** L'offre retenue d'une entreprise : rattachée par son identifiant de consultation, à défaut par son nom ; une offre écartée ne compte pas. */
export function trouverOffre(offres: OffreDocument[], entreprise: EntrepriseConsultee): OffreDocument | undefined {
  const valides = offres.filter(o => o.statut !== 'ecartee');
  return valides.find(o => o.entrepriseId === entreprise.id)
    ?? valides.find(o => o.entrepriseNom.trim().toLowerCase() === entreprise.nom.trim().toLowerCase());
}

export function snapshotOffre(
  offre: OffreDocument | undefined, lotDoc: Lot | undefined, entreprise: EntrepriseConsultee, montant: number, maintenant = new Date(),
): SnapshotOffre | null {
  if (!offre || !lotDoc) return null;
  const ids = idsArticles(lotDoc);
  const prix: Record<string, number | null> = {};
  for (const [id, p] of Object.entries(offre.prix ?? {})) if (ids.has(id)) prix[id] = p;
  const postes = (offre.postesAjoutes ?? []).filter(p => p.lotId === lotDoc.id);
  return {
    source: 'dpgf', offre_id: offre.id, entreprise_nom: entreprise.nom, fige_le: maintenant.toISOString(),
    prix, postes_ajoutes: postes, total_ht: arrondi(montant),
  };
}

// ── DPGF du marché ───────────────────────────────────────────────────────────

export interface DpgfMarche {
  dpgf: DPGF;
  /** `offre` : prix figés de l'entreprise ; `absent` : pas d'offre figée, prix à zéro. */
  source: 'offre' | 'absent';
  /** Articles du lot sans prix dans l'offre (comptés à zéro). */
  manquants: number;
}

/**
 * DPGF d'un lot aux prix de l'offre figée. Un article absent de l'offre vaut
 * zéro et est compté, jamais complété par l'estimation du cabinet : le marché
 * ne doit pas mêler deux prix. Les postes ajoutés par l'entreprise sont rangés
 * sous un chapitre dédié.
 */
export function dpgfDuMarche(doc: DPGF, lotNumero: string, snapshot: SnapshotOffre | null | undefined): DpgfMarche {
  const filtre = filtrerPourExport(doc, { lotNumeros: [lotNumero], batimentCodes: null, phaseCodes: null });
  let manquants = 0;
  const appliquer = (l: Ligne): Ligne => {
    if (l.children?.length) {
      const children = l.children.map(appliquer);
      return { ...l, children, prixTotal: arrondi(children.reduce((s, c) => s + sumLigne(c), 0)) };
    }
    if (!snapshot) return { ...l, prixUnitaire: 0, prixTotal: 0 };
    const p = snapshot.prix[l.id];
    if (p === undefined) manquants++;
    const pu = typeof p === 'number' ? p : 0;
    return { ...l, prixUnitaire: pu, prixTotal: arrondi((Number(l.quantite) || 0) * pu) };
  };

  let lots: Lot[] = filtre.lots.map(lot => recomputeLot({
    ...lot,
    chapitres: lot.chapitres.map(c => ({ ...c, lignes: c.lignes.map(appliquer) })),
  }));

  const postes = snapshot?.postes_ajoutes ?? [];
  if (postes.length && lots.length) {
    const lot = lots[0];
    const lignes: Ligne[] = postes.map(p => ({
      id: p.id, numero: p.numero, designation: p.designation, unite: p.unite,
      quantite: p.quantite ?? 1, prixUnitaire: p.prixUnitaire ?? 0, prixTotal: arrondi(montantPoste(p)), type: 'ouvrage',
    }));
    lots = [recomputeLot({
      ...lot,
      chapitres: [...lot.chapitres, { id: `postes-ajoutes-${lot.id}`, numero: `${lot.numero}.A`, titre: 'Postes ajoutés par l\'entreprise', lignes }],
    })];
  }

  const t = totauxDocument(lots, filtre.TVA);
  return {
    dpgf: { ...filtre, lots, totalHT: arrondi(t.totalHT), totalTTC: arrondi(t.totalTTC) },
    source: snapshot ? 'offre' : 'absent',
    manquants: snapshot ? manquants : 0,
  };
}

// ── Acte d'engagement prérempli ──────────────────────────────────────────────

const frNombre = (n: number) => String(arrondi(n)).replace('.', ',');

/** Valeurs des champs du formulaire d'acte (voir `nomChamp`). Un champ inconnu reste vide, jamais inventé. */
export function valeursActe(
  contact: Contact | undefined, entreprise: EntrepriseConsultee, lot: { numero: string },
  montantHt: number, tvaPct: number, delaiMois?: number | null,
): Record<string, string | boolean> {
  const v: Record<string, string | boolean> = {};
  const adresse = [contact?.address, [contact?.zip, contact?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const nomContact = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ');
  const valeurs: Record<CleEntreprise, string | undefined> = {
    entreprise: contact?.company_name || entreprise.nom,
    // Pour une fiche de personne sans société, le nom du contact est celui de l'entreprise : pas de signataire à déduire.
    representant: contact?.company_name ? nomContact : undefined,
    qualite: contact?.company_name ? contact?.job_title : undefined,
    siege: adresse,
    siret: contact?.siret,
    ape: undefined,
    rcs: undefined,
    email: contact?.email,
    telephone: contact?.phone,
  };
  for (const c of CHAMPS_ENTREPRISE) {
    const val = valeurs[c.cle]?.trim();
    if (val) v[nomChamp.entreprise(c.cle)] = val;
  }
  v[nomChamp.tva] = frNombre(tvaPct);
  v[nomChamp.lotCandidat(lot.numero)] = true;
  v[nomChamp.lotPrix(lot.numero)] = frNombre(montantHt);
  if (delaiMois) v[nomChamp.lotDelai(lot.numero)] = frNombre(delaiMois);
  return v;
}

// ── Charge utile de constitution ─────────────────────────────────────────────

export interface MarcheACreer {
  act_lot_id: string;
  act_entreprise_id: string;
  contact_id?: string;
  entreprise_nom: string;
  lot_numero: string;
  lot_titre: string;
  montant_ht: number;
  tva_rate: number;
  offre_snapshot: SnapshotOffre | null;
}

export function marcheACreer(l: LigneMarche, snapshot: SnapshotOffre | null, tvaPct: number): MarcheACreer {
  return {
    act_lot_id: l.lot.id,
    act_entreprise_id: l.entreprise.id,
    contact_id: l.entreprise.contact_id,
    entreprise_nom: l.entreprise.nom,
    lot_numero: l.lot.lot_number,
    lot_titre: l.lot.lot_title,
    montant_ht: arrondi(l.montant),
    tva_rate: tvaPct,
    offre_snapshot: snapshot,
  };
}

/** Nom de fichier d'une pièce du marché : « CCTP_Lot-02_Maconnerie-Dupont_26001.pdf ». */
export function nomPiece(piece: 'CCAP' | 'CCTP' | 'DPGF' | 'Acte_engagement' | 'Marche', operation: string, lot?: { numero: string }, entreprise?: string, ext = 'pdf'): string {
  const morceaux = [piece, lot ? `Lot-${lot.numero}` : '', entreprise ?? '', operation].filter(Boolean).join('_');
  const propre = morceaux.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return `${propre}.${ext}`;
}
