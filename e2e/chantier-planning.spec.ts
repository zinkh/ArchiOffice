import { test, expect } from '@playwright/test';

// Keep text assertions deterministic on English-language CI runners.
test.use({ locale: 'fr-FR' });

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

test('déplacement, poignées, liaison par geste et annulation sans écriture', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  let saved = { version: 1, taches, hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {} } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  const bar = page.getByRole('button', { name: 'Déplacer « Fondations et dallage »', exact: true });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  if (isMobile) {
    await page.getByText('Affichage et exports', { exact: true }).click();
    await page.getByRole('slider', { name: 'Largeur des libellés' }).focus(); await page.keyboard.press('Home');
    await page.getByText('Affichage et exports', { exact: true }).click();
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(page.getByText(/^Aperçu/)).toBeVisible(); // appui long réel, pas de délai arbitraire
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 24 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => saved.taches.find(t => t.id === 'fondations')?.debut).toBe('2027-01-01');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(bar).toHaveAttribute('title', /2027-01-01 – 2027-01-10/);
    return;
  }
  const glisser = async (locator: typeof bar, dx: number) => {
    const box = (await locator.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  };
  await glisser(bar, 36); // 84 px/semaine = 12 px/jour
  await expect.poll(() => saved.taches.find(t => t.id === 'fondations')?.debut).toBe('2027-01-02');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await glisser(page.getByRole('button', { name: 'Redimensionner la fin de « Fondations et dallage »', exact: true }), 24);
  await expect.poll(() => saved.taches.find(t => t.id === 'fondations')?.fin).toBe('2027-01-13');
  await glisser(page.getByRole('button', { name: 'Redimensionner le début de « Fondations et dallage »', exact: true }), 12);
  await expect.poll(() => saved.taches.find(t => t.id === 'fondations')?.debut).toBe('2027-01-03');
  // Un geste annulé ne doit jamais produire un PUT de dates provisoires.
  const avant = JSON.stringify(saved);
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByText('Geste annulé, aucune modification enregistrée.')).toBeVisible();
  expect(JSON.stringify(saved)).toBe(avant);
  const relier = async (source: string, cible: string) => {
    const from = (await page.getByRole('button', { name: `Créer une dépendance depuis « ${source} »`, exact: true }).boundingBox())!;
    const to = (await page.getByRole('button', { name: `Déplacer « ${cible} »`, exact: true }).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
  };
  await relier('Fondations et dallage', 'Réception');
  await expect.poll(() => saved.taches.find(t => t.id === 'reception')?.dependencies).toContain('fondations');
  await relier('Réception', 'Fondations et dallage');
  await expect(page.getByText('Lien refusé : il créerait une dépendance circulaire.')).toBeVisible();
  await page.reload();
  await expect(bar).toHaveAttribute('title', /2027-01-03 – 2027-01-13/);
  await expect(page.locator('[data-planning-task-id="reception"]')).toBeVisible();
});

test('largeurs, ajustement et avancement persistants, édition clavier et liaison sans glisser', async ({ page }) => {
  test.setTimeout(90_000);
  let saved = { version: 1, taches, hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {} } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  const bar = page.getByRole('button', { name: 'Déplacer « Fondations et dallage »', exact: true });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByLabel('Afficher l’avancement', { exact: true }).uncheck();
  await expect(page.locator('[data-planning-progress]')).toHaveCount(0);
  await expect(page.locator('[data-planning-task-id="fondations"]')).not.toContainText('%');
  const labels = page.getByRole('slider', { name: 'Largeur des libellés' });
  await labels.focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await page.getByLabel('Ajuster à la largeur', { exact: true }).check();
  const region = page.getByRole('region', { name: 'Diagramme de Gantt du chantier' });
  await expect.poll(() => region.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const separator = page.getByRole('separator', { name: 'Largeur des libellés' });
  await separator.focus(); await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '208');
  await bar.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => saved.taches.find(t => t.id === 'fondations')?.debut).toBe('2026-12-31');
  await page.getByRole('button', { name: 'Créer une dépendance depuis « Fondations et dallage »', exact: true }).click();
  await page.getByRole('button', { name: 'Déplacer « Réception »', exact: true }).click();
  await expect.poll(() => saved.taches.find(t => t.id === 'reception')?.dependencies).toContain('fondations');
  await page.reload();
  await expect(page.locator('[data-planning-progress]')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Largeur des libellés' })).toHaveAttribute('aria-valuenow', '208');
  await page.getByText('Affichage et exports', { exact: true }).click();
  await expect(page.getByLabel('Ajuster à la largeur', { exact: true })).toBeChecked();
  await page.screenshot({ path: `/tmp/chantier-gestes-${test.info().project.name}.png`, fullPage: true });
});
