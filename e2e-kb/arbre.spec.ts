// Arbre de pages : sous-pages, favoris, recherche, corbeille, restauration, suppression définitive.
import { expect, test } from '@playwright/test';
import { installGuards, newPage, PAGE, sidebar, titleOf } from './helpers';

installGuards();

test('sous-page, favori, recherche, corbeille et restauration', async ({ page }) => {
  await page.goto(PAGE);
  await newPage(page, 'Détails constructifs');
  await expect.poll(async () => page.evaluate(() => location.hash)).toMatch(/base-de-donnees\//);

  let nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Ajouter une sous-page : Détails constructifs' }).click({ force: true });
  await expect(page.getByRole('article', { name: 'Sans titre' })).toBeVisible();
  await titleOf(page).fill('Planchers en bois anciens');
  await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toContainText('Détails constructifs');

  nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Ajouter aux favoris : Planchers en bois anciens' }).click({ force: true });
  await expect(nav.getByRole('region', { name: 'Favoris' })).toContainText('Planchers en bois anciens');

  await nav.getByPlaceholder('Rechercher une page').fill('planchers');
  await expect(nav).toContainText('Planchers en bois anciens');
  await nav.getByPlaceholder('Rechercher une page').fill('introuvable');
  await expect(nav).toContainText('Aucune page trouvée.');
  await nav.getByPlaceholder('Rechercher une page').fill('');

  await nav.getByRole('button', { name: 'Mettre à la corbeille : Planchers en bois anciens' }).first().click({ force: true });
  await expect(page.getByText('Page mise à la corbeille.')).toBeVisible();
  nav = await sidebar(page);
  await nav.getByRole('button', { name: /^Corbeille/ }).click();
  await expect(nav.getByRole('button', { name: 'Restaurer : Planchers en bois anciens' })).toBeVisible();
  await nav.getByRole('button', { name: 'Restaurer : Planchers en bois anciens' }).click();
  await expect(nav.getByRole('button', { name: 'Restaurer : Planchers en bois anciens' })).toHaveCount(0);
});

test('suppression définitive : confirmation puis disparition', async ({ page }) => {
  await page.goto(PAGE);
  await newPage(page, 'À supprimer');
  let nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Mettre à la corbeille : À supprimer' }).first().click({ force: true });
  await expect(page.getByText('Page mise à la corbeille.')).toBeVisible();
  nav = await sidebar(page);
  await nav.getByRole('button', { name: /^Corbeille/ }).click();
  await nav.getByRole('button', { name: 'Supprimer définitivement : À supprimer' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('À supprimer');
  await confirm.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(nav.getByRole('button', { name: 'Restaurer : À supprimer' })).toHaveCount(0);
});

test('une page absente affiche un message', async ({ page }) => {
  await page.goto(`${PAGE}#/base-de-donnees/inconnue`);
  await expect(page.getByText(/introuvable/i)).toBeVisible();
});
