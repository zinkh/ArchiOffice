// Migration des fichiers existants vers l'arborescence lisible
// (server/storageTreeMigration.ts).
//
// Une migration de fichiers qui se trompe perd des documents sans le dire : ce qui
// est verrouillé ici, ce sont les promesses qui l'empêchent. Copier sans supprimer,
// ne jamais écraser, pouvoir reprendre, ne rien changer en simulation, et ne purger
// que ce qu'aucune ligne ne référence plus.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { createDocumentFolderResolver } from '../server/externalStorage/documentFolders';
import {
  planTreeMigration,
  purgeLegacyFiles,
  runTreeMigration,
  type MigrationDeps,
} from '../server/storageTreeMigration';
import { parseStorageRef } from '../server/storagePaths';

const T = '3f1c2a9e-8b7d-4c5e-9a10-1234567890ab';
const UUID1 = '0a1b2c3d-1111-4222-8333-444455556666';
const UUID2 = '0a1b2c3d-2222-4222-8333-444455556666';
const UUID3 = '0a1b2c3d-3333-4222-8333-444455556666';

let root: string;
let db: FakeSupabaseAdmin;
let deps: MigrationDeps;

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const urlOf = (bucket: string, p: string) => `http://local/storage/v1/object/public/${bucket}/${enc(p)}`;

