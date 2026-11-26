// « Base de données » du cabinet dans un vrai navigateur : l'écran réel, le code serveur réel, une fausse base en
// mémoire (e2e-kb/kbApiServer.ts). Voir playwright.kb.config.ts. Aucune donnée réelle.
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/e2e-kb/fixtures/base-de-donnees.html';
const API = `http://127.0.0.1:${process.env.KB_API_PORT ?? 4311}`;

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  await request.post(`${API}/__reset`);
  const list: string[] = [];
  problems.set(page, list);
  page.on('pageerror', error => list.push(`pageerror: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon|Failed to load resource/.test(msg.text())) list.push(`console: ${msg.text()}`); });
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), 'aucune erreur de page ni de console').toEqual([]);
});

async function openFabricants(page: Page) {
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Base Fabricants' }).click();
  await expect(page.getByRole('textbox', { name: 'Titre de la page' })).toHaveValue('Fabricants');
  await expect(page.getByRole('columnheader', { name: /Produits/ })).toBeVisible();
}

async function addRow(page: Page, title: string) {
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  const names = page.getByRole('textbox', { name: 'Nom', exact: true });
  const last = names.last();
  await expect(last).toBeVisible();
  await last.fill(title);
  await last.blur();
}

test.describe('Base Fabricants', () => {
  test('crée la base du modèle, ajoute des fiches et des étiquettes colorées', async ({ page }) => {
    await openFabricants(page);
    await expect(page.getByRole('columnheader', { name: /Nom/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Texte/ })).toBeVisible();
    await expect(page.getByText('Aucune fiche. Cliquez sur « Nouveau » pour en ajouter une.')).toBeVisible();

    await addRow(page, 'La Rochère');
    const produits = page.getByRole('button', { name: 'Produits', exact: true }).first();
    await produits.click();
    const popover = page.getByRole('dialog', { name: 'Produits' });
    await popover.getByRole('option', { name: /Construction vitrée/ }).click();
    await popover.getByRole('option', { name: /Pavés de verre/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('tbody .kb-tag', { hasText: 'Construction vitrée' })).toBeVisible();
    await expect(page.locator('tbody .kb-tag', { hasText: 'Pavés de verre' })).toBeVisible();

    // Étiquette créée à la volée, puis recolorée.
    await produits.click();
    await popover.getByPlaceholder('Chercher ou créer une étiquette').fill('Verre feuilleté');
    await page.keyboard.press('Enter');
    await expect(popover.getByRole('option', { name: /Verre feuilleté/ })).toBeVisible();
    await popover.getByRole('button', { name: 'Couleur : Verre feuilleté' }).click();
    await popover.getByRole('button', { name: 'Rose' }).click();
    await expect(page.locator('.kb-tag[data-color="rose"]', { hasText: 'Verre feuilleté' }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Texte libre.
    await page.getByRole('textbox', { name: 'Texte', exact: true }).first().fill('Localisation : 123 rue de La Rochère');
    await page.getByRole('textbox', { name: 'Texte', exact: true }).first().blur();

    // Les valeurs sont enregistrées : rechargement de la page.
    await expect.poll(async () => page.evaluate(() => location.hash)).toMatch(/base-de-donnees\//);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Titre de la page' })).toHaveValue('Fabricants');
    await expect(page.getByRole('textbox', { name: 'Nom', exact: true }).first()).toHaveValue('La Rochère');
    await expect(page.locator('tbody .kb-tag', { hasText: 'Verre feuilleté' })).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Texte', exact: true }).first()).toHaveValue('Localisation : 123 rue de La Rochère');
  });
});
