// Sauvegardes et restauration par cabinet (superadmin uniquement).
//
// Cas visé : un associé, ou un compte piraté, efface les données d'un cabinet.
// Les sauvegardes globales de Supabase restaurent toute la plateforme, pas un
// seul cabinet ; celles-ci sont propres à chaque cabinet, et hors de portée de
// ses administrateurs (bucket privé `tenant-backups`, tables sans accès public).
//
// Ce qu'une sauvegarde contient :
//   - les LIGNES de toutes les tables du cabinet, en JSON compressé (pas en
//     CSV : l'export RGPD de tenantExport.ts perd des types en route) ;
//   - les FICHIERS des buckets Supabase, copiés côté serveur (jamais
//     téléchargés dans la mémoire du processus), une seule fois par fichier.
//
// Ce qu'elle ne contient pas, et qu'on ne peut pas contenir :
//   - les fichiers déposés sur l'espace de stockage du cabinet (Drive,
//     Dropbox, Nextcloud) : ils lui appartiennent et vivent chez lui ;
//   - les secrets des intégrations (jetons, mots de passe SMTP, clés API),
//     masqués comme dans l'export RGPD. Après une restauration, il faut
//     reconnecter les boîtes mail et les connecteurs.
//
// La restauration est volontairement NON destructive : elle remet ce qui
// manque (lignes et fichiers effacés) et n'écrase jamais ce qui existe.
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  EXPORT_TABLES,
  JUNCTION_EXPORT_TABLES,
  TENANT_PREFIXED_BUCKETS,
  fetchAllRows,
  redact,
} from './tenantExport';

export const BACKUP_BUCKET = 'tenant-backups';
export const BACKUP_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Une sauvegarde par cabinet toutes les 24 h ; on en reprend une dès que la
// dernière a plus de 20 h, pour que le cycle de 6 h ne la décale pas d'un jour.
const NIGHTLY_MIN_AGE_MS = 20 * 60 * 60 * 1000;
const STALE_PENDING_MS = 60 * 60 * 1000;
const DEFAULT_CHECK_INTERVAL_HOURS = 6;
const LIST_PAGE_SIZE = 1000;
const DB_CHUNK = 200;
const MAX_RESTORE_PASSES = 5;
const MAX_REPORTED_FAILURES = 20;
const REDACTED_MARKER = '[REDACTED]';

// Les adhésions ne figurent pas dans l'export RGPD (elles ne sont pas de
// l'activité du cabinet) mais sont indispensables à une restauration : sans
// elles, une personne restaurée ne verrait pas le cabinet.
const BACKUP_TABLES: readonly string[] = Array.from(new Set([...EXPORT_TABLES, 'tenant_memberships']));

export type BackupTrigger = 'nightly' | 'suspension' | 'closure_request' | 'manual';

export interface TenantBackupRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  trigger: BackupTrigger;
  status: 'pending' | 'complete' | 'failed';
  data_path: string | null;
  row_counts: Record<string, number> | null;
  file_count: number;
  data_bytes: number;
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

interface BackupPayload {
  version: 1;
  tenant_id: string;
  tenant_name: string | null;
  created_at: string;
  tables: Record<string, Record<string, any>[]>;
  junctions: Record<string, Record<string, any>[]>;
}

/**
 * Les sauvegardes prises à la suspension ou à la demande de fermeture ne
 * s'effacent pas d'elles-mêmes : ce sont celles dont on aura besoin dans six
 * mois, ou dans dix ans, quand le cabinet aura disparu. Les autres glissent sur
 * BACKUP_RETENTION_DAYS jours.
 */
function expiryFor(trigger: BackupTrigger, now: Date): string | null {
  if (trigger === 'suspension' || trigger === 'closure_request') return null;
  return new Date(now.getTime() + BACKUP_RETENTION_DAYS * DAY_MS).toISOString();
}

export async function ensureBackupBucket(supabaseAdmin: any): Promise<void> {
  const { data: existing } = await supabaseAdmin.storage.getBucket(BACKUP_BUCKET);
  if (existing) return;
  const { error } = await supabaseAdmin.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !String(error.message).includes('already exists')) {
    throw new Error(`Bucket de sauvegarde introuvable et non créable : ${error.message}`);
  }
}

/**
 * Lit toutes les lignes d'un cabinet pour une table, triées par `id` quand la
 * table en a un. fetchAllRows (export RGPD) pagine sans tri : sur un cabinet
 * actif, une ligne insérée entre deux pages peut en faire sauter une autre, ce
 * qui est acceptable pour un export mais pas pour une sauvegarde.
 */
