// Ce qu'un contrat MOE reprend d'une proposition validée. Logique pure, partagée par
// la modale de contrat (`Contrats.tsx`) et testée. Elle reproduit le découpage que le
// serveur applique à l'acceptation (`PUT /api/proposals/:id`) : missions classées par
// catégorie, part de chaque mission rapportée aux missions de base, cotraitants avec
// leur quote-part, tranche ferme seule ou toutes les tranches selon `contrat_tranches`.
import type { ContratCotraitant, ContratMOE, ContratMOEMission, ContratMissionCategory, Proposal } from '../types';
import { positiveNumber } from './contratFromProject';
import {
  donneesPourContrat, lireDonnees, listeTranches, tranchesActives, totauxParTranche, trancheDeMission,
} from './tranches';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Catégories de la répartition des propositions (libellés en clair) vers le vocabulaire fermé du contrat. */
export function categorieDeMission(label?: string): ContratMissionCategory {
  if (label === 'Mission Exécution') return 'exe';
  if (label === 'Missions complémentaires') return 'complementaire';
  return 'base';
}

/** Une proposition validée : acceptée, ou convertie en affaire (archivée d'office). */
export function estPropositionValidee(p: Pick<Proposal, 'status' | 'archive_reason'>): boolean {
  return p.status === 'Accepted' || p.archive_reason === 'converted';
}

/** Adresse des travaux d'une proposition : l'adresse du terrain suivie du code postal et de la ville. */
export function adresseTravauxProposition(p: Pick<Proposal, 'adresse_terrain' | 'cp_ville_terrain'>): string | undefined {
  const adresse = [text(p.adresse_terrain), text(p.cp_ville_terrain)].filter(Boolean).join(', ');
  return adresse || undefined;
}

/**
 * Les champs du contrat que la proposition renseigne, à fusionner dans le formulaire.
 *
 * - Identité (client, intitulé), lieu, surface : une valeur non vide de la proposition
 *   remplace celle du formulaire (choisir une autre proposition change de dossier).
 * - Montants, missions et équipe : ceux de la proposition, car c'est le devis que le
 *   client a validé ; ce que la proposition ne porte pas n'est jamais vidé.
 */
export function contratFieldsFromProposal(p: Proposal): Partial<ContratMOE> {
  const out: Partial<ContratMOE> = {};

  if (p.client_id) out.client_id = p.client_id;
  if (text(p.title)) out.intitule_projet = text(p.title);

  const adresse = adresseTravauxProposition(p);
  if (adresse) out.adresse_travaux = adresse;

  const surface = positiveNumber(p.surface_plancher);
  if (surface) out.surface_plancher = surface;

  const budget = positiveNumber(p.construction_cost);
  if (budget) out.budget_previsionnel = budget;

  const brut = lireDonnees(p.fee_distribution);
  const donnees = brut ? donneesPourContrat(brut) : null;
  const missions = donnees?.missions ?? [];

  // Ferme seule : le montant du contrat est celui de la tranche ferme, pas le total.
  const montantContrat = brut && donnees && tranchesActives(donnees) && brut.contrat_tranches === 'ferme'
    ? totauxParTranche(donnees).ferme
    : p.amount;
  const montant = positiveNumber(montantContrat);
  if (montant) {
    out.montant_honoraires = montant;
    out.mode_honoraires = 'forfait';
  }

  const specialites = p.specialties_list || [];

  if (donnees && missions.length > 0) {
    const tranches = listeTranches(donnees);
    const avecTranches = tranchesActives(donnees);
    const totalBase = missions
      .filter(m => m.category === 'Mission base')
      .reduce((acc, m) => acc + (m.amount || 0), 0);
    out.missions_list = missions.map((m): ContratMOEMission => ({
      id: m.id,
      name: m.name,
      incluse: true,
      pct: totalBase > 0 ? (m.amount || 0) / totalBase * 100 : 0,
      category: categorieDeMission(m.category),
      ...(avecTranches ? { tranche: trancheDeMission(m, tranches).label } : {}),
    }));

    const totalHonoraires = montant || totalBase || 1;
    out.cotraitants = specialites.map((s): ContratCotraitant => {
      const montant_honoraires = missions.reduce((acc, m) => {
        const quotePart = (m.percentages as Record<string, number> | undefined)?.[s.contact_id as string] || 0;
        return acc + (m.amount || 0) * (quotePart / 100);
      }, 0);
      return {
        id: crypto.randomUUID(),
        contact_id: s.contact_id || undefined,
        contact_name: s.contact_name || s.specialty_name || '',
        specialty: s.specialty_name || '',
        montant_honoraires,
        fee_pct: montant_honoraires / totalHonoraires * 100,
      };
    });
  } else if (specialites.length > 0) {
    // Sans répartition enregistrée, l'équipe est reprise sans quote-part.
    out.cotraitants = specialites.map((s): ContratCotraitant => ({
      id: crypto.randomUUID(),
      contact_id: s.contact_id || undefined,
      contact_name: s.contact_name || s.specialty_name || '',
      specialty: s.specialty_name || '',
      fee_pct: 0,
      montant_honoraires: 0,
    }));
  }

  return out;
}
