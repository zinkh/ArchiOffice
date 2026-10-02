import { describe, it, expect } from 'vitest';
import {
  parseDateIso, joursAvant, statutQualification, resumeQualifications, parContact,
  normaliserSiret, siretValide, validerQualification, formaterDate, type Qualification,
} from '../qualifications';

const TODAY = '2026-10-02';
const q = (p: Partial<Qualification> = {}): Qualification => ({
  id: 'q', contact_id: 'c1', organisme: 'qualibat', reference: '2111', source: 'saisie', ...p,
});

describe('parseDateIso', () => {
  it('lit AAAA-MM-JJ, un horodatage ISO et JJ/MM/AAAA', () => {
    expect(parseDateIso('2027-03-15')).toBe('2027-03-15');
    expect(parseDateIso('2027-03-15T10:00:00Z')).toBe('2027-03-15');
    expect(parseDateIso('15/03/2027')).toBe('2027-03-15');
  });
  it('refuse une date impossible ou un texte', () => {
    expect(parseDateIso('2027-02-30')).toBeNull();
    expect(parseDateIso('demain')).toBeNull();
    expect(parseDateIso(42)).toBeNull();
    expect(parseDateIso('')).toBeNull();
  });
});

describe('statutQualification', () => {
  it('valide au-delà de 60 jours', () => {
    expect(statutQualification({ date_fin: '2027-03-01' }, TODAY)).toBe('valide');
  });
  it('expire bientôt dans les 60 jours, borne comprise, jour même compris', () => {
    expect(statutQualification({ date_fin: '2026-12-01' }, TODAY)).toBe('bientot'); // 60 jours
    expect(statutQualification({ date_fin: TODAY }, TODAY)).toBe('bientot');
  });
  it('expirée dès la veille', () => {
    expect(statutQualification({ date_fin: '2026-10-01' }, TODAY)).toBe('expiree');
  });
  it('sans date, ni valide ni expirée', () => {
    expect(statutQualification({ date_fin: null }, TODAY)).toBe('sans_date');
  });
  it('joursAvant est négatif pour une date passée', () => {
    expect(joursAvant('2026-10-01', TODAY)).toBe(-1);
  });
});

describe('resumeQualifications', () => {
  it('« aucune » sans qualification', () => {
    expect(resumeQualifications([], TODAY)).toMatchObject({ statut: 'aucune', total: 0, verifiee: false });
  });
  it('retient la meilleure : une qualification valide suffit même si une autre est expirée', () => {
    const r = resumeQualifications([
      q({ id: 'vieux', date_fin: '2025-01-01' }),
      q({ id: 'bon', reference: '3112', date_fin: '2027-06-01' }),
    ], TODAY);
    expect(r.statut).toBe('valide');
    expect(r.principale?.id).toBe('bon');
    expect(r.total).toBe(2);
  });
  it('à statut égal, Qualibat passe avant un autre organisme', () => {
    const r = resumeQualifications([
      q({ id: 'rge', organisme: 'rge', date_fin: '2028-01-01' }),
      q({ id: 'qb', date_fin: '2027-06-01' }),
    ], TODAY);
    expect(r.principale?.id).toBe('qb');
  });
  it('signale si l\'une a été vérifiée', () => {
    expect(resumeQualifications([q({ verified_at: '2026-09-01T00:00:00Z' })], TODAY).verifiee).toBe(true);
  });
  it('parContact regroupe', () => {
    const g = parContact([q({ id: '1' }), q({ id: '2', contact_id: 'c2' }), q({ id: '3' })]);
    expect(Object.keys(g).sort()).toEqual(['c1', 'c2']);
    expect(g.c1).toHaveLength(2);
  });
});

describe('SIRET', () => {
  it('nettoie les espaces', () => {
    expect(normaliserSiret('552 081 317 00014')).toBe('55208131700014');
  });
  it('valide une clé de Luhn correcte', () => {
    expect(siretValide('55208131700018')).toBe(true);
    expect(siretValide('552 081 317 00018')).toBe(true);
  });
  it('refuse une clé fausse, une longueur fausse', () => {
    expect(siretValide('55208131700014')).toBe(false);
    expect(siretValide('5520813170001')).toBe(false);
    expect(siretValide('')).toBe(false);
  });
  it('applique l\'exception de La Poste', () => {
    expect(siretValide('35600000000001')).toBe(true);  // somme des chiffres : 15
    expect(siretValide('35600000000005')).toBe(false); // somme des chiffres : 19
  });
});

describe('validerQualification', () => {
  it('accepte une saisie complète et normalise', () => {
    const r = validerQualification({ organisme: 'qualibat', reference: ' 2111 ', date_fin: '15/03/2027', libelle: 'Maçonnerie' });
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ organisme: 'qualibat', reference: '2111', date_fin: '2027-03-15', libelle: 'Maçonnerie', date_debut: null }) });
  });
  it('refuse un organisme inconnu', () => {
    expect(validerQualification({ organisme: 'bidon' })).toMatchObject({ ok: false });
  });
  it('refuse une date impossible et une fin avant le début', () => {
    expect(validerQualification({ organisme: 'rge', date_fin: '2027-13-01' })).toMatchObject({ ok: false });
    expect(validerQualification({ organisme: 'rge', date_debut: '2027-05-01', date_fin: '2027-01-01' })).toMatchObject({ ok: false });
  });
  it('en modification partielle, ne touche pas aux champs absents', () => {
    const r = validerQualification({ date_fin: '2028-01-01' }, { partiel: true });
    expect(r).toEqual({ ok: true, value: { date_fin: '2028-01-01' } });
  });
  it('en modification partielle, une date vide efface', () => {
    const r = validerQualification({ date_fin: '' }, { partiel: true });
    expect(r).toEqual({ ok: true, value: { date_fin: null } });
  });
});

describe('formaterDate', () => {
  it('met en forme JJ/MM/AAAA', () => {
    expect(formaterDate('2027-03-05')).toBe('05/03/2027');
    expect(formaterDate('2027-03-05T23:30:00Z')).toBe('05/03/2027');
  });
  it('rend une chaîne vide pour une valeur absente ou invalide', () => {
    expect(formaterDate(null)).toBe('');
    expect(formaterDate('n/a')).toBe('');
  });
});
