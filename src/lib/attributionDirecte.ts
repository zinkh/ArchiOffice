// ── Attribution directe d'une entreprise à un lot (ACT, sans offre) ──────────
// Logique pure (testée). Une attribution directe désigne une entreprise pour un
// lot sans passer par la collecte ni la négociation : aucun montant n'est saisi
// (`montant` vaut 0, le marché se chiffre ensuite). L'entreprise est aussi posée
// sur le lot du projet (`PUT /api/lots/:id`, hors de ce module), d'où le chantier
// la retrouve (planning, panneau, diffusion des comptes-rendus).
import { contactDisplayName } from './projectIntervenants';

export interface AttributionDirecteBase {
  lot_id: string;
  entreprise_id: string;
  montant: number;
  /** Posé à la désignation sans offre ; absent pour une attribution issue d'une offre. */
  directe?: boolean;
}

export interface EntrepriseDirecteBase {
  id: string;
  contact_id?: string;
  nom: string;
  lots_ids: string[];
  envoyer_dce: boolean;
  corps_etat_codes?: string[];
}

export interface ContactChoisi {
  id: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
}

export const estAttributionDirecte = (a: Pick<AttributionDirecteBase, 'directe'> | undefined | null): boolean => a?.directe === true;

/**
 * Désigne `contact` pour le lot : une seule attribution par lot (elle remplace
 * l'existante, issue d'une offre ou non) et une seule entreprise consultée par
 * fiche contact (réutilisée si elle existe, le lot s'ajoute à ses lots).
 */
export function attribuerSansOffre<A extends AttributionDirecteBase, E extends EntrepriseDirecteBase>(
  consultation: { attributions: A[]; entreprises: E[] },
  lotId: string,
  contact: ContactChoisi,
  nouvelId: () => string,
): { attributions: A[]; entreprises: E[]; entrepriseId: string } {
  const nom = contactDisplayName(contact) || 'Entreprise';
  const existante = consultation.entreprises.find(e => e.contact_id === contact.id);
  let entreprises = consultation.entreprises;
  let entrepriseId: string;
  if (existante) {
    entrepriseId = existante.id;
    if (!existante.lots_ids.includes(lotId)) {
      entreprises = entreprises.map(e => e.id === existante.id ? { ...e, lots_ids: [...e.lots_ids, lotId] } : e);
    }
  } else {
    entrepriseId = nouvelId();
    const nouvelle = { id: entrepriseId, contact_id: contact.id, nom, lots_ids: [lotId], envoyer_dce: false, corps_etat_codes: [] } as unknown as E;
    entreprises = [...entreprises, nouvelle];
  }
  const attribution = { lot_id: lotId, entreprise_id: entrepriseId, montant: 0, directe: true } as A;
  return {
    attributions: [...consultation.attributions.filter(a => a.lot_id !== lotId), attribution],
    entreprises,
    entrepriseId,
  };
}

/** Retire l'attribution du lot ; les entreprises consultées ne bougent pas. */
export function retirerAttribution<A extends AttributionDirecteBase>(attributions: A[], lotId: string): A[] {
  return attributions.filter(a => a.lot_id !== lotId);
}

/**
 * Avertissement à montrer avant de désigner sans offre : en marché public, une
 * attribution hors consultation peut contrevenir aux règles de la commande
 * publique. Rien n'est interdit, le choix revient à l'architecte.
 */
export const avertitAttributionPublique = (estMarchePublic: boolean | undefined | null): boolean => estMarchePublic === true;