function legacyFile(bucket: string, rel: string, content: string) {
  const file = path.join(root, bucket, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
const read = (bucket: string, rel: string) => fs.readFileSync(path.join(root, bucket, ...rel.split('/')), 'utf8');
const exists = (bucket: string, rel: string) => fs.existsSync(path.join(root, bucket, ...rel.split('/')));
const row = (table: string, id: string) => db.getTable(table).find((r) => r.id === id)!;
const pathOf = (table: string, id: string, column = 'file_url') => parseStorageRef(row(table, id)[column])!.path;

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-migration-'));
  db = new FakeSupabaseAdmin();
  db.seed('projects', [{ id: 'p1', tenant_id: T, project_code: '26014', name: 'Villa Martin' }]);
  deps = {
    db,
    resolver: createDocumentFolderResolver(db),
    storageRoot: (bucket) => path.join(root, bucket),
    publicUrl: urlOf,
    journalPath: path.join(root, '.archioffice-migration.json'),
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Un document de l'affaire, dans son ancien rangement à identifiant. */
function seedDocument(opts: { id?: string; name?: string; phase?: string; content?: string; legacyName?: string } = {}) {
  const id = opts.id ?? 'doc-1';
  const legacy = `${T}/p1/${opts.phase ?? 'DCE'}/${UUID1}/${opts.legacyName ?? 'Plan-RDC.pdf'}`;
  legacyFile('documents', legacy, opts.content ?? 'octets-plan');
  db.seed('documents', [...db.getTable('documents'), {
    id, tenant_id: T, project_id: 'p1', name: opts.name ?? 'Plan RDC.pdf', category: 'Plans',
    phase: opts.phase ?? 'DCE', file_url: urlOf('documents', legacy), uploaded_at: '2026-01-01',
  }]);
  return legacy;
}

describe('simulation', () => {
  it('compte sans rien copier ni modifier', async () => {
    const legacy = seedDocument();
    const before = row('documents', 'doc-1').file_url;
    const filesBefore = listFiles(root);

    const report = await runTreeMigration(deps, T, { dryRun: true });

    expect(report).toMatchObject({ dryRun: true, total: 1, aMigrer: 1, migres: 0, erreurs: 0 });
    expect(report.bytes).toBe('octets-plan'.length);
    expect(row('documents', 'doc-1').file_url).toBe(before);
    expect(listFiles(root)).toEqual(filesBefore);
    expect(exists('documents', legacy)).toBe(true);
  });
});

describe('migration', () => {
  it('copie vers <affaire>/<phase>/<nom affiché>, repointe la ligne et GARDE l\'ancien fichier', async () => {
    const legacy = seedDocument();

    const report = await runTreeMigration(deps, T, { dryRun: false });

    const expected = `${T}/26014 - Villa Martin/DCE/Plan RDC.pdf`;
    expect(report).toMatchObject({ migres: 1, erreurs: 0, introuvables: 0 });
    expect(pathOf('documents', 'doc-1')).toBe(expected);
    expect(read('documents', expected)).toBe('octets-plan');
    // L'ancien fichier est toujours là : un autre poste peut encore le lire.
    expect(exists('documents', legacy)).toBe(true);
  });

  it('ne touche pas aux autres colonnes de la ligne', async () => {
    seedDocument();
    await runTreeMigration(deps, T, { dryRun: false });
    expect(row('documents', 'doc-1')).toMatchObject({
      name: 'Plan RDC.pdf', category: 'Plans', phase: 'DCE', project_id: 'p1', uploaded_at: '2026-01-01',
    });
  });

  it('est idempotente : un second passage ne fait rien', async () => {
    seedDocument();
    await runTreeMigration(deps, T, { dryRun: false });
    const files = listFiles(root);
    const url = row('documents', 'doc-1').file_url;

    const second = await runTreeMigration(deps, T, { dryRun: false });

    expect(second).toMatchObject({ aMigrer: 0, migres: 0, dejaranges: 1 });
    expect(listFiles(root)).toEqual(files);
    expect(row('documents', 'doc-1').file_url).toBe(url);
  });

  it('n\'écrase jamais un fichier déjà présent à la destination', async () => {
    seedDocument();
    const occupied = `${T}/26014 - Villa Martin/DCE/Plan RDC.pdf`;
    legacyFile('documents', occupied, 'AUTRE-FICHIER');

    await runTreeMigration(deps, T, { dryRun: false });

    expect(read('documents', occupied)).toBe('AUTRE-FICHIER');
    expect(pathOf('documents', 'doc-1')).toBe(`${T}/26014 - Villa Martin/DCE/Plan RDC (2).pdf`);
    expect(read('documents', pathOf('documents', 'doc-1'))).toBe('octets-plan');
  });

  it('numérote deux documents qui veulent le même nom', async () => {
    seedDocument({ id: 'doc-1', content: 'un' });
    // Second document, même nom affiché, autre ancien fichier.
    const legacy2 = `${T}/p1/DCE/${UUID2}/Plan-RDC.pdf`;
    legacyFile('documents', legacy2, 'deux');
    db.seed('documents', [...db.getTable('documents'), {
      id: 'doc-2', tenant_id: T, project_id: 'p1', name: 'Plan RDC.pdf', category: 'Plans', phase: 'DCE',
      file_url: urlOf('documents', legacy2), uploaded_at: '2026-01-02',
    }]);

    await runTreeMigration(deps, T, { dryRun: false });

    const a = pathOf('documents', 'doc-1');
    const b = pathOf('documents', 'doc-2');
    expect(new Set([a, b]).size).toBe(2);
    expect([read('documents', a), read('documents', b)].sort()).toEqual(['deux', 'un']);
  });

  it('reprend après une interruption : une copie identique déjà faite est réutilisée', async () => {
    seedDocument();
    // Un passage interrompu a copié le fichier sans avoir repointé la ligne.
    const target = `${T}/26014 - Villa Martin/DCE/Plan RDC.pdf`;
    legacyFile('documents', target, 'octets-plan');

    const report = await runTreeMigration(deps, T, { dryRun: false });

    expect(report.migres).toBe(1);
    expect(pathOf('documents', 'doc-1')).toBe(target);
    expect(exists('documents', `${T}/26014 - Villa Martin/DCE/Plan RDC (2).pdf`)).toBe(false);
  });

  it('signale un fichier introuvable sans modifier la ligne', async () => {
    const legacy = seedDocument();
    fs.rmSync(path.join(root, 'documents', ...legacy.split('/')));
    const before = row('documents', 'doc-1').file_url;

    const report = await runTreeMigration(deps, T, { dryRun: false });

    expect(report).toMatchObject({ introuvables: 1, migres: 0 });
    expect(report.problemes[0]).toMatchObject({ table: 'documents', id: 'doc-1', status: 'introuvable' });
    expect(row('documents', 'doc-1').file_url).toBe(before);
  });

  it('retire la copie et garde la ligne quand la mise à jour échoue', async () => {
    seedDocument();
    const failing: any = {
      from: (table: string) => {
        const q = db.from(table);
        if (table !== 'documents') return q;
        return {
          select: (...args: any[]) => (q as any).select(...args),
          update: () => ({ eq: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }),
        };
      },
    };
    const before = row('documents', 'doc-1').file_url;

    const report = await runTreeMigration({ ...deps, db: failing }, T, { dryRun: false });

    expect(report).toMatchObject({ erreurs: 1, migres: 0 });
    expect(report.problemes[0].detail).toContain('boom');
    expect(row('documents', 'doc-1').file_url).toBe(before);
    // Aucune copie orpheline : seul l'original reste.
    expect(exists('documents', `${T}/26014 - Villa Martin/DCE/Plan RDC.pdf`)).toBe(false);
  });

  it('refuse un chemin qui sortirait du dossier de stockage', async () => {
    const outside = path.join(root, 'secret.txt');
    fs.writeFileSync(outside, 'hors-bucket');
    db.seed('documents', [{
      id: 'doc-x', tenant_id: T, project_id: 'p1', name: 'x.txt', category: 'Plans', phase: 'DCE',
      file_url: `http://local/storage/v1/object/public/documents/..%2Fsecret.txt`, uploaded_at: '2026-01-01',
    }]);

    const report = await runTreeMigration(deps, T, { dryRun: false });

    expect(report.introuvables).toBe(1);
    expect(fs.readFileSync(outside, 'utf8')).toBe('hors-bucket');
  });

  it('ignore les références externes et les autres buckets', async () => {
    db.seed('documents', [
      { id: 'ext', tenant_id: T, project_id: 'p1', name: 'a.pdf', category: 'x', file_url: 'archioffice+external://webdav/c1/YWJj', uploaded_at: 'x' },
      { id: 'photo', tenant_id: T, project_id: 'p1', name: 'b.jpg', category: 'x', file_url: urlOf('meeting-photos', `${T}/b.jpg`), uploaded_at: 'x' },
      { id: 'foreign', tenant_id: T, project_id: 'p1', name: 'c.pdf', category: 'x', file_url: 'https://example.test/c.pdf', uploaded_at: 'x' },
    ]);
    expect(await planTreeMigration(deps, T)).toHaveLength(0);
  });
});

describe('autres sources de fichiers', () => {
  it('range les versions, plans, visas et inspirations dans leur dossier', async () => {
    seedDocument({ id: 'doc-1' });
    const v1 = `${T}/p1/DCE/${UUID1}/v1-cctp.pdf`;
    const v2 = `${T}/p1/DCE/${UUID1}/v2-cctp.pdf`;
    legacyFile('documents', v1, 'v1');
    legacyFile('documents', v2, 'v2');
    db.seed('document_versions', [
      { id: 'ver-1', tenant_id: T, document_id: 'doc-1', version: 1, file_url: urlOf('documents', v1), uploaded_at: 'x' },
      { id: 'ver-2', tenant_id: T, document_id: 'doc-1', version: 2, file_url: urlOf('documents', v2), uploaded_at: 'x' },
    ]);
    const plan = `${T}/p1/plan-1/Facade-nord.pdf`;
    legacyFile('plans', plan, 'plan');
    db.seed('plans', [{ id: 'plan-1', tenant_id: T, project_id: 'p1', name: 'Façade nord.pdf', file_url: urlOf('plans', plan), uploaded_at: 'x' }]);
    const visa = `${T}/p1/visas/visa-1/Visa-gros-oeuvre.pdf`;
    legacyFile('documents', visa, 'visa');
    db.seed('visas', [{ id: 'visa-1', tenant_id: T, project_id: 'p1', title: 'Visa gros oeuvre', date: 'x', document_url: urlOf('documents', visa) }]);
    const insp = `${T}/p1/inspiration/ESQ/${UUID3}-ambiance.jpg`;
    legacyFile('documents', insp, 'img');
    db.seed('inspiration_items', [{ id: 'insp-1', tenant_id: T, project_id: 'p1', phase: 'ESQ', category: 'architecture', file_url: urlOf('documents', insp) }]);

    const report = await runTreeMigration(deps, T, { dryRun: false });

    expect(report).toMatchObject({ erreurs: 0, introuvables: 0, migres: 6 });
    const base = `${T}/26014 - Villa Martin`;
    expect(pathOf('document_versions', 'ver-1')).toBe(`${base}/DCE/cctp.pdf`);
    expect(pathOf('document_versions', 'ver-2')).toBe(`${base}/DCE/cctp (2).pdf`);
    expect(pathOf('plans', 'plan-1')).toBe(`${base}/Plans/Facade nord.pdf`);
    expect(pathOf('visas', 'visa-1', 'document_url')).toBe(`${base}/VISA/Visa-gros-oeuvre.pdf`);
    expect(pathOf('inspiration_items', 'insp-1')).toBe(`${base}/ESQ/Inspiration/ambiance.jpg`);
    expect(read('plans', pathOf('plans', 'plan-1'))).toBe('plan');
  });

  it('range une pièce jointe de permis sous l\'affaire du permis', async () => {
    db.seed('permits', [{ id: 'pc-1', tenant_id: T, project_id: 'p1' }]);
    const legacy = `${T}/pc-1/${UUID2}/Cerfa-13406.pdf`;
    legacyFile('documents', legacy, 'cerfa');
    db.seed('documents', [{
      id: 'doc-pc', tenant_id: T, project_id: null, resource_type: 'permits', resource_id: 'pc-1',
      name: 'Cerfa 13406.pdf', category: 'Permis', file_url: urlOf('documents', legacy), uploaded_at: 'x',
    }]);

    await runTreeMigration(deps, T, { dryRun: false });

    expect(pathOf('documents', 'doc-pc')).toBe(`${T}/26014 - Villa Martin/Permis/Cerfa 13406.pdf`);
  });

  it('range un document sans affaire sous Général', async () => {
    const legacy = `${T}/general/${UUID2}/Charte.pdf`;
    legacyFile('documents', legacy, 'charte');
    db.seed('documents', [{
      id: 'doc-g', tenant_id: T, project_id: null, name: 'Charte graphique.pdf', category: 'x', phase: null,
      file_url: urlOf('documents', legacy), uploaded_at: 'x',
    }]);

    await runTreeMigration(deps, T, { dryRun: false });

    // Pas de phase : le dossier de repli « Général » apparaît deux fois, comme à l'upload.
    expect(pathOf('documents', 'doc-g')).toBe(`${T}/General/General/Charte graphique.pdf`);
  });
});

describe('purge des anciens fichiers', () => {
  it('supprime les anciens fichiers que plus aucune ligne ne référence, et seulement eux', async () => {
    const legacy = seedDocument();
    await runTreeMigration(deps, T, { dryRun: false });
    const target = pathOf('documents', 'doc-1');

    const preview = await purgeLegacyFiles(deps, T, { dryRun: true });
    expect(preview).toMatchObject({ dryRun: true, supprimables: 1, supprimes: 0 });
    expect(exists('documents', legacy)).toBe(true);

    const report = await purgeLegacyFiles(deps, T, { dryRun: false });

    expect(report).toMatchObject({ supprimes: 1, encoreReferences: 0 });
    expect(exists('documents', legacy)).toBe(false);
    expect(read('documents', target)).toBe('octets-plan');
    // Les dossiers vidés disparaissent, pas ceux qui contiennent encore quelque chose.
    expect(exists('documents', `${T}/p1`)).toBe(false);
    expect(exists('documents', `${T}/26014 - Villa Martin/DCE`)).toBe(true);
  });

  it('conserve un ancien fichier encore référencé par une ligne (poste pas à jour)', async () => {
    const legacy = seedDocument();
    await runTreeMigration(deps, T, { dryRun: false });
    // Une autre ligne (réintroduite par la synchronisation d'un poste en retard) pointe encore dessus.
    db.seed('documents', [...db.getTable('documents'), {
      id: 'doc-stale', tenant_id: T, project_id: 'p1', name: 'Plan RDC.pdf', category: 'Plans', phase: 'DCE',
      file_url: urlOf('documents', legacy), uploaded_at: 'x',
    }]);

    const report = await purgeLegacyFiles(deps, T, { dryRun: false });

    expect(report).toMatchObject({ supprimes: 0, encoreReferences: 1 });
    expect(exists('documents', legacy)).toBe(true);
  });

  it('s\'arrête sans rien supprimer quand une lecture échoue', async () => {
    const legacy = seedDocument();
    await runTreeMigration(deps, T, { dryRun: false });
    const broken: any = {
      from: (table: string) => (table === 'plans'
        ? { select: () => ({ eq: () => ({ range: async () => ({ data: null, error: { message: 'connexion perdue' } }) }) }) }
        : db.from(table)),
    };

    await expect(purgeLegacyFiles({ ...deps, db: broken }, T, { dryRun: false })).rejects.toThrow(/connexion perdue/);
    expect(exists('documents', legacy)).toBe(true);
  });

  it('ne fait rien sans journal de migration', async () => {
    seedDocument();
    expect(await purgeLegacyFiles(deps, T, { dryRun: false })).toMatchObject({ supprimes: 0, supprimables: 0 });
  });
});
