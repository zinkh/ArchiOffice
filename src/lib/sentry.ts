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
  });
}

export { Sentry };
