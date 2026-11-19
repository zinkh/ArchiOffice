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
  await expect.poll(() => saved.taches.find(t => t.id === 'reception')?.debut).toBe('2027-01-16');
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

test('décalage des successeurs : désactivé par défaut, puis activé et mémorisé', async ({ page }) => {
  test.setTimeout(90_000);
  let saved = { version: 1, taches, hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {} } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  const bar = page.getByRole('button', { name: 'Déplacer « Fondations et dallage »', exact: true });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  const tache = (id: string) => saved.taches.find(t => t.id === id);

  // Par défaut : seules les dates de la tâche déplacée changent (Maj = 7 jours).
  await bar.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => tache('fondations')?.debut).toBe('2027-01-06');
  expect(tache('charpente')).toMatchObject({ debut: '2027-01-07', fin: '2027-01-15' });

  // Activé : les successeurs sont reculés en cascade, durée conservée, jalon sur un jour.
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByLabel('Décaler les successeurs', { exact: true }).check();
  await bar.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => tache('fondations')?.debut).toBe('2027-01-13');
  await expect.poll(() => tache('charpente')).toMatchObject({ debut: '2027-01-23', fin: '2027-01-31' });
  expect(tache('reception')).toMatchObject({ debut: '2027-02-01', fin: '2027-02-01' });
  expect(tache('installation')).toMatchObject({ debut: '2026-12-23', fin: '2026-12-29' });
  await expect(page.getByRole('status').filter({ hasText: '2 successeur(s) décalé(s).' })).toBeVisible();

  // Le réglage est mémorisé par appareil.
  await page.reload();
  await page.getByText('Affichage et exports', { exact: true }).click();
  await expect(page.getByLabel('Décaler les successeurs', { exact: true })).toBeChecked();
});

