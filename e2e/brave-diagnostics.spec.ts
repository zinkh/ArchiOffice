import { test, expect } from '@playwright/test';

// Diagnostics are read-only and restricted to public pages.
// A Brave executable must be explicitly configured; Chromium is not silently substituted.
test.skip(!process.env.PLAYWRIGHT_BRAVE_EXECUTABLE_PATH, 'Brave must be configured for this diagnostic suite');

const pages = [
  { route: '/', label: 'landing' },
  { route: '/login', label: 'login' },
  { route: '/register', label: 'register' },
];

for (const { route, label } of pages) {
  test(`Brave diagnostic — ${label}`, async ({ page, browser }, testInfo) => {
    const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173').origin;
    const report = {
      route,
      project: testInfo.project.name,
      browserVersion: browser.version(),
      finalURL: '',
      status: 0,
      userAgent: '',
      isBrave: null as boolean | null,
      rootMounted: false,
      overflowPixels: 0,
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      failedRequests: [] as string[],
      httpErrors: [] as string[],
      navigationError: '',
    };

    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => {
      if (new URL(request.url()).origin === origin) {
        report.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
      }
    });
    page.on('response', response => {
      if (new URL(response.url()).origin === origin && response.status() >= 400) {
        report.httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    try {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      report.status = response?.status() ?? 0;
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
      await page.waitForTimeout(1500); // Allow lazy route errors to surface.
      report.rootMounted = await page.locator('#root').evaluate(el => el.childElementCount > 0);
      const details = await page.evaluate(async () => {
        const brave = (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave;
        return {
          userAgent: navigator.userAgent,
          isBrave: (await brave?.isBrave?.().catch(() => false)) ?? null,
          overflowPixels: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        };
      });
      report.userAgent = details.userAgent;
      report.isBrave = details.isBrave;
      report.overflowPixels = details.overflowPixels;
      report.finalURL = page.url();
    } catch (error) {
      report.navigationError = String(error);
      report.finalURL = page.url();
    } finally {
      console.log(`BRAVE_DIAGNOSTIC ${JSON.stringify(report)}`);
      await testInfo.attach(`brave-${label}-diagnostic.json`, {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json',
      });
      try {
        await testInfo.attach(`brave-${label}-screenshot.png`, {
          body: await page.screenshot({ fullPage: true, timeout: 10_000 }),
          contentType: 'image/png',
        });
      } catch { /* The JSON report still records navigation failures. */ }
    }

    expect(report.navigationError, 'navigation error').toBe('');
    expect(report.status, 'document HTTP status').toBeGreaterThanOrEqual(200);
    expect(report.status, 'document HTTP status').toBeLessThan(400);
    expect(report.rootMounted, 'React root mounted').toBe(true);
    expect(report.pageErrors, 'uncaught JavaScript exceptions').toEqual([]);
    expect(report.httpErrors.filter(e => /^5\d\d /.test(e)), 'server errors').toEqual([]);
    expect(report.overflowPixels, 'horizontal overflow in CSS pixels').toBeLessThanOrEqual(2);
  });
}
