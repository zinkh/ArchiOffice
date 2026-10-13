import { describe, it, expect } from 'vitest';
import { lotPourLigne, postesDepuisLignes, montantPoste, totalPostesAjoutes, ajouterLignesAuDocument } from '../postesAjoutes';
import { versComparatif } from '../bpuToAct';
import type { Lot, OffreDocument } from '../../types/dpgf';
import type { LigneImportee } from '../bpuImport';

const ligne = (numero: string, designation: string, over: Partial<LigneImportee> = {}): LigneImportee => ({
  feuille: 'F', rowIndex: 1, ref: '', numero, designation, unite: 'ens', quantite: null, prixUnitaire: 100, ...over,
});

const lots = (): Lot[] => [
  { id: 'l1', numero: '01', titre: 'Démolition', sousTotal: 0, projectLotId: 'pl1', chapitres: [] },
  { id: 'l2', numero: '02', titre: 'Gros œuvre', sousTotal: 0, projectLotId: 'pl2', chapitres: [] },
];

describe('lotPourLigne', () => {
  it('prend le lot du premier segment du numéro, zéros initiaux ignorés', () => {
    expect(lotPourLigne('02.05', lots())).toBe('l2');
    expect(lotPourLigne('1.3', lots())).toBe('l1');
  });
  it('retombe sur le lot précédent, puis sur le premier lot', () => {
    expect(lotPourLigne('', lots(), 'l2')).toBe('l2');
    expect(lotPourLigne('99.1', lots())).toBe('l1');
    expect(lotPourLigne('1', [])).toBeUndefined();
  });
});

describe('postes ajoutés', () => {
  it('range une suite de lignes sans numéro avec leur voisine', () => {
    const p = postesDepuisLignes([ligne('02.01', 'A'), ligne('', 'B')], lots());
    expect(p.map(x => x.lotId)).toEqual(['l2', 'l2']);
  });
  it("sans quantité annoncée un poste vaut 1, sans prix il ne vaut rien", () => {
    const [a, b] = postesDepuisLignes([ligne('01.1', 'A', { prixUnitaire: 250 }), ligne('01.2', 'B', { prixUnitaire: null })], lots());
    expect(montantPoste(a)).toBe(250);
    expect(montantPoste(b)).toBe(0);
    expect(totalPostesAjoutes([a, b])).toBe(250);
  });
});

describe('versComparatif et postes ajoutés', () => {
  const offre: OffreDocument = {
    id: 'o1', entrepriseId: 'e1', entrepriseNom: 'Dupont SARL', dateReception: '2026-01-01',
    fichierNom: 'x.xlsx', importedAt: '2026-01-01', documentVersion: '1', prix: {}, anomalies: [], statut: 'validee',
  };
  it('verse le poste sous son lot, marqué par l\'entreprise, et l\'ajoute au sous-total', () => {
    const postes = postesDepuisLignes([ligne('02.07', 'Marche escalier', { quantite: 2, prixUnitaire: 300 })], lots());
    const { comparatif } = versComparatif(lots(), [{ ...offre, postesAjoutes: postes }]);
    const lot2 = comparatif.find(c => c.lot_id === 'pl2')!;
    const ajout = lot2.articles.find(a => a.ajoute_par)!;
    expect(ajout).toMatchObject({ code: '02.07', titre: 'Marche escalier', ajoute_par: 'Dupont SARL' });
    expect(ajout.prix.e1).toBe(600);
    expect(lot2.articles.find(a => a.is_subtotal)!.prix.e1).toBe(600);
    // L'autre lot n'est pas touché.
    expect(comparatif.find(c => c.lot_id === 'pl1')!.articles.some(a => a.ajoute_par)).toBe(false);
  });
  it("n'ajoute rien pour une offre écartée", () => {
    const postes = postesDepuisLignes([ligne('02.07', 'X')], lots());
    const { comparatif } = versComparatif(lots(), [{ ...offre, statut: 'ecartee', postesAjoutes: postes }]);
    expect(comparatif[1].articles.some(a => a.ajoute_par)).toBe(false);
  });
});

describe('ajouterLignesAuDocument', () => {
  it('crée lots, chapitres et articles, et complète un lot existant sans le dupliquer', () => {
    const src = [
      ligne('01.01', 'Installation', { quantite: 1, prixUnitaire: 500 }),
      ligne('01.02', 'Repérage'),
      ligne('03.02.01', 'Chevêtre', { quantite: 2, prixUnitaire: 10 }),
    ];
    const { lots: res, ajoutes } = ajouterLignesAuDocument(lots(), src);
    expect(ajoutes).toBe(3);
    expect(res.map(l => l.numero)).toEqual(['01', '02', '03']);
    expect(res[0].chapitres[0].lignes.map(l => l.designation)).toEqual(['Installation', 'Repérage']);
    expect(res[0].sousTotal).toBe(500); // sans quantité, « Repérage » ne vaut rien
    expect(res[2].chapitres[0].lignes[0]).toMatchObject({ numero: '03.02.01', prixTotal: 20 });
  });
  it("ne modifie pas le document d'origine", () => {
    const base = lots();
    ajouterLignesAuDocument(base, [ligne('01.01', 'A')]);
    expect(base[0].chapitres).toHaveLength(0);
  });
});
