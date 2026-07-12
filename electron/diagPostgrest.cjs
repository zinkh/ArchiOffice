// TEMPORARY diagnostic script — not part of the packaged app, not referenced
// by electron-builder.yml. Run only from build-windows.yml's "Diagnose
// PostgREST startup" CI step to capture PostgREST's full stdout/stderr over
// a longer window than the packaged app waits before giving up, since a real
// Windows install showed PostgREST logging "API server listening" and then
// exiting with code 3 within milliseconds — too fast to see why. Delete this
// file and its CI step once the real crash cause is found and fixed.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  startLocalPostgres,
  postgrestBinaryPath,
  PG_USER,
  PG_PASSWORD,
  PG_PORT,
  POSTGREST_PORT,
} = require('./pgBootstrap.cjs');

async function main() {
  const dataDir = path.resolve('.diag-data');
  fs.rmSync(dataDir, { recursive: true, force: true });

  console.log('[diag] starting local Postgres + applying schema...');
  const pg = await startLocalPostgres(dataDir, console.log, null);
  console.log('[diag] Postgres up, starting postgrest...');

  const bin = postgrestBinaryPath(null);
  const libDir = path.resolve('node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'Path';

  const child = spawn(bin, [], {
    env: {
      ...process.env,
      [pathKey]: `${libDir}${path.delimiter}${process.env[pathKey] || ''}`,
      PGRST_DB_URI: `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: PG_USER,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
    },
  });
  child.stdout.on('data', (d) => console.log('[postgrest]', d.toString()));
  child.stderr.on('data', (d) => console.error('[postgrest:err]', d.toString()));
  child.on('exit', (code, signal) => console.log('[diag] postgrest exited, code =', code, 'signal =', signal));
  child.on('error', (err) => console.error('[diag] postgrest spawn error:', err));

  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log('[diag] 10s elapsed, tearing down...');
  child.kill();
  await pg.stop();
}

main().catch((err) => {
  console.error('[diag] FAILED:', err);
  process.exit(1);
});