async function fetchTableRows(supabaseAdmin: any, table: string, tenantId: string): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('tenant_id', tenantId)
      .order('id', { ascending: true }).range(offset, offset + LIST_PAGE_SIZE - 1);
    if (error) {
      // Table sans colonne `id` (ou absente de ce déploiement) : lecture sans tri.
      return offset === 0 ? fetchAllRows(supabaseAdmin, table, tenantId) : rows;
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < LIST_PAGE_SIZE) break;
  }
  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface LiveFile { path: string; size: number }

/** Tous les objets d'un bucket sous `<tenantId>/`, dossiers parcourus récursivement. */
export async function listLiveFiles(supabaseAdmin: any, bucket: string, tenantId: string): Promise<LiveFile[]> {
  const files: LiveFile[] = [];
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data: entries, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE, offset });
      if (error || !entries?.length) return;
      for (const entry of entries) {
        const full = `${prefix}/${entry.name}`;
        // list() marque un dossier par un id nul ; un fichier porte toujours
        // ses métadonnées (même convention que tenantExport.ts).
        if (entry.id === null) await walk(full);
        else files.push({ path: full, size: Number(entry.metadata?.size ?? 0) });
      }
      if (entries.length < LIST_PAGE_SIZE) return;
    }
  };
  await walk(tenantId);
  return files;
}

function filePoolPath(tenantId: string, bucket: string, objectPath: string): string {
  // objectPath commence déjà par `<tenantId>/`.
  return `files/${tenantId}/${bucket}/${objectPath}`;
}

async function buildPayload(supabaseAdmin: any, tenantId: string, tenantName: string | null) {
  const tables: BackupPayload['tables'] = {};
  const junctions: BackupPayload['junctions'] = {};
  const rowCounts: Record<string, number> = {};
  const idsByTable = new Map<string, string[]>();

  for (const table of BACKUP_TABLES) {
    const rows = await fetchTableRows(supabaseAdmin, table, tenantId);
    if (!rows.length) continue;
    rowCounts[table] = rows.length;
    idsByTable.set(table, rows.map((r: any) => r.id).filter(Boolean));
    tables[table] = redact(table, rows);
  }

  for (const { table, parentTable, parentIdColumn } of JUNCTION_EXPORT_TABLES) {
    const parentIds = idsByTable.get(parentTable) || [];
    const rows: Record<string, any>[] = [];
    for (const ids of chunk(parentIds, 100)) {
      const { data, error } = await supabaseAdmin.from(table).select('*').in(parentIdColumn, ids);
      if (error) { console.error(`[tenantBackup] lecture de ${table} impossible:`, error.message); continue; }
      if (data?.length) rows.push(...data);
    }
    if (rows.length) {
      rowCounts[table] = rows.length;
      junctions[table] = rows;
    }
  }

  const payload: BackupPayload = {
    version: 1, tenant_id: tenantId, tenant_name: tenantName,
    created_at: new Date().toISOString(), tables, junctions,
  };
  return { payload, rowCounts };
}

/**
 * Copie dans le bucket de sauvegarde les fichiers vivants du cabinet qui n'y
 * sont pas encore, et marque les autres comme revus. Retourne le nombre de
 * fichiers couverts et ceux qui n'ont pas pu être copiés.
 */
async function backupFiles(supabaseAdmin: any, tenantId: string): Promise<{ covered: number; failed: string[] }> {
  let covered = 0;
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (const bucket of TENANT_PREFIXED_BUCKETS) {
    const live = await listLiveFiles(supabaseAdmin, bucket, tenantId);
    if (!live.length) continue;

    const { data: pooled } = await supabaseAdmin
      .from('tenant_backup_files').select('path').eq('tenant_id', tenantId).eq('bucket', bucket);
    const known = new Set<string>(((pooled as any[]) || []).map(r => r.path));

    const seen = live.filter(f => known.has(f.path)).map(f => f.path);
    for (const paths of chunk(seen, DB_CHUNK)) {
      await supabaseAdmin.from('tenant_backup_files').update({ last_seen_at: now })
        .eq('tenant_id', tenantId).eq('bucket', bucket).in('path', paths);
    }
    covered += seen.length;

    for (const file of live.filter(f => !known.has(f.path))) {
      const { error } = await supabaseAdmin.storage.from(bucket)
        .copy(file.path, filePoolPath(tenantId, bucket, file.path), { destinationBucket: BACKUP_BUCKET });
      if (error) { failed.push(`${bucket}/${file.path}`); continue; }
      await supabaseAdmin.from('tenant_backup_files').insert({
        tenant_id: tenantId, bucket, path: file.path, size_bytes: file.size,
        backed_up_at: now, last_seen_at: now,
      });
      covered += 1;
    }
  }
  return { covered, failed };
}

