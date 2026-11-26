import { describe, expect, it } from 'vitest';
import { AFFICHAGE_PLANNING, decalerSuccesseurs, sanitizeAffichage, type TachePlanning } from '../planningChantier';
import { creerEstOuvre } from '../planningChantierCalendrier';

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

describe('décalage vers l’avant (rapprocher les successeurs)', () => {
  // `avant` est le planning d'avant l'action ; `apres` le même planning avec la tâche modifiée.
  const rapprocher = (avant: TachePlanning[], apres: TachePlanning[], modifiees = ['a'], ouvre?: (iso: string) => boolean) =>
    decalerSuccesseurs(apres, modifiees, ouvre, { avant, rapprocher: true });
  const base = [
    tache('a', '2027-01-10', '2027-01-14'),
    tache('b', '2027-01-15', '2027-01-19', { dependencies: ['a'] }), // collé à a
    tache('c', '2027-01-20', '2027-01-24', { dependencies: ['b'] }), // collé à b
  ];
  const paire = (t: TachePlanning) => [t.debut, t.fin];
  const avance = (taches: TachePlanning[]) => taches.map(t => t.id === 'a' ? { ...t, debut: '2027-01-04', fin: '2027-01-08' } : t);

  it('rapproche en cascade les successeurs collés, durée conservée', () => {
    const r = rapprocher(base, avance(base));
    expect(paire(r.taches[1])).toEqual(['2027-01-09', '2027-01-13']);
    expect(paire(r.taches[2])).toEqual(['2027-01-14', '2027-01-18']);
    expect(r.decalees).toEqual([{ id: 'b', jours: -6 }, { id: 'c', jours: -6 }]);
  });

  it('garde la marge d’un successeur qui n’était pas collé', () => {
    const avecMarge = base.map(t => t.id === 'b' ? { ...t, debut: '2027-01-18', fin: '2027-01-22' } : t.id === 'c' ? { ...t, debut: '2027-01-23', fin: '2027-01-27' } : t);
    const r = rapprocher(avecMarge, avance(avecMarge));
    expect(paire(r.taches[1])).toEqual(['2027-01-12', '2027-01-16']); // marge de 3 jours conservée
    expect(paire(r.taches[2])).toEqual(['2027-01-17', '2027-01-21']);
  });

  it('ne dépasse jamais le minimum permis par un autre prédécesseur', () => {
    const avecAutre = [...base, tache('x', '2027-01-08', '2027-01-14')].map(t => t.id === 'b' ? { ...t, dependencies: ['a', 'x'] } : t);
    const r = rapprocher(avecAutre, avance(avecAutre));
    expect(paire(r.taches[1])).toEqual(['2027-01-15', '2027-01-19']); // x impose toujours le 15
    expect(r.decalees).toEqual([]);
  });

  it('ne fait rien sans l’option, ni sans le planning d’avant', () => {
    expect(decalerSuccesseurs(avance(base), ['a']).decalees).toEqual([]);
    expect(decalerSuccesseurs(avance(base), ['a'], undefined, { rapprocher: true }).decalees).toEqual([]);
    expect(decalerSuccesseurs(avance(base), ['a'], undefined, { avant: base }).decalees).toEqual([]);
  });

  it('ne touche ni une tâche terminée, ni une tâche déjà en conflit avant l’action', () => {
    const terminee = base.map(t => t.id === 'b' ? { ...t, avancement: 100 } : t);
    const r = rapprocher(terminee, avance(terminee));
    expect(paire(r.taches[1])).toEqual(['2027-01-15', '2027-01-19']);
    expect(r.terminees).toEqual(['b']);
    const enConflit = base.map(t => t.id === 'b' ? { ...t, debut: '2027-01-12', fin: '2027-01-16' } : t);
    expect(rapprocher(enConflit, avance(enConflit)).decalees.map(d => d.id)).not.toContain('b');
  });

  it('respecte les délais et pousse toujours ce qui entre en conflit', () => {
    const delai = base.map(t => t.id === 'b' ? { ...t, debut: '2027-01-17', fin: '2027-01-21', delais: { a: 2 } } : t);
    const r = rapprocher(delai, avance(delai)); // a finit le 8 : minimum du 11
    expect(paire(r.taches[1])).toEqual(['2027-01-11', '2027-01-15']);
    // Un prédécesseur qui recule pousse comme avant, l'option n'y change rien.
    const recule = base.map(t => t.id === 'a' ? { ...t, debut: '2027-01-16', fin: '2027-01-20' } : t);
    expect(paire(rapprocher(base, recule).taches[1])).toEqual(['2027-01-21', '2027-01-25']);
  });

  it('garde la marge en jours ouvrés', () => {
    const ouvre = creerEstOuvre({ joursFeries: 'france', periodes: [], joursOuvres: true });
    // a finit le vendredi 15, b commence le mercredi 20 : deux jours ouvrés de marge (lundi 18, mardi 19).
    const avant = [tache('a', '2027-01-11', '2027-01-15'), tache('b', '2027-01-20', '2027-01-22', { dependencies: ['a'] })];
    const apres = avant.map(t => t.id === 'a' ? { ...t, debut: '2027-01-04', fin: '2027-01-08' } : t);
    const r = rapprocher(avant, apres, ['a'], ouvre);
    expect(paire(r.taches[1])).toEqual(['2027-01-13', '2027-01-15']); // lundi 11 + 2 jours ouvrés, trois jours ouvrés de durée
  });

  it('se lit strictement dans les réglages', () => {
    expect(AFFICHAGE_PLANNING.cascadeRapprocher).toBe(false);
    expect(sanitizeAffichage({ cascadeRapprocher: true })).toMatchObject({ cascadeRapprocher: true });
    expect(sanitizeAffichage({ cascadeRapprocher: 1 })).toMatchObject({ cascadeRapprocher: false });
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
