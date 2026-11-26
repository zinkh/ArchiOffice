// Import de fiches : export Notion (zip), CSV Windows-1252 en « ; », refus tout ou rien, import dans une base existante.
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { addRow, editorOf, installGuards, openFabricants, PAGE, sidebar, titleOf } from './helpers';

installGuards();

const ID_A = '0123456789abcdef0123456789abcdef';
const ID_B = 'fedcba9876543210fedcba9876543210';
const ID_C = '11111111222222223333333344444444';
const NOTION_CSV = 'Nom,Produits,Texte\n"La Rochère","Construction vitrée, Pavés de verre","Localisation: Adresse postale 123 Rue de La Rochère"\nSOTTAS,"Construction vitrée, Structure métallique","Adresse postale de SOTTAS : Rue de la Gare 12, 1003 Lausanne"\nFPEE,"Menuiseries Extérieures Al, Menuiseries Extérieures B","Adresse : 2 rue Henri Vallée – CS 20002, 72000 Le Mans"\n';

async function notionZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(`Export/Fabricants ${ID_A}.csv`, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTION_CSV)]));
  zip.file(`Export/Fabricants/La Rochère ${ID_B}.md`, [
    '# La Rochère', '', 'Produits: Construction vitrée, Pavés de verre', 'Texte: Localisation: Adresse postale 123 Rue de La Rochère', '',
    '## Contact', '', '- Tél : **03 83 00 00 00**', '- [Site](https://exemple.fr)', '',
    '<details>', '<summary>Détails constructifs</summary>', '', 'Solivage bois, entraxe 40 cm', '', '</details>', '',
  ].join('\n'));
  zip.file(`Export/Fabricants/SOTTAS ${ID_C}.md`, '# SOTTAS\n\nProduits: Construction vitrée, Structure métallique\n');
  zip.file('Export/Fabricants/plan.png', Buffer.from([1, 2, 3]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

const dialog = (page: Page) => page.getByRole('dialog');
const dropFile = async (page: Page, name: string, buffer: Buffer, mimeType: string) => {
  const input = page.locator('input[type="file"]');
  await expect(input).toBeEnabled(); // actif une fois les colonnes existantes de la base chargées
  await input.setInputFiles({ name, mimeType, buffer });
};

test('export Notion : nouvelle base avec colonnes, étiquettes et contenu des pages', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Importer dans une nouvelle base' })).toBeVisible();
  await dropFile(page, 'Export.zip', await notionZip(), 'application/zip');

  // Correspondance : types proposés, base nommée d'après le CSV, pages Markdown rattachées.
  await expect(dialog(page).getByLabel('Nom de la nouvelle base')).toHaveValue('Fabricants');
  await expect(dialog(page).getByLabel('Type : Produits')).toHaveValue('multi_select');
  await expect(dialog(page).getByLabel('Type : Texte')).toHaveValue('text');
  await expect(dialog(page).getByLabel('Type : Nom')).toHaveValue('title');
  await expect(dialog(page)).toContainText('1 page Notion est reprise comme contenu de fiche.');
  await expect(dialog(page).getByRole('region', { name: /Aperçu/ }).getByRole('cell', { name: 'La Rochère', exact: true })).toBeVisible();

  await dialog(page).getByRole('button', { name: 'Importer 3 fiches' }).click();
  await expect(dialog(page)).toContainText('Import terminé : 3 fiches créées.');
  await expect(dialog(page)).toContainText('2 colonnes créées.');
  await expect(dialog(page)).toContainText('5 étiquettes créées.');
  await dialog(page).getByRole('button', { name: 'Terminer' }).click();

  // La nouvelle base s'ouvre avec ses fiches, ses étiquettes et ses pages.
  await expect(titleOf(page)).toHaveValue('Fabricants');
  const names = page.getByRole('textbox', { name: 'Nom', exact: true });
  await expect(names).toHaveCount(3);
  await expect(names.nth(0)).toHaveValue('La Rochère');
  await expect(page.locator('tbody .kb-tag', { hasText: 'Pavés de verre' })).toHaveCount(1);
  await expect(page.locator('tbody .kb-tag', { hasText: 'Construction vitrée' })).toHaveCount(2);
  await page.getByRole('button', { name: /Ouvrir la fiche : La Rochère/ }).click();
  await expect(editorOf(page).locator('h2')).toHaveText('Contact');
  await expect(editorOf(page)).toContainText('03 83 00 00 00');
  await expect(editorOf(page).locator('[data-type="details"]')).toBeVisible();
  await expect(editorOf(page)).not.toContainText('Produits:');
  await sidebar(page);
});

test('CSV Windows-1252 en « ; » : accents lus, types proposés', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  const csv = iconv.encode('Nom;Produits;Poids\nVerrière;Pavés de verre, Menuiseries extérieures;12,5\nÉlan;Pavés de verre;3\n', 'win1252');
  await dropFile(page, 'fabricants.csv', Buffer.from(csv), 'text/csv');
  await expect(dialog(page).getByLabel('Type : Poids')).toHaveValue('number');
  await expect(dialog(page).getByLabel('Type : Produits')).toHaveValue('multi_select');
  await expect(dialog(page).getByRole('region', { name: /Aperçu/ })).toContainText('Verrière');
  await dialog(page).getByRole('button', { name: 'Importer 2 fiches' }).click();
  await dialog(page).getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom', exact: true }).first()).toHaveValue('Verrière');
  await expect(page.getByRole('textbox', { name: 'Poids', exact: true }).first()).toHaveValue('12.5');
});

test('une ligne illisible refuse tout l\'import et rien n\'est créé', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await dropFile(page, 'prix.csv', Buffer.from('Nom;Prix\nA;12\nB;abc\n'), 'text/csv');
  await expect(dialog(page).getByLabel('Type : Prix')).toHaveValue('text');
  await dialog(page).getByLabel('Type : Prix').selectOption({ label: 'Nombre' });
  await dialog(page).getByRole('button', { name: 'Importer 2 fiches' }).click();
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'Lignes à corriger' })).toContainText('Ligne 3, colonne « Prix »');
});

test('format refusé et fichier vide : messages clairs', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await dropFile(page, 'plan.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
  await expect(dialog(page).getByRole('alert')).toContainText('Format non pris en charge');
  await dropFile(page, 'vide.csv', Buffer.from('Nom;Prix\n'), 'text/csv');
  await expect(dialog(page).getByRole('alert')).toContainText('ne contient aucune fiche');
});

test('import dans une base existante : la colonne Produits est reprise, pas dupliquée', async ({ page }) => {
  await openFabricants(page);
  await addRow(page, 'Déjà là');
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await dropFile(page, 'suite.csv', Buffer.from('Nom;Produits\nNouvelle fiche;Pavés de verre\n'), 'text/csv');
  await dialog(page).getByRole('button', { name: 'Importer 1 fiche' }).click();
  await expect(dialog(page)).toContainText('Import terminé : 1 fiche créée.');
  await dialog(page).getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom', exact: true })).toHaveCount(2);
  await expect(page.getByRole('columnheader', { name: /Produits/ })).toHaveCount(1);
});
