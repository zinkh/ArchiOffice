// RGPD / archivage légal — export complet et exploitable de toute l'activité
// d'un tenant (server/routes/settings.ts's GET /api/settings/tenant-export,
// admin only). Streams a ZIP: one CSV per data table under donnees/, every
// uploaded file (documents, plans, CV, photos, pièces jointes) under
// fichiers/<bucket>/..., and a manifest.json summary. Meant to be run before
// requesting a cabinet closure (server/tenantPurge.ts) so the legally
// mandated accounting records (10-year retention under French law) and the
// rest of the cabinet's activity survive the eventual purge as an archive.
import type { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ZipArchive, type Archiver } from 'archiver';
import { SYNC_TABLES } from './syncTables';
import { parseExternalRef } from './externalStorage/externalRef';
import { getConnectionById } from './externalStorage/externalConnection';
import { createProvider } from './externalStorage/providerFactory';

// Every table scoped by tenant_id that represents real cabinet activity.
// SYNC_TABLES (offline cloud-link scope) covers most of it; the rest is
// added explicitly here. Kept in sync with supabase/schema.sql by hand —
// same maintenance duty syncTables.ts's own header comment already calls
// out for SYNC_TABLES. sync_log (internal sync bookkeeping) is deliberately
// excluded, and `tenants` itself is handled separately in the manifest.
const EXPORT_TABLES: readonly string[] = Array.from(new Set([
  ...SYNC_TABLES,
  'profiles', 'billing_events', 'activities',
  'agents', 'agent_conversations', 'agent_messages', 'agent_token_usage',
  'agent_alert_rules', 'agent_alerts', 'agent_schedules', 'agent_schedule_runs',
  'conversations', 'conversation_participants', 'messages',
  'document_diffusions', 'document_templates',
  'feed_posts', 'feed_comments', 'feed_likes',
  'gpa_reserves', 'join_requests', 'leave_balances', 'leave_requests',
  'meeting_attendees', 'meeting_photos', 'meetings', 'mentions',
  // L'historique des notifications système, au même titre que le flux
  // d'activité. push_subscriptions, en revanche, reste hors export : ce sont
  // des identifiants de transport propres à un navigateur (endpoint + clés de
  // chiffrement), pas du contenu produit par le cabinet.
  'notification_outbox', 'permits',
  'profile_education', 'profile_experience', 'project_phase_history', 'rfis',
  // L'espace de stockage branché par le cabinet et le cache d'arborescence qui
  // va avec — jetons et mots de passe masqués plus bas.
  'external_storage_connections', 'external_storage_folders',
]));

// Pure junction tables with no tenant_id/id column of their own (composite
// PK) — same three as server/syncTables.ts's JUNCTION_TABLES, re-derived
// here from their parent table's exported row ids.
const JUNCTION_EXPORT_TABLES: readonly { table: string; parentTable: string; parentIdColumn: string }[] = [
  { table: 'project_categories_junction', parentTable: 'projects', parentIdColumn: 'project_id' },
  { table: 'project_team', parentTable: 'projects', parentIdColumn: 'project_id' },
  { table: 'observation_reports', parentTable: 'observations', parentIdColumn: 'observation_id' },
];

// Third-party credentials, not activity — never written to the archive in
// cleartext, since a ZIP full of exported "data" is easy to hand off or
// store carelessly compared to the settings page itself.
const REDACTED_COLUMNS_BY_TABLE: Record<string, Set<string>> = {
  external_storage_connections: new Set(['refresh_token', 'access_token', 'password_encrypted']),
};

const REDACTED_SETTINGS_COLUMNS = new Set([
  'smtp_pass', 'seller_iban',
  'zoho_client_secret', 'zoho_refresh_token', 'zoho_books_refresh_token',
  'odoo_api_key', 'ragic_api_key',
  'chorus_pro_piste_client_secret', 'chorus_pro_technical_password',
  'superpdp_client_secret',
]);

// Buckets whose objects are namespaced by `${tenantId}/...` — see
// server.ts's uploadToStorage call sites.
const TENANT_PREFIXED_BUCKETS = ['documents', 'plans', 'cv', 'message-attachments', 'feed-attachments', 'meeting-photos', 'logos'];

