// Migration des fichiers déjà déposés vers l'arborescence lisible du client
// Electron (server/externalStorage/localTreePath.ts).
//
// Avant : <cabinet>/<affaire>/<phase>/<identifiant>/<fichier>   (illisible)
// Après : <cabinet>/<code - affaire>/<phase>/<fichier>
//
// Règles, dans l'ordre d'importance :
//
//  1. COPIER, puis repointer la référence. Jamais déplacer : sur un dossier
//     partagé, un autre poste dont les lignes ne sont pas encore à jour lit encore
//     l'ancien chemin. Les anciens fichiers restent donc en place jusqu'à une
//     purge explicite (`purgeLegacyFiles`), qui ne supprime que ce qu'AUCUNE ligne
//     ne référence plus.
//  2. Reprenable. Rien n'est écrit tant que le fichier copié n'est pas vérifié
//     (taille ET empreinte), et un fichier déjà copié lors d'un passage interrompu
//     est reconnu à son contenu et réutilisé, au lieu d'être recopié en « (2) ».
//  3. Jamais d'écrasement : la copie est exclusive (COPYFILE_EXCL).
//  4. Une lecture ratée n'est jamais prise pour « aucune ligne » : la purge s'arrête
//     à la première erreur de lecture, sans quoi des fichiers encore référencés
//     passeraient pour orphelins.
//
// Les mises à jour de lignes passent par l'API locale (supabaseAdmin), donc par la
// passerelle hors ligne : elles sont enregistrées pour la synchronisation cloud
// comme n'importe quelle modification.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  buildDocumentFolderPath,
  buildInspirationFolderPath,
  buildPlanFolderPath,
  buildVisaFolderPath,
} from './externalStorage/businessFolderPath';
import type { DocumentFolderResolver } from './externalStorage/documentFolders';
import { isExternalRef } from './externalStorage/externalRef';
import { LAST_NUMBERED_ATTEMPT, readableObjectPath } from './externalStorage/localTreePath';
import { parseStorageRef } from './storagePaths';

const PAGE_SIZE = 1000;
const MIGRATED_BUCKETS = new Set(['documents', 'plans']);

interface Source {
  table: 'documents' | 'document_versions' | 'plans' | 'visas' | 'inspiration_items';
  column: 'file_url' | 'document_url';
}

const SOURCES: Source[] = [
  { table: 'documents', column: 'file_url' },
  { table: 'document_versions', column: 'file_url' },
  { table: 'plans', column: 'file_url' },
  { table: 'visas', column: 'document_url' },
  { table: 'inspiration_items', column: 'file_url' },
];

export type MigrationStatus = 'a_migrer' | 'migre' | 'deja_range' | 'introuvable' | 'erreur';

export interface MigrationItem {
  table: Source['table'];
  id: string;
  bucket: string;
  /** Chemin d'objet actuel (décodé). */
  from: string;
  /** Chemin cible ; définitif une fois le statut « migre ». */
  to: string;
  status: MigrationStatus;
  bytes?: number;
  detail?: string;
}

export interface MigrationReport {
  dryRun: boolean;
  total: number;
  aMigrer: number;
  migres: number;
  dejaranges: number;
  introuvables: number;
  erreurs: number;
  /** Octets à copier (simulation) ou copiés. */
  bytes: number;
  /** Les lignes qui demandent attention : introuvables et en erreur (200 au plus). */
  problemes: MigrationItem[];
}

export interface MigrationDeps {
  db: any;
  resolver: DocumentFolderResolver;
  /** Dossier d'un bucket : `storageDir(bucket)`. */
  storageRoot: (bucket: string) => string;
  /** Référence stockée dans la ligne : l'URL publique d'un chemin d'objet. */
  publicUrl: (bucket: string, objectPath: string) => string;
  /** Fichier JSON qui garde la liste des anciens chemins déjà copiés. */
  journalPath: string;
}

interface PlanEntry extends MigrationItem {
  column: Source['column'];
  folder: string[];
  name: string;
}

// ── Lecture ────────────────────────────────────────────────────────────────

function isMissingTable(error: any): boolean {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(text);
}

/** Lit toutes les lignes d'un cabinet. Lève sur toute erreur, sauf table absente
 *  quand l'appelant l'accepte (instance non migrée). */
