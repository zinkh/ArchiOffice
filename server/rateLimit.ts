// Shared rate limiters for the unauthenticated, internet-reachable public
// routes flagged by the security audit — sign-up, password recovery, and
// local login had no brute-force/spam protection at all (only trust proxy +
// Supabase's own auth endpoints were protected, this app's own routes weren't).
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Sign-up / resend-confirmation / forgot-password: generous enough for a real
// user retrying a typo, tight enough to stop mass account creation or an
// email-bombing loop against one address.
export const publicAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Veuillez réessayer plus tard.' },
});

// Local (offline/Electron) login — bcrypt comparison per attempt, so this
// also caps CPU spent on a brute-force loop even though the server now only
// listens on loopback.
export const localLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Veuillez réessayer plus tard.' },
});

// AI generation endpoints bill against the tenant's credit balance, but that
// balance is only deducted *after* a generation completes — a burst of
// concurrent requests can run past a balance check before the first deduction
// lands. Cap request rate independent of the credit system, keyed by user so
// one abusive account can't starve others sharing the Gemini API key.
export const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || ipKeyGenerator(req.ip || ''),
  message: { error: 'Trop de requêtes IA. Veuillez patienter avant de réessayer.' },
});

// Outbound mail relays a tenant's own SMTP credentials — still worth capping
// so a compromised/misused account can't be turned into a spam cannon.
export const sendEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || ipKeyGenerator(req.ip || ''),
  message: { error: 'Trop d\'emails envoyés. Veuillez réessayer plus tard.' },
});

// The Stancer payment webhook is unauthenticated by necessity (it's called by
// Stancer, not a logged-in user) and its handler re-fetches the payment from
// Stancer's API for every call — an unbounded flood of requests here both
// hammers our own server and burns calls against our Stancer API key. Capped
// by IP well above any plausible legitimate delivery rate.
export const billingWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => ipKeyGenerator(req.ip || ''),
  message: { error: 'Too many requests' },
});
