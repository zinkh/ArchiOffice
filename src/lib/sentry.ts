// Browser-side error reporting. No-ops when VITE_SENTRY_DSN isn't set at
// build time (see vite.config.ts's `define` block for how DigitalOcean's
// build-time env vars get baked in) — so local dev stays silent by default.
import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    // Mirrors the backend: every existing console.error across the app
    // becomes a Sentry event without touching each call site.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    beforeSend(event) {
      // WebGL context loss is a normal, recoverable GPU/browser condition
      // (low memory, backgrounded tab, too many contexts on lower-end
      // devices) — MapLibreCadastre already shows dedicated recovery UI for
      // it. Drop it here as a backstop in case it ever reaches Sentry
      // through a path other than the console.error one we handle directly.
      const message = event.exception?.values?.[0]?.value || event.message || '';
      if (/webgl context was lost/i.test(message)) return null;
      return event;
    },
  });
}

export { Sentry };
