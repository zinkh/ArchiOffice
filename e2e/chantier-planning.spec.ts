import { test, expect } from '@playwright/test';

const taches = [
  { id: 'installation', lotId: '', libelle: 'Installation du chantier', debut: '2026-12-23', fin: '2026-12-29', avancement: 100, source: 'manuel' },
  { id: 'fondations', lotId: 'go', libelle: 'Fondations et dallage', debut: '2026-12-30', fin: '2027-01-08', avancement: 40, source: 'manuel', dependencies: ['installation'] },
  { id: 'charpente', lotId: 'bois', libelle: 'Pose de la charpente', debut: '2027-01-07', fin: '2027-01-15', avancement: 0, source: 'manuel', dependencies: ['fondations'] },
  { id: 'reception', lotId: '', libelle: 'Réception', debut: '2027-01-18', fin: '2027-01-18', avancement: 0, source: 'manuel', jalon: true, dependencies: ['charpente'] },
];
test('réglages persistants, liens masqués et édition des dépendances', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('pageerror', error => { console.error('PAGE ERROR:', error.message); });
  page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE:', msg.text()); });
  let saved = { version: 1, taches, hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {}, couleursAor: { 'e:martin': '#dc2626' } } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  await expect(page.getByText('2026-S53', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Dates incohérentes/)).toBeVisible();
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByLabel('Calendrier relatif').check();
  await expect(page.getByText('S1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tout replier' }).click();
  await expect(page.getByRole('button', { name: /Fondations et dallage, .*du/ })).toHaveCount(0);
  await expect(page.getByText(/3 liaison\(s\), dont 3/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('S1', { exact: true })).toBeVisible();
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByRole('button', { name: 'Tout déplier' }).click();
  await page.getByLabel('Échelle').selectOption('mois');
  await expect(page.getByText('M1', { exact: true })).toBeVisible();
  await page.getByLabel('Tâches générales', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: /Installation du chantier, .*du/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
  await (await download).saveAs(`/tmp/chantier-planning-${test.info().project.name}.pdf`);
  await page.screenshot({ path: `/tmp/chantier-planning-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: /Pose de la charpente, .*du/ }).click();
  await page.getByLabel(/Fondations et dallage · Lot 01/).uncheck();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(() => saved.taches.find(t => t.id === 'charpente')?.dependencies ?? []).toEqual([]);
  await page.reload();
  await expect(page.getByText(/Dates incohérentes/)).toHaveCount(0);
  await page.goto('/e2e/fixtures/chantier-planning.html?project=autre');
  await expect(page.getByText('2026-S53', { exact: true })).toBeVisible({ timeout: 30_000 });
});
