import { describe, it, expect } from 'vitest';
import {
  parseFrenchNumber, normalizeText, normalizeNumero, diceSimilarity,
  detectHeader, analyserClasseur, rapprocher, type FeuilleBrute, type LigneImportee,
} from '../bpuImport';
import type { BPU } from '../../types/bpu';

// ── Le bordereau de référence ────────────────────────────────────────────────
const art = (id: string, ref: string, numero: string, designation: string, unite: string, q: number, pu: number, children?: any[]) => ({
  id, refBpu: ref, numero, designation, unite,
  quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const,
  ...(children ? { children } : {}),
});

const makeBpu = (): BPU => ({
  id: 'b1', projectId: 'p1', titre: 'BPU', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft',
  marche: { typeMarche: 'bons_de_commande' }, tranches: [], prixEnLettres: false,
  totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 0,
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [
        art('a1', 'A01', '01.1.1', 'Béton de propreté', 'm3', 10, 100),
        art('a2', 'A02', '01.1.2', 'Semelle filante armée', 'ml', 40, 55),
        art('a3', 'A03', '01.1.3', 'Coffrage de longrine', 'm2', 25, 30),
      ],
    }],
  }],
});

describe('parseFrenchNumber', () => {
  it('lit les formats français et anglo-saxons', () => {
    expect(parseFrenchNumber('1 234,56')).toBe(1234.56);
    expect(parseFrenchNumber('1.234,56')).toBe(1234.56);
    expect(parseFrenchNumber('1,234.56')).toBe(1234.56);
    expect(parseFrenchNumber('1234.56')).toBe(1234.56);
    expect(parseFrenchNumber('12,5')).toBe(12.5);
    expect(parseFrenchNumber(42)).toBe(42);
  });

  it('distingue un point décimal d’un séparateur de milliers', () => {
    expect(parseFrenchNumber('1.234')).toBe(1234);
    expect(parseFrenchNumber('1.500.000')).toBe(1500000);
    expect(parseFrenchNumber('12.5')).toBe(12.5);
  });

  it('supporte les espaces insécables et le bruit monétaire', () => {
    expect(parseFrenchNumber('1 234,56 €')).toBe(1234.56);
    expect(parseFrenchNumber('1 234,56')).toBe(1234.56);
    expect(parseFrenchNumber('12,50 €/m²')).toBe(12.5);
    expect(parseFrenchNumber('55,00 EUR HT')).toBe(55);
  });

  it('rend null, et jamais zéro, quand rien n’est chiffré', () => {
    // « pour mémoire » est une réponse d’entreprise, pas un prix de zéro euro.
    for (const v of ['', '-', '—', 'néant', 'PM', 'p.m.', 'sans objet', 'N/A', null, undefined]) {
      expect(parseFrenchNumber(v)).toBeNull();
    }
    // Un zéro explicitement écrit reste, lui, un zéro.
    expect(parseFrenchNumber('0')).toBe(0);
    expect(parseFrenchNumber('0,00 €')).toBe(0);
  });

  it('ne se laisse pas prendre par du texte', () => {
    expect(parseFrenchNumber('à définir')).toBeNull();
    expect(parseFrenchNumber('voir mémoire technique')).toBeNull();
  });
});

describe('normalisations', () => {
  it('retire accents, casse et ponctuation', () => {
    expect(normalizeText('Béton de propreté (dosé à 150 kg/m³)'))
      .toBe('beton de proprete dose a 150 kg m3');
    // m² et m2 doivent se rapprocher : les deux graphies coexistent partout.
    expect(normalizeText('m²')).toBe(normalizeText('m2'));
    expect(normalizeText('  DOUBLE   espace ')).toBe('double espace');
  });

  it('normalise les numéros à zéros de tête', () => {
    expect(normalizeNumero('1.02.3')).toBe('1.2.3');
    expect(normalizeNumero('01.1.1')).toBe('1.1.1');
    expect(normalizeNumero('1-2-3')).toBe('1.2.3');
    expect(normalizeNumero('01.1.1.')).toBe('1.1.1');
  });

  it('mesure une similarité exploitable', () => {
    expect(diceSimilarity('Béton de propreté', 'beton de proprete')).toBe(1);
    expect(diceSimilarity('Semelle filante armée', 'Semelle filante armee BA')).toBeGreaterThan(0.8);
    expect(diceSimilarity('Béton de propreté', 'Coffrage de longrine')).toBeLessThan(0.5);
  });
});