test('calendrier configurable, repères persistants et poignées discrètes', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  let saved: any = { version: 1, taches, hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {} } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  const bands = page.locator('[data-planning-calendar-bands]');
  await expect(bands.locator('[data-calendar-start="2026-12-25"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(bands.locator('[data-calendar-start="2027-01-01"]')).toHaveCount(1);
  if (!isMobile) {
    await page.mouse.move(0, 0);
    const handle = page.getByRole('button', { name: 'Redimensionner la fin de « Fondations et dallage »', exact: true });
    await expect(handle).toHaveCSS('opacity', '0');
    await page.getByRole('button', { name: 'Déplacer « Fondations et dallage »', exact: true }).hover();
    await expect(handle).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0); await handle.focus();
    await expect(handle).toHaveCSS('opacity', '1');
  }
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByLabel('Jours fériés automatiques').selectOption('alsace_moselle');
  await page.getByLabel('Nom de la période', { exact: true }).fill('Fermeture hivernale');
  await page.getByLabel('Début de la période', { exact: true }).fill('2026-12-24');
  await page.getByLabel('Fin de la période (incluse)', { exact: true }).fill('2027-01-03');
  await page.getByRole('button', { name: 'Ajouter une période', exact: true }).click();
  await expect.poll(() => saved.calendrier?.periodes.length).toBe(1);
  expect(saved.calendrier.joursFeries).toBe('alsace_moselle');
  await expect(bands.locator('[data-calendar-type="conge"]')).toHaveCount(1);
  await expect(bands.locator('[data-calendar-start="2026-12-26"]')).toHaveCount(1);
  const originalDates = saved.taches.map((t: any) => [t.debut, t.fin]);
  await page.getByLabel('Afficher les congés', { exact: true }).uncheck();
  await expect(bands.locator('[data-calendar-type="conge"]')).toHaveCount(0);
  await page.reload();
  await expect(bands.locator('[data-calendar-type="conge"]')).toHaveCount(0);
  await expect(bands.locator('[data-calendar-start="2026-12-26"]')).toHaveCount(1);
  await page.getByText('Affichage et exports', { exact: true }).click();
  await expect(page.getByLabel('Afficher les congés', { exact: true })).not.toBeChecked();
  await page.getByLabel('Afficher les congés', { exact: true }).check();
  await page.getByRole('button', { name: 'Modifier « Fermeture hivernale »', exact: true }).click();
  await page.getByLabel('Fin de la période (incluse)', { exact: true }).fill('2027-01-04');
  await page.getByRole('button', { name: 'Enregistrer la période', exact: true }).click();
  await expect.poll(() => saved.calendrier?.periodes[0].fin).toBe('2027-01-04');
  await page.getByLabel('Afficher les jours fériés', { exact: true }).uncheck();
  await expect(bands.locator('[data-calendar-type="ferie"]')).toHaveCount(0);
  await page.getByLabel('Afficher les jours fériés', { exact: true }).check();
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.screenshot({ path: `/tmp/chantier-calendrier-${test.info().project.name}.png`, fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
  await (await download).saveAs(`/tmp/chantier-calendrier-${test.info().project.name}.pdf`);
  await page.getByText('Affichage et exports', { exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer « Fermeture hivernale »', exact: true }).click();
  await expect.poll(() => saved.calendrier?.periodes.length).toBe(0);
  expect(saved.taches.map((t: any) => [t.debut, t.fin])).toEqual(originalDates);
});

test('ordre vertical fixe, placement à l’ajout du prédécesseur puis dates manuelles', async ({ page }) => {
  test.setTimeout(120_000);
  const seconde = { ...taches[1], id: 'finitions', libelle: 'Finitions du gros œuvre', debut: '2027-01-01', fin: '2027-01-03', dependencies: [] as string[] };
  let saved = { version: 1, taches: [...taches, seconde], hypotheses: [], genereLe: null };
  await page.route('**/api/projects/*/planning-chantier', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, planning: saved, entreprises: {} } });
  });
  await page.goto('/e2e/fixtures/chantier-planning.html');
  const rowIds = () => page.locator('[data-planning-task-id]').evaluateAll(els => els.map(el => el.getAttribute('data-planning-task-id')));
  const initial = ['installation', 'reception', 'fondations', 'finitions', 'charpente'];
  await expect.poll(rowIds).toEqual(initial);
  // La tâche initialement plus tôt reste sous Fondations, même après modification des dates.
  await page.getByRole('button', { name: /Finitions du gros œuvre, .*du/ }).click();
  await page.getByLabel(/Fondations et dallage · Lot 01/).check();
  await expect(page.getByLabel('Début', { exact: true })).toHaveValue('2027-01-09');
  await expect(page.getByLabel('Fin', { exact: true })).toHaveValue('2027-01-11');
  // Les dates proposées restent modifiables avant même d’enregistrer.
  await page.getByLabel('Début', { exact: true }).fill('2026-12-20');
  await page.getByLabel('Fin', { exact: true }).fill('2026-12-22');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(() => saved.taches.find(t => t.id === 'finitions')?.debut).toBe('2026-12-20');
  await expect.poll(rowIds).toEqual(initial);
  await page.reload();
  await expect.poll(rowIds).toEqual(initial);
  await page.getByRole('button', { name: /Finitions du gros œuvre, .*du/ }).click();
  await expect(page.getByLabel('Début', { exact: true })).toHaveValue('2026-12-20');
  await page.getByLabel(/Fondations et dallage · Lot 01/).uncheck();
  await expect(page.getByLabel('Début', { exact: true })).toHaveValue('2026-12-20');
  await page.getByLabel(/Fondations et dallage · Lot 01/).check();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(() => saved.taches.find(t => t.id === 'finitions')?.debut).toBe('2027-01-09');
  // Déplacement clavier après création, sans recalcul automatique au rechargement.
  const bar = page.getByRole('button', { name: 'Déplacer « Finitions du gros œuvre »', exact: true });
  await bar.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(() => saved.taches.find(t => t.id === 'finitions')?.debut).toBe('2027-01-08');
  await expect.poll(rowIds).toEqual(initial);
  await page.reload();
  await expect(bar).toHaveAttribute('title', /2027-01-08 – 2027-01-10/);
  await expect.poll(rowIds).toEqual(initial);
  expect(saved.taches.find(t => t.id === 'fondations')?.fin).toBe('2027-01-08');
});
