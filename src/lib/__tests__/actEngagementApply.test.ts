import { describe, expect, it } from 'vitest';
import { appliquerActeAuxOffres, nomComparable, type EntrepriseOffre, type OffreImportee } from '../actEngagementApply';
import type { ActeRempli } from '../actEngagementForm';

const lots = [{ id: 'L1', lot_number: '01', lot_title: 'Gros œuvre' }, { id: 'L2', lot_number: '02', lot_title: 'Charpente' }];
const contacts = [{ id: 'C1', siret: '123 456 789 00012', company_name: 'Bâti SAS' }];
let n = 0;
const opts = { aujourdhui: '2026-10-07', genererId: () => `id${++n}` };
const acte = (p: Partial<ActeRempli> = {}): ActeRempli => ({
  entreprise: { entreprise: 'BATI sas', siret: '12345678900012', email: 'a@b.fr' }, tvaPct: 20, fraisNonInclus: '', lieu: '', date: '',
  lots: [
    { numero: '01', candidat: true, prixHT: 48000, delaiMois: 3 },
    { numero: '02', candidat: false, prixHT: null, delaiMois: null },
  ], avertissements: [], ...p,
});
const vide = { entreprises: [] as EntrepriseOffre[], offres: [] as OffreImportee[] };

describe('import d\'un acte d\'engagement dans les offres', () => {
  it('compare les noms sans accents, casse ni forme juridique', () => {
    expect(nomComparable('Bâti, S.A.S.')).toBe(nomComparable('BATI sas'));
  });

  it('crée l\'entreprise (liée à sa fiche par le SIRET) et l\'offre', () => {
    const r = appliquerActeAuxOffres(vide, acte(), lots, contacts, opts);
    expect(r.entreprises).toHaveLength(1);
    expect(r.entreprises[0]).toMatchObject({ contact_id: 'C1', lots_ids: ['L1'], offre_recue_le: '2026-10-07', email: 'a@b.fr' });
    expect(r.offres[0]).toMatchObject({ lot_id: 'L1', montant_base: 48000, conforme: true });
    expect(r.resume.rapprochement).toBe('nouvelle');
  });

  it('retrouve une entreprise déjà consultée par son SIRET et met l\'offre à jour sans doublon', () => {
    const e: EntrepriseOffre = { id: 'E1', contact_id: 'C1', nom: 'Bâti', lots_ids: ['L1'], envoyer_dce: true };
    const o: OffreImportee = { id: 'O1', lot_id: 'L1', entreprise_id: 'E1', montant_base: 50000, note_technique: 12, conforme: true };
    const r = appliquerActeAuxOffres({ entreprises: [e], offres: [o] }, acte(), lots, contacts, opts);
    expect(r.entreprises).toHaveLength(1);
    expect(r.offres).toHaveLength(1);
    expect(r.offres[0]).toMatchObject({ id: 'O1', montant_base: 48000, note_technique: 12 });
    expect(r.resume).toMatchObject({ rapprochement: 'siret' });
    expect(r.resume.lots[0]).toMatchObject({ action: 'mise_a_jour', ancien: 50000 });
  });

  it('rapproche par le nom quand le SIRET est inconnu', () => {
    const e: EntrepriseOffre = { id: 'E2', nom: 'Couverture Martin SARL', lots_ids: [], envoyer_dce: true };
    const r = appliquerActeAuxOffres({ entreprises: [e], offres: [] }, acte({ entreprise: { entreprise: 'couverture martin' } }), lots, [], opts);
    expect(r.entreprises).toHaveLength(1);
    expect(r.entreprises[0].lots_ids).toEqual(['L1']);
    expect(r.resume.rapprochement).toBe('nom');
  });

  it('ignore un lot inconnu ou sans prix, et ne crée rien si rien n\'est exploitable', () => {
    const r = appliquerActeAuxOffres(vide, acte({ lots: [
      { numero: '99', candidat: true, prixHT: 10, delaiMois: null },
      { numero: '02', candidat: true, prixHT: null, delaiMois: null },
    ] }), lots, [], opts);
    expect(r.offres).toHaveLength(0);
    expect(r.entreprises).toHaveLength(0);
    expect(r.resume.ignores).toHaveLength(2);
  });
});
