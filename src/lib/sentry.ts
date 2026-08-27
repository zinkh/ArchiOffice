// Browser-side error reporting. No-ops when VITE_SENTRY_DSN isn't set at
// build time (see vite.config.ts's `define` block for how DigitalOcean's
// build-time env vars get baked in) — so local dev stays silent by default.
import * as Sentry from '@sentry/react';

// Redacts likely-PII substrings (emails, bearer/JWT/opaque tokens) from
// event text before it leaves the browser — mirrors instrument.ts's backend
// scrubbing. captureConsoleIntegration forwards whatever was passed to
// console.error as-is, which across this app can include a user's email or
// an auth token interpolated into a debug log.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

function redactText(value: string): string {
  return value.replace(EMAIL_RE, '[email redacted]').replace(TOKEN_RE, '[token redacted]');
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v);
    return out;
  }
  return value;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete (event.request as any).cookies;
    delete (event.request as any).data;
    if (event.request.headers) delete (event.request.headers as any).authorization;
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  if (event.message) event.message = redactText(event.message);
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(v => (v.value ? { ...v, value: redactText(v.value) } : v));
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(b => ({
      ...b,
      message: b.message ? redactText(b.message) : b.message,
      data: b.data ? (scrubValue(b.data) as typeof b.data) : b.data,
    }));
  }
  return event;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
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
      return scrubEvent(event);
    },
  });
}

export { Sentry };
