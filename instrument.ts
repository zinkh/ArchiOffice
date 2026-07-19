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

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    // Every existing console.error/warn across server.ts and the agents
    // package becomes a Sentry event without touching each call site —
    // most routes already catch their own errors and just log them.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  });
} else {
  console.warn('[sentry] SENTRY_DSN not set — error reporting disabled.');
}
