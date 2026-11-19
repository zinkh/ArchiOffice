import { describe, expect, it } from 'vitest';
import { AFFICHAGE_PLANNING, decalerSuccesseurs, sanitizeAffichage, type TachePlanning } from '../planningChantier';

const tache = (id: string, debut: string, fin: string, extra: Partial<TachePlanning> = {}): TachePlanning =>
  ({ id, lotId: 'lot', libelle: id, debut, fin, avancement: 0, source: 'ia', ...extra });
const dates = (r: { taches: TachePlanning[] }, id: string) => { const t = r.taches.find(x => x.id === id)!; return [t.debut, t.fin]; };

describe('décalage automatique des successeurs', () => {
  it('recule en cascade les successeurs en conflit, en gardant leur durée', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14', { source: 'manuel' }), // déjà déplacée par l'utilisateur
      tache('b', '2027-01-11', '2027-01-15', { dependencies: ['a'] }),
      tache('c', '2027-01-16', '2027-01-20', { dependencies: ['b'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(dates(r, 'a')).toEqual(['2027-01-10', '2027-01-14']);
    expect(dates(r, 'b')).toEqual(['2027-01-15', '2027-01-19']);
    expect(dates(r, 'c')).toEqual(['2027-01-20', '2027-01-24']);
    expect(r.decalees).toEqual([{ id: 'b', jours: 4 }, { id: 'c', jours: 4 }]);
    expect(r.terminees).toEqual([]);
  });

  it('n’avance jamais un successeur quand le prédécesseur se déplace plus tôt', () => {
    const taches = [
      tache('a', '2027-01-04', '2027-01-08'),
      tache('b', '2027-01-20', '2027-01-25', { dependencies: ['a'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(r.decalees).toEqual([]);
    expect(dates(r, 'b')).toEqual(['2027-01-20', '2027-01-25']);
  });

  it('ne déplace pas un successeur qui respecte déjà le lendemain de la fin du prédécesseur', () => {
    const r = decalerSuccesseurs([tache('a', '2027-01-04', '2027-01-08'), tache('b', '2027-01-09', '2027-01-12', { dependencies: ['a'] })], ['a']);
    expect(r.decalees).toEqual([]);
  });

  it('se cale sur le prédécesseur le plus tardif quand il y en a plusieurs', () => {
    const taches = [
      tache('a', '2027-01-04', '2027-01-08', { source: 'manuel' }),
      tache('x', '2027-01-04', '2027-01-20'),
      tache('b', '2027-01-09', '2027-01-12', { dependencies: ['a', 'x'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(dates(r, 'b')).toEqual(['2027-01-21', '2027-01-24']);
  });

  it('garde un jalon sur un seul jour', () => {
    const taches = [
      tache('a', '2027-02-01', '2027-02-05', { source: 'manuel' }),
      tache('hors-d-eau', '2027-02-03', '2027-02-03', { jalon: true, dependencies: ['a'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(dates(r, 'hors-d-eau')).toEqual(['2027-02-06', '2027-02-06']);
  });

  it('ne touche que l’aval des tâches modifiées', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14', { source: 'manuel' }),
      tache('b', '2027-01-11', '2027-01-12', { dependencies: ['a'] }),
      tache('p', '2027-01-04', '2027-01-08'),
      tache('q', '2027-01-05', '2027-01-06', { dependencies: ['p'] }), // conflit existant, étranger à la modification
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(r.decalees.map(d => d.id)).toEqual(['b']);
    expect(dates(r, 'q')).toEqual(['2027-01-05', '2027-01-06']);
  });

  it('ne déplace jamais une tâche terminée et la signale', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14', { source: 'manuel' }),
      tache('b', '2027-01-11', '2027-01-15', { dependencies: ['a'], avancement: 100 }),
      tache('c', '2027-01-16', '2027-01-20', { dependencies: ['b'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(dates(r, 'b')).toEqual(['2027-01-11', '2027-01-15']);
    expect(r.terminees).toEqual(['b']);
    expect(r.decalees).toEqual([]);
  });

  it('passe les tâches déplacées en manuel et ne modifie pas le planning reçu', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14', { source: 'manuel' }),
      tache('b', '2027-01-11', '2027-01-15', { dependencies: ['a'] }),
    ];
    const copie = JSON.stringify(taches);
    const r = decalerSuccesseurs(taches, ['a']);
    expect(r.taches.find(t => t.id === 'b')!.source).toBe('manuel');
    expect(JSON.stringify(taches)).toBe(copie);
  });

  it('s’arrête sur des données circulaires corrompues', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14', { dependencies: ['b'] }),
      tache('b', '2027-01-11', '2027-01-15', { dependencies: ['a'] }),
      tache('c', '2027-01-12', '2027-01-13', { dependencies: ['b'] }),
    ];
    expect(() => decalerSuccesseurs(taches, ['c'])).not.toThrow();
    expect(() => decalerSuccesseurs(taches, ['a'])).not.toThrow();
  });
});

describe('réglage « Décaler les successeurs »', () => {
  it('est désactivé par défaut et lu strictement', () => {
    expect(AFFICHAGE_PLANNING.cascade).toBe(false);
    expect(sanitizeAffichage({})).toMatchObject({ cascade: false });
    expect(sanitizeAffichage({ cascade: true })).toMatchObject({ cascade: true });
    expect(sanitizeAffichage({ cascade: 'oui' })).toMatchObject({ cascade: false });
  });
});
