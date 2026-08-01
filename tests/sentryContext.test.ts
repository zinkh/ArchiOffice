// Phase 6: captureWithContext() is a thin wrapper (console.error + tagged
// Sentry.captureException) — Sentry.init() never runs in the test process
// (tests import createApp() directly, not via --import ./instrument.ts), so
// this only verifies the wrapper doesn't throw and still logs locally, not
// that an event actually reaches Sentry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWithContext } from '../server/sentryContext';

describe('captureWithContext', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs the error prefixed with the route, and does not throw without Sentry.init() having run', () => {
    const error = new Error('boom');
    expect(() => captureWithContext(error, { route: 'PUT /api/invoices/:id', tenantId: 'tenant-1', userId: 'user-1' })).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[PUT /api/invoices/:id]', error);
  });

  it('works with tenantId/userId omitted', () => {
    const error = new Error('boom');
    expect(() => captureWithContext(error, { route: 'GET /api/health' })).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[GET /api/health]', error);
  });
});
