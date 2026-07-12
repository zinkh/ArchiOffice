// Application-level local login, mounted only when OFFLINE_MODE=true. Distinct
// from offlineGateway.ts's /auth/v1 shim (which only satisfies supabaseAdmin's
// own internal calls) — these are the endpoints the client actually calls to
// sign in on a single-account-per-install desktop build.
import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readLocalAccount, writeLocalAccount, signLocalJwt, goTrueUserFromAccount, LocalAccount } from './offlineAccount';

function accountResponse(account: LocalAccount) {
  // Field name matches src/lib/authToken.ts's LocalSession shape (access_token, not token).
  return { access_token: signLocalJwt(account.userId), user: goTrueUserFromAccount(account) };
}

export function createLocalAuthRouter(supabaseAdmin: SupabaseClient): Router {
  const router = Router();

  router.get('/local-status', (req: Request, res: Response) => {
    res.json({ configured: !!readLocalAccount() });
  });

  router.post('/local-setup', express.json(), async (req: Request, res: Response) => {
    if (readLocalAccount()) return res.status(409).json({ error: 'Un compte local existe déjà' });

    const agencyName = (req.body?.agencyName || '').trim();
    const password = req.body?.password || '';
    if (!agencyName || password.length < 8) {
      return res.status(400).json({ error: "Nom d'agence et mot de passe (8 caractères minimum) requis" });
    }

    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const email = 'local@archioffice.local';
    const slug = 'local-' + crypto.randomBytes(4).toString('hex');

    const { error: tenantErr } = await supabaseAdmin.from('tenants').insert({ id: tenantId, slug, name: agencyName });
    if (tenantErr) return res.status(500).json({ error: tenantErr.message });

    const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      tenant_id: tenantId,
      name: agencyName,
      email,
      role: 'admin',
      system_role: 'admin',
    });
    if (profileErr) return res.status(500).json({ error: profileErr.message });

    const passwordHash = await bcrypt.hash(password, 10);
    const account: LocalAccount = { userId, tenantId, email, agencyName, passwordHash };
    writeLocalAccount(account);

    res.json(accountResponse(account));
  });

  router.post('/local-login', express.json(), async (req: Request, res: Response) => {
    const account = readLocalAccount();
    if (!account) return res.status(404).json({ error: 'Aucun compte local configuré' });

    const password = req.body?.password || '';
    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });

    res.json(accountResponse(account));
  });

  return router;
}
