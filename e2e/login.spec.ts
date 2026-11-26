import { test, expect } from '@playwright/test';

// Public-route smoke test: no real account or production data is required.
test('the login page mounts on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/ArchiOffice/i);
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('#root')).not.toContainText('Une erreur est survenue.');
});