const PAGE_SIZE = 1000;

function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const columnSet = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) columnSet.add(key);
  const columns = Array.from(columnSet);
  const escape = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(c => escape(row[c])).join(','));
  return lines.join('\n');
}

function redact(table: string, rows: Record<string, any>[]): Record<string, any>[] {
  // Était codé en dur sur `settings`, seule table à porter des secrets à
  // l'époque. Les jetons d'un espace de stockage externe vivent ailleurs, d'où
  // la table de correspondance : un secret de plus ne doit pas demander de
  // retoucher cette fonction.
  const columns = table === 'settings' ? REDACTED_SETTINGS_COLUMNS : REDACTED_COLUMNS_BY_TABLE[table];
  if (!columns) return rows;
  return rows.map(row => {
    const copy = { ...row };
    for (const col of columns) {
      if (copy[col]) copy[col] = '[REDACTED]';
    }
    return copy;
  });
}

async function fetchAllRows(supabaseAdmin: SupabaseClient, table: string, tenantId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('tenant_id', tenantId).range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      // A table missing on this deployment (pending migration) shouldn't
      // sink the whole export — skip it and keep going.
      console.error(`[tenantExport] Failed to read ${table}:`, error.message);
      return rows;
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function addStorageFolder(
  supabaseAdmin: SupabaseClient,
  archive: Archiver,
  bucket: string,
  tenantId: string,
  relPrefix = '',
): Promise<void> {
  const cloudPath = relPrefix ? `${tenantId}/${relPrefix}` : tenantId;
  const { data: entries, error } = await supabaseAdmin.storage.from(bucket).list(cloudPath, { limit: 1000 });
  if (error || !entries?.length) return;

  for (const entry of entries) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    // Supabase Storage's list() marks folders with a null id — files always
    // have metadata (size, mimetype...). Same convention as
    // server/initialImport.ts's importStorageFolder().
    const isFolder = entry.id === null;
    if (isFolder) {
      await addStorageFolder(supabaseAdmin, archive, bucket, tenantId, relPath);
      continue;
    }
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(`${tenantId}/${relPath}`);
    if (dlErr || !blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    archive.append(buf, { name: `fichiers/${bucket}/${relPath}` });
  }
}

interface ExternalExportSummary {
  fournisseur: string | null;
  fichiers_exportes: number;
  fichiers_en_echec: string[];
}

/**
 * Verse dans l'archive les documents et plans hébergés sur l'espace de stockage
 * du cabinet.
 *
 * Sans cette passe, un export RGPD serait MENSONGER : il ne parcourt que les
 * buckets Supabase, et les fichiers déposés chez le cabinet en seraient
 * silencieusement absents alors que l'archive se présente comme complète.
 *
 * Un échec par fichier n'interrompt pas l'archive — la réponse HTTP est déjà en
 * cours de diffusion, on ne peut plus la transformer en erreur — mais il est
 * compté et nommé dans le manifeste, pour que l'absence soit visible plutôt que
 * silencieuse.
 */
async function addExternalFiles(
  supabaseAdmin: SupabaseClient,
  archive: Archiver,
  tenantId: string,
): Promise<ExternalExportSummary> {
  const summary: ExternalExportSummary = { fournisseur: null, fichiers_exportes: 0, fichiers_en_echec: [] };

  // On repart des LIGNES et non d'un parcours de l'espace distant : ce sont
  // elles qui disent quels fichiers appartiennent à ce cabinet.
  const sources: { table: string; column: string; nameColumn: string }[] = [
    { table: 'documents', column: 'file_url', nameColumn: 'name' },
    { table: 'document_versions', column: 'file_url', nameColumn: 'version' },
    { table: 'plans', column: 'file_url', nameColumn: 'name' },
    { table: 'visas', column: 'document_url', nameColumn: 'title' },
  ];

  const providerCache = new Map<string, any>();
  const seen = new Set<string>();

  for (const source of sources) {
    let rows: any[] = [];
    try {
      const { data } = await (supabaseAdmin as any)
        .from(source.table).select('*').eq('tenant_id', tenantId);
      rows = (data as any[]) || [];
    } catch {
      continue; // table absente sur ce déploiement
    }

    for (const row of rows) {
      const ref = parseExternalRef(row[source.column]);
      if (!ref || seen.has(ref.externalId)) continue;
      seen.add(ref.externalId);

      const label = `${source.table}/${row[source.nameColumn] ?? row.id}`;
      try {
        let provider = providerCache.get(ref.connectionId);
        if (!provider) {
          const connection = await getConnectionById(supabaseAdmin as any, tenantId, ref.connectionId);
          // Accès révoqués depuis les Réglages : ArchiOffice ne sait plus aller
          // chercher ces fichiers. Ils restent chez le cabinet, mais l'export ne
          // peut pas les inclure — et doit le dire.
          if (!connection) { summary.fichiers_en_echec.push(label); continue; }
          summary.fournisseur = summary.fournisseur || connection.provider;
          provider = createProvider(connection);
          providerCache.set(ref.connectionId, provider);
        }
        const stream = await provider.openReadStream(ref.externalId);
        archive.append(stream.body as any, {
          name: `fichiers/externe/${source.table}/${ref.fileName || ref.externalId}`,
        });
        summary.fichiers_exportes += 1;
      } catch {
        summary.fichiers_en_echec.push(label);
      }
    }
  }

  return summary;
}

/** Streams a ZIP archive of every row and file belonging to `tenantId` directly to `res`. */
export async function streamTenantExport(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  tenantName: string,
  res: Response,
): Promise<void> {
  const slug = (tenantName || 'cabinet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'cabinet';
  const filename = `archioffice-export-${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (err) => console.warn('[tenantExport] archiver warning:', err.message));
  archive.on('error', (err) => { console.error('[tenantExport] archiver error:', err.message); res.destroy(err); });
  archive.pipe(res);

  const tableCounts: Record<string, number> = {};
  const idsByTable = new Map<string, string[]>();

  for (const table of EXPORT_TABLES) {
    const rows = await fetchAllRows(supabaseAdmin, table, tenantId);
    tableCounts[table] = rows.length;
    if (rows.length) {
      idsByTable.set(table, rows.map((r: any) => r.id).filter(Boolean));
      archive.append(toCsv(redact(table, rows)), { name: `donnees/${table}.csv` });
    }
  }

  for (const { table, parentTable, parentIdColumn } of JUNCTION_EXPORT_TABLES) {
    const parentIds = idsByTable.get(parentTable) || [];
    if (!parentIds.length) continue;
    const rows: any[] = [];
    for (let i = 0; i < parentIds.length; i += 100) {
      const chunk = parentIds.slice(i, i + 100);
      const { data, error } = await supabaseAdmin.from(table).select('*').in(parentIdColumn, chunk);
      if (error) { console.error(`[tenantExport] Failed to read ${table}:`, error.message); continue; }
      if (data?.length) rows.push(...data);
    }
    tableCounts[table] = rows.length;
    if (rows.length) archive.append(toCsv(rows), { name: `donnees/${table}.csv` });
  }

  for (const bucket of TENANT_PREFIXED_BUCKETS) {
    await addStorageFolder(supabaseAdmin, archive, bucket, tenantId);
  }

  const externalFiles = await addExternalFiles(supabaseAdmin, archive, tenantId);

  archive.append(JSON.stringify({
    exported_at: new Date().toISOString(),
    tenant_id: tenantId,
    tenant_name: tenantName,
    row_counts: tableCounts,
    stockage_externe: externalFiles,
    note: "Export complet des données du cabinet à des fins d'archivage. "
      + "donnees/ : un fichier CSV par table de données. fichiers/ : tous les fichiers déposés "
      + "(documents, plans, CV, photos de réunion, pièces jointes), classés par type de stockage. "
      + "fichiers/externe/ : les documents et plans hébergés sur l'espace de stockage du cabinet. "
      + "fichiers/externe/ : les documents et plans hébergés sur l'espace de stockage du cabinet. "
      + "Les identifiants et secrets des intégrations tierces (SMTP, clés API) sont masqués. "
      + "Conservez cet export conformément à vos obligations légales (les documents comptables "
      + "doivent notamment être conservés 10 ans en droit français).",
  }, null, 2), { name: 'manifest.json' });

  await archive.finalize();
}
