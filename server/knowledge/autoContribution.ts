/**
 * Partage automatique d'extraits techniques, sans validation humaine préalable.
 *
 * Un document d'une catégorie choisie par le cabinet est mis en file à son dépôt,
 * puis traité en tâche de fond : lecture du texte, masquage (valeurs exactes du
 * cabinet, puis règles), relecture par l'IA de Mistral, tri paragraphe par
 * paragraphe. Ce qui reste douteux est RETENU, jamais envoyé ; le reste part.
 *
 * Rien ne quitte ArchiOffice tant que `MISTRAL_KNOWLEDGE_PUBLISH_ENABLED` n'est
 * pas actif : la relecture IA envoie déjà du texte non validé à Mistral.
 */
import { tenantScopedFrom } from '../tenantScopedFrom';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import {
  anonymizeTechnicalText, buildKnownMatchers, findResidualProperNouns, type KnownMatcher,
} from './anonymize';
import { applyFindings, type AiReviewer } from './aiReview';
import { extractDocumentSource, MAX_SOURCE_BYTES, type SourceDocument } from './documentSource';
import { loadTenantKnownValues } from './tenantIdentifiers';
import { publishContribution, publishEnabled } from './publishContribution';
import { resolveKnowledgeLibraryId } from './mistralLibrary';

/** Sous ce volume de texte partageable, rien n'est envoyé : ce n'est pas une prescription. */
export const MIN_SHARED_CHARS = 200;
const MAX_SOURCE_CHARS = 60_000;
const CHUNK_CHARS = 9_000;
const PARAGRAPH_MAX_CHARS = 1_200;
export const MAX_ANALYSIS_ATTEMPTS = 5;
export const STALE_ANALYZING_MS = 10 * 60_000;
/** Délai minimal entre la mise en file (ou un échec) et la prochaine tentative. */
export const QUEUE_SETTLE_MS = 30_000;
/** Plafond d'envois automatiques par cabinet et par 24 h : ni emballement, ni facture surprise. */
export const AUTO_SHARE_DAILY_CAP = 25;

export interface WithheldParagraph { index: number; text: string; reasons: string[] }

export interface AnalysisReport {
  source_chars: number;
  paragraphs: number;
  kept: number;
  withheld: number;
  dropped_low_content: number;
  /** Éléments masqués, par catégorie (personne, adresse, montant...). */
  masked: Record<string, number>;
  ai_findings: number;
  ai_chunks: number;
  known_values: number;
  analysed_at: string;
  attempts?: number;
  last_error?: string;
  reason?: string;
}

/** Découpe en paragraphes de taille raisonnable (blocs séparés par une ligne vide, sinon groupes de lignes). */
export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length <= PARAGRAPH_MAX_CHARS) { out.push(trimmed); continue; }
    let group = '';
    for (const line of trimmed.split('\n')) {
      if (group && group.length + line.length + 1 > PARAGRAPH_MAX_CHARS) { out.push(group.trim()); group = ''; }
      group += (group ? '\n' : '') + line;
    }
    if (group.trim()) out.push(group.trim());
  }
  return out;
}

const placeholderShare = (text: string) => {
  const stripped = text.replace(/\[[A-ZÉ_ ]+\]/g, '').replace(/[^\p{L}\d]/gu, '');
  return { remaining: stripped.length, total: text.replace(/\s/g, '').length };
};

export interface AnalysisResult { text: string; withheld: WithheldParagraph[]; report: AnalysisReport }

