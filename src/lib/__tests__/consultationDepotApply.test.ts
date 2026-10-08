import { describe, expect, it } from 'vitest';
import { appliquerSaisie, apercuSaisie, saisieIntegrable, type ConsultationApplicable, type DepotSaisie } from '../consultationDepotApply';

let n = 0;
const genererId = () => `id-${++n}`;

const base = (): ConsultationApplicable => ({
  entreprises: [
    { id: 'e1', nom: 'Dupont' },
    { id: 'e2', nom: 'Martin', ne_repond_pas: true },
  ],
  offres: [],
  negociations: [],
});

const depot = (over: Partial<DepotSaisie> = {}): DepotSaisie => ({
  id: 'd1', entreprise_id: 'e1', lot_id: 'lot1', received_at: '2026-10-08T21:30:00.000Z',
  payload: { montant_base: 12000, lignes: [] },
  ...over,
});

describe('apercuSaisie', () => {
  it('annonce une offre ajoutée quand le couple lot x entreprise est neuf', () => {
    expect(apercuSaisie(base(), depot())).toMatchObject({ action: 'ajoutee', nouveauMontant: 12000, ancienMontant: undefined });
  });

  it("annonce la mise à jour avec l'ancien montant", () => {
    const c = base();
    c.offres = [{ id: 'o1', lot_id: 'lot1', entreprise_id: 'e1', montant_base: 11000, note_technique: 7, conforme: true }];
    expect(apercuSaisie(c, depot())).toMatchObject({ action: 'mise_a_jour', ancienMontant: 11000 });
  });

  it('reconnaît un montant identique', () => {
    const c = base();
    c.offres = [{ id: 'o1', lot_id: 'lot1', entreprise_id: 'e1', montant_base: 12000, note_technique: 0, conforme: true }];
    expect(apercuSaisie(c, depot())?.action).toBe('identique');
  });

  it('rend null pour une remise sans lot ou une entreprise retirée', () => {
    expect(apercuSaisie(base(), depot({ lot_id: null }))).toBeNull();
    expect(apercuSaisie(base(), depot({ entreprise_id: 'inconnue' }))).toBeNull();
    expect(saisieIntegrable(base(), depot({ lot_id: null }))).toBe(false);
  });

  it('décrit chaque option et variante', () => {
    const d = depot({ payload: { montant_base: 100, lignes: [{ kind: 'option', libelle: 'Isolation', montant: 50 }, { kind: 'variante', libelle: 'Zinc', montant: 40 }] } });
    expect(apercuSaisie(base(), d)?.lignes.map(l => [l.kind, l.action])).toEqual([['option', 'ajoutee'], ['variante', 'ajoutee']]);
  });
});

