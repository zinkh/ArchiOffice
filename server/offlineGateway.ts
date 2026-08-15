// Mounted only when OFFLINE_MODE=true. Makes the app's own Express server act
// as the Supabase origin that `supabaseAdmin` (in server.ts) already talks to:
// createClient(SUPABASE_URL, KEY) hardcodes /rest/v1, /auth/v1 and /storage/v1
// off a single base URL (see the offline-mode plan for the research behind
// this), so `SUPABASE_URL` is pointed at this same server in offline builds
// and these three route groups satisfy those three sub-clients — without
// touching any of the 259 existing /api/* routes or their helpers.
import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
import { readCloudLinkState } from './cloudLinkState';
import { recordPendingPush } from './localPendingPush';

/** `?id=eq.<value>` — this app's update/delete calls consistently target a
 *  single row via .eq('id', x), which PostgREST renders as this query param. */
function rowIdFromEqFilter(url: string): string | null {
  const match = url.match(/[?&]id=eq\.([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function tableNameFromUrl(url: string): string {
  return url.split('?')[0].replace(/^\//, '');
}

async function recordPendingPushForRequest(pgUrl: string, req: any): Promise<void> {
  // Not cloud-linked yet (or the initial import hasn't finished) — the
  // _local_pending_push table may not even exist yet (it's bootstrapped by
  // server/cloudSync.ts only once linked), and there's no cloud to push to anyway.
  const state = readCloudLinkState();
  if (!state?.importCompleted) return;

  const table = tableNameFromUrl(req.url);
  const opByMethod: Record<string, string> = { POST: 'INSERT', PATCH: 'UPDATE', PUT: 'UPDATE', DELETE: 'DELETE' };
  const op = opByMethod[req.method];
  if (!op) return;

  if (op === 'INSERT') {
    const bodies = Array.isArray(req.body) ? req.body : [req.body];
    for (const row of bodies) {
      if (row?.id) await recordPendingPush(pgUrl, table, String(row.id), op);
    }
    return;
  }

  const rowId = rowIdFromEqFilter(req.url);
  if (rowId) await recordPendingPush(pgUrl, table, rowId, op);
  // A bulk update/delete without an id=eq. filter isn't captured in v1 —
  // this codebase's write call sites consistently target a single row via
  // .eq('id', x) (confirmed by grepping server.ts's supabaseAdmin.from(...)
  // .update()/.insert() call sites), so this is a rare/non-existent case
  // today rather than a silent gap in normal usage.
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [, token] = header.split(' ');
  return token || null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Gate every write/admin capability of the gateway behind the same random,
// per-launch secret that `supabaseAdmin` already sends as its own Authorization
// header (see electron/main.cjs's SUPABASE_SERVICE_ROLE_KEY) — nothing else on
// the machine knows this value, so this closes the local network off entirely
// from a stranger without weakening anything `supabaseAdmin` itself relies on.
function requireGatewaySecret(secret: string) {
  return (req: Request, res: Response, next: () => void) => {
    const token = bearerToken(req);
    if (!token || !timingSafeEqualStr(token, secret)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  };
}

function mountAuthShim(router: Router, serviceRoleKey: string) {
  // Called with the caller's own local-account JWT (see verifyLocalJwt below),
  // not the service-role secret — this mirrors real GoTrue's GET /auth/v1/user,
  // which validates whatever access token it's handed rather than requiring
  // the service role. The JWT itself is unforgeable (random per-install secret,
  // written with 0600 perms — see offlineAccount.ts), so this is already gated.
  router.get('/user', (req: Request, res: Response) => {
    const token = bearerToken(req);
    const claims = token ? verifyLocalJwt(token) : null;
    if (!claims) return res.status(401).json({ message: 'Invalid token' });
    const account = readLocalAccount();
    if (!account || account.userId !== claims.sub) return res.status(401).json({ message: 'Invalid token' });
    res.json(goTrueUserFromAccount(account));
  });

  // /admin/* mirrors GoTrue's admin API, which only ever accepts the service
  // role key — gate it the same way here instead of leaving it wide open.
  router.use('/admin', requireGatewaySecret(serviceRoleKey));

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

// Resolves a bucket-relative object path and rejects anything (`../…`,
// absolute paths) that would resolve outside that bucket's own directory —
// none of the write/read/delete handlers below validated this before, so a
// crafted relative path could otherwise reach arbitrary files on disk.
function safeObjectPath(bucket: string, relPath: string): string | null {
  const dir = storageDir(bucket);
  const resolved = path.resolve(dir, relPath);
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (resolved !== dir && !resolved.startsWith(dirWithSep)) return null;
  return resolved;
}

function mountStorageShim(router: Router, serviceRoleKey: string) {
  // Bucket administration (create/inspect) and object writes/deletes require
  // the service-role secret, matching real Supabase Storage (RLS or service
  // role only). GET /object/public/* is deliberately left open below — that's
  // the one route meant to be fetched unauthenticated, the same way a real
  // "public" bucket's objects are (see the offline-mode plan; the renderer
  // loads these directly as <img src>, which can't attach an Authorization
  // header), and it only ever serves objects already living under a bucket
  // whose objects the app treats as public.
  router.post('/bucket', requireGatewaySecret(serviceRoleKey), express.json(), (req: Request, res: Response) => {
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
    // Always reports `public: false` here — this shim's actual access model
    // doesn't key off this flag (writes/deletes always require the gateway
    // secret above; unauthenticated GETs are only ever served at the fixed
    // /object/public/* and /object/sign/* routes below, for whichever
    // buckets server.ts's caller chooses to fetch through them), so there's
    // nothing for server.ts's ensureStorageBuckets() migration check to do.
    res.json({ id: req.params.id, name: req.params.id, public: false });
  });

  // No-op: mirrors real Supabase Storage's updateBucket() response shape so
  // ensureStorageBuckets()'s public→private migration call doesn't 404 here
  // (moot in this shim — see the GET handler above).
  router.put('/bucket/:id', requireGatewaySecret(serviceRoleKey), express.json(), (_req: Request, res: Response) => {
    res.json({ message: 'ok' });
  });

  // Order matters: the public-URL GET route is more specific than the
  // generic object upload/remove route below, so it must be registered first.
  router.get('/object/public/:bucket/*', (req: Request, res: Response) => {
    const relPath = (req.params as any)[0] as string;
    const filePath = safeObjectPath(req.params.bucket, relPath);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'Object not found' });
    res.sendFile(filePath);
  });

  // Mirrors real Supabase Storage's sign/token flow for server/routes/
  // storageAccess.ts's createSignedUrl() call: POST (service-role only,
  // called server-side by supabaseAdmin) mints a random token good for
  // `expiresIn` seconds; GET (deliberately unauthenticated, same reasoning
  // as /object/public/* above — the renderer loads this as a plain <img
  // src>/<a href>) serves the object only while presenting that token.
  const signedTokens = new Map<string, { bucket: string; path: string; expiresAt: number }>();
  router.post(
    '/object/sign/:bucket/*',
    requireGatewaySecret(serviceRoleKey),
    express.json(),
    (req: Request, res: Response) => {
      const relPath = (req.params as any)[0] as string;
      if (!safeObjectPath(req.params.bucket, relPath)) {
        return res.status(400).json({ message: 'Invalid object path' });
      }
      const expiresIn = Number(req.body?.expiresIn) > 0 ? Number(req.body.expiresIn) : 3600;
      const token = crypto.randomBytes(24).toString('hex');
      signedTokens.set(token, { bucket: req.params.bucket, path: relPath, expiresAt: Date.now() + expiresIn * 1000 });
      res.json({ signedURL: `/object/sign/${req.params.bucket}/${relPath}?token=${token}` });
    },
  );

  router.get('/object/sign/:bucket/*', (req: Request, res: Response) => {
    const relPath = (req.params as any)[0] as string;
    const token = req.query.token as string | undefined;
    const entry = token ? signedTokens.get(token) : undefined;
    if (!entry || entry.bucket !== req.params.bucket || entry.path !== relPath) {
      return res.status(404).json({ message: 'Object not found' });
    }
    if (Date.now() > entry.expiresAt) {
      signedTokens.delete(token!);
      return res.status(404).json({ message: 'Signed URL expired' });
    }
    const filePath = safeObjectPath(req.params.bucket, relPath);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'Object not found' });
    res.sendFile(filePath);
  });

  router.post(
    '/object/:bucket/*',
    requireGatewaySecret(serviceRoleKey),
    express.raw({ type: '*/*', limit: '50mb' }),
    (req: Request, res: Response) => {
      const relPath = (req.params as any)[0] as string;
      const filePath = safeObjectPath(req.params.bucket, relPath);
      if (!filePath) return res.status(400).json({ message: 'Invalid object path' });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, req.body);
      res.json({ Id: relPath, Key: `${req.params.bucket}/${relPath}` });
    },
  );

  router.put(
    '/object/:bucket/*',
    requireGatewaySecret(serviceRoleKey),
    express.raw({ type: '*/*', limit: '50mb' }),
    (req: Request, res: Response) => {
      const relPath = (req.params as any)[0] as string;
      const filePath = safeObjectPath(req.params.bucket, relPath);
      if (!filePath) return res.status(400).json({ message: 'Invalid object path' });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, req.body);
      res.json({ Id: relPath, Key: `${req.params.bucket}/${relPath}` });
    },
  );

  router.delete('/object/:bucket', requireGatewaySecret(serviceRoleKey), express.json(), (req: Request, res: Response) => {
    const prefixes: string[] = req.body?.prefixes || [];
    for (const p of prefixes) {
      const filePath = safeObjectPath(req.params.bucket, p);
      if (!filePath) continue;
      fs.rmSync(filePath, { force: true });
    }
    res.json(prefixes.map((p) => ({ name: p })));
  });
}

export interface OfflineGatewayOptions {
  postgrestUrl: string;
  /** Direct local Postgres connection string (electron/main.cjs's
   *  OFFLINE_PG_URL) — used only to record pending-push entries for cloud
   *  sync (server/localPendingPush.ts); business-data reads/writes never use
   *  this, they always go through the /rest/v1 → PostgREST proxy above. */
  pgUrl?: string;
  /** electron/main.cjs's random per-launch SUPABASE_SERVICE_ROLE_KEY — the
   *  only thing `supabaseAdmin` authenticates itself with. Required so this
   *  gateway can demand it back on every non-public route instead of trusting
   *  anything that can reach the port (see the offline-mode plan / security
   *  audit: this server used to listen on 0.0.0.0 with zero auth here). */
  serviceRoleKey: string;
}

export function createOfflineGateway({ postgrestUrl, pgUrl, serviceRoleKey }: OfflineGatewayOptions): Router {
  const router = Router();

  // Mounted before server.ts's own express.json()/urlencoded() so PostgREST
  // requests keep their raw body stream intact for the proxy to forward —
  // except this route specifically now needs a parsed body too (to capture
  // an INSERT's row id for cloud-sync bookkeeping), so it gets its own
  // scoped express.json() + the "fixRequestBody" pattern (re-serialize
  // req.body back onto the outgoing proxied request, since express.json()
  // already consumed the raw stream).
  router.use(
    '/rest/v1',
    requireGatewaySecret(serviceRoleKey),
    express.json({ limit: '10mb' }),
    createProxyMiddleware({
      target: postgrestUrl,
      changeOrigin: true,
      on: {
        proxyReq: (proxyReq, req: any) => {
          // supabaseAdmin always sends Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
          // (a random local secret generated per launch — see electron/main.cjs —
          // not a real JWT). PostgREST has no PGRST_JWT_SECRET configured, since
          // it isn't meant to verify anything locally: every request should run
          // as the fixed PGRST_DB_ANON_ROLE (no RLS locally), and real auth
          // already happened in server.ts's own middleware before a request ever
          // reaches this proxy. Forwarding that header verbatim instead makes
          // PostgREST reject every single request with "Server lacks JWT secret"
          // (confirmed on a real Windows install) — strip it before proxying.
          proxyReq.removeHeader('authorization');

          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
          }

          if (pgUrl && req.method !== 'GET') {
            recordPendingPushForRequest(pgUrl, req).catch((err) => {
              console.error('[offlineGateway] Failed to record pending push:', err.message);
            });
          }
        },
      },
    }),
  );

  const authRouter = Router();
  mountAuthShim(authRouter, serviceRoleKey);
  router.use('/auth/v1', authRouter);

  const storageRouter = Router();
  mountStorageShim(storageRouter, serviceRoleKey);
  router.use('/storage/v1', storageRouter);

  return router;
}
