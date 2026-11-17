import { test, expect } from '@playwright/test';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

for (const kind of ['meeting', 'siteReport']) {
  test(`records, restores and reviews notes for ${kind}`, async ({ page }) => {
    let uploadedBytes = 0;
    await page.route('**/api/agents/transcribe?**', async route => {
      uploadedBytes = route.request().postDataBuffer()?.length ?? 0;
      expect(route.request().headers()['content-type']).toContain('audio/');
      await route.fulfill({ json: { text: 'Le devis de la véranda reste à choisir.' } });
    });
    await page.route('**/api/meeting-notes/generate', async route => {
      expect(route.request().postDataJSON()).toEqual({ transcript: 'Le devis de la véranda reste à choisir.', kind });
      await route.fulfill({ json: { notes: 'Points à confirmer\nChoisir le devis de la véranda.' } });
    });
    await page.goto(`/e2e/fixtures/meeting-recording.html?kind=${kind}`);
    await page.getByRole('button', { name: 'Démarrer l’enregistrement' }).click();
    await expect(page.getByRole('status')).toContainText('Enregistrement');
    await expect(page.getByRole('status')).toContainText('0:02');
    await page.getByRole('button', { name: 'Arrêter', exact: true }).click();
    await expect(page.locator('audio')).toHaveCount(1);
    // Wait for the durable final snapshot, not merely the render.
    await expect.poll(async () => page.evaluate(async () => {
      const modulePath = '/src/lib/meetingRecordingDrafts.ts';
      const { recordingDrafts } = await import(/* @vite-ignore */ modulePath);
      return (await recordingDrafts.get(`browser-test-${new URLSearchParams(location.search).get('kind')}`))?.segments[0]?.size ?? 0;
    })).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator('audio')).toHaveCount(1);
    await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Transcrire et préparer les notes' }).click();
    const add = page.getByRole('button', { name: kind === 'meeting' ? 'Ajouter aux notes de réunion' : 'Ajouter aux rubriques du compte rendu' });
    await expect(add).toBeVisible();
    expect(uploadedBytes).toBeGreaterThan(0);
    await expect(page.getByTestId('saved-notes')).toHaveText('Notes existantes');
    await add.click();
    await expect(page.getByTestId('saved-notes')).toHaveText('Notes existantes\n\nPoints à confirmer\nChoisir le devis de la véranda.');
    await expect(add).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
