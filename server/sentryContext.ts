// Phase 6 of the engineering-maturity plan: Sentry is already wired into
// server.ts (see instrument.ts) — `captureConsoleIntegration` turns every
// existing `console.error` into a Sentry event with zero per-call-site
// changes, which is why the whole codebase still has hundreds of bare
// `console.error(e)` calls. The gap isn't "no monitoring", it's that those
// auto-captured events carry no tenant_id/route/user context, making them
// hard to triage (which tenant hit this? which route?). This adds that
// context on top, scoped to the route handlers touched by the security
// fixes in Phases 2 and 4 — not a blanket sweep of the ~440 console.error
// call sites across server.ts and src/.
//
// Deliberately keeps the console.error call alongside the explicit
// Sentry.captureException: local dev (SENTRY_DSN unset) still gets terminal
// output, and Sentry's default Dedupe integration collapses the resulting
// pair of identical-looking events (from captureConsoleIntegration and this
// explicit call) into one — this is exactly what that integration exists
// for. Worth revisiting only if duplicate events actually show up in Sentry.
import * as Sentry from '@sentry/node';

export interface CaptureContext {
  route: string;
  tenantId?: string;
  userId?: string;
}

export function captureWithContext(error: unknown, context: CaptureContext): void {
  console.error(`[${context.route}]`, error);
  Sentry.withScope(scope => {
    scope.setTag('route', context.route);
    if (context.tenantId) scope.setTag('tenant_id', context.tenantId);
    if (context.userId) scope.setTag('user_id', context.userId);
    Sentry.captureException(error);
  });
}