/**
 * Prend une sauvegarde complète du cabinet. Ne lève pas pour un échec de
 * contenu : la ligne passe en `failed` avec le motif, visible du superadmin.
 */
export async function createTenantBackup(
  supabaseAdmin: any,
  tenantId: string,
  trigger: BackupTrigger,
  opts: { createdBy?: string | null } = {},
): Promise<TenantBackupRow> {
  const now = new Date();
  const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name').eq('id', tenantId).maybeSingle();
  if (!tenant) {
    const err: any = new Error('Cabinet introuvable');
    err.status = 404;
    throw err;
  }

  // Une sauvegarde déjà en cours pour ce cabinet : pas de seconde en parallèle
  // (deux copies de fichiers concurrentes se marcheraient dessus).
  const { data: pending } = await supabaseAdmin.from('tenant_backups').select('id, created_at')
    .eq('tenant_id', tenantId).eq('status', 'pending');
  const running = ((pending as any[]) || []).find(p => now.getTime() - new Date(p.created_at).getTime() < STALE_PENDING_MS);
  if (running) {
    const err: any = new Error('Une sauvegarde est déjà en cours pour ce cabinet');
    err.status = 409;
    throw err;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin.from('tenant_backups').insert({
    tenant_id: tenantId, tenant_name: tenant.name ?? null, trigger, status: 'pending',
    created_by: opts.createdBy ?? null, created_at: now.toISOString(), expires_at: expiryFor(trigger, now),
  }).select().single();
  if (insertError || !inserted) throw new Error(`Sauvegarde non enregistrée : ${insertError?.message ?? 'erreur inconnue'}`);
  const backupId: string = inserted.id;

  const fail = async (message: string): Promise<TenantBackupRow> => {
    const { data } = await supabaseAdmin.from('tenant_backups')
      .update({ status: 'failed', error: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq('id', backupId).select().single();
    console.error(`[tenantBackup] échec pour ${tenantId} :`, message);
    return data as TenantBackupRow;
  };

  try {
    await ensureBackupBucket(supabaseAdmin);
    const { payload, rowCounts } = await buildPayload(supabaseAdmin, tenantId, tenant.name ?? null);
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    const dataPath = `snapshots/${tenantId}/${backupId}/data.json.gz`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BACKUP_BUCKET)
      .upload(dataPath, compressed, { contentType: 'application/gzip', upsert: false });
    if (uploadError) return await fail(`Dépôt de la sauvegarde impossible : ${uploadError.message}`);

    const files = await backupFiles(supabaseAdmin, tenantId);
    const { data: done } = await supabaseAdmin.from('tenant_backups').update({
      status: 'complete', data_path: dataPath, row_counts: rowCounts,
      file_count: files.covered, data_bytes: compressed.length,
      error: files.failed.length ? `${files.failed.length} fichier(s) non copié(s) : ${files.failed.slice(0, 5).join(', ')}` : null,
      completed_at: new Date().toISOString(),
    }).eq('id', backupId).select().single();
    return done as TenantBackupRow;
  } catch (e: any) {
    return await fail(e?.message ?? 'erreur inconnue');
  }
}

/** Lance une sauvegarde sans bloquer l'appelant (suspension, demande de fermeture). */
export function createTenantBackupInBackground(
  supabaseAdmin: any, tenantId: string, trigger: BackupTrigger, createdBy?: string | null,
): Promise<TenantBackupRow | null> {
  return createTenantBackup(supabaseAdmin, tenantId, trigger, { createdBy })
    .catch((e: any) => {
      console.error(`[tenantBackup] sauvegarde ${trigger} impossible pour ${tenantId} :`, e?.message);
      return null;
    });
}

export async function listTenantBackups(supabaseAdmin: any, tenantId: string): Promise<TenantBackupRow[]> {
  const { data } = await supabaseAdmin.from('tenant_backups').select('*')
    .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100);
  return (data as TenantBackupRow[]) || [];
}

async function loadBackup(supabaseAdmin: any, tenantId: string, backupId: string): Promise<TenantBackupRow> {
  const { data } = await supabaseAdmin.from('tenant_backups').select('*').eq('id', backupId).maybeSingle();
  // Le cabinet de l'URL doit être celui de la sauvegarde : un identifiant de
  // sauvegarde ne doit pas permettre de lire ou restaurer un autre cabinet.
  if (!data || data.tenant_id !== tenantId) {
    const err: any = new Error('Sauvegarde introuvable pour ce cabinet');
    err.status = 404;
    throw err;
  }
  if (data.status !== 'complete' || !data.data_path) {
    const err: any = new Error("Cette sauvegarde n'est pas exploitable (incomplète ou en échec)");
    err.status = 409;
    throw err;
  }
  return data as TenantBackupRow;
}

export async function getBackupDownloadUrl(supabaseAdmin: any, tenantId: string, backupId: string): Promise<string> {
  const backup = await loadBackup(supabaseAdmin, tenantId, backupId);
  const { data, error } = await supabaseAdmin.storage.from(BACKUP_BUCKET).createSignedUrl(backup.data_path!, 120);
  if (error || !data?.signedUrl) throw new Error(`Lien de téléchargement impossible : ${error?.message ?? 'erreur inconnue'}`);
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Restauration
// ---------------------------------------------------------------------------

export interface RestoreSummary {
  dry_run: boolean;
  backup_id: string;
  rows: { table: string; missing: number; restored: number; failed: number }[];
  files: { missing: number; restored: number; failed: number };
  failures: string[];
}

async function existingIds(supabaseAdmin: any, table: string, tenantId: string): Promise<Set<string>> {
  const rows = await fetchTableRows(supabaseAdmin, table, tenantId);
  return new Set(rows.map((r: any) => r.id).filter(Boolean));
}

/** Les valeurs masquées à la sauvegarde ne doivent jamais être réécrites telles quelles. */
function unredact(row: Record<string, any>): Record<string, any> {
  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) copy[key] = value === REDACTED_MARKER ? null : value;
  return copy;
}

function isDuplicate(error: any): boolean {
  return error?.code === '23505';
}

async function insertRows(
  supabaseAdmin: any, table: string, rows: Record<string, any>[],
): Promise<{ inserted: Record<string, any>[]; rejected: { row: Record<string, any>; error: string }[] }> {
  const inserted: Record<string, any>[] = [];
  const rejected: { row: Record<string, any>; error: string }[] = [];
  for (const group of chunk(rows, DB_CHUNK)) {
    const { error } = await supabaseAdmin.from(table).insert(group);
    if (!error) { inserted.push(...group); continue; }
    // Un lot refusé ne dit pas quelle ligne pose problème : on reprend ligne à
    // ligne pour ne perdre que les fautives.
    for (const row of group) {
      const { error: rowError } = await supabaseAdmin.from(table).insert(row);
      if (!rowError || isDuplicate(rowError)) inserted.push(row);
      else rejected.push({ row, error: rowError.message });
    }
  }
  return { inserted, rejected };
}

/**
 * Remet dans le cabinet ce qui a disparu depuis la sauvegarde : lignes et
 * fichiers. N'écrase rien. `dryRun` ne fait que compter.
 *
 * Les lignes sont réinsérées en plusieurs passes : une ligne qui en référence
 * une autre (clé étrangère) échoue tant que sa référence manque, et passe à la
 * passe suivante une fois celle-ci rétablie.
 */
export async function restoreTenantBackup(
  supabaseAdmin: any, tenantId: string, backupId: string, opts: { dryRun: boolean },
): Promise<RestoreSummary> {
  const backup = await loadBackup(supabaseAdmin, tenantId, backupId);
  const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(BACKUP_BUCKET).download(backup.data_path!);
  if (downloadError || !blob) throw new Error(`Lecture de la sauvegarde impossible : ${downloadError?.message ?? 'erreur inconnue'}`);
  const payload: BackupPayload = JSON.parse(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
  if (payload.tenant_id !== tenantId) throw new Error('Cette sauvegarde appartient à un autre cabinet');

  const summary: RestoreSummary = {
    dry_run: opts.dryRun, backup_id: backupId, rows: [],
    files: { missing: 0, restored: 0, failed: 0 }, failures: [],
  };
  const note = (message: string) => { if (summary.failures.length < MAX_REPORTED_FAILURES) summary.failures.push(message); };

  // --- lignes : tables portant tenant_id, comparées par identifiant
  const pending = new Map<string, Record<string, any>[]>();
  for (const [table, rows] of Object.entries(payload.tables)) {
    const present = await existingIds(supabaseAdmin, table, tenantId);
    // Une ligne d'un autre cabinet dans une sauvegarde de celui-ci serait une
    // anomalie : on ne la réinsère jamais.
    const missing = rows.filter(r => (!r.tenant_id || r.tenant_id === tenantId) && r.id && !present.has(r.id));
    if (missing.length) pending.set(table, missing.map(unredact));
  }
  // Les tables de jonction n'ont ni id ni tenant_id : toute ligne est tentée,
  // les doublons étant reconnus à l'insertion.
  for (const [table, rows] of Object.entries(payload.junctions)) {
    if (rows.length) pending.set(table, rows.map(unredact));
  }

  const counts = new Map<string, { missing: number; restored: number }>();
  for (const [table, rows] of pending) counts.set(table, { missing: rows.length, restored: 0 });

  if (!opts.dryRun) {
    const lastError = new Map<string, string>();
    for (let pass = 1; pass <= MAX_RESTORE_PASSES && pending.size > 0; pass++) {
      let progress = 0;
      for (const [table, rows] of [...pending]) {
        const { inserted, rejected } = await insertRows(supabaseAdmin, table, rows);
        counts.get(table)!.restored += inserted.length;
        progress += inserted.length;
        if (rejected.length) {
          pending.set(table, rejected.map(r => r.row));
          lastError.set(table, rejected[0].error);
        } else {
          pending.delete(table);
        }
      }
      // Aucune ligne rétablie sur toute la passe : les suivantes n'y changeraient rien.
      if (progress === 0) break;
    }
    for (const [table, rows] of pending) note(`${table} : ${rows.length} ligne(s) non restaurée(s), ${lastError.get(table)}`);
  }

  for (const [table, c] of counts) {
    summary.rows.push({ table, missing: c.missing, restored: c.restored, failed: opts.dryRun ? 0 : c.missing - c.restored });
  }

  // --- fichiers : ceux de la réserve de sauvegarde absents du stockage vivant
  const { data: pooled } = await supabaseAdmin.from('tenant_backup_files').select('bucket, path').eq('tenant_id', tenantId);
  const byBucket = new Map<string, string[]>();
  for (const f of (pooled as { bucket: string; path: string }[]) || []) {
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  }
  for (const [bucket, paths] of byBucket) {
    const live = new Set((await listLiveFiles(supabaseAdmin, bucket, tenantId)).map(f => f.path));
    for (const path of paths.filter(p => !live.has(p))) {
      summary.files.missing += 1;
      if (opts.dryRun) continue;
      const { error } = await supabaseAdmin.storage.from(BACKUP_BUCKET)
        .copy(filePoolPath(tenantId, bucket, path), path, { destinationBucket: bucket });
      if (error) { summary.files.failed += 1; note(`${bucket}/${path} : ${error.message}`); }
      else summary.files.restored += 1;
    }
  }

  return summary;
}

/**
 * Efface TOUTES les sauvegardes d'un cabinet : instantanés, fichiers de la
 * réserve et inventaire. Appelée par l'effacement définitif du cabinet — une
 * demande d'effacement n'est pas honorée si ses sauvegardes survivent.
 */
export async function deleteTenantBackups(supabaseAdmin: any, tenantId: string): Promise<{ snapshots: number; files: number }> {
  const { data: backups } = await supabaseAdmin.from('tenant_backups').select('id, data_path').eq('tenant_id', tenantId);
  const snapshotPaths = ((backups as { data_path: string | null }[]) || []).map(b => b.data_path).filter((p): p is string => !!p);
  for (const paths of chunk(snapshotPaths, DB_CHUNK)) await supabaseAdmin.storage.from(BACKUP_BUCKET).remove(paths);
  await supabaseAdmin.from('tenant_backups').delete().eq('tenant_id', tenantId);

  const { data: pooled } = await supabaseAdmin.from('tenant_backup_files').select('bucket, path').eq('tenant_id', tenantId);
  const filePaths = ((pooled as { bucket: string; path: string }[]) || []).map(f => filePoolPath(tenantId, f.bucket, f.path));
  for (const paths of chunk(filePaths, DB_CHUNK)) await supabaseAdmin.storage.from(BACKUP_BUCKET).remove(paths);
  await supabaseAdmin.from('tenant_backup_files').delete().eq('tenant_id', tenantId);

  return { snapshots: snapshotPaths.length, files: filePaths.length };
}

// ---------------------------------------------------------------------------
// Rétention et déclenchement nocturne
// ---------------------------------------------------------------------------

/**
 * Retire les sauvegardes échues, puis les fichiers de la réserve que plus aucun
 * fichier vivant ne justifie depuis BACKUP_RETENTION_DAYS jours.
 *
 * Un cabinet qui porte une sauvegarde sans échéance (suspension, demande de
 * fermeture) garde TOUS ses fichiers : ils sont ce que cette sauvegarde
 * référence, et le cabinet ne les « voit » plus pour les rafraîchir.
 */
export async function pruneBackups(supabaseAdmin: any, now = new Date()): Promise<{ snapshots: number; files: number }> {
  let snapshots = 0;
  let files = 0;

  const { data: expired } = await supabaseAdmin.from('tenant_backups').select('id, data_path')
    .not('expires_at', 'is', null).lt('expires_at', now.toISOString());
  for (const row of (expired as { id: string; data_path: string | null }[]) || []) {
    if (row.data_path) await supabaseAdmin.storage.from(BACKUP_BUCKET).remove([row.data_path]);
    await supabaseAdmin.from('tenant_backups').delete().eq('id', row.id);
    snapshots += 1;
  }

  const { data: kept } = await supabaseAdmin.from('tenant_backups').select('tenant_id')
    .is('expires_at', null).eq('status', 'complete');
  const protectedTenants = new Set(((kept as { tenant_id: string }[]) || []).map(r => r.tenant_id));

  const cutoff = new Date(now.getTime() - BACKUP_RETENTION_DAYS * DAY_MS).toISOString();
  const { data: stale } = await supabaseAdmin.from('tenant_backup_files')
    .select('tenant_id, bucket, path').lt('last_seen_at', cutoff).limit(1000);
  for (const f of (stale as { tenant_id: string; bucket: string; path: string }[]) || []) {
    if (protectedTenants.has(f.tenant_id)) continue;
    await supabaseAdmin.storage.from(BACKUP_BUCKET).remove([filePoolPath(f.tenant_id, f.bucket, f.path)]);
    await supabaseAdmin.from('tenant_backup_files').delete()
      .eq('tenant_id', f.tenant_id).eq('bucket', f.bucket).eq('path', f.path);
    files += 1;
  }
  return { snapshots, files };
}

/**
 * Sauvegarde les cabinets dont la dernière sauvegarde réussie est trop ancienne.
 * Un cabinet suspendu est gelé : ses données ne bougent plus, la sauvegarde
 * prise à la suspension reste la bonne.
 */
export async function runDueBackups(supabaseAdmin: any, now = new Date()): Promise<number> {
  const { data: tenants, error } = await supabaseAdmin.from('tenants').select('id').is('suspended_at', null);
  if (error) {
    console.error('[tenantBackup] liste des cabinets impossible :', error.message);
    return 0;
  }
  const recentSince = new Date(now.getTime() - NIGHTLY_MIN_AGE_MS).toISOString();
  const { data: recent } = await supabaseAdmin.from('tenant_backups').select('tenant_id')
    .eq('status', 'complete').gte('created_at', recentSince);
  const upToDate = new Set(((recent as { tenant_id: string }[]) || []).map(r => r.tenant_id));

  let done = 0;
  for (const tenant of (tenants as { id: string }[]) || []) {
    if (upToDate.has(tenant.id)) continue;
    const row = await createTenantBackupInBackground(supabaseAdmin, tenant.id, 'nightly');
    if (row?.status === 'complete') done += 1;
  }
  return done;
}

export async function runBackupCycle(supabaseAdmin: any): Promise<void> {
  const backedUp = await runDueBackups(supabaseAdmin);
  const pruned = await pruneBackups(supabaseAdmin);
  if (backedUp || pruned.snapshots || pruned.files) {
    console.log(`[tenantBackup] ${backedUp} sauvegarde(s), ${pruned.snapshots} échue(s) retirée(s), ${pruned.files} fichier(s) retiré(s)`);
  }
}

export function startTenantBackups(supabaseAdmin: any): void {
  const intervalHours = parseInt(process.env.TENANT_BACKUP_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  // Premier passage quelques minutes après le démarrage : un redéploiement ne
  // doit pas déclencher une rafale de sauvegardes pendant que le serveur se
  // met en route.
  setTimeout(() => {
    runBackupCycle(supabaseAdmin).catch(e => console.error('[tenantBackup] premier cycle en échec :', e.message));
  }, 5 * 60 * 1000);
  setInterval(() => {
    runBackupCycle(supabaseAdmin).catch(e => console.error('[tenantBackup] cycle en échec :', e.message));
  }, intervalMs);
}
