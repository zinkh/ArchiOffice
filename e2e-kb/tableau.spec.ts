// Tableau d'une base : recherche, filtre, tri, colonnes masquées, ligne ouverte en page.
import { expect, test } from '@playwright/test';
import { addRow, editorOf, installGuards, openFabricants, saved, setProduits, titleOf } from './helpers';

installGuards();

test('recherche, filtre par étiquette, tri et colonne masquée', async ({ page }) => {
  await openFabricants(page);
  await addRow(page, 'La Rochère');
  await setProduits(page, 0, ['Construction vitrée', 'Pavés de verre']);
  await addRow(page, 'SOTTAS');
  await setProduits(page, 1, ['Structure métallique']);
  await addRow(page, 'FPEE');
  await setProduits(page, 2, ['Menuiseries extérieures']);
  const names = page.getByRole('textbox', { name: 'Nom', exact: true });
  await expect(names).toHaveCount(3);

  // Recherche : sans accent ni casse.
  await page.getByPlaceholder('Rechercher dans le tableau').fill('rochere');
  await expect(names).toHaveCount(1);
  await expect(names.first()).toHaveValue('La Rochère');
  await page.getByPlaceholder('Rechercher dans le tableau').fill('');
  await expect(names).toHaveCount(3);

  // Filtre : contient l'étiquette « Structure métallique ».
  await page.getByRole('button', { name: 'Filtrer', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Filtrer' });
  await filter.getByRole('button', { name: 'Ajouter un filtre' }).click();
  await filter.getByLabel('Colonne').selectOption({ label: 'Produits' });
  await filter.getByLabel('Valeur').selectOption({ label: 'Structure métallique' });
  await page.keyboard.press('Escape');
  await expect(names).toHaveCount(1);
  await expect(names.first()).toHaveValue('SOTTAS');
  await page.getByRole('button', { name: 'Filtrer', exact: true }).click();
  await filter.getByRole('button', { name: 'Retirer le filtre' }).click();
  await page.keyboard.press('Escape');
  await expect(names).toHaveCount(3);

  // Tri décroissant sur le nom.
  await page.getByRole('button', { name: 'Trier', exact: true }).click();
  const sort = page.getByRole('dialog', { name: 'Trier' });
  await sort.getByRole('button', { name: 'Ajouter un tri' }).click();
  await sort.getByLabel('Sens du tri').selectOption({ label: 'Décroissant' });
  await page.keyboard.press('Escape');
  await expect(names.nth(0)).toHaveValue('SOTTAS');
  await expect(names.nth(1)).toHaveValue('La Rochère');
  await expect(names.nth(2)).toHaveValue('FPEE');

  // Colonne masquée : enregistrée dans la vue, elle survit au rechargement.
  await page.getByRole('button', { name: 'Colonnes', exact: true }).click();
  await page.getByRole('dialog', { name: 'Colonnes' }).getByLabel('Texte').uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: /Texte/ })).toHaveCount(0);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(titleOf(page)).toHaveValue('Fabricants');
  await expect(page.getByRole('columnheader', { name: /Texte/ })).toHaveCount(0);
  await expect(names.nth(0)).toHaveValue('SOTTAS');
});

test('une fiche s\'ouvre en page avec ses propriétés et son contenu, enregistrés seuls', async ({ page }) => {
  await openFabricants(page);
  await addRow(page, 'La Rochère');
  await setProduits(page, 0, ['Pavés de verre']);
  await page.getByRole('button', { name: /Ouvrir la fiche : La Rochère/ }).click();

  await expect(titleOf(page)).toHaveValue('La Rochère');
  const properties = page.getByRole('region', { name: 'Propriétés de la fiche' });
  await expect(properties.locator('.kb-tag', { hasText: 'Pavés de verre' })).toBeVisible();

  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type('/h2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Contact');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tél : 03 83 00 00 00');
  await saved(page);

  await page.reload();
  await expect(editorOf(page).locator('h2')).toHaveText('Contact');
  await expect(editorOf(page)).toContainText('03 83 00 00 00');
  await expect(page.getByRole('region', { name: 'Propriétés de la fiche' }).locator('.kb-tag', { hasText: 'Pavés de verre' })).toBeVisible();
  // Fil d'Ariane : retour à la base.
  await page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('button', { name: 'Fabricants' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom', exact: true })).toHaveValue('La Rochère');
});
