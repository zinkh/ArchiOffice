// Express middleware factory wrapping a Zod schema — Phase 5 of the
// engineering-maturity plan. Only ever a pass/fail gate ahead of the route
// handler: on success it calls next() without touching req.body, so an
// already-valid request behaves exactly as it did before this middleware
// existed (the handler still destructures req.body itself, unchanged). On
// failure it returns 400 with the list of Zod issues, rather than letting a
// malformed payload reach a raw Supabase insert/update and fail with an
// opaque Postgres error (or silently write garbage).
import type { ZodType } from 'zod';

export function validateBody(schema: ZodType) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    next();
  };
}
