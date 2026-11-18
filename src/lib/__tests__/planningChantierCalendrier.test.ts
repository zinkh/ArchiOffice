import { describe, expect, it } from 'vitest';
import { AFFICHAGE_PLANNING, CALENDRIER_PLANNING, appliquerGeneration, periodesPlanning, positionPlanning, sanitizeAffichage, sanitizeCalendrierPlanning, sanitizePlanning } from '../planningChantier';
import { joursFeriesPlanning, reperesCalendrierPlanning } from '../planningChantierCalendrier';

describe('jours fériés du chantier', () => {
  it('correspond aux 11 dates officielles métropolitaines 2026, sans appel réseau', () => {
    // https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json
    expect(joursFeriesPlanning(2026, 'france').map(j => j.debut)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
      '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
  });
  it('calcule les fêtes mobiles au changement d’heure et dans une année bissextile', () => {
    const fetes = joursFeriesPlanning(2024, 'france');
    expect(fetes.find(j => j.cle === 'paques')?.debut).toBe('2024-04-01');
    expect(fetes.find(j => j.cle === 'ascension')?.debut).toBe('2024-05-09');
    expect(fetes.find(j => j.cle === 'pentecote')?.debut).toBe('2024-05-20');
    expect(joursFeriesPlanning(2027, 'france').find(j => j.cle === 'paques')?.debut).toBe('2027-03-29');
  });
  it('ajoute les deux jours régionaux et permet de désactiver les dates automatiques', () => {
    const alsace = joursFeriesPlanning(2026, 'alsace_moselle');
    expect(alsace).toHaveLength(13);
    expect(alsace.find(j => j.cle === 'vendredi_saint')?.debut).toBe('2026-04-03');
    expect(alsace.find(j => j.cle === 'saint_etienne')?.debut).toBe('2026-12-26');
    expect(joursFeriesPlanning(2026, 'aucun')).toEqual([]);
    expect(joursFeriesPlanning(NaN, 'france')).toEqual([]);
  });
});

const conge = { id: 'hiver', libelle: 'Fermeture hivernale', debut: '2026-12-24', fin: '2027-01-03', type: 'conge' as const };
describe('repères du calendrier', () => {
  it('traverse les années, garde les dates originales, distingue les chevauchements', () => {
    const cal = { ...CALENDRIER_PLANNING, periodes: [conge] };
    const r = reperesCalendrierPlanning(cal, '2026-12-28', '2027-01-10', AFFICHAGE_PLANNING);
    expect(r.map(x => x.libelle)).toEqual(['Fermeture hivernale', 'Jour de l’an']);
    expect(r[0].debut).toBe('2026-12-24');
    expect(r[0].fin).toBe('2027-01-03');
    const periodes = periodesPlanning('2026-12-28', '2027-01-10', AFFICHAGE_PLANNING);
    expect(positionPlanning(r[0].debut, periodes)).toBe(0); // bande tronquée au début de l’axe
  });
  it('filtre séparément congés et fériés, y compris les jours locaux saisis', () => {
    const cal = { ...CALENDRIER_PLANNING, periodes: [conge, { ...conge, id: 'local', libelle: 'Fête locale', type: 'ferie' as const }] };
    expect(reperesCalendrierPlanning(cal, '2026-12-24', '2027-01-03', { joursFeries: false, conges: true }).map(r => r.id)).toEqual(['personnalise-hiver']);
    expect(reperesCalendrierPlanning(cal, '2026-12-24', '2027-01-03', { joursFeries: true, conges: false }).every(r => r.type === 'ferie')).toBe(true);
    expect(reperesCalendrierPlanning(cal, '2026-12-24', '2027-01-03', { joursFeries: false, conges: false })).toEqual([]);
  });
  it('respecte la fin inclusive et ignore les périodes hors de l’axe', () => {
    expect(reperesCalendrierPlanning({ joursFeries: 'aucun', periodes: [conge] }, '2027-01-03', '2027-01-03', AFFICHAGE_PLANNING)).toHaveLength(1);
    expect(reperesCalendrierPlanning({ joursFeries: 'aucun', periodes: [conge] }, '2027-01-04', '2027-01-05', AFFICHAGE_PLANNING)).toEqual([]);
  });
});

describe('persistance et compatibilité', () => {
  it('valide et borne les périodes sans déplacer des dates inversées', () => {
    const cal = sanitizeCalendrierPlanning({ joursFeries: 'inconnu', periodes: [conge, conge, { ...conge, fin: '2026-12-01' }, { ...conge, debut: '2026-02-30' }, { ...conge, libelle: '' }] });
    expect(cal.joursFeries).toBe('france'); expect(cal.periodes).toHaveLength(2);
    expect(new Set(cal.periodes.map(p => p.id)).size).toBe(2);
    expect(sanitizeCalendrierPlanning({ periodes: Array(110).fill(conge) }).periodes).toHaveLength(100);
  });
  it('conserve le calendrier au rechargement et lors d’une génération IA', () => {
    const p = sanitizePlanning({ calendrier: { joursFeries: 'alsace_moselle', periodes: [conge] }, taches: [{ id: 't', libelle: 'Travaux', debut: '2027-01-01', fin: '2027-01-02' }] });
    expect(sanitizePlanning(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(appliquerGeneration(p, { taches: [], hypotheses: [], ecartees: 0 }, new Set(), { garderManuel: true }).calendrier).toEqual(p.calendrier);
    expect(p.taches[0].debut).toBe('2027-01-01'); // le férié n’a pas déplacé la tâche
    expect(sanitizePlanning({}).calendrier).toBeUndefined();
  });
  it('complète les anciennes préférences, sans réactiver une visibilité masquée', () => {
    expect(sanitizeAffichage({})).toMatchObject({ joursFeries: true, conges: true });
    expect(sanitizeAffichage({ joursFeries: false, conges: false })).toMatchObject({ joursFeries: false, conges: false });
  });
});
