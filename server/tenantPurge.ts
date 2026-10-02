// Fermeture et effacement d'un cabinet.
//
// POLITIQUE (décision du 2 octobre 2026) : AUCUNE suppression automatique.
//
//   1. Un administrateur demande la fermeture du cabinet (Réglages > Zone
//      dangereuse, server/routes/settings.ts). Une sauvegarde permanente est
//      prise aussitôt (server/tenantBackup.ts).
//   2. À l'issue du délai de grâce de 30 jours, ce traitement GÈLE le cabinet
//      (suspension, voir server/tenantSuspension.ts) au lieu de l'effacer. Les
//      données sont conservées intactes.
//   3. L'effacement définitif n'a lieu que sur demande écrite du cabinet par
//      courrier recommandé avec accusé de réception, exécutée à la main par le
//      superadmin (DELETE /api/admin/tenants/:id) : il saisit la référence du
//      courrier, sa date de réception, et retape le nom du cabinet.
//   4. Les pièces comptables restent protégées 10 ans (Code de commerce) : tant
//      qu'une facture émise depuis moins de 10 ans existe, l'effacement complet
//      est refusé. L'effacement partiel (tout sauf les pièces comptables) n'est
//      pas encore construit — voir ROADMAP.md.
//
// Pourquoi pas une purge automatique : une demande de fermeture peut être
// malveillante (un associé qui nuit à l'autre) ou prématurée, et une purge
// automatique la rendrait irréversible au bout de 30 jours sans que personne
// d'autre que l'auteur de la demande n'ait eu son mot à dire.
//
// Même patron setInterval-au-démarrage que server/tenderRssPoller.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { listUsersOnlyIn } from './tenantMemberships';
import { createTenantBackupInBackground, deleteTenantBackups } from './tenantBackup';
import { invalidateSuspensionCache } from './tenantSuspension';

const GRACE_PERIOD_DAYS = 30;
export const ACCOUNTING_RETENTION_YEARS = 10;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
// Buckets whose files are namespaced by `${tenantId}/...` (see server.ts's
// uploadToStorage call sites) — best-effort cleanup, not privacy-critical
// once the referencing rows are gone, but avoids leaving orphaned files.
const TENANT_PREFIXED_BUCKETS = ['documents', 'plans', 'cv', 'message-attachments', 'feed-attachments', 'meeting-photos', 'reserve-photos', 'logos', 'support-attachments'];

// Ce qui N'EST PAS supprimé, et ne doit pas l'être : les fichiers qu'un cabinet
// a fait déposer sur SON propre espace de stockage (Google Drive, Dropbox,
// Nextcloud, kDrive — voir server/externalStorage/). Ils vivent sur un compte
// qui lui appartient ; les détruire reviendrait à anéantir son bien hors de
// notre système, alors que l'effacement RGPD porte sur les données que NOUS
// détenons. Les lignes external_storage_connections / external_storage_folders
// disparaissent seules par la cascade sur tenants — c'est-à-dire qu'on oublie
// comment aller chercher ces fichiers, sans y toucher.

async function purgeStorageForTenant(supabaseAdmin: SupabaseClient, tenantId: string): Promise<void> {
  for (const bucket of TENANT_PREFIXED_BUCKETS) {
    try {
      const { data: entries, error } = await supabaseAdmin.storage.from(bucket).list(tenantId, { limit: 1000 });
      if (error || !entries?.length) continue;
      const paths = entries.filter(e => e.id !== null).map(e => `${tenantId}/${e.name}`);
      if (paths.length) await supabaseAdmin.storage.from(bucket).remove(paths);
    } catch (e: any) {
      console.error(`[tenantPurge] Storage cleanup failed for ${bucket}/${tenantId}:`, e.message);
    }
  }
}

/**
 * La date de la dernière pièce comptable du cabinet : sa dernière facture émise
 * (un brouillon n'est pas une pièce comptable). Null s'il n'en a aucune.
 */
