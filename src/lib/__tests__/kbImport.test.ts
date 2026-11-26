// Import dans la base de données du cabinet : src/lib/kbImport.ts (types, cellules, colonnes, lots).
import { describe, expect, it } from 'vitest';
import type { KbProperty } from '../kb';
import {
  buildImportRows, convertImportCell, inferImportType, parseCheckboxCell, parseDateCell, parseNumberCell,
  proposeImportColumns, splitLabels, toImportRequests, validateImportColumns,
} from '../kbImport';

const fabricants = [
  ['Nom', 'Produits', 'Texte'],
  ['La Rochère', 'Construction vitrée, Pavés de verre', 'Localisation: Adresse postale 123 Rue de La Rochère'],
  ['SOTTAS', 'Construction vitrée, Structure métallique', 'Adresse postale de SOTTAS : Rue de la Gare 12, 1003 Lausanne'],
  ['FPEE', 'Menuiseries Extérieures Al, Menuiseries Extérieures B', 'Adresse : 2 rue Henri Vallée – CS 20002, 72000 Le Mans'],
];

describe('parseNumberCell', () => {
  it('lit les formats français et anglais', () => {
    expect(parseNumberCell('1 234,56')).toBe(1234.56);
    expect(parseNumberCell('1.234,56')).toBe(1234.56);
    expect(parseNumberCell('1,234.56')).toBe(1234.56);
    expect(parseNumberCell('12,5')).toBe(12.5);
    expect(parseNumberCell('-7')).toBe(-7);
    expect(parseNumberCell('1.234.567')).toBe(1234567);
  });
  it('laisse en texte un code à zéro initial, un mot ou une cellule vide', () => {
    expect(parseNumberCell('0684016633')).toBeNull();
    expect(parseNumberCell('abc')).toBeNull();
    expect(parseNumberCell('12 rue')).toBeNull();
    expect(parseNumberCell('')).toBeNull();
    expect(parseNumberCell('0,5')).toBe(0.5);
  });
});

describe('parseDateCell', () => {
  it('rend AAAA-MM-JJ pour les formats courants', () => {
    expect(parseDateCell('2026-11-26')).toBe('2026-11-26');
    expect(parseDateCell('2026-11-26T10:00:00Z')).toBe('2026-11-26');
    expect(parseDateCell('26/11/2026')).toBe('2026-11-26');
    expect(parseDateCell('5.1.2027')).toBe('2027-01-05');
    expect(parseDateCell('26 novembre 2026')).toBe('2026-11-26');
    expect(parseDateCell('1er janvier 2026')).toBe('2026-01-01');
    expect(parseDateCell('November 26, 2026')).toBe('2026-11-26');
  });
  it('refuse une date impossible ou un texte', () => {
    expect(parseDateCell('31/02/2026')).toBeNull();
    expect(parseDateCell('demain')).toBeNull();
    expect(parseDateCell('')).toBeNull();
  });
});

describe('cases à cocher et étiquettes', () => {
  it('lit oui/non et vrai/faux', () => {
    expect(parseCheckboxCell('Oui')).toBe(true);
    expect(parseCheckboxCell('FAUX')).toBe(false);
    expect(parseCheckboxCell('peut-être')).toBeNull();
  });
  it('découpe sur virgule, point-virgule et retour à la ligne, sans doublon', () => {
    expect(splitLabels('A, B; a\nC')).toEqual(['A', 'B', 'C']);
    expect(splitLabels('  ')).toEqual([]);
  });
});

describe('inferImportType', () => {
  it('reconnaît chaque type de colonne', () => {
    expect(inferImportType(['12', '3,5', ''])).toBe('number');
    expect(inferImportType(['26/11/2026', '2026-01-02'])).toBe('date');
    expect(inferImportType(['oui', 'non', 'oui'])).toBe('checkbox');
    expect(inferImportType(['https://aazs.fr', 'www.exemple.fr'])).toBe('url');
    expect(inferImportType(['0684016633', '0383123456'])).toBe('text');
    expect(inferImportType(['', ''])).toBe('text');
  });

  it('reconnaît la multi-sélection « Produits » de Notion et laisse l\'adresse en texte', () => {
    const produits = fabricants.slice(1).map(r => r[1]);
    const texte = fabricants.slice(1).map(r => r[2]);
    expect(inferImportType(produits)).toBe('multi_select');
    expect(inferImportType(texte)).toBe('text');
  });

  it('propose un choix unique pour une colonne de valeurs répétées', () => {
    expect(inferImportType(['Gros œuvre', 'Couverture', 'Gros œuvre', 'Couverture', 'Gros œuvre'])).toBe('select');
    expect(inferImportType(['Gros œuvre', 'Couverture'])).toBe('text');
  });
});