describe('appliquerSaisie', () => {
  it("crée l'offre de base, conforme, sans note technique", () => {
    const r = appliquerSaisie(base(), depot(), { genererId });
    expect(r.offres).toHaveLength(1);
    expect(r.offres[0]).toMatchObject({ lot_id: 'lot1', entreprise_id: 'e1', montant_base: 12000, conforme: true, note_technique: 0 });
  });

  it("met à jour l'offre existante sans toucher à sa note ni à sa conformité", () => {
    const c = base();
    c.offres = [{ id: 'o1', lot_id: 'lot1', entreprise_id: 'e1', montant_base: 11000, note_technique: 7, conforme: false, motif_nc: 'x' }];
    const r = appliquerSaisie(c, depot(), { genererId });
    expect(r.offres).toEqual([{ id: 'o1', lot_id: 'lot1', entreprise_id: 'e1', montant_base: 12000, note_technique: 7, conforme: false, motif_nc: 'x' }]);
  });

  it('ne mute pas la consultation reçue', () => {
    const c = base();
    const copie = JSON.stringify(c);
    appliquerSaisie(c, depot(), { genererId });
    expect(JSON.stringify(c)).toBe(copie);
  });

  it("date l'offre reçue au jour de la remise (heure de Paris) sans écraser une date saisie", () => {
    const r = appliquerSaisie(base(), depot(), { genererId });
    // 21 h 30 UTC le 8 octobre = 23 h 30 à Paris, toujours le 8.
    expect(r.entreprises.find(e => e.id === 'e1')?.offre_recue_le).toBe('2026-10-08');
    const c = base();
    c.entreprises[0].offre_recue_le = '2026-10-01';
    expect(appliquerSaisie(c, depot(), { genererId }).entreprises[0].offre_recue_le).toBe('2026-10-01');
  });

  it('une entreprise qui remet une offre ne « ne répond plus »', () => {
    const r = appliquerSaisie(base(), depot({ entreprise_id: 'e2' }), { genererId });
    expect(r.entreprises.find(e => e.id === 'e2')?.ne_repond_pas).toBe(false);
  });

  it("verse options et variantes dans la négociation, au prix d'ouverture", () => {
    const d = depot({ payload: { montant_base: 100, lignes: [{ kind: 'option', libelle: 'Isolation', montant: 50 }, { kind: 'variante', libelle: 'Zinc', montant: 40 }] } });
    const r = appliquerSaisie(base(), d, { genererId });
    const neg = r.negociations!.find(x => x.lot_id === 'lot1' && x.entreprise_id === 'e1')!;
    expect(neg.lignes.map(l => [l.kind, l.libelle, l.montant_ouverture])).toEqual([['option', 'Isolation', 50], ['variante', 'Zinc', 40]]);
    expect(neg.tours).toEqual([]);
  });

  it('rejouer une version plus récente met à jour les lignes au lieu de les dupliquer', () => {
    const v1 = depot({ payload: { montant_base: 100, lignes: [{ kind: 'option', libelle: 'Isolation', montant: 50 }] } });
    const v2 = depot({ id: 'd2', payload: { montant_base: 90, lignes: [{ kind: 'option', libelle: ' isolation ', montant: 45 }] } });
    const r = appliquerSaisie(appliquerSaisie(base(), v1, { genererId }), v2, { genererId });
    const neg = r.negociations!.find(x => x.lot_id === 'lot1')!;
    expect(neg.lignes).toHaveLength(1);
    expect(neg.lignes[0].montant_ouverture).toBe(45);
    expect(r.offres).toHaveLength(1);
    expect(r.offres[0].montant_base).toBe(90);
  });

  it("conserve les tours de négociation déjà saisis", () => {
    const c = base();
    c.negociations = [{ lot_id: 'lot1', entreprise_id: 'e1', lignes: [], tours: [{ id: 't1', date: '2026-10-05', montants: { base: 11000 } }] }];
    const d = depot({ payload: { montant_base: 12000, lignes: [{ kind: 'option', libelle: 'A', montant: 1 }] } });
    const neg = appliquerSaisie(c, d, { genererId }).negociations![0];
    expect(neg.tours).toHaveLength(1);
  });

  it("reporte délai et observations sans écraser la remarque de l'architecte", () => {
    const d = depot({ payload: { montant_base: 100, lignes: [], delai_semaines: 8, observations: 'Sous réserve du site.' } });
    const r = appliquerSaisie(base(), d, { genererId });
    expect(r.negociations![0].remarque_verification).toContain('8 semaines');
    expect(r.negociations![0].remarque_verification).toContain('Sous réserve du site.');

    const c = base();
    c.negociations = [{ lot_id: 'lot1', entreprise_id: 'e1', lignes: [], tours: [], remarque_verification: 'Vérifié par moi' }];
    expect(appliquerSaisie(c, d, { genererId }).negociations![0].remarque_verification).toBe('Vérifié par moi');
  });

  it('ne change rien pour une remise non intégrable', () => {
    const c = base();
    expect(appliquerSaisie(c, depot({ lot_id: null }), { genererId })).toBe(c);
  });
});