export async function latestAccountingRecordDate(supabaseAdmin: SupabaseClient, tenantId: string): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from('invoices').select('status, issue_date, created_at').eq('tenant_id', tenantId);
  let latest: Date | null = null;
  for (const row of (data || []) as { status: string | null; issue_date: string | null; created_at: string | null }[]) {
    if (row.status === 'Draft') continue;
    const date = new Date(row.issue_date || row.created_at || '');
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

/**
 * Jusqu'à quand les pièces comptables du cabinet sont protégées, ou null si
 * elles ne le sont plus (ou n'existent pas).
 */
export async function accountingRetentionEnd(supabaseAdmin: SupabaseClient, tenantId: string, now = new Date()): Promise<Date | null> {
  const latest = await latestAccountingRecordDate(supabaseAdmin, tenantId);
  if (!latest) return null;
  const end = new Date(latest);
  end.setFullYear(end.getFullYear() + ACCOUNTING_RETENTION_YEARS);
  return end > now ? end : null;
}

/**
 * EFFACEMENT DÉFINITIF d'un cabinet : comptes, fichiers, lignes ET sauvegardes
 * (une demande d'effacement n'est pas honorée si les sauvegardes restent). À ne
 * jamais appeler sans les garde-fous de la route superadmin (courrier
 * recommandé, pièces comptables, cabinet suspendu).
 */
export async function eraseTenant(supabaseAdmin: SupabaseClient, tenantId: string): Promise<void> {
  // Seuls les comptes dont c'est le SEUL cabinet sont supprimés : une
  // personne qui exerce aussi ailleurs garde le sien, sinon fermer une
  // structure la déconnecterait de l'autre (server/tenantMemberships.ts).
  const exclusiveUserIds = await listUsersOnlyIn(supabaseAdmin, tenantId);
  for (const userId of exclusiveUserIds) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) console.error(`[tenantPurge] Failed to delete auth user ${userId}:`, error.message);
  }

  await purgeStorageForTenant(supabaseAdmin, tenantId);

  // Cascades every table with `tenant_id UUID REFERENCES tenants(id) ON
  // DELETE CASCADE` (projects, invoices, documents, contacts, ... — see
  // supabase/schema.sql) — this is the actual purge of all professional data.
  const { error } = await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
  if (error) throw new Error(`Suppression du cabinet impossible : ${error.message}`);

  await deleteTenantBackups(supabaseAdmin, tenantId);
  invalidateSuspensionCache();
  console.log(`[tenantPurge] Cabinet ${tenantId} effacé (demande par courrier recommandé)`);
}

/**
 * Gèle les cabinets dont le délai de grâce de fermeture est écoulé. Ne supprime
 * rien : voir la politique en tête de fichier.
 */
export async function freezeExpiredTenants(supabaseAdmin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, deletion_requested_at')
    .not('deletion_requested_at', 'is', null)
    // Déjà suspendu (par le superadmin ou par un passage précédent) : rien à faire.
    .is('suspended_at', null)
    .lte('deletion_requested_at', cutoff);
  if (error) {
    console.error('[tenantPurge] Failed to list tenants pending closure:', error.message);
    return 0;
  }
  let frozen = 0;
  for (const tenant of (data || []) as { id: string; deletion_requested_at: string }[]) {
    const requestedOn = new Date(tenant.deletion_requested_at).toLocaleDateString('fr-FR');
    const { error: updateError } = await supabaseAdmin.from('tenants').update({
      suspended_at: new Date().toISOString(),
      suspended_by: null,
      suspension_reason: `Fermeture demandée le ${requestedOn}, délai de grâce de ${GRACE_PERIOD_DAYS} jours écoulé. `
        + "Données conservées : l'effacement définitif n'a lieu que sur demande du cabinet par courrier recommandé.",
    }).eq('id', tenant.id).is('suspended_at', null);
    if (updateError) {
      console.error(`[tenantPurge] Failed to freeze tenant ${tenant.id}:`, updateError.message);
      continue;
    }
    invalidateSuspensionCache();
    // État figé du cabinet, hors de portée de ses administrateurs.
    void createTenantBackupInBackground(supabaseAdmin, tenant.id, 'suspension');
    frozen += 1;
    console.log(`[tenantPurge] Cabinet ${tenant.id} gelé (fermeture demandée le ${requestedOn}, rien n'est supprimé)`);
  }
  return frozen;
}

export function startTenantClosure(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.TENANT_PURGE_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  freezeExpiredTenants(supabaseAdmin).catch(e => console.error('[tenantPurge] Initial closure check failed:', e.message));
  setInterval(() => {
    freezeExpiredTenants(supabaseAdmin).catch(e => console.error('[tenantPurge] Closure cycle failed:', e.message));
  }, intervalMs);
}