async function readAll(db: any, table: string, tenantId: string, tolerateMissing: boolean): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from(table).select('*').eq('tenant_id', tenantId).range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (tolerateMissing && isMissingTable(error)) return rows;
      throw new Error(`Lecture de ${table} impossible : ${error.message}`);
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// ── Chemins ────────────────────────────────────────────────────────────────

/** Résout un chemin d'objet DANS le dossier d'un bucket ; null s'il en sortirait. */
export function resolveInBucket(root: string, objectPath: string): string | null {
  const resolved = path.resolve(root, ...objectPath.split('/'));
  const base = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]{1,10})$/);
  return m && name.length > m[0].length ? m[0] : '';
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Le nom d'origine d'un ancien chemin : sans « v2- » ni identifiant en préfixe. */
function legacyBaseName(objectPath: string): string {
  const base = objectPath.split('/').pop() || 'fichier';
  return base.replace(/^v\d+-/i, '').replace(UUID_PREFIX, '') || 'fichier';
}

/**
 * Le nom que portera le fichier : le nom affiché dans l'application quand il est
 * cohérent avec le fichier (même extension, ou aucune), sinon le nom d'origine.
 * Les anciens fichiers portaient un nom assaini (« Plan-RDC.pdf ») ; le nom affiché
 * (« Plan RDC ») est plus lisible.
 */
