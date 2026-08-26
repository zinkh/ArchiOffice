// Preloaded via `--import ./instrument.ts` (see package.json's dev/start
// scripts) so Sentry.init() runs before server.ts's own imports — including
// express — are resolved. Under ESM, a module's imports are always fully
// evaluated before any of its top-level code runs, so calling Sentry.init()
// from inside server.ts itself (even as the very first statement) is always
// too late for Sentry's auto-instrumentation to patch express at import
// time. This file must stay free of other local imports so it loads fast
// and doesn't itself pull in anything Sentry needs to instrument.
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';

dotenv.config();

// Redacts likely-PII substrings (emails, bearer/JWT/opaque tokens) from
// event text, and strips fields Sentry might otherwise carry verbatim
// (auth headers, cookies, raw request bodies). captureConsoleIntegration
// forwards whatever was passed to console.error/warn as-is — including
// interpolated user data (an email in an error message, a raw request
// body logged for debugging) — so this runs on every event, not just the
// ones from an explicit Sentry.captureException call. No local imports
// here per the file-level comment above, so this stays self-contained
// rather than living in its own module.
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
    if (event.request.headers) {
      delete (event.request.headers as any).authorization;
      delete (event.request.headers as any).cookie;
    }
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

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // Every existing console.error/warn across server.ts and the agents
    // package becomes a Sentry event without touching each call site —
    // most routes already catch their own errors and just log them.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    beforeSend: scrubEvent,
  });
} else {
  console.warn('[sentry] SENTRY_DSN not set — error reporting disabled.');
}
