// ── Envoi groupé du DCE et convocations à la visite : qui reçoit quoi ───────
// L'envoi groupé reste un mail INDIVIDUEL par entreprise (chacune ne voit que son propre
// message). Ce module décide, sans rien envoyer, quelles entreprises peuvent recevoir le
// message et pourquoi les autres sont écartées, puis ce qu'il faut enregistrer après l'envoi.
import { destinatairesEntreprise, type EntrepriseSuivi } from './actEntreprises';
import { visiteNotifiee } from './actVisites';

/** `dce` : envoi du dossier ; `visite` : convocation à la visite ; `reponse` : diffusion d'une réponse publique ; `additif` : modification du DCE ; `quantites` : demande de confirmation des quantités. */
export type ModeEnvoi = 'dce' | 'visite' | 'reponse' | 'additif' | 'quantites';

export type MotifExclusion = 'ne_repond_pas' | 'sans_adresse' | 'sans_lot' | 'sans_creneau';

export const LIBELLE_MOTIF: Record<MotifExclusion, string> = {
  ne_repond_pas: 'Marquée « ne répond pas »',
  sans_adresse: 'Aucune adresse e-mail',
  sans_lot: 'Aucun lot assigné',
  sans_creneau: 'Aucun créneau de visite affecté',
};

export interface LigneEnvoiGroupe {
  entreprise: EntrepriseSuivi;
  destinataires: string[];
  /** Renseigné quand l'entreprise ne peut pas recevoir le message : la ligne n'est pas cochable. */
  motif?: MotifExclusion;
  /** Elle a déjà reçu ce message : décochée d'office (pour le DCE, un renvoi révoque son lien de dépôt). */
  dejaEnvoye: boolean;
  /** Date du dernier envoi, quand elle est connue. */
  dejaLe?: string;
}

export function planEnvoiGroupe(
  entreprises: EntrepriseSuivi[], mode: ModeEnvoi = 'dce',
  /** Modes `reponse` et `additif` : entreprises déjà destinataires de ce message. */
  dejaDiffusee: ReadonlySet<string> = new Set(),
): LigneEnvoiGroupe[] {
  return entreprises.map(entreprise => {
    const destinataires = destinatairesEntreprise(entreprise);
    const motif: MotifExclusion | undefined = entreprise.ne_repond_pas ? 'ne_repond_pas'
      : destinataires.length === 0 ? 'sans_adresse'
      : mode === 'dce' && entreprise.lots_ids.length === 0 ? 'sans_lot'
      : mode === 'visite' && !entreprise.visite_creneau_id ? 'sans_creneau'
      : undefined;
    const dejaEnvoye = mode === 'dce' ? !!entreprise.dce_transmis_le : mode === 'visite' ? visiteNotifiee(entreprise)
      : mode === 'quantites' ? !!entreprise.quantites_demandees_le : dejaDiffusee.has(entreprise.id);
    const dejaLe = mode === 'dce' ? entreprise.dce_transmis_le : mode === 'visite' ? entreprise.visite_convoquee_le
      : mode === 'quantites' ? entreprise.quantites_demandees_le : undefined;
    return { entreprise, destinataires, motif, dejaEnvoye, dejaLe };
  });
}

/** Entreprises cochées par défaut : celles qui peuvent recevoir le message et ne l'ont pas encore reçu. */
export function lignesCochees(plan: LigneEnvoiGroupe[]): Set<string> {
  return new Set(plan.filter(l => !l.motif && !l.dejaEnvoye).map(l => l.entreprise.id));
}

/**
 * Entreprises « DCE à envoyer » : la case est cochée, le DCE n'est pas parti et aucune offre
 * n'est déjà là. Même définition que le statut « DCE à envoyer » du tableau.
 */
export function entreprisesDceAEnvoyer<E extends EntrepriseSuivi>(entreprises: E[]): E[] {
  return entreprises.filter(e => e.envoyer_dce && !e.dce_transmis_le && !e.ne_repond_pas && !e.offre_recue_le);
}

/** Entreprises à convoquer : un créneau leur est affecté et elles n'en ont pas encore été prévenues. */
export function entreprisesAConvoquer<E extends EntrepriseSuivi>(entreprises: E[]): E[] {
  return entreprises.filter(e => !!e.visite_creneau_id && !e.ne_repond_pas && !visiteNotifiee(e));
}

/**
 * Ce qu'il faut enregistrer sur l'entreprise après un envoi RÉUSSI. Un mail du DCE qui citait son
 * créneau (`creneauCite`) vaut convocation ; sans créneau cité, la convocation n'est pas posée.
 */
export function marquageEnvoi(e: EntrepriseSuivi, mode: ModeEnvoi, aujourdhui: string, creneauCite: boolean): Partial<EntrepriseSuivi> {
  const convocation: Partial<EntrepriseSuivi> = e.visite_creneau_id && creneauCite
    ? { visite_convoquee_creneau_id: e.visite_creneau_id, visite_convoquee_le: aujourdhui }
    : {};
  if (mode === 'reponse' || mode === 'additif') return {};
  if (mode === 'quantites') return { quantites_demandees_le: aujourdhui };
  if (mode === 'visite') return convocation;
  return { dce_transmis_le: e.dce_transmis_le || aujourdhui, envoyer_dce: true, ne_repond_pas: false, ...convocation };
}