describe('detectHeader', () => {
  it('trouve la ligne d’en-tête au milieu du préambule', () => {
    const grid = [
      ['Chantier Untel'], [], ['Bordereau de prix'], [],
      ['Réf.', 'N°', 'Désignation', 'Unité', 'P.U. HT (€)'],
      ['A01', '01.1.1', 'Béton', 'm3', '100'],
    ];
    const d = detectHeader(grid)!;
    expect(d.headerRow).toBe(4);
    expect(d.columns).toMatchObject({ ref: 0, numero: 1, designation: 2, unite: 3, prixUnitaire: 4 });
  });

  it('accepte des libellés de colonne différents des nôtres', () => {
    const grid = [['Code', 'Libellé', 'U', 'Qté', 'Prix unitaire', 'Total']];
    const d = detectHeader(grid)!;
    expect(d.columns.numero).toBe(0);
    expect(d.columns.designation).toBe(1);
    expect(d.columns.prixUnitaire).toBe(4);
  });

  it('rend null quand rien n’est exploitable', () => {
    expect(detectHeader([['a', 'b'], ['c', 'd']])).toBeNull();
  });
});

// ── Le fichier tel qu’il revient ─────────────────────────────────────────────

const HEADER = ['Réf.', 'N°', 'Désignation', 'Unité', 'P.U. HT (€)'];
const feuille = (rows: any[][], nom = 'BPU', merges?: any[]): FeuilleBrute => ({ nom, grid: rows, merges });

