export interface CreneauVisite { id: string; date_heure: string }
export type PresenceVisite = 'prevue' | 'confirmee' | 'presente' | 'absente';
export interface EntrepriseVisite { id: string; lots_ids: string[]; visite_creneau_id?: string; visite_presence?: PresenceVisite }

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