/** Analyse un texte source : masque, fait relire, trie. Pure hormis l'appel au relecteur injecté. */
export async function analyseSource(source: string, known: KnownMatcher[], review: AiReviewer): Promise<AnalysisResult> {
  const paragraphs = splitParagraphs(source.slice(0, MAX_SOURCE_CHARS));
  const masked: Record<string, number> = {};
  const add = (byCategory: Record<string, number>) => {
    for (const [label, n] of Object.entries(byCategory)) masked[label] = (masked[label] || 0) + n;
  };

  // 1. Valeurs du cabinet puis règles, paragraphe par paragraphe.
  const items = paragraphs.map((original, index) => {
    const result = anonymizeTechnicalText(original, { known });
    add(result.byCategory);
    return { index, text: result.text, reasons: [] as string[] };
  }).filter(item => item.text);

  // 2. Relecture IA par lots ; un échec du relecteur interrompt tout (jamais d'envoi sans relecture).
  let aiFindings = 0;
  let aiChunks = 0;
  for (let i = 0; i < items.length;) {
    const batch: typeof items = [];
    let size = 0;
    while (i < items.length && (batch.length === 0 || size + items[i].text.length < CHUNK_CHARS)) {
      size += items[i].text.length + 2; batch.push(items[i++]);
    }
    const reviewed = await review(batch.map(b => b.text).join('\n\n'));
    aiChunks++;
    for (const item of batch) {
      const applied = applyFindings(item.text, reviewed.findings);
      item.text = applied.text; aiFindings += applied.count; add(applied.byCategory);
      if (reviewed.risk === 'eleve') item.reasons.push('relecture IA : risque d’identifiants non désignés');
    }
  }

  // 3. Contrôle final des noms propres restants, puis tri.
  const kept: string[] = [];
  const withheld: WithheldParagraph[] = [];
  let droppedLowContent = 0;
  for (const item of items) {
    const residual = findResidualProperNouns(item.text);
    if (residual.length) {
      item.reasons.push('à vérifier : ' + [...new Set(residual.map(r => r.text))].slice(0, 3).join(', '));
    }
    if (item.reasons.length) { withheld.push({ index: item.index, text: item.text, reasons: item.reasons }); continue; }
    const share = placeholderShare(item.text);
    if (share.remaining < 40 || share.remaining < share.total * 0.5) { droppedLowContent++; continue; }
    kept.push(item.text);
  }
  const text = kept.join('\n\n');
  return {
    text, withheld,
    report: {
      source_chars: source.length, paragraphs: paragraphs.length, kept: kept.length, withheld: withheld.length,
      dropped_low_content: droppedLowContent, masked, ai_findings: aiFindings, ai_chunks: aiChunks,
      known_values: known.length, analysed_at: new Date().toISOString(),
    },
  };
}

// ── Réglage du cabinet ────────────────────────────────────────────────────────

export interface AutoSharePrefs { optedIn: boolean; enabled: boolean; categories: string[] }

/** Lit le réglage ; une base sans la migration vaut « partage automatique désactivé ». */
export async function getAutoSharePrefs(db: any, tenantId: string): Promise<AutoSharePrefs> {
  const { data, error } = await tenantScopedFrom(db, tenantId, 'knowledge_sharing_preferences')
    .select('opted_in,auto_share_enabled,auto_share_categories').maybeSingle();
  if (error || !data) return { optedIn: false, enabled: false, categories: [] };
  return {
    optedIn: data.opted_in === true,
    enabled: data.opted_in === true && data.auto_share_enabled === true,
    categories: Array.isArray(data.auto_share_categories) ? data.auto_share_categories : [],
  };
}

// ── Mise en file ──────────────────────────────────────────────────────────────

/**
 * Types de documents qu'un cabinet peut choisir de partager. Liste BLANCHE : les
 * contrats, devis, ordres de service, comptes rendus et pièces de clients n'en
 * font jamais partie, et un plan est un dessin sans texte à partager.
 */
export const SHAREABLE_DOC_TYPES = ['CCTP', 'Note technique', 'DPGF', 'BPU', 'DQE', 'Rapport'] as const;

export interface QueueableDocument extends SourceDocument { doc_type?: string | null }