function chooseName(displayName: string | null | undefined, fromPath: string): string {
  const legacy = legacyBaseName(fromPath);
  const legacyExt = extOf(legacy);
  const shown = String(displayName ?? '').trim();
  if (!shown) return legacy;
  const shownExt = extOf(shown);
  if (shownExt && shownExt.toLowerCase() === legacyExt.toLowerCase()) return shown;
  if (!shownExt && legacyExt) return `${shown}${legacyExt}`;
  return legacy;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Vrai si le fichier est déjà là où la migration le rangerait (nom numéroté compris). */
function isAlreadyPlaced(current: string, target: string): boolean {
  if (path.posix.dirname(current) !== path.posix.dirname(target)) return false;
  const targetBase = path.posix.basename(target);
  const ext = extOf(targetBase);
  const stem = ext ? targetBase.slice(0, -ext.length) : targetBase;
  return new RegExp(`^${escapeRegExp(stem)}( \\(\\d+\\))?${escapeRegExp(ext)}$`).test(path.posix.basename(current));
}

// ── Plan ───────────────────────────────────────────────────────────────────

export async function planTreeMigration(deps: MigrationDeps, tenantId: string): Promise<PlanEntry[]> {
  const { db, resolver } = deps;
  const tables = new Map<string, any[]>();
  for (const source of SOURCES) {
    // inspiration_items n'existe pas sur une instance non migrée : table absente tolérée.
    tables.set(source.table, await readAll(db, source.table, tenantId, source.table === 'inspiration_items'));
  }
  const documentsById = new Map<string, any>((tables.get('documents') || []).map((d) => [d.id, d]));

  const projects = new Map<string, Promise<any>>();
  const project = (id: string | null) => {
    if (!id) return Promise.resolve(null);
    if (!projects.has(id)) projects.set(id, resolver.loadFolderProject(id, tenantId));
    return projects.get(id)!;
  };

  async function documentFolder(doc: any): Promise<string[]> {
    const type = doc.resource_type || 'projects';
    if (type !== 'projects') return resolver.folderPathForResource(type, doc.resource_id ?? null, tenantId);
    return buildDocumentFolderPath(await project(doc.project_id ?? null), doc.phase || null);
  }

  async function folderFor(table: Source['table'], row: any): Promise<string[]> {
    switch (table) {
      case 'documents': return documentFolder(row);
      case 'document_versions': {
        const parent = documentsById.get(row.document_id);
        return parent ? documentFolder(parent) : buildDocumentFolderPath(null, null);
      }
      case 'plans': return buildPlanFolderPath(await project(row.project_id ?? null));
      case 'visas': return buildVisaFolderPath(await project(row.project_id ?? null));
      case 'inspiration_items': return buildInspirationFolderPath(await project(row.project_id ?? null), row.phase || null);
    }
  }

  const entries: PlanEntry[] = [];
  for (const source of SOURCES) {
    for (const row of tables.get(source.table) || []) {
      const url = row[source.column];
      if (!url || isExternalRef(url)) continue;
      const ref = parseStorageRef(url);
      if (!ref || !MIGRATED_BUCKETS.has(ref.bucket)) continue;

      const folder = await folderFor(source.table, row);
      // Une version ancienne garde le nom de son fichier : son nom affiché est celui
      // du document, qui désigne la version courante.
      const name = chooseName(source.table === 'document_versions' ? null : row.name, ref.path);
      const target = readableObjectPath({ tenantId, folderPath: folder, fileName: name }, 1);

      entries.push({
        table: source.table,
        column: source.column,
        id: String(row.id),
        bucket: ref.bucket,
        from: ref.path,
        to: target,
        status: isAlreadyPlaced(ref.path, target) ? 'deja_range' : 'a_migrer',
        folder,
        name,
      });
    }
  }
  return entries;
}

// ── Exécution ──────────────────────────────────────────────────────────────

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

async function sameContent(a: string, b: string): Promise<boolean> {
  if (fs.statSync(a).size !== fs.statSync(b).size) return false;
  return (await sha256(a)) === (await sha256(b));
}

interface Journal { items: Array<{ bucket: string; from: string }> }

function readJournal(journalPath: string): Journal {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    return { items: Array.isArray(parsed?.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeJournal(journalPath: string, journal: Journal): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, JSON.stringify({ updatedAt: new Date().toISOString(), items: journal.items }, null, 2));
}

async function migrateOne(deps: MigrationDeps, tenantId: string, entry: PlanEntry): Promise<void> {
  const root = deps.storageRoot(entry.bucket);
  const source = resolveInBucket(root, entry.from);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    entry.status = 'introuvable';
    entry.detail = 'Fichier absent du dossier de stockage';
    return;
  }
  entry.bytes = fs.statSync(source).size;

  let relative = '';
  let created = false;
  for (let attempt = 1; attempt <= LAST_NUMBERED_ATTEMPT + 1; attempt += 1) {
    relative = readableObjectPath({ tenantId, folderPath: entry.folder, fileName: entry.name }, attempt);
    const dest = resolveInBucket(root, relative);
    if (!dest) throw new Error('Chemin cible invalide');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
      created = true;
      break;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      // Déjà là : copie d'un passage interrompu (même contenu), ou autre fichier de
      // même nom (on essaie le nom suivant).
      if (await sameContent(source, dest)) break;
    }
    if (attempt > LAST_NUMBERED_ATTEMPT) throw new Error('Aucun nom libre pour ce fichier');
  }

  const dest = resolveInBucket(root, relative)!;
  if (!(await sameContent(source, dest))) {
    if (created) fs.rmSync(dest, { force: true });
    throw new Error('La copie ne correspond pas à l\'original');
  }

  const { error } = await deps.db.from(entry.table)
    .update({ [entry.column]: deps.publicUrl(entry.bucket, relative) })
    .eq('id', entry.id).eq('tenant_id', tenantId);
  if (error) {
    // Pas de ligne repointée : on retire la copie qu'on vient de faire (pas celle d'un
    // passage précédent, que le prochain essai reconnaîtra).
    if (created) fs.rmSync(dest, { force: true });
    throw new Error(`Mise à jour de ${entry.table} impossible : ${error.message}`);
  }

  entry.to = relative;
  entry.status = 'migre';
}

function summarize(entries: PlanEntry[], dryRun: boolean): MigrationReport {
  const count = (status: MigrationStatus) => entries.filter((e) => e.status === status).length;
  const bytes = entries
    .filter((e) => e.status === 'a_migrer' || e.status === 'migre')
    .reduce((sum, e) => sum + (e.bytes ?? 0), 0);
  return {
    dryRun,
    total: entries.length,
    aMigrer: count('a_migrer'),
    migres: count('migre'),
    dejaranges: count('deja_range'),
    introuvables: count('introuvable'),
    erreurs: count('erreur'),
    bytes,
    problemes: entries
      .filter((e) => e.status === 'introuvable' || e.status === 'erreur')
      .slice(0, 200)
      .map(({ table, id, bucket, from, to, status, bytes: size, detail }) => ({ table, id, bucket, from, to, status, bytes: size, detail })),
  };
}

