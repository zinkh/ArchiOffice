import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from './supabaseAdmin.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = {
    id: data.user.id,
    email: data.user.email,
    role: (data.user.user_metadata?.system_role as string) ?? 'user',
  };

  next();
}

// Lighter version: attaches user if token present, but doesn't block unauthenticated requests
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.slice(7);
  if (token) {
    const { data } = await supabaseAdmin.auth.getUser(token);
    if (data.user) {
      req.user = { id: data.user.id, email: data.user.email };
    }
  }
  next();
}