/** Met un document en file si son cabinet l'a demandé. Meilleur effort : ne bloque jamais un dépôt. */
export async function enqueueAutoContribution(db: any, tenantId: string, doc: QueueableDocument): Promise<boolean> {
  try {
    const prefs = await getAutoSharePrefs(db, tenantId);
    if (!prefs.enabled || !doc.doc_type || !prefs.categories.includes(doc.doc_type)) return false;
    // Défense en profondeur : même un réglage ancien ou forcé ne fait jamais partir un contrat ou un devis.
    if (!(SHAREABLE_DOC_TYPES as readonly string[]).includes(doc.doc_type)) return false;
    if (!isOwnStorageRef(doc.file_url, 'documents') || (doc.size_bytes ?? 0) > MAX_SOURCE_BYTES) return false;
    const { error } = await tenantScopedFrom(db, tenantId, 'knowledge_contributions').upsert({
      document_id: doc.id, status: 'queued', origin: 'auto', sanitized_text: '', warnings: [], withheld: [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,document_id', ignoreDuplicates: true });
    return !error;
  } catch {
    return false;
  }
}

// ── Traitement de la file ─────────────────────────────────────────────────────

export interface CycleDeps {
  review: AiReviewer;
  /** Lecture du document source. Injectable pour les tests ; par défaut, la lecture réelle. */
  extract?: typeof extractDocumentSource;
}

async function releaseStale(db: any) {
  const before = new Date(Date.now() - STALE_ANALYZING_MS).toISOString();
  await db.from('knowledge_contributions')
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('origin', 'auto').eq('status', 'analyzing').lt('updated_at', before);
}

async function settle(db: any, tenantId: string, id: string, patch: Record<string, unknown>) {
  const result = await tenantScopedFrom(db, tenantId, 'knowledge_contributions')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'analyzing').select().maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function processOne(db: any, row: any, deps: CycleDeps) {
  const tenantId = row.tenant_id as string;
  const prefs = await getAutoSharePrefs(db, tenantId);
  if (!prefs.enabled) {
    await settle(db, tenantId, row.id, { status: 'held', analysis: { reason: 'Partage automatique désactivé avant le traitement.' } });
    return;
  }
  const { data: doc, error } = await tenantScopedFrom(db, tenantId, 'documents')
    .select('id,name,file_url,mime_type,size_bytes,doc_type').eq('id', row.document_id).maybeSingle();
  if (error) throw error;
  if (!doc) { await tenantScopedFrom(db, tenantId, 'knowledge_contributions').delete().eq('id', row.id); return; }
  if (!doc.doc_type || !prefs.categories.includes(doc.doc_type) || !(SHAREABLE_DOC_TYPES as readonly string[]).includes(doc.doc_type)) {
    await settle(db, tenantId, row.id, { status: 'held', analysis: { reason: 'Type de document retiré du partage automatique.' } });
    return;
  }
  const extracted = await (deps.extract ?? extractDocumentSource)(db, tenantId, doc);
  if (extracted.unreadable || !extracted.text?.trim()) {
    await settle(db, tenantId, row.id, {
      status: 'held', analysis: { reason: 'Aucun texte exploitable dans ce document (fichier illisible, numérisé ou vide).' },
    });
    return;
  }
  const known = buildKnownMatchers(await loadTenantKnownValues(db, tenantId));
  const result = await analyseSource(extracted.text, known, deps.review);
  const analysis = { ...result.report, attempts: (row.analysis?.attempts ?? 0) + 1 };
  if (result.text.length < MIN_SHARED_CHARS) {
    await settle(db, tenantId, row.id, {
      status: 'held', sanitized_text: '', withheld: result.withheld, analysis: { ...analysis, reason: 'Rien de partageable sans risque : tout est retenu.' },
    });
    return;
  }
  await settle(db, tenantId, row.id, {
    status: 'reviewed', review_mode: 'auto', reviewed_at: new Date().toISOString(), sanitized_text: result.text,
    warnings: ['Relu automatiquement (règles, valeurs du cabinet, relecture IA) ; les paragraphes douteux ont été retenus.'],
    withheld: result.withheld, analysis,
  });
}

/** Traite quelques contributions en file. Retourne ce qui a été pris en charge. */
export async function processQueuedContributions(db: any, deps: CycleDeps, limit = 3) {
  await releaseStale(db);
  const settled = new Date(Date.now() - QUEUE_SETTLE_MS).toISOString();
  const { data, error } = await db.from('knowledge_contributions').select('*')
    .eq('origin', 'auto').eq('status', 'queued').lt('updated_at', settled)
    .order('updated_at', { ascending: true }).limit(limit);
  if (error) throw error;
  const summary = { claimed: 0, reviewed: 0, held: 0, retried: 0 };
  for (const row of data || []) {
    // Prise en charge atomique : un autre processus ne traite pas la même ligne.
    const claim = await tenantScopedFrom(db, row.tenant_id, 'knowledge_contributions')
      .update({ status: 'analyzing', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'queued').select().maybeSingle();
    if (claim.error || !claim.data) continue;
    summary.claimed++;
    try {
      await processOne(db, row, deps);
      const after = await tenantScopedFrom(db, row.tenant_id, 'knowledge_contributions').select('status').eq('id', row.id).maybeSingle();
      if (after.data?.status === 'reviewed') summary.reviewed++; else summary.held++;
    } catch (e: any) {
      const attempts = (row.analysis?.attempts ?? 0) + 1;
      const giveUp = attempts >= MAX_ANALYSIS_ATTEMPTS;
      // Ni extrait ni contenu dans le message : seulement la nature de l'échec.
      await settle(db, row.tenant_id, row.id, {
        status: giveUp ? 'held' : 'queued',
        analysis: { attempts, last_error: String(e?.message || 'Analyse impossible').slice(0, 200),
          ...(giveUp ? { reason: 'Analyse impossible après plusieurs tentatives : rien n’a été envoyé.' } : {}) },
      }).catch(() => undefined);
      if (giveUp) summary.held++; else summary.retried++;
    }
  }
  return summary;
}

// ── Envoi automatique ─────────────────────────────────────────────────────────

/** Publie les extraits relus automatiquement, dans la limite du plafond quotidien du cabinet. */
export async function publishApprovedContributions(db: any, limit = 10) {
  const { data, error } = await db.from('knowledge_contributions').select('id,tenant_id')
    .eq('origin', 'auto').eq('status', 'reviewed').order('updated_at', { ascending: true }).limit(50);
  if (error) throw error;
  const rows = data || [];
  const summary = { published: 0, skipped: 0, failed: 0 };
  if (!rows.length) return summary;
  const { data: remote } = await db.from('knowledge_remote_documents').select('contribution_id')
    .in('contribution_id', rows.map((r: any) => r.id));
  const already = new Set((remote || []).map((r: any) => r.contribution_id));
  const prefsByTenant = new Map<string, AutoSharePrefs>();
  const sentToday = new Map<string, number>();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  let done = 0;
  for (const row of rows) {
    if (done >= limit) break;
    if (already.has(row.id)) continue;
    if (!prefsByTenant.has(row.tenant_id)) prefsByTenant.set(row.tenant_id, await getAutoSharePrefs(db, row.tenant_id));
    if (!prefsByTenant.get(row.tenant_id)!.enabled) { summary.skipped++; continue; }
    if (!sentToday.has(row.tenant_id)) {
      const { data: recent } = await tenantScopedFrom(db, row.tenant_id, 'knowledge_remote_documents')
        .select('id').gte('created_at', dayAgo);
      sentToday.set(row.tenant_id, (recent || []).length);
    }
    if ((sentToday.get(row.tenant_id) ?? 0) >= AUTO_SHARE_DAILY_CAP) { summary.skipped++; continue; }
    done++;
    try {
      const outcome = await publishContribution(db, row.tenant_id, row.id);
      sentToday.set(row.tenant_id, (sentToday.get(row.tenant_id) ?? 0) + 1);
      if (outcome.status === 201) summary.published++;
      else if (outcome.body.code === 'REANONYMIZE') {
        // Le texte relu ne passe plus le contrôle final : retenu, jamais publié.
        await tenantScopedFrom(db, row.tenant_id, 'knowledge_contributions')
          .update({ status: 'held', analysis: { reason: 'Le contrôle final a refusé cet extrait : retenu.' }, updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('status', 'reviewed');
        summary.failed++;
      } else summary.failed++;
    } catch { summary.failed++; }
  }
  return summary;
}

/** Un cycle complet : analyse de la file, puis envoi. Inactif tant que l'instance n'autorise pas la publication. */
export async function runAutoSharingCycle(db: any, deps: CycleDeps) {
  if (!publishEnabled() || !process.env.MISTRAL_API_KEY || !resolveKnowledgeLibraryId()) return { skipped: true as const };
  const analysed = await processQueuedContributions(db, deps);
  const published = await publishApprovedContributions(db);
  return { skipped: false as const, analysed, published };
}

