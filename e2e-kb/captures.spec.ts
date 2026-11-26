// Captures d'écran de la « Base de données » (clair et sombre, ordinateur et téléphone), pour la relecture visuelle :
// dossier /tmp/kb-captures. Ce n'est pas une comparaison d'images : le test échoue seulement sur une erreur de page
// ou un débordement horizontal de la page.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addRow, editorOf, installGuards, newPage, PAGE, setProduits, sidebar } from './helpers';

installGuards();

const OUT = '/tmp/kb-captures';
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  const project = test.info().project.name.replace('-chromium', '');
  const theme = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'sombre' : 'clair'));
  await page.screenshot({ path: `${OUT}/${project}-${theme}-${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `débordement horizontal de la page (${name})`).toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  test(`parcours en images, thème ${theme}`, async ({ page }) => {
    const query = theme === 'dark' ? '?theme=dark' : '';
    await page.goto(`${PAGE}${query}`);
    await shot(page, '1-accueil');

    await page.getByRole('button', { name: 'Base Fabricants' }).click();
    await expect(page.getByRole('columnheader', { name: /Produits/ })).toBeVisible();
    await addRow(page, 'La Rochère');
    await setProduits(page, 0, ['Construction vitrée', 'Pavés de verre']);
    await page.getByRole('textbox', { name: 'Texte', exact: true }).first().fill('Localisation : 123 rue de La Rochère');
    await page.getByRole('textbox', { name: 'Texte', exact: true }).first().blur();
    await addRow(page, 'SOTTAS');
    await setProduits(page, 1, ['Construction vitrée', 'Structure métallique']);
    await addRow(page, 'FPEE');
    await setProduits(page, 2, ['Menuiseries extérieures']);
    await shot(page, '2-tableau-fabricants');

    await page.getByRole('button', { name: 'Produits', exact: true }).first().click();
    await shot(page, '3-choix-etiquettes');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Filtrer', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filtrer' }).getByRole('button', { name: 'Ajouter un filtre' }).click();
    await shot(page, '4-filtre');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Ouvrir la fiche : La Rochère/ }).click();
    await editorOf(page).click();
    await page.keyboard.type('/h2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Contact');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/cocher');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Vérifier la portance');
    await shot(page, '5-fiche-editeur');

    await newPage(page, 'Détails constructifs');
    await editorOf(page).click();
    await page.keyboard.type('/');
    await shot(page, '6-menu-blocs');
    await page.keyboard.press('Escape');
    await sidebar(page);
    await shot(page, '7-page-et-arbre');
  });
}
