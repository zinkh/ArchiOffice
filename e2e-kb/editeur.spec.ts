// Éditeur de blocs : menu « / », menu de la poignée, enregistrement automatique.
import { expect, test } from '@playwright/test';
import { editorOf, installGuards, newPage, PAGE, saved, titleOf } from './helpers';

installGuards();

const BLOCKS: Array<{ query: string; label: string; selector: string }> = [
  { query: 'h2', label: 'Titre 2', selector: 'h2' },
  { query: 'puces', label: 'Liste à puces', selector: 'ul:not([data-type="taskList"]) li' },
  { query: 'cocher', label: 'Liste de tâches', selector: 'ul[data-type="taskList"] li' },
  { query: 'repliable', label: 'Bloc repliable', selector: '[data-type="details"]' },
  { query: 'citation', label: 'Citation', selector: 'blockquote' },
  { query: 'code', label: 'Code', selector: 'pre' },
  { query: 'separateur', label: 'Séparateur', selector: 'hr' },
  { query: 'tableau', label: 'Tableau', selector: 'table' },
];

for (const block of BLOCKS) {
  test(`menu « / » : ${block.label}`, async ({ page }) => {
    await page.goto(PAGE);
    await newPage(page, `Essai ${block.label}`);
    await editorOf(page).click();
    await page.keyboard.type(`/${block.query}`);
    const menu = page.getByRole('listbox', { name: 'Blocs' });
    await expect(menu.getByRole('option', { name: block.label })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(editorOf(page).locator(block.selector).first()).toBeVisible();
  });
}

test('menu « / » : recherche sans résultat, Échap le ferme sans rien insérer', async ({ page }) => {
  await page.goto(PAGE);
  await newPage(page, 'Recherche de bloc');
  await editorOf(page).click();
  await page.keyboard.type('/zzzz');
  await expect(page.getByRole('listbox', { name: 'Blocs' })).toContainText('Aucun bloc ne correspond.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Blocs' })).toBeHidden();
  await expect(editorOf(page)).toContainText('/zzzz');
});

test('texte et blocs enregistrés seuls, retrouvés après rechargement', async ({ page }) => {
  await page.goto(PAGE);
  await newPage(page, 'Planchers en bois anciens');
  await editorOf(page).click();
  await page.keyboard.type('Plancher bois, solivage Bestrema');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/cocher');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Vérifier la portance');
  await saved(page);

  await page.reload();
  await expect(titleOf(page)).toHaveValue('Planchers en bois anciens');
  await expect(editorOf(page)).toContainText('Plancher bois, solivage Bestrema');
  await expect(editorOf(page).locator('ul[data-type="taskList"] li')).toContainText('Vérifier la portance');
});

test('poignée de bloc : transformer, dupliquer, supprimer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'la poignée de bloc apparaît au survol de la souris');
  await page.goto(PAGE);
  await newPage(page, 'Menu de bloc');
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type('Un paragraphe à transformer');

  await editor.locator('p').first().hover();
  const handle = page.getByRole('button', { name: 'Actions du bloc' });
  await expect(handle).toBeVisible();
  await handle.click();
  const menu = page.getByRole('menu', { name: 'Actions du bloc' });
  await menu.getByRole('menuitem', { name: 'Titre 1' }).click();
  await expect(editor.locator('h1')).toHaveText('Un paragraphe à transformer');

  await editor.locator('h1').hover();
  await handle.click();
  await menu.getByRole('menuitem', { name: 'Dupliquer' }).click();
  await expect(editor.locator('h1')).toHaveCount(2);

  await editor.locator('h1').first().hover();
  await handle.click();
  await menu.getByRole('menuitem', { name: 'Supprimer' }).click();
  await expect(editor.locator('h1')).toHaveCount(1);
  await saved(page);
});
