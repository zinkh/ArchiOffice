export interface CreneauVisite { id: string; date_heure: string }
export type PresenceVisite = 'prevue' | 'confirmee' | 'presente' | 'absente';
export interface EntrepriseVisite {
  id: string; lots_ids: string[]; visite_creneau_id?: string; visite_presence?: PresenceVisite;
  /** Créneau cité dans le dernier message de convocation (ou d'envoi du DCE) et date de ce message. */
  visite_convoquee_creneau_id?: string;
  visite_convoquee_le?: string;
}

/** Lieu et consignes de la visite, saisis une fois pour toute la consultation. */
export interface VisiteSite { lieu?: string; consignes?: string }

/** Ce que le message dit de la visite à une entreprise (dates déjà mises en forme). */
export interface BlocVisite { creneaux: string[]; assigne: boolean; lieu?: string; consignes?: string }

/** L'entreprise a reçu le créneau qui lui est affecté aujourd'hui. */
export function visiteNotifiee(e: Pick<EntrepriseVisite, 'visite_creneau_id' | 'visite_convoquee_creneau_id'>): boolean {
  return !!e.visite_creneau_id && e.visite_convoquee_creneau_id === e.visite_creneau_id;
}

/** Un autre créneau lui a été affecté depuis sa dernière convocation : elle est à prévenir de nouveau. */
export function aRenotifier(e: Pick<EntrepriseVisite, 'visite_creneau_id' | 'visite_convoquee_creneau_id' | 'visite_convoquee_le'>): boolean {
  return !!e.visite_creneau_id && !!e.visite_convoquee_le && e.visite_convoquee_creneau_id !== e.visite_creneau_id;
}

/**
 * Bloc « visite » d'un message à une entreprise : son créneau s'il en a un, sinon les créneaux à venir
 * qu'elle peut choisir. Sans créneau à citer, aucune visite n'est annoncée (le lieu seul ne suffit pas).
 */
export function visitePourMessage(
  e: Pick<EntrepriseVisite, 'visite_creneau_id'>, creneaux: CreneauVisite[], site?: VisiteSite, maintenant: Date = new Date(),
): BlocVisite | undefined {
  const tries = [...creneaux].sort((a, b) => a.date_heure.localeCompare(b.date_heure));
  const lieu = site?.lieu?.trim() || undefined;
  const consignes = site?.consignes?.trim() || undefined;
  const affecte = tries.find(c => c.id === e.visite_creneau_id);
  if (affecte) return { creneaux: [libelleVisite(affecte.date_heure)], assigne: true, lieu, consignes };
  const proposes = tries.filter(c => new Date(c.date_heure).getTime() >= maintenant.getTime());
  if (proposes.length === 0) return undefined;
  return { creneaux: proposes.map(c => libelleVisite(c.date_heure)), assigne: false, lieu, consignes };
}

/** Les dates sont locales et sans conversion UTC : elles représentent l'heure affichée au chantier. */
export function libelleVisite(dateHeure: string): string {
  const d = new Date(dateHeure);
  return Number.isNaN(d.getTime()) ? dateHeure : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function bilanVisite(creneauId: string, entreprises: EntrepriseVisite[], lots: { id: string; lot_number: string; lot_title: string }[]) {
  const uniques = [...new Map(entreprises.filter(e => e.visite_creneau_id === creneauId).map(e => [e.id, e])).values()];
  return {
    inscrites: uniques.length,
    presentes: uniques.filter(e => e.visite_presence === 'presente').length,
    lots: lots.map(lot => {
      const entreprisesLot = uniques.filter(e => e.lots_ids.includes(lot.id));
      return { lot, inscrites: entreprisesLot.length, presentes: entreprisesLot.filter(e => e.visite_presence === 'presente').length };
    }).filter(item => item.inscrites > 0),
    sansLot: uniques.filter(e => !e.lots_ids.some(id => lots.some(l => l.id === id))).length,
  };
}
