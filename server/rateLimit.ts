// Shared rate limiters for the unauthenticated, internet-reachable public
// routes flagged by the security audit — sign-up, password recovery, and
// local login had no brute-force/spam protection at all (only trust proxy +
// Supabase's own auth endpoints were protected, this app's own routes weren't).
import rateLimit from 'express-rate-limit';

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