describe('analyserClasseur', () => {
  it('rapproche par référence le fichier renvoyé tel quel', () => {
    const r = analyserClasseur([feuille([
      ['Chantier'], [], HEADER,
      ['#L1', '01', 'Gros œuvre', '', ''],
      ['#C1.1', '01.1', 'Fondations', '', ''],
      ['A01', '01.1.1', 'Béton de propreté', 'm3', '110,00'],
      ['A02', '01.1.2', 'Semelle filante armée', 'ml', '60,00'],
      ['A03', '01.1.3', 'Coffrage de longrine', 'm2', '28,50'],
    ])], makeBpu());

    expect(r.rapprochements).toHaveLength(3);
    expect(r.rapprochements.every(x => x.method === 'ref' && x.confiance === 'exacte')).toBe(true);
    expect(r.nonAppariees).toHaveLength(0);
    expect(r.nonChiffres).toHaveLength(0);
    // 110x10 + 60x40 + 28,50x25 = 1100 + 2400 + 712,50
    expect(r.totalOffreHT).toBeCloseTo(4212.5, 2);
  });

  it('écarte les lignes de structure sans les compter comme non appariées', () => {
    const r = analyserClasseur([feuille([
      HEADER,
      ['#L1', '01', 'Gros œuvre', '', ''],
      ['', '', 'Sous-total du lot', '', ''],
      ['A01', '01.1.1', 'Béton de propreté', 'm3', '110'],
    ])], makeBpu());
    expect(r.rapprochements).toHaveLength(1);
    expect(r.nonAppariees).toHaveLength(0);
  });

  it('retrouve les articles malgré un réordonnancement et une ligne insérée', () => {
    const r = analyserClasseur([feuille([
      HEADER,
      ['A03', '01.1.3', 'Coffrage de longrine', 'm2', '28,50'],
      ['', '', 'Installation de chantier (ajout du candidat)', 'ft', '900'],
      ['A01', '01.1.1', 'Béton de propreté', 'm3', '110'],
      ['A02', '01.1.2', 'Semelle filante armée', 'ml', '60'],
    ])], makeBpu());

    expect(r.rapprochements).toHaveLength(3);
    expect(r.nonAppariees).toHaveLength(1);
    expect(r.nonAppariees[0].designation).toContain('Installation de chantier');
  });

  it('retombe sur le numéro quand la colonne Réf. a disparu', () => {
    const r = analyserClasseur([feuille([
      ['N°', 'Désignation', 'Unité', 'Prix unitaire'],
      ['01.1.1', 'Béton de propreté', 'm3', '110'],
      ['1.1.2', 'Semelle filante armée', 'ml', '60'],  // zéro de tête retiré
    ])], makeBpu());

    expect(r.rapprochements).toHaveLength(2);
    expect(r.rapprochements.map(x => x.method)).toEqual(['numero', 'numero']);
    expect(r.rapprochements.every(x => x.confiance === 'haute')).toBe(true);
  });

  it('retombe sur la désignation quand ni référence ni numéro ne suivent', () => {
    const r = analyserClasseur([feuille([
      ['Désignation', 'Unité', 'P.U.'],
      ['BÉTON DE PROPRETÉ', 'm3', '110'],
    ])], makeBpu());
    expect(r.rapprochements[0].method).toBe('designation');
    expect(r.rapprochements[0].articleId).toBe('a1');
  });

  it('rapproche une désignation légèrement modifiée, en confiance basse', () => {
    const r = analyserClasseur([feuille([
      ['Désignation', 'Unité', 'P.U.'],
      ['Semelle filante armée BA', 'ml', '60'],
    ])], makeBpu());
    expect(r.rapprochements).toHaveLength(1);
    expect(r.rapprochements[0].method).toBe('approximatif');
    expect(r.rapprochements[0].confiance).toBe('basse');
    expect(r.rapprochements[0].alertes).toContain('Désignation modifiée par le candidat');
  });

  it('ne rapproche pas deux lignes sur le même article', () => {
    const r = analyserClasseur([feuille([
      HEADER,
      ['A01', '01.1.1', 'Béton de propreté', 'm3', '110'],
      ['A01', '01.1.1', 'Béton de propreté (doublon)', 'm3', '120'],
    ])], makeBpu());
    expect(r.rapprochements).toHaveLength(1);
    expect(r.rapprochements[0].prixUnitaire).toBe(110);
    expect(r.nonAppariees).toHaveLength(1);
  });

  it('lit un fichier scindé en plusieurs feuilles', () => {
    const r = analyserClasseur([
      feuille([HEADER, ['A01', '01.1.1', 'Béton de propreté', 'm3', '110']], 'Lot 01'),
      feuille([HEADER, ['A02', '01.1.2', 'Semelle filante armée', 'ml', '60']], 'Lot 02'),
    ], makeBpu());
    expect(r.rapprochements).toHaveLength(2);
    expect(r.rapprochements.map(x => x.source.feuille)).toEqual(['Lot 01', 'Lot 02']);
  });

  it('résout les cellules fusionnées', () => {
    const r = analyserClasseur([feuille(
      [HEADER, ['A01', '01.1.1', 'Béton de propreté', 'm3', '110'], ['A02', '01.1.2', '', 'ml', '60']],
      'BPU',
      // Le candidat a fusionné la désignation sur deux lignes.
      [{ s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }],
    )], makeBpu());
    expect(r.rapprochements).toHaveLength(2);
  });

  it('signale les postes non chiffrés sans les compter à zéro', () => {
    const r = analyserClasseur([feuille([
      HEADER,
      ['A01', '01.1.1', 'Béton de propreté', 'm3', '110'],
      ['A02', '01.1.2', 'Semelle filante armée', 'ml', 'PM'],
    ])], makeBpu());

    const a02 = r.rapprochements.find(x => x.articleId === 'a2')!;
    expect(a02.prixUnitaire).toBeNull();
    expect(a02.alertes).toContain('Poste non chiffré');
    // A03 n’apparaît pas du tout dans le fichier.
    expect(r.nonChiffres.map(x => x.id)).toEqual(['a3']);
    // Un poste non chiffré ne pèse pas dans le total.
    expect(r.totalOffreHT).toBe(1100);
  });

  it('alerte sur un prix aberrant, une unité et une quantité modifiées', () => {
    const r = analyserClasseur([feuille([
      ['Réf.', 'N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)'],
      ['A01', '01.1.1', 'Béton de propreté', 'm2', '99', '9000'],
    ])], makeBpu());

    const alertes = r.rapprochements[0].alertes.join(' | ');
    expect(alertes).toContain('Unité différente');
    expect(alertes).toContain('Quantité modifiée');
    expect(alertes).toContain('Prix très éloigné');
  });

  it('vérifie la feuille technique quand elle a survécu', () => {
    const meta = feuille([['schema_version', 1], ['bpu_id', 'b1'], ['version', '1.0']], '_meta');
    const ok = analyserClasseur([feuille([HEADER, ['A01', '01.1.1', 'Béton', 'm3', '110']]), meta], makeBpu());
    expect(ok.meta.correspond).toBe(true);
    expect(ok.meta.bpuId).toBe('b1');

    const autre = feuille([['schema_version', 1], ['bpu_id', 'autre-bpu']], '_meta');
    const ko = analyserClasseur([feuille([HEADER, ['A01', '01.1.1', 'Béton', 'm3', '110']]), autre], makeBpu());
    expect(ko.meta.correspond).toBe(false);
  });

  it('fonctionne sans la feuille technique, disparue à un enregistrement CSV', () => {
    const r = analyserClasseur([feuille([HEADER, ['A01', '01.1.1', 'Béton', 'm3', '110']])], makeBpu());
    expect(r.meta.correspond).toBe(true);
    expect(r.rapprochements).toHaveLength(1);
  });
});

describe('rapprocher', () => {
  it('ne chiffre pas un article parent, qui porte la somme de ses enfants', () => {
    const bpu = makeBpu();
    bpu.lots[0].chapitres[0].lignes[1].children = [
      art('a2a', 'A02a', '01.1.2.1', 'Semelle sous poteau', 'u', 4, 80),
    ];
    const lignes: LigneImportee[] = [{
      feuille: 'BPU', rowIndex: 1, ref: 'A02a', numero: '01.1.2.1',
      designation: 'Semelle sous poteau', unite: 'u', quantite: 4, prixUnitaire: 90,
    }];
    const r = rapprocher(lignes, bpu);
    expect(r.rapprochements).toHaveLength(1);
    expect(r.rapprochements[0].articleId).toBe('a2a');
    // Le parent a2 n’est pas listé comme non chiffré : il ne se chiffre pas.
    expect(r.nonChiffres.map(x => x.id)).toEqual(['a1', 'a3']);
  });
});
