// Outils communs des tests de bout en bout de la « Base de données » (e2e-kb/*.spec.ts).
import { expect, test, type Locator, type Page } from '@playwright/test';

export const PAGE = '/e2e-kb/fixtures/base-de-donnees.html';
export const API = `http://127.0.0.1:${process.env.KB_API_PORT ?? 4311}`;

const problems = new WeakMap<Page, string[]>();

/** Base vide avant chaque test, et toute erreur de page ou de console fait échouer le test. */
export function installGuards() {
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
}

/** Barre latérale des pages : sur téléphone elle est repliée derrière le bouton « Pages ». */
export async function sidebar(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Pages de la base de données' });
  if (!(await nav.isVisible())) {
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await expect(nav).toBeVisible();
  }
  return nav;
}

export const editorOf = (page: Page) => page.getByRole('textbox', { name: 'Contenu de la page' });
export const titleOf = (page: Page) => page.getByRole('textbox', { name: 'Titre de la page' });

/** Crée une page libre depuis la barre latérale et lui donne un titre. */
export async function newPage(page: Page, title: string) {
  const nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Nouvelle page', exact: true }).click();
  // La page vierge est affichée (et non la précédente) avant de saisir son titre.
  await expect(page.getByRole('article', { name: 'Sans titre' })).toBeVisible();
  await expect(titleOf(page)).toBeVisible();
  await titleOf(page).fill(title);
  await expect(editorOf(page)).toBeVisible();
}

export async function openFabricants(page: Page, query = '') {
  await page.goto(`${PAGE}${query}`);
  await page.getByRole('button', { name: 'Base Fabricants' }).click();
  await expect(titleOf(page)).toHaveValue('Fabricants');
  await expect(page.getByRole('columnheader', { name: /Produits/ })).toBeVisible();
}

/** Ajoute une fiche au tableau et en renseigne le nom. */
export async function addRow(page: Page, title: string) {
  const names = page.getByRole('textbox', { name: 'Nom', exact: true });
  const before = await names.count();
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  // La nouvelle ligne est la dernière, une fois affichée : on attend qu'elle existe avant de la remplir.
  await expect(names).toHaveCount(before + 1);
  const last = names.last();
  await expect(last).toHaveValue('');
  await last.fill(title);
  await last.blur();
}

/** Choisit des étiquettes dans la colonne Produits de la n-ième fiche (0 = première). */
export async function setProduits(page: Page, row: number, labels: string[]) {
  await page.getByRole('button', { name: 'Produits', exact: true }).nth(row).click();
  const popover = page.getByRole('dialog', { name: 'Produits' });
  for (const label of labels) await popover.getByRole('option', { name: new RegExp(label) }).click();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
}

/** Attend la fin de l'enregistrement automatique. */
export async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré' }).first()).toBeVisible({ timeout: 15_000 });
}
