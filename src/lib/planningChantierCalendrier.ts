// Calendrier VISUEL des interventions d'entreprises. Aucun lien avec les congés RH.
// Référence des dates : https://calendrier.api.gouv.fr/jours-feries/
import { ajouterJours, estDateIso, type CalendrierPlanning, type ZoneFeriesPlanning } from './planningChantier';

export interface RepereCalendrierPlanning {
  id: string;
  debut: string;
  fin: string;
  type: 'ferie' | 'conge';
  libelle: string;
  /** Traduction pour un jour calculé ; le libellé d'une période saisie reste tel quel. */
  cle?: string;
}

/** Pâques grégoriennes (Meeus/Jones/Butcher), calculées exclusivement en UTC. */
function paques(annee: number): string {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = (h + l - 7 * m + 114) % 31 + 1;
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

export function joursFeriesPlanning(annee: number, zone: ZoneFeriesPlanning): RepereCalendrierPlanning[] {
  if (zone === 'aucun' || !Number.isInteger(annee) || annee < 1583 || annee > 9999) return [];
  const p = paques(annee);
  const dates: [string, string, string][] = [
    [`${annee}-01-01`, 'nouvel_an', 'Jour de l’an'],
    [ajouterJours(p, 1), 'paques', 'Lundi de Pâques'],
    [`${annee}-05-01`, 'travail', 'Fête du Travail'],
    [`${annee}-05-08`, 'victoire', 'Victoire du 8 mai'],
    [ajouterJours(p, 39), 'ascension', 'Ascension'],
    [ajouterJours(p, 50), 'pentecote', 'Lundi de Pentecôte'],
    [`${annee}-07-14`, 'nationale', 'Fête nationale'],
    [`${annee}-08-15`, 'assomption', 'Assomption'],
    [`${annee}-11-01`, 'toussaint', 'Toussaint'],
    [`${annee}-11-11`, 'armistice', 'Armistice du 11 novembre'],
    [`${annee}-12-25`, 'noel', 'Noël'],
  ];
  if (zone === 'alsace_moselle') dates.push([ajouterJours(p, -2), 'vendredi_saint', 'Vendredi saint'], [`${annee}-12-26`, 'saint_etienne', 'Saint-Étienne']);
  return dates.map<RepereCalendrierPlanning>(([date, cle, libelle]) => ({ id: `ferie-${cle}-${annee}`, debut: date, fin: date, type: 'ferie', cle, libelle }))
    .sort((a, b) => a.debut.localeCompare(b.debut));
}

/** Repères qui intersectent l'axe affiché, sans modifier ni étendre les tâches. */
export function reperesCalendrierPlanning(calendrier: CalendrierPlanning, debut: string, fin: string, affichage: { joursFeries: boolean; conges: boolean }): RepereCalendrierPlanning[] {
  if (!estDateIso(debut) || !estDateIso(fin) || fin < debut) return [];
  const reperes: RepereCalendrierPlanning[] = [];
  if (affichage.joursFeries) {
    for (let annee = Number(debut.slice(0, 4)); annee <= Number(fin.slice(0, 4)); annee++) reperes.push(...joursFeriesPlanning(annee, calendrier.joursFeries));
  }
  reperes.push(...calendrier.periodes.filter(p => p.type === 'ferie' ? affichage.joursFeries : affichage.conges).map(p => ({ ...p, id: `personnalise-${p.id}` })));
  return reperes.filter(p => p.debut <= fin && p.fin >= debut).sort((a, b) => a.debut.localeCompare(b.debut) || a.fin.localeCompare(b.fin) || a.id.localeCompare(b.id));
}
