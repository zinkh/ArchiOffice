// Mounted only when OFFLINE_MODE=true. Makes the app's own Express server act
// as the Supabase origin that `supabaseAdmin` (in server.ts) already talks to:
// createClient(SUPABASE_URL, KEY) hardcodes /rest/v1, /auth/v1 and /storage/v1
// off a single base URL (see the offline-mode plan for the research behind
// this), so `SUPABASE_URL` is pointed at this same server in offline builds
// and these three route groups satisfy those three sub-clients — without
// touching any of the 259 existing /api/* routes or their helpers.
import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  verifyLocalJwt,
  readLocalAccount,
  readAdminUsers,
  writeAdminUsers,
  storageDir,
  goTrueUserFromAccount,
  AdminUser,
} from './offlineAccount';

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [, token] = header.split(' ');
  return token || null;
}

function mountAuthShim(router: Router) {
  router.get('/user', (req: Request, res: Response) => {
    const token = bearerToken(req);
    const claims = token ? verifyLocalJwt(token) : null;
    if (!claims) return res.status(401).json({ message: 'Invalid token' });
    const account = readLocalAccount();
    if (!account || account.userId !== claims.sub) return res.status(401).json({ message: 'Invalid token' });
    res.json(goTrueUserFromAccount(account));
  });

  router.post('/admin/users', express.json(), (req: Request, res: Response) => {
    const users = readAdminUsers();
    const newUser: AdminUser = {
      id: (req.body?.id as string) || `local-${Date.now()}`,
      email: req.body?.email || '',
      user_metadata: req.body?.user_metadata || {},
      created_at: new Date().toISOString(),
    };
    users.push(newUser);
    writeAdminUsers(users);
    res.json(newUser);
  });

  router.get('/admin/users/:id', (req: Request, res: Response) => {
    const account = readLocalAccount();
    if (account && account.userId === req.params.id) {
      return res.json(goTrueUserFromAccount(account));
    }
    const user = readAdminUsers().find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });

  router.delete('/admin/users/:id', (req: Request, res: Response) => {
    const users = readAdminUsers();
    writeAdminUsers(users.filter((u) => u.id !== req.params.id));
    res.json({});
  });
}

function mountStorageShim(router: Router) {
  router.post('/bucket', express.json(), (req: Request, res: Response) => {
    const id = req.body?.id || req.body?.name;
    if (!id) return res.status(400).json({ message: 'Bucket id required' });
    storageDir(id);
    res.json({ name: id });
  });

  router.get('/bucket/:id', (req: Request, res: Response) => {
    const dir = path.join(storageDir(req.params.id), '..');
    if (!fs.existsSync(path.join(dir, req.params.id))) {
      return res.status(404).json({ message: 'Bucket not found' });
    }
    res.json({ id: req.params.id, name: req.params.id, public: true });
  });

  // Order matters: the public-URL GET route is more specific than the
  // generic object upload/remove route below, so it must be registered first.
  router.get('/object/public/:bucket/*', (req: Request, res: Response) => {
    const relPath = (req.params as any)[0] as string;
    const filePath = path.join(storageDir(req.params.bucket), relPath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Object not found' });
    res.sendFile(filePath);
  });

  router.post(
    '/object/:bucket/*',
    express.raw({ type: '*/*', limit: '50mb' }),
    (req: Request, res: Response) => {
      const relPath = (req.params as any)[0] as string;
      const filePath = path.join(storageDir(req.params.bucket), relPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, req.body);
      res.json({ Id: relPath, Key: `${req.params.bucket}/${relPath}` });
    },
  );

  router.put(
    '/object/:bucket/*',
    express.raw({ type: '*/*', limit: '50mb' }),
    (req: Request, res: Response) => {
      const relPath = (req.params as any)[0] as string;
      const filePath = path.join(storageDir(req.params.bucket), relPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, req.body);
      res.json({ Id: relPath, Key: `${req.params.bucket}/${relPath}` });
    },
  );

  router.delete('/object/:bucket', express.json(), (req: Request, res: Response) => {
    const prefixes: string[] = req.body?.prefixes || [];
    const dir = storageDir(req.params.bucket);
    for (const p of prefixes) {
      const filePath = path.join(dir, p);
      fs.rmSync(filePath, { force: true });
    }
    res.json(prefixes.map((p) => ({ name: p })));
  });
}

export interface OfflineGatewayOptions {
  postgrestUrl: string;
}

export function createOfflineGateway({ postgrestUrl }: OfflineGatewayOptions): Router {
  const router = Router();

  // Mounted before server.ts's own express.json()/urlencoded() so PostgREST
  // requests keep their raw body stream intact for the proxy to forward.
  router.use('/rest/v1', createProxyMiddleware({ target: postgrestUrl, changeOrigin: true }));

  const authRouter = Router();
  mountAuthShim(authRouter);
  router.use('/auth/v1', authRouter);

  const storageRouter = Router();
  mountStorageShim(storageRouter);
  router.use('/storage/v1', storageRouter);

  return router;
}
