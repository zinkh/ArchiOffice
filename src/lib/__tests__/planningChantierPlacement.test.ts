import { describe, expect, it } from 'vitest';
import { datesParGeste, incoherencesDependances, placerApresPredecesseurs, planningParLot, sanitizePlanning, type TachePlanning } from '../planningChantier';

const a: TachePlanning = { id: 'a', lotId: 'go', libelle: 'A', debut: '2026-12-28', fin: '2026-12-31', source: 'manuel', avancement: 40 };
const b: TachePlanning = { ...a, id: 'b', libelle: 'B', debut: '2026-12-01', fin: '2026-12-03', dependencies: ['a'] };
const lots = [{ id: 'go', lot_number: '01', lot_title: 'GO' }];

describe('placement ponctuel après les prédécesseurs', () => {
  it('passe au lendemain de la fin inclusive et conserve durée, avancement et ordre', () => {
    const placee = placerApresPredecesseurs(b, [a, b]);
    expect(placee).toMatchObject({ debut: '2027-01-01', fin: '2027-01-03', avancement: 40 });
    const avant = sanitizePlanning({ taches: [a, b] });
    const apres = sanitizePlanning(JSON.parse(JSON.stringify({ taches: [a, placee] })));
    expect(planningParLot(avant, lots)[0].taches.map(t => t.id)).toEqual(['a', 'b']);
    expect(planningParLot(apres, lots)[0].taches.map(t => t.id)).toEqual(['a', 'b']);
    expect(avant.taches[1]).toEqual(b);
  });
  it('retient la fin la plus tardive, tous lots et jalons compris, même pour avancer la tâche', () => {
    const precedent = { ...a, id: 'j', lotId: '', debut: '2027-01-04', fin: '2027-01-04', jalon: true };
    const t = placerApresPredecesseurs({ ...b, debut: '2027-02-01', fin: '2027-02-03', dependencies: ['a', 'j'] }, [a, precedent]);
    expect(t).toMatchObject({ debut: '2027-01-05', fin: '2027-01-07' });
    expect(placerApresPredecesseurs({ ...b, jalon: true }, [a])).toMatchObject({ debut: '2027-01-01', fin: '2027-01-01' });
  });
  it('calcule les jours calendaires UTC autour des changements d’heure et des années bissextiles', () => {
    for (const [fin, debut] of [['2024-02-28', '2024-02-29'], ['2026-03-28', '2026-03-29'], ['2026-10-24', '2026-10-25']]) {
      expect(placerApresPredecesseurs(b, [{ ...a, fin }]).debut).toBe(debut);
    }
  });
  it('autorise ensuite le déplacement manuel et le conserve à la relecture avec une alerte', () => {
    const placee = placerApresPredecesseurs(b, [a]);
    const manuelle = datesParGeste(placee, 'deplacer', '2026-12-30');
    const relu = sanitizePlanning(JSON.parse(JSON.stringify({ taches: [a, manuelle] })));
    expect(relu.taches[1]).toMatchObject({ debut: '2026-12-30', fin: '2027-01-01', dependencies: ['a'] });
    expect(incoherencesDependances(relu.taches)).toHaveLength(1);
    expect(planningParLot(relu, lots)[0].taches.map(t => t.id)).toEqual(['a', 'b']);
  });
  it('ne déplace rien sans prédécesseur valide ou avec des dates de brouillon invalides', () => {
    expect(placerApresPredecesseurs(b, [])).toBe(b);
    const brouillon = { ...b, debut: '' };
    expect(placerApresPredecesseurs(brouillon, [a])).toBe(brouillon);
    expect(placerApresPredecesseurs(b, [{ ...a, fin: '9999-12-31' }])).toBe(b);
  });
});
