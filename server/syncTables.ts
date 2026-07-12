// Single source of truth for which tables participate in cloud↔local sync
// (offline desktop "cloud-link" feature). Mirrors the exact table list the
// supabase/migrate_add_sync_infra.sql migration attached triggers to —
// verified directly against the live production schema (not just
// schema.sql, which references some tables — activities/feed_posts/
// feed_comments — that don't actually exist in production) before either
// file was written. If a table is added here, it must also be added to
// that migration's trigger-attachment loop, and vice versa.
//
// Deliberately excluded from this list (see the migration's own header
// comment for the full reasoning):
//   - tenants, profiles: provisioned once at cloud-link time with IDs
//     copied verbatim from the cloud row, not tracked via the generic
//     sync_log mechanism.
//   - agents, agent_conversations, agent_messages, agent_token_usage,
//     billing_events: out of scope for v1 (AI-agent/billing data).
//   - project_categories_junction, project_team, observation_reports: pure
//     junction tables with no tenant_id/id of their own — see
//     JUNCTION_TABLES below instead.

export const SYNC_TABLES: readonly string[] = [
  'act_data', 'articles_type', 'cctps', 'contact_categories', 'contacts',
  'contrats_moe', 'custom_references', 'det_data', 'detail_situations',
  'document_versions', 'documents', 'dpgf_items', 'dpgfs', 'invoice_items',
  'invoices', 'lignes_ouvrages', 'maf_project_data', 'marches_entreprises',
  'milestones', 'notes_honoraires', 'observations', 'ordres_de_service',
  'plans', 'project_categories', 'project_cotraitants', 'project_lots',
  'project_members', 'project_stakeholders', 'project_templates',
  'projects', 'proposal_specialties', 'proposals', 'receptions',
  'reserves', 'settings', 'site_report_notes', 'site_reports',
  'situations', 'specifications', 'tasks', 'team_members',
  'tender_specialties', 'tenders', 'visas',
];

/**
 * Pure junction tables with no tenant_id/id column of their own (composite
 * PK) — not tracked by the generic sync_log trigger. Instead, whenever a row
 * in `parentTable` is imported/synced, re-fetch and diff all of the
 * junction table's rows for that parent id (see server/initialImport.ts and
 * server/cloudSync.ts).
 */
export const JUNCTION_TABLES: readonly { table: string; parentTable: string; parentIdColumn: string }[] = [
  { table: 'project_categories_junction', parentTable: 'projects', parentIdColumn: 'project_id' },
  { table: 'project_team', parentTable: 'projects', parentIdColumn: 'project_id' },
  { table: 'observation_reports', parentTable: 'observations', parentIdColumn: 'observation_id' },
];
