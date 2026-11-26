// L'entreprise d'un marché de travaux vient de l'ATTRIBUTION de l'ACT (consultation des entreprises),
// pas de la fiche du lot : c'est la consultation qui désigne l'entreprise retenue et son montant.
// Logique pure. Un marché signé garde l'entreprise de l'acte (rien n'est réécrit après signature) ;
// un accord-cadre et ses subséquents ont leurs propres titulaires et ne sont pas concernés.

export interface ConsultationAttribution {
  entreprises?: { id: string; nom: string; contact_id?: string }[];
  attributions?: { lot_id: string; entreprise_id: string; montant?: number }[];
}

export interface LotAttribution { id: string; lot_number?: string | null; lot_title?: string | null }

export interface EntrepriseAttribuee { entrepriseId: string; nom: string; contactId?: string; montant: number }

/** Entreprise retenue pour un lot du projet par l'attribution de l'ACT, ou null. */
export function entrepriseAttribuee(lotId: string | null | undefined, consultation: ConsultationAttribution | null | undefined): EntrepriseAttribuee | null {
  if (!lotId || !consultation) return null;
  const attribution = (consultation.attributions ?? []).find(a => a.lot_id === lotId);
  const entreprise = attribution && (consultation.entreprises ?? []).find(e => e.id === attribution.entreprise_id);
  if (!attribution || !entreprise?.nom?.trim()) return null;
  return { entrepriseId: entreprise.id, nom: entreprise.nom.trim(), contactId: entreprise.contact_id, montant: Number(attribution.montant) || 0 };
}

const cleNumero = (v: unknown) => String(v ?? '').trim().toLowerCase().split('.').map(s => (/^\d+$/.test(s) ? String(parseInt(s, 10)) : s)).join('.');

interface MarcheLike {
  entreprise_nom: string;
  lot_numero?: string | null;
  lot_titre?: string | null;
  act_lot_id?: string | null;
  statut_signature?: string | null;
  type_marche?: string | null;
}

/** Le lot du projet d'un marché : par son rattachement ACT, à défaut par son numéro de lot. */
export function lotDuMarche<L extends LotAttribution>(marche: MarcheLike, lots: L[]): L | undefined {
  if (marche.act_lot_id) {
    const parId = lots.find(l => l.id === marche.act_lot_id);
    if (parId) return parId;
  }
  const numero = cleNumero(marche.lot_numero);
  return numero ? lots.find(l => cleNumero(l.lot_number) === numero) : undefined;
}

/**
 * Le marché avec l'entreprise de l'attribution ACT de son lot. Inchangé (même objet) quand il n'y a pas
 * d'attribution, qu'il est signé, ou que c'est un accord-cadre ou un subséquent.
 */
export function avecEntrepriseAttribuee<M extends MarcheLike, L extends LotAttribution>(
  marche: M, lots: L[], consultation: ConsultationAttribution | null | undefined,
): M {
  if (marche.statut_signature === 'signe') return marche;
  if (marche.type_marche === 'accord_cadre' || marche.type_marche === 'subsequent') return marche;
  const attribuee = entrepriseAttribuee(lotDuMarche(marche, lots)?.id, consultation);
  if (!attribuee || attribuee.nom === marche.entreprise_nom) return marche;
  return { ...marche, entreprise_nom: attribuee.nom };
}
