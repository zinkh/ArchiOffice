// ── Envoi groupé du DCE : qui reçoit quoi ────────────────────────────────────
// L'envoi groupé reste un mail INDIVIDUEL par entreprise (chacune ne voit que son propre
// message). Ce module décide, sans rien envoyer, quelles entreprises peuvent recevoir le
// DCE et pourquoi les autres sont écartées.
import { destinatairesEntreprise, type EntrepriseSuivi } from './actEntreprises';

export type MotifExclusion = 'ne_repond_pas' | 'sans_adresse' | 'sans_lot';

export const LIBELLE_MOTIF: Record<MotifExclusion, string> = {
  ne_repond_pas: 'Marquée « ne répond pas »',
  sans_adresse: 'Aucune adresse e-mail',
  sans_lot: 'Aucun lot assigné',
};

export interface LigneEnvoiGroupe {
  entreprise: EntrepriseSuivi;
  destinataires: string[];
  /** Renseigné quand l'entreprise ne peut pas recevoir le DCE : la ligne n'est pas cochable. */
  motif?: MotifExclusion;
  /** Le DCE lui a déjà été transmis : décochée d'office, un nouvel envoi révoque son lien de dépôt. */
  dejaTransmis: boolean;
}

export function planEnvoiGroupe(entreprises: EntrepriseSuivi[]): LigneEnvoiGroupe[] {
  return entreprises.map(entreprise => {
    const destinataires = destinatairesEntreprise(entreprise);
    const motif: MotifExclusion | undefined = entreprise.ne_repond_pas ? 'ne_repond_pas'
      : destinataires.length === 0 ? 'sans_adresse'
      : entreprise.lots_ids.length === 0 ? 'sans_lot'
      : undefined;
    return { entreprise, destinataires, motif, dejaTransmis: !!entreprise.dce_transmis_le };
  });
}

/** Entreprises cochées par défaut : celles qui peuvent recevoir le DCE et ne l'ont pas encore reçu. */
export function lignesCochees(plan: LigneEnvoiGroupe[]): Set<string> {
  return new Set(plan.filter(l => !l.motif && !l.dejaTransmis).map(l => l.entreprise.id));
}

/**
 * Entreprises « DCE à envoyer » : la case est cochée, le DCE n'est pas parti et aucune offre
 * n'est déjà là. Même définition que le statut « DCE à envoyer » du tableau.
 */
export function entreprisesDceAEnvoyer<E extends EntrepriseSuivi>(entreprises: E[]): E[] {
  return entreprises.filter(e => e.envoyer_dce && !e.dce_transmis_le && !e.ne_repond_pas && !e.offre_recue_le);
}
