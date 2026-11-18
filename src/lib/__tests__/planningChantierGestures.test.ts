import { describe, expect, it } from 'vitest';
import { AFFICHAGE_PLANNING, ajouterJours, dateDepuisPositionPlanning, datesParGeste, dimensionsPlanning, periodesPlanning, positionPlanning, sanitizeAffichage, verifierLienPlanning, type TachePlanning } from '../planningChantier';
const tache: TachePlanning = { id: 'a', lotId: 'lot', libelle: 'Fondations', debut: '2026-12-30', fin: '2027-01-08', avancement: 40, source: 'ia' };

describe('conversion du pointeur en date', () => {
  for (const relatif of [false, true]) for (const echelle of ['semaines', 'mois'] as const) {
    it(`inverse précisément l'axe ${echelle}, relatif=${relatif}, sans dérive mensuelle`, () => {
      const periodes = periodesPlanning('2024-01-31', '2024-04-15', { ...AFFICHAGE_PLANNING, echelle, relatif });
      for (let i = 0; i < 75; i++) {
        const jour = ajouterJours('2024-01-31', i);
        expect(dateDepuisPositionPlanning(positionPlanning(jour, periodes), periodes, echelle)).toBe(jour);
      }
      expect(dateDepuisPositionPlanning(-1, periodes, echelle)).toBe(echelle === 'semaines' ? ajouterJours(periodes[0].debut, -7) : relatif ? '2023-12-31' : '2023-12-01');
    });
  }
  it('déplace une tâche sans changer sa durée, y compris au changement d’année', () => {
    const suivante = datesParGeste(tache, 'deplacer', '2027-01-06');
    expect(suivante).toMatchObject({ debut: '2027-01-06', fin: '2027-01-15', avancement: 40 });
    expect(tache.debut).toBe('2026-12-30');
  });
  it('borne les deux poignées à une journée au minimum', () => {
    expect(datesParGeste(tache, 'debut', '2027-02-01').debut).toBe(tache.fin);
    expect(datesParGeste(tache, 'fin', '2026-01-01').fin).toBe(tache.debut);
    expect(datesParGeste(tache, 'deplacer', 'invalide')).toBe(tache);
  });
  it('conserve un jalon ponctuel', () => {
    const jalon = { ...tache, jalon: true, fin: tache.debut };
    expect(datesParGeste(jalon, 'deplacer', '2027-01-09')).toMatchObject({ debut: '2027-01-09', fin: '2027-01-09' });
  });
});

describe('liaisons au pointeur', () => {
  const suivantes = [tache, { ...tache, id: 'b', lotId: 'autre', dependencies: ['a'] }, { ...tache, id: 'j', lotId: '', jalon: true, dependencies: ['b'] }];
  it('accepte les lots différents et jalons, refuse les références invalides et les cycles', () => {
    expect(verifierLienPlanning(suivantes, 'a', 'j')).toBe('ajoute');
    expect(verifierLienPlanning(suivantes, 'j', 'a')).toBe('cycle');
    expect(verifierLienPlanning(suivantes, 'a', 'a')).toBe('soi');
    expect(verifierLienPlanning(suivantes, 'a', 'b')).toBe('existant');
    expect(verifierLienPlanning(suivantes, 'supprimee', 'b')).toBe('introuvable');
  });
});

describe('largeurs et préférences', () => {
  it('préserve les anciens réglages et borne les dimensions reçues', () => {
    expect(sanitizeAffichage({})).toEqual(AFFICHAGE_PLANNING);
    expect(sanitizeAffichage({ avancement: false, largeurPeriode: 10000, largeurLibelles: -1 })).toMatchObject({ avancement: false, largeurPeriode: 240, largeurLibelles: 140 });
    expect(sanitizeAffichage({ largeurPeriode: null, largeurLibelles: Infinity })).toMatchObject({ largeurPeriode: 84, largeurLibelles: 272 });
  });
  it('ajuste toutes les périodes et la poignée de liaison à la région disponible', () => {
    for (const largeur of [320, 768, 1200]) {
      const d = dimensionsPlanning(largeur, 60, { ...AFFICHAGE_PLANNING, ajusterLargeur: true });
      expect(d.libelles + d.periode * 60 + 80).toBeCloseTo(largeur);
      expect(d.periode).toBeGreaterThan(0);
    }
  });
  it('respecte le zoom manuel', () => {
    expect(dimensionsPlanning(1000, 20, { ...AFFICHAGE_PLANNING, largeurPeriode: 120 }).periode).toBe(120);
  });
});
