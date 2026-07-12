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
    // On Windows, initdb defaults to the OS codepage (e.g. WIN1252) rather
    // than UTF8 unless told otherwise — schema.sql/migrate_*.sql contain
    // UTF-8 characters (box-drawing, Greek letters) in French comments, which
    // then fail to insert with "has no equivalent in encoding WIN1252"
    // (confirmed on a real Windows install). Force UTF8 explicitly so the
    // cluster's encoding doesn't depend on the host machine's locale.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (isFirstRun) {
    log('[pgBootstrap] first launch — initialising local Postgres');
    await pg.initialise();
  }
  await pg.start();

  if (isFirstRun) {
    try {
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
    } catch (err) {
      // Without this, a failed first run leaves a half-initialised pgdata/
      // directory behind — isFirstRun is based on that directory's mere
      // existence, so every subsequent launch would silently skip
      // initialise()/applyLocalSchema() forever and stay broken, requiring
      // the user to manually find and delete the AppData folder (confirmed
      // painful across several real-Windows bug reports in a row). Instead,
      // clean up so the next launch is a true first run and retries on its own.
      log('[pgBootstrap] first-run setup failed, cleaning up for a fresh retry on next launch:', err);
      await pg.stop().catch(() => {});
      fs.rmSync(databaseDir, { recursive: true, force: true });
      throw err;
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
 * PostgREST's Windows binary dynamically links against libpq (and libpq's
 * own dependencies: OpenSSL, zlib, ICU, ...) — confirmed via the actual
 * Windows error dialog on a real install: "LIBPQ.dll est introuvable". The
 * official PostgREST Windows release ships only postgrest.exe itself, no
 * libpq.dll alongside it (the downloaded zip contains a single file — ruled
 * out separately). Rather than vendor a second copy of these DLLs, reuse the
 * ones that already ship inside the embedded-postgres Windows platform
 * package (bundled anyway for postgres.exe/initdb.exe themselves — see
 * electron-builder.yml's node_modules/@embedded-postgres extraResource) by
 * adding its bin/ directory to the child process's DLL search path: Windows
 * falls back to PATH when a DLL isn't found next to the launching exe.
 * @param {string | null} resourcesDir
 */
function dllSearchPathEnv(resourcesDir) {
  if (process.platform !== 'win32' || !resourcesDir) return {};
  const libDir = path.join(resourcesDir, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
  // process.env's PATH key is case-insensitive on Windows (usually "Path") —
  // preserve whatever casing is already there instead of adding a second,
  // possibly-conflicting "PATH" key.
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'Path';
  return { [pathKey]: `${libDir}${path.delimiter}${process.env[pathKey] || ''}` };
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
      ...dllSearchPathEnv(resourcesDir),
      PGRST_DB_URI: `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: PG_USER, // no RLS locally (see offline plan) — every request acts as this role
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
    },
    // 'inherit' is invisible on a windowless packaged app (same reason
    // electron/main.cjs pipes the spawned server's own output into the log
    // file) — capture PostgREST's own stdout/stderr too.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log('[postgrest]', d.toString().trim()));
  child.stderr.on('data', (d) => log('[postgrest:err]', d.toString().trim()));
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
    // For the rare cases PostgREST can't do (DDL) — see server/cloudSync.ts,
    // which bootstraps a local-only bookkeeping table via a direct pg
    // connection. Never used for ordinary business-data reads/writes; those
    // all still go through the /rest/v1 proxy → PostgREST as usual.
    pgUrl: `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
    stop: async () => {
      postgrest.kill();
      await pg.stop();
    },
  };
}

module.exports = {
  startLocalPostgres,
  startPostgrest,
  startOfflineDataStack,
  postgrestBinaryPath,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  POSTGREST_PORT,
};
