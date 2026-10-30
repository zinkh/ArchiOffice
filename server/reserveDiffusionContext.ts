// Contexte d'une diffusion de réserves : réserves du périmètre, lots, marchés, intervenants et contacts,
// puis destinataires rejoués (src/lib/reserveDiffusion.ts). Partagé par les routes de diffusion
// (server/routes/reserveExports.ts) et par les rappels hebdomadaires (server/reserveReminders.ts), pour
// qu'un rappel automatique n'écrive jamais à d'autres personnes que la diffusion manuelle.
import { tenantScopedFrom } from './tenantScopedFrom';
import { parseJsonList } from '../src/lib/jsonList';
import { buildReserveRecipients, selectReserves } from '../src/lib/reserveDiffusion';

export const RESERVE_KINDS = ['opr', 'gpa'] as const;
export type ReserveKind = (typeof RESERVE_KINDS)[number];

export const RESERVE_TABLE: Record<ReserveKind, string> = { opr: 'reserves', gpa: 'gpa_reserves' };
export const RESERVE_TITLE: Record<ReserveKind, string> = { opr: 'Réserves', gpa: 'Réserves GPA' };

export const readKind = (v: unknown): ReserveKind | null => (RESERVE_KINDS as readonly string[]).includes(String(v)) ? (v as ReserveKind) : null;

/** Lots du périmètre : tableau d'intitulés, ou null pour toute la liste. */
export const readLots = (raw: unknown): string[] | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return null;
    return [...new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length <= 200))].slice(0, 200);
  } catch { return null; }
};

/** Tout ce qu'il faut pour rejouer les destinataires d'un périmètre ; null si l'opération n'est pas au cabinet. */
export async function loadReserveContext(supabaseAdmin: any, tenantId: string, projectId: string, kind: ReserveKind, lots: string[] | null) {
  const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
    .select('id, name, project_code, address').eq('id', projectId).maybeSingle();
  if (!project) return null;
  const [reservesRes, lotsRes, marchesRes, stakeholdersRes] = await Promise.all([
    tenantScopedFrom(supabaseAdmin, tenantId, RESERVE_TABLE[kind]).select('id, number, status, title, lots, entreprises, due_date').eq('project_id', projectId),
    tenantScopedFrom(supabaseAdmin, tenantId, 'project_lots').select('lot_number, lot_title, contact_id, contact_name').eq('project_id', projectId),
    tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises').select('entreprise_nom, contact_id, type_marche, statut').eq('project_id', projectId),
    tenantScopedFrom(supabaseAdmin, tenantId, 'project_stakeholders').select('name, role, contact_id').eq('project_id', projectId),
  ]);
  const reserves = selectReserves((reservesRes.data || []) as any[], lots);
  const lotRows = (lotsRes.data || []) as any[];
  const marches = ((marchesRes.data || []) as any[]).filter(m => m.type_marche !== 'subsequent' && m.statut !== 'resilie');
  const stakeholders = (stakeholdersRes.data || []) as any[];

  const ids = [...new Set([...lotRows, ...marches, ...stakeholders].map(x => x.contact_id).filter(Boolean))];
  const noms = [...new Set(reserves.flatMap(r => parseJsonList(r.entreprises)))].slice(0, 100);
  const colonnes = 'id, first_name, last_name, company_name, email, email_work, email_other, email_home';
  const [byId, byName] = await Promise.all([
    ids.length ? tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select(colonnes).in('id', ids) : Promise.resolve({ data: [] }),
    noms.length ? tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select(colonnes).in('company_name', noms) : Promise.resolve({ data: [] }),
  ]);
  const contacts = [...new Map([...((byId.data || []) as any[]), ...((byName.data || []) as any[])].map(c => [c.id, c])).values()];
  const recipients = buildReserveRecipients({ reserves, lots: lotRows, marches, stakeholders, contacts });
  return { project: project as any, reserves, recipients };
}