export interface RunOptions {
  /** Vrai : ne copie rien, ne modifie rien, compte seulement. */
  dryRun: boolean;
  onProgress?: (done: number, total: number) => void;
}

export async function runTreeMigration(deps: MigrationDeps, tenantId: string, options: RunOptions): Promise<MigrationReport> {
  const entries = await planTreeMigration(deps, tenantId);

  // Simulation : la taille à copier se lit sur le disque, rien d'autre.
  if (options.dryRun) {
    for (const entry of entries.filter((e) => e.status === 'a_migrer')) {
      const source = resolveInBucket(deps.storageRoot(entry.bucket), entry.from);
      if (!source || !fs.existsSync(source)) {
        entry.status = 'introuvable';
        entry.detail = 'Fichier absent du dossier de stockage';
      } else {
        entry.bytes = fs.statSync(source).size;
      }
    }
    return summarize(entries, true);
  }

  const todo = entries.filter((e) => e.status === 'a_migrer');
  const journal = readJournal(deps.journalPath);
  let done = 0;
  for (const entry of todo) {
    const from = entry.from;
    try {
      await migrateOne(deps, tenantId, entry);
      if (entry.status === 'migre' && !journal.items.some((j) => j.bucket === entry.bucket && j.from === from)) {
        journal.items.push({ bucket: entry.bucket, from });
      }
    } catch (err: any) {
      entry.status = 'erreur';
      entry.detail = err?.message || String(err);
    }
    done += 1;
    options.onProgress?.(done, todo.length);
    // Le journal est écrit au fil de l'eau : une interruption ne doit pas perdre la
    // liste de ce qui a déjà été copié.
    if (done % 25 === 0) writeJournal(deps.journalPath, journal);
  }
  writeJournal(deps.journalPath, journal);
  return summarize(entries, false);
}

// ── Purge des anciens fichiers ─────────────────────────────────────────────

export interface PurgeReport {
  dryRun: boolean;
  /** Anciens fichiers que plus aucune ligne ne référence. */
  supprimables: number;
  supprimes: number;
  /** Encore référencés (un autre poste n'est peut-être pas à jour) : conservés. */
  encoreReferences: number;
  /** Déjà absents du disque. */
  absents: number;
  bytes: number;
}

function removeEmptyParents(start: string, stopAt: string): void {
  let dir = path.dirname(start);
  const stop = path.resolve(stopAt);
  while (dir.startsWith(stop + path.sep)) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Supprime les anciens fichiers copiés par la migration, à condition qu'aucune ligne
 * ne les référence encore. À lancer une fois que tous les postes ont reçu les lignes
 * mises à jour. S'arrête à la première erreur de lecture.
 */
export async function purgeLegacyFiles(
  deps: MigrationDeps,
  tenantId: string,
  options: { dryRun: boolean },
): Promise<PurgeReport> {
  const journal = readJournal(deps.journalPath);
  const report: PurgeReport = {
    dryRun: options.dryRun, supprimables: 0, supprimes: 0, encoreReferences: 0, absents: 0, bytes: 0,
  };
  if (!journal.items.length) return report;

  // Lecture stricte de TOUTES les sources : une erreur ici interrompt la purge.
  const referenced = new Set<string>();
  for (const source of SOURCES) {
    for (const row of await readAll(deps.db, source.table, tenantId, source.table === 'inspiration_items')) {
      const ref = row[source.column] ? parseStorageRef(row[source.column]) : null;
      if (ref) referenced.add(`${ref.bucket}/${ref.path}`);
    }
  }

  const remaining: Journal['items'] = [];
  for (const item of journal.items) {
    if (referenced.has(`${item.bucket}/${item.from}`)) {
      report.encoreReferences += 1;
      remaining.push(item);
      continue;
    }
    const root = deps.storageRoot(item.bucket);
    const file = resolveInBucket(root, item.from);
    if (!file || !fs.existsSync(file)) {
      report.absents += 1;
      continue;
    }
    report.supprimables += 1;
    report.bytes += fs.statSync(file).size;
    if (options.dryRun) {
      remaining.push(item);
      continue;
    }
    fs.rmSync(file, { force: true });
    removeEmptyParents(file, root);
    report.supprimes += 1;
  }

  if (!options.dryRun) writeJournal(deps.journalPath, { items: remaining });
  return report;
}
