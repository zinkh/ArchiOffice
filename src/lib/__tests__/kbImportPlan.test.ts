// Plan d'import dans la base de données : src/lib/kbImportPlan.ts (validation tout ou rien, colonnes, étiquettes).
import { describe, expect, it } from 'vitest';
import type { KbProperty } from '../kb';
import { planKbImport } from '../kbImportPlan';

let counter = 0;
const id = () => `id-${++counter}`;
const existingProps: KbProperty[] = [
  { id: 'p-nom', database_id: 'db', name: 'Nom', type: 'title', options: [], position: 0 },
  { id: 'p-prod', database_id: 'db', name: 'Produits', type: 'multi_select', options: [{ id: 'o-vitree', label: 'Construction vitrée', color: 'bleu' }], position: 1 },
];
const columns = [{ name: 'Produits', type: 'multi_select' }, { name: 'Texte', type: 'text' }];

describe('planKbImport : demande refusée en bloc', () => {
  it('refuse un corps mal formé, vide ou trop gros', () => {
    expect(planKbImport({}, existingProps, id).fatal).toMatch(/Colonnes manquantes/);
    expect(planKbImport({ columns, rows: [] }, existingProps, id).fatal).toMatch(/Aucune ligne/);
    expect(planKbImport({ columns, rows: Array.from({ length: 501 }, () => ({ title: 'x', cells: {} })) }, existingProps, id).fatal).toMatch(/Trop de lignes/);
    expect(planKbImport({ columns: Array.from({ length: 31 }, (_, i) => ({ name: `C${i}`, type: 'text' })), rows: [{ title: 'x', cells: {} }] }, existingProps, id).fatal).toMatch(/Trop de colonnes/);
  });

  it('refuse un nom vide, un type inconnu, un doublon, le nom du titre et un type qui change', () => {
    const rows = [{ title: 'x', cells: {} }];
    expect(planKbImport({ columns: [{ name: ' ', type: 'text' }], rows }, existingProps, id).fatal).toMatch(/vide/);
    expect(planKbImport({ columns: [{ name: 'A', type: 'formule' }], rows }, existingProps, id).fatal).toMatch(/Type de colonne inconnu/);
    expect(planKbImport({ columns: [{ name: 'A', type: 'title' }], rows }, existingProps, id).fatal).toMatch(/Type de colonne inconnu/);
    expect(planKbImport({ columns: [{ name: 'A', type: 'text' }, { name: 'a', type: 'text' }], rows }, existingProps, id).fatal).toMatch(/deux fois/);
    expect(planKbImport({ columns: [{ name: 'nom', type: 'text' }], rows }, existingProps, id).fatal).toMatch(/colonne titre/);
    expect(planKbImport({ columns: [{ name: 'produits', type: 'text' }], rows }, existingProps, id).fatal).toMatch(/autre type/);
  });

  it('refuse plus de 100 étiquettes différentes dans une colonne', () => {
    const rows = [{ title: 'x', cells: { Produits: Array.from({ length: 101 }, (_, i) => `E${i}`) } }];
    expect(planKbImport({ columns, rows }, existingProps, id).fatal).toMatch(/Trop d'étiquettes/);
  });
});

describe('planKbImport : colonnes, étiquettes et lignes', () => {
  it('rapproche une colonne existante, crée la nouvelle et les étiquettes manquantes sans toucher aux existantes', () => {
    const plan = planKbImport({
      columns,
      rows: [
        { title: 'La Rochère', cells: { Produits: ['Construction vitrée', 'Pavés de verre'], Texte: '123 rue' } },
        { title: 'SOTTAS', cells: { produits: ['pavés de verre', 'Structure métallique'] } },
      ],
    }, existingProps, id);
    expect(plan.fatal).toBeUndefined();
    expect(plan.errors).toEqual([]);
    expect(plan.newProperties.map(p => [p.name, p.type])).toEqual([['Texte', 'text']]);
    expect(plan.optionsCreated).toBe(2);
    expect(plan.optionUpdates).toHaveLength(1);
    const options = plan.optionUpdates[0].options;
    expect(options.map(o => o.label)).toEqual(['Construction vitrée', 'Pavés de verre', 'Structure métallique']);
    expect(options[0].id).toBe('o-vitree');
    expect(new Set(options.map(o => o.id)).size).toBe(3);
    // Les valeurs de lignes portent des identifiants d'options, jamais des libellés.
    expect(plan.rows[0].properties['p-prod']).toEqual([options[0].id, options[1].id]);
    expect(plan.rows[1].properties['p-prod']).toEqual([options[1].id, options[2].id]);
    expect(plan.rows[0].properties[plan.newProperties[0].id]).toBe('123 rue');
  });

  it('crée une colonne à choix neuve avec ses étiquettes, sans mise à jour de colonne existante', () => {
    const plan = planKbImport({
      columns: [{ name: 'Corps d\'état', type: 'select' }],
      rows: [{ title: 'A', cells: { 'Corps d\'état': 'Couverture' } }, { title: 'B', cells: { 'Corps d\'état': 'couverture' } }],
    }, [existingProps[0]], id);
    expect(plan.optionUpdates).toEqual([]);
    expect(plan.newProperties[0].options.map(o => o.label)).toEqual(['Couverture']);
    expect(plan.optionsCreated).toBe(1);
    expect(plan.rows[0].properties[plan.newProperties[0].id]).toBe(plan.newProperties[0].options[0].id);
    expect(plan.rows[1].properties[plan.newProperties[0].id]).toBe(plan.newProperties[0].options[0].id);
  });

  it('valide chaque cellule comme à l\'écran et rapporte ligne et colonne, sans rien écrire de partiel', () => {
    const plan = planKbImport({
      columns: [{ name: 'Prix', type: 'number' }, { name: 'Livré', type: 'date' }, { name: 'Actif', type: 'checkbox' }],
      rows: [
        { title: 'OK', cells: { Prix: 12.5, Livré: '2026-11-26', Actif: true } },
        { title: 'Mauvais', cells: { Prix: 'abc', Livré: 'demain', Actif: 'oui' } },
        { title: 'Inconnue', cells: { Fantôme: 'x' } },
      ],
    }, [existingProps[0]], id);
    expect(plan.errors).toEqual([
      { row: 2, column: 'Prix', error: 'Nombre attendu.' },
      { row: 2, column: 'Livré', error: 'Date attendue (AAAA-MM-JJ).' },
      { row: 2, column: 'Actif', error: 'Case à cocher attendue.' },
      { row: 3, column: 'Fantôme', error: 'Colonne inconnue.' },
    ]);
  });

  it('ignore les cellules vides, borne le titre et refuse un contenu invalide ou trop gros', () => {
    const plan = planKbImport({
      columns: [{ name: 'Texte', type: 'text' }],
      rows: [
        { title: `  ${'x'.repeat(300)}  `, cells: { Texte: null } },
        { title: 'Contenu', cells: {}, content: { type: 'doc', content: [] } },
        { title: 'Tableau', cells: {}, content: [1] },
        { title: 'Gros', cells: {}, content: { type: 'doc', blob: 'y'.repeat(100) } },
        'pas une ligne',
      ],
    }, [existingProps[0]], id, { maxContentBytes: 50 });
    expect(plan.rows[0].title).toHaveLength(200);
    expect(plan.rows[0].properties).toEqual({});
    expect(plan.rows[1].content).toEqual({ type: 'doc', content: [] });
    expect(plan.errors).toEqual([
      { row: 3, error: 'Contenu invalide.' },
      { row: 4, error: 'Contenu trop volumineux.' },
      { row: 5, error: 'Ligne invalide.' },
    ]);
  });

  it('une cellule à choix sans étiquette lisible ne laisse aucune valeur', () => {
    const plan = planKbImport({ columns: [{ name: 'Produits', type: 'multi_select' }], rows: [{ title: 'A', cells: { Produits: ['', '  '] } }] }, existingProps, id);
    expect(plan.rows[0].properties).toEqual({});
    expect(plan.optionsCreated).toBe(0);
  });
});
