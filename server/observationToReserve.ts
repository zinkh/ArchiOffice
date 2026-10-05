// Reprise d'observations de la DET en réserves de l'AOR (table `reserves`, OPR).
// L'observation n'est ni déplacée ni supprimée : elle garde sa place dans les
// comptes-rendus et pointe vers sa réserve par `observations.reserve_id`
// (supabase/migrate_observation_reserve_link.sql). Les photos ne sont pas
// copiées : la suppression d'une réserve retire ses fichiers du stockage, ce
// qui emporterait ceux de l'observation d'origine.
import { tenantScopedFrom } from './tenantScopedFrom';

export const TITLE_MAX_LENGTH = 120;
/** Statuts d'une observation qui ne se reprennent plus : déjà réglée ou refusée. */
export const CLOSED_OBSERVATION_STATUSES = ['Levée', 'Refusée'];

export type SkipReason = 'introuvable' | 'deja_reprise' | 'cloturee';

export interface ReserveFromObservation {
  observation_id: string;
  reserve_id: string;
  number: number;
}

export interface ConversionResult {
  created: ReserveFromObservation[];
  skipped: { observation_id: string; reason: SkipReason }[];
}

/** Intitulé court d'une réserve tiré du texte d'une observation (première ligne, borné). */
export function reserveTitleFromObservation(texte: string | null | undefined): string {
  const firstLine = (texte || '').split('\n').map(l => l.trim()).find(Boolean) || 'Observation de la DET';
  return firstLine.length > TITLE_MAX_LENGTH ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…` : firstLine;
}

export function reserveDescriptionFromObservation(obs: { texte?: string | null; number?: number | null }): string {
  const origin = `Reprise de l'observation de la DET n° ${obs.number ?? '—'}.`;
  const texte = (obs.texte || '').trim();
  return texte ? `${texte}\n\n${origin}` : origin;
}

/**
 * Crée une réserve par observation reprenable. Séquentiel : la numérotation des
 * réserves est continue par projet. Si le lien ne peut pas être enregistré
 * (migration absente), la réserve créée est retirée et l'erreur remonte, pour
 * ne jamais laisser une réserve en double à la prochaine tentative.
 */
export async function convertObservationsToReserves(
  supabaseAdmin: any,
  tenantId: string,
  projectId: string,
  observationIds: string[],
): Promise<ConversionResult> {
  const result: ConversionResult = { created: [], skipped: [] };
  if (observationIds.length === 0) return result;

  const { data: rows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
    .select('*').eq('project_id', projectId).in('id', observationIds);
  const found = new Map<string, any>(((rows || []) as any[]).map(o => [o.id, o]));

  const linkedIds = ((rows || []) as any[]).map(o => o.reserve_id).filter(Boolean);
  const { data: existingReserves } = linkedIds.length
    ? await supabaseAdmin.from('reserves').select('id').eq('tenant_id', tenantId).in('id', linkedIds)
    : { data: [] };
  const aliveReserveIds = new Set(((existingReserves || []) as any[]).map(r => r.id));

  const lotIds = [...new Set(((rows || []) as any[]).map(o => o.lot_id).filter(Boolean))];
  const { data: lots } = lotIds.length
    ? await tenantScopedFrom(supabaseAdmin, tenantId, 'project_lots').select('id, lot_title, contact_name').in('id', lotIds)
    : { data: [] };
  const lotById = new Map<string, any>(((lots || []) as any[]).map(l => [l.id, l]));

  const { data: lastRow } = await supabaseAdmin.from('reserves').select('number')
    .eq('tenant_id', tenantId).eq('project_id', projectId).order('number', { ascending: false }).limit(1).maybeSingle();
  let nextNumber = ((lastRow as any)?.number || 0) + 1;
  const today = new Date().toISOString().slice(0, 10);

  for (const observationId of observationIds) {
    const obs = found.get(observationId);
    if (!obs) { result.skipped.push({ observation_id: observationId, reason: 'introuvable' }); continue; }
    if (obs.reserve_id && aliveReserveIds.has(obs.reserve_id)) { result.skipped.push({ observation_id: observationId, reason: 'deja_reprise' }); continue; }
    if (CLOSED_OBSERVATION_STATUSES.includes(obs.statut)) { result.skipped.push({ observation_id: observationId, reason: 'cloturee' }); continue; }

    const lot = obs.lot_id ? lotById.get(obs.lot_id) : undefined;
    const reserveId = crypto.randomUUID();
    const { error: insertError } = await supabaseAdmin.from('reserves').insert({
      id: reserveId, tenant_id: tenantId, project_id: projectId,
      title: reserveTitleFromObservation(obs.texte), batiment: '', local: '', status: 'A faire',
      lots: JSON.stringify(lot?.lot_title ? [lot.lot_title] : []),
      entreprises: JSON.stringify(lot?.contact_name ? [lot.contact_name] : []),
      created_at: today, due_date: obs.due_date || null, number: nextNumber,
      description: reserveDescriptionFromObservation(obs),
    });
    if (insertError) throw insertError;

    const { error: linkError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
      .update({ reserve_id: reserveId }).eq('id', observationId);
    if (linkError) {
      await supabaseAdmin.from('reserves').delete().eq('id', reserveId).eq('tenant_id', tenantId);
      throw linkError;
    }
    result.created.push({ observation_id: observationId, reserve_id: reserveId, number: nextNumber });
    nextNumber += 1;
  }
  return result;
}
