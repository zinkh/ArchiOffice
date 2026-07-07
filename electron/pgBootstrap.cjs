// Orchestrates the two local sidecars for offline mode: an embedded Postgres
// (via the `embedded-postgres` npm package, which bundles real Postgres
// binaries per platform) and PostgREST (a separate static binary, vendored
// at build time — see NOTE below). Called once from electron/main.cjs before
// the bundled server.ts is spawned.
//
// embedded-postgres/pg/async-exit-hook (and their own transitive deps) are
// shipped as loose extraResources, NOT inside the asar-packed `files` set:
// embedded-postgres resolves its own binary path via require/import relative
// to its own module location, which still resolves "inside" app.asar even
// when asarUnpack mirrors those files to app.asar.unpacked — Electron only
// rewrites that path transparently for fs reads, not for child_process.spawn()
// — confirmed on a real Windows install (ENOENT spawning initdb.exe). Shipping
// the whole of node_modules/**/* as loose files instead (i.e. `asar: false`)
// "worked" but made installs extremely slow (thousands of small files, each
// scanned by antivirus) for no reason: everything else the app needs is
// already self-contained (dist-server/server.cjs is esbuild-bundled, dist/ is
// the static SPA). Only this small, explicit dependency closure actually needs
// to exist as real files — see electron-builder.yml's extraResources.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { applyLocalSchema } = require('./applySchema.cjs');

const PG_PORT = 5544; // loopback-only, never exposed outside this machine
const PG_USER = 'archioffice';
const PG_PASSWORD = 'archioffice-local'; // local loopback only — not a real trust boundary
const POSTGREST_PORT = 5555;

/**
 * @param {string | null} resourcesDir `process.resourcesPath` when packaged, null in dev
 *   (dev just uses normal node_modules resolution, since this file already
 *   lives inside the project tree there).
 */
function loadEmbeddedPostgres(resourcesDir) {
  if (resourcesDir) {
    const entry = path.join(resourcesDir, 'node_modules', 'embedded-postgres', 'dist', 'index.js');
    return require(entry).default;
  }
  return require('embedded-postgres').default;
}

/**
 * @param {string} dataDir Persistent app data directory (e.g. Electron's app.getPath('userData'))
 * @param {(msg: string) => void} [log]
 * @param {string | null} [resourcesDir]
 */
async function startLocalPostgres(dataDir, log = console.log, resourcesDir = null) {
  const EmbeddedPostgres = loadEmbeddedPostgres(resourcesDir);
  const databaseDir = path.join(dataDir, 'pgdata');
  const isFirstRun = !fs.existsSync(databaseDir);

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
  });

  if (isFirstRun) {
    log('[pgBootstrap] first launch — initialising local Postgres');
    await pg.initialise();
  }
  await pg.start();

  if (isFirstRun) {
    const client = await pg.getPgClient();
    await client.connect();
    try {
      await client.query(`GRANT ALL ON SCHEMA public TO ${PG_USER}`);
      await applyLocalSchema(client, log);
      await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${PG_USER}`);
      await client.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${PG_USER}`);
      log('[pgBootstrap] local schema applied');
    } finally {
      await client.end();
    }
  }

  return pg;
}

/** @param {string | null} resourcesDir */
function postgrestBinaryPath(resourcesDir) {
  const bin = process.platform === 'win32' ? 'postgrest.exe' : 'postgrest';
  // NOTE: unlike embedded-postgres, PostgREST has no npm-packaged binary —
  // it must be downloaded from its GitHub releases and vendored here as an
  // electron-builder extraResource. That download requires GitHub access this
  // dev sandbox's network policy blocks (same constraint as the NSIS tooling
  // in Phase 1) — wire this up in the Windows CI build, then validate the
  // /rest/v1 proxy against the real binary (it was validated against a stub
  // HTTP server here; see the Phase 2 verification notes in the offline plan).
  return resourcesDir
    ? path.join(resourcesDir, 'postgrest', bin)
    : path.join(__dirname, '..', 'vendor', 'postgrest', bin);
}

function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for ${url}`));
          setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

/**
 * @param {(msg: string) => void} [log]
 * @param {string | null} [resourcesDir]
 */
function startPostgrest(log = console.log, resourcesDir = null) {
  const bin = postgrestBinaryPath(resourcesDir);
  if (!fs.existsSync(bin)) {
    throw new Error(`PostgREST binary not found at ${bin} — vendor it via the Windows build step.`);
  }
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: PG_USER, // no RLS locally (see offline plan) — every request acts as this role
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
    },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) log(`[pgBootstrap] PostgREST exited unexpectedly (code ${code})`);
  });
  return child;
}

/**
 * @param {string} dataDir
 * @param {(msg: string) => void} [log]
 * @param {string | null} [resourcesDir]
 */
async function startOfflineDataStack(dataDir, log = console.log, resourcesDir = null) {
  const pg = await startLocalPostgres(dataDir, log, resourcesDir);
  const postgrest = startPostgrest(log, resourcesDir);
  await waitForHttp(`http://127.0.0.1:${POSTGREST_PORT}/`, 15000);
  log('[pgBootstrap] PostgREST ready');
  return {
    postgrestUrl: `http://127.0.0.1:${POSTGREST_PORT}`,
    stop: async () => {
      postgrest.kill();
      await pg.stop();
    },
  };
}

module.exports = { startLocalPostgres, startPostgrest, startOfflineDataStack, PG_PORT, PG_USER, PG_PASSWORD, POSTGREST_PORT };
