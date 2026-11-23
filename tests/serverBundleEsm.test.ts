// Le serveur de production est compilé en ESM (scripts/build-server.mjs) avec les paquets de node_modules en
// imports externes. Un paquet CommonJS importé en nommé (`import { saveAs } from 'file-saver'`) ne démarre pas :
// Node refuse l'import (« Named export not found ») et le déploiement échoue après la mise en ligne du build.
// Ce test compile le vrai serveur et exige que le build le détecte (code de sortie) et que `file-saver` soit
// recopié dans le bundle plutôt que laissé en import externe.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const outdir = mkdtempSync(join(tmpdir(), 'archioffice-server-'));
afterAll(() => rmSync(outdir, { recursive: true, force: true }));

describe('compilation du serveur de production', () => {
  it('se compile sans import nommé introuvable et sans importer file-saver en externe', () => {
    // Un import nommé manquant fait échouer le script : execFileSync lève alors une erreur.
    execFileSync('node', ['scripts/build-server.mjs'], {
      cwd: process.cwd(), env: { ...process.env, SERVER_BUILD_OUTDIR: outdir }, stdio: 'pipe',
    });
    const bundle = readFileSync(join(outdir, 'server.mjs'), 'utf8');
    expect(bundle).not.toMatch(/from\s+"file-saver"/);
  }, 120_000);
});