describe('convertImportCell', () => {
  it('convertit selon le type, null pour le vide ou l\'illisible', () => {
    expect(convertImportCell('1 234,5', 'number')).toBe(1234.5);
    // Illisible dans le type choisi : la valeur brute est gardée, le serveur refuse la ligne (rien n'est perdu en silence).
    expect(convertImportCell('abc', 'number')).toBe('abc');
    expect(convertImportCell('pas une date', 'date')).toBe('pas une date');
    expect(convertImportCell('peut-être', 'checkbox')).toBe('peut-être');
    expect(convertImportCell('26/11/2026', 'date')).toBe('2026-11-26');
    expect(convertImportCell('Oui', 'checkbox')).toBe(true);
    expect(convertImportCell('A, B', 'multi_select')).toEqual(['A', 'B']);
    expect(convertImportCell('A, B', 'select')).toBe('A');
    expect(convertImportCell('  texte  ', 'text')).toBe('texte');
    expect(convertImportCell('   ', 'text')).toBeNull();
  });
});

describe('proposeImportColumns et buildImportRows', () => {
  it('propose le titre, les types et garde toutes les colonnes pour un export Notion « Fabricants »', () => {
    const columns = proposeImportColumns(fabricants);
    expect(columns.map(c => [c.name, c.type, c.include])).toEqual([
      ['Nom', 'title', true], ['Produits', 'multi_select', true], ['Texte', 'text', true],
    ]);
    const rows = buildImportRows(fabricants, columns);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      title: 'La Rochère',
      cells: { Produits: ['Construction vitrée', 'Pavés de verre'], Texte: 'Localisation: Adresse postale 123 Rue de La Rochère' },
    });
  });

  it('prend la première colonne pour titre sans en-tête « Nom », et nomme les colonnes sans en-tête', () => {
    const columns = proposeImportColumns([['Entreprise', '', 'Entreprise'], ['A', 'texte libre', 'autre texte']]);
    expect(columns.map(c => [c.name, c.type])).toEqual([['Entreprise', 'title'], ['Colonne 2', 'text'], ['Entreprise (2)', 'text']]);
  });

  it('rapproche une colonne existante (casse et accents ignorés) et garde son type', () => {
    const existing: KbProperty[] = [
      { id: 'p-nom', database_id: 'db', name: 'Nom', type: 'title', options: [], position: 0 },
      { id: 'p-prod', database_id: 'db', name: 'Produits', type: 'multi_select', options: [], position: 1 },
    ];
    const columns = proposeImportColumns([['nom', 'PRODUITS', 'Autre'], ['A', 'x', 'y']], existing);
    expect(columns[0]).toMatchObject({ existingId: 'p-nom', type: 'title', name: 'Nom' });
    expect(columns[1]).toMatchObject({ existingId: 'p-prod', type: 'multi_select' });
    expect(columns[2]).toMatchObject({ existingId: null });
  });

  it('ignore les colonnes décochées et les lignes vides, change le type à la demande', () => {
    const table = [['Nom', 'Prix', 'Note'], ['A', '12', 'une note'], ['', '', ''], ['B', 'abc', 'autre note']];
    const columns = proposeImportColumns(table).map(c => (c.name === 'Note' ? { ...c, include: false } : c));
    // « 12 » et « abc » : la colonne est proposée en texte, rien n'est perdu.
    expect(columns.find(c => c.name === 'Prix')!.type).toBe('text');
    expect(buildImportRows(table, columns)).toEqual([{ title: 'A', cells: { Prix: '12' } }, { title: 'B', cells: { Prix: 'abc' } }]);
    // Forcée en nombre : « abc » est gardé tel quel pour que l'import soit refusé, plutôt que perdu en silence.
    const asNumber = columns.map(c => (c.name === 'Prix' ? { ...c, type: 'number' as const } : c));
    expect(buildImportRows(table, asNumber)).toEqual([{ title: 'A', cells: { Prix: 12 } }, { title: 'B', cells: { Prix: 'abc' } }]);
  });
});

describe('validateImportColumns et toImportRequests', () => {
  it('exige un seul titre, des noms non vides et distincts', () => {
    const base = proposeImportColumns(fabricants);
    expect(validateImportColumns(base)).toBeNull();
    expect(validateImportColumns(base.map(c => ({ ...c, type: c.type === 'title' ? 'text' as const : c.type })))).toBe('title');
    expect(validateImportColumns(base.map(c => (c.name === 'Texte' ? { ...c, name: ' ' } : c)))).toBe('empty_name');
    expect(validateImportColumns(base.map(c => (c.name === 'Texte' ? { ...c, name: 'produits' } : c)))).toBe('duplicate_name');
  });

  it('refuse plus de 30 colonnes', () => {
    const header = Array.from({ length: 32 }, (_, i) => `C${i}`);
    expect(validateImportColumns(proposeImportColumns([header, header.map(() => 'x')]))).toBe('too_many_columns');
  });

  it('découpe en lots de 500 lignes qui portent chacun les colonnes', () => {
    const columns = proposeImportColumns(fabricants);
    const rows = Array.from({ length: 1201 }, (_, i) => ({ title: `L${i}`, cells: {} }));
    const requests = toImportRequests(columns, rows);
    expect(requests.map(r => r.rows.length)).toEqual([500, 500, 201]);
    expect(requests.every(r => r.columns.length === 2)).toBe(true);
    expect(requests[0].columns).toEqual([{ name: 'Produits', type: 'multi_select' }, { name: 'Texte', type: 'text' }]);
  });
});
