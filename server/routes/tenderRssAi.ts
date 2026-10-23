// Pré-tri IA de la veille des appels d'offres (flux RSS, BOAMP, TED) — réservé
// au plan Enterprise comme le reste de l'assistance IA sur les appels d'offres
// (server/routes/tenderAi.ts), dont il reprend le patron réserve → exécute →
// règle : un coût pessimiste est réservé avant chaque appel au modèle, réglé
// contre l'usage réel, remboursé si l'appel échoue.
//
// « Scanner » lit les annonces à trier (statut new/read, pas encore notées), en
// 12 par appel et 48 au plus par passage :
//   - une annonce dont la date limite est dépassée est écartée SANS appel au
//     modèle (note 0, hors cible) ;
//   - les autres reçoivent une note de 0 à 100, un motif et des points
//     d'attention ; le verdict se déduit de la note (verdictForScore) ;
//   - à partir de « à étudier » (40), l'annonce reçoit un identifiant
//     AO-IA-AAAA-NNN, stable (jamais réattribué, même si l'annonce est
//     renotée), unique par cabinet (index partiel en base).
// L'IA ne change JAMAIS le statut d'une annonce : écarter, surveiller et
// convertir en appel d'offres restent des gestes de l'architecte.
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import {
  TRIAGE_BATCH_SIZE, TRIAGE_MAX_PER_SCAN, buildTriagePrompt, formatAiRef, isExpired, isProposed,
  maxAiRefSequence, normalizeCriteria, parseTriageResponse, verdictForScore, aiRefPrefix,
  type TriageItem,
} from '../tenderAiTriage';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'tender_ai'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
}

const UNIQUE_VIOLATION = '23505';
const REF_ATTRIBUTION_ATTEMPTS = 4;
// Sortie attendue : une note, un motif et quelques points par annonce.
const RESERVED_OUTPUT_TOKENS_PER_ITEM = 200;

interface ScanMatchRow extends TriageItem {
  id: string;
  ai_ref?: string | null;
}

export function registerTenderRssAiRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, getTenantPlan, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents } = deps;

  app.get("/api/tender-ai-criteria", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('tender_ai_criteria').maybeSingle();
      // Colonne absente (migration non jouée) : critères vides, jamais une erreur.
      if (error) return res.json({ criteria: '' });
      res.json({ criteria: normalizeCriteria((data as any)?.tender_ai_criteria) });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to read tender AI criteria" }); }
  });

  app.put("/api/tender-ai-criteria", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const criteria = normalizeCriteria(req.body?.criteria);
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('id').maybeSingle();
      const { error } = existing
        ? await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').update({ tender_ai_criteria: criteria })
        : await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').insert({ id: crypto.randomUUID(), tender_ai_criteria: criteria });
      if (error) return res.status(503).json({ error: "Critères non enregistrés : la migration du pré-tri IA n'est pas appliquée." });
      res.json({ criteria });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to save tender AI criteria" }); }
  });

  app.post("/api/tender-rss-matches/ai-scan", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const { plan } = await getTenantPlan(tenantId);
      if (plan !== 'enterprise') return res.status(403).json({ error: "Cette assistance IA est réservée au plan Enterprise." });

      // « rescore » reprend aussi les annonces déjà notées (critères modifiés) ;
      // leur identifiant, s'il existe, est conservé.
      const rescore = req.body?.rescore === true;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches')
        .select('id, title, description, pouvoir_adjudicateur, ville_execution, montant_travaux, date_limite_reponse, type_marche, ai_ref')
        .in('status', ['new', 'read']);
      if (!rescore) query = query.is('ai_scored_at', null);
      const { data: candidates, error: listError } = await query
        .order('pub_date', { ascending: false, nullsFirst: false })
        .limit(TRIAGE_MAX_PER_SCAN + 1);
      if (listError) {
        return res.status(503).json({ error: "Pré-tri indisponible : la migration du pré-tri IA n'est pas appliquée." });
      }

      const rows = (candidates || []) as ScanMatchRow[];
      const more = rows.length > TRIAGE_MAX_PER_SCAN;
      const batchRows = rows.slice(0, TRIAGE_MAX_PER_SCAN);

      const summary = { scanned: 0, expired: 0, pertinent: 0, a_etudier: 0, hors_cible: 0, proposed: 0, unscored: 0, more, insufficient_credit: false, error: null as string | null };
      const now = new Date();
      const scoredAt = () => new Date().toISOString();

      // 1. Échues : écartées sans appel au modèle.
      const toScore: ScanMatchRow[] = [];
      for (const row of batchRows) {
        if (isExpired(row.date_limite_reponse, now)) {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({
            ai_score: 0, ai_verdict: 'hors_cible', ai_reason: 'Date limite de réponse dépassée.', ai_flags: [], ai_scored_at: scoredAt(),
          }).eq('id', row.id);
          summary.expired++; summary.scanned++; summary.hors_cible++;
        } else {
          toScore.push(row);
        }
      }
      if (toScore.length === 0) return res.json(summary);

      const { data: settings } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('agency_name, tender_ai_criteria').maybeSingle();
      const agencyName = (settings as any)?.agency_name || null;
      const criteria = (settings as any)?.tender_ai_criteria || '';

      const { resolveLlmProvider, getTenantAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getTenantAiConfig(supabaseAdmin, tenantId));

      // Compteur d'identifiants : lu une fois, puis tenu en mémoire pendant le passage.
      const year = now.getUTCFullYear();
      const readMaxSequence = async (): Promise<number> => {
        const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches')
          .select('ai_ref').like('ai_ref', `${aiRefPrefix(year)}%`);
        return maxAiRefSequence(((data || []) as { ai_ref: string | null }[]).map(r => r.ai_ref), year);
      };
      let sequence = await readMaxSequence();

      const assignRef = async (id: string): Promise<string | null> => {
        for (let attempt = 0; attempt < REF_ATTRIBUTION_ATTEMPTS; attempt++) {
          const ref = formatAiRef(year, ++sequence);
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({ ai_ref: ref }).eq('id', id);
          if (!error) return ref;
          if (error.code !== UNIQUE_VIOLATION) return null;
          sequence = await readMaxSequence();
        }
        return null;
      };

      // 2. Les autres : par lots, un appel réservé et réglé chacun.
      for (let start = 0; start < toScore.length; start += TRIAGE_BATCH_SIZE) {
        const batch = toScore.slice(start, start + TRIAGE_BATCH_SIZE);
        const prompt = buildTriagePrompt({ agencyName, criteria, items: batch });

        const estimatedInputTokens = Math.ceil(prompt.length / 4) + batch.length * RESERVED_OUTPUT_TOKENS_PER_ITEM;
        const reservedCents = await estimateReserveCents(provider.id, provider.model, estimatedInputTokens);
        if (!(await reserveAiCredit(tenantId, reservedCents))) {
          summary.insufficient_credit = true;
          summary.unscored += toScore.length - start;
          break;
        }

        let result;
        try {
          result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
        } catch (e: any) {
          await refundAiCredit(tenantId, reservedCents).catch(() => {});
          summary.error = e?.message || 'Échec de l\'appel au modèle';
          summary.unscored += toScore.length - start;
          Sentry.captureException(e, { tags: { feature: 'tender-rss-ai-scan' } });
          break;
        }
        await settleAiCredit({
          tenantId, userId: req.user.id, agentId: null, conversationId: null, endpointType: 'tender_ai',
          provider: provider.id, model: provider.model, reservedCents,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        });

        const results = parseTriageResponse(result.text, batch.length);
        const byRank = new Map(results.map(r => [r.n, r]));
        // Meilleures notes d'abord : elles reçoivent les premiers numéros du passage.
        const ranked = batch
          .map((row, index) => ({ row, outcome: byRank.get(index + 1) }))
          .sort((a, b) => (b.outcome?.score ?? -1) - (a.outcome?.score ?? -1));

        for (const { row, outcome } of ranked) {
          if (!outcome) { summary.unscored++; continue; }
          const verdict = verdictForScore(outcome.score);
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_rss_matches').update({
            ai_score: outcome.score, ai_verdict: verdict, ai_reason: outcome.reason, ai_flags: outcome.flags, ai_scored_at: scoredAt(),
          }).eq('id', row.id);
          if (error) { summary.unscored++; continue; }
          summary.scanned++;
          summary[verdict]++;
          if (isProposed(outcome.score)) {
            const ref = row.ai_ref || await assignRef(row.id);
            if (ref) summary.proposed++;
          }
        }
      }

      if (summary.scanned === 0 && summary.error) return res.status(502).json({ error: `Échec du pré-tri IA : ${summary.error}` });
      res.json(summary);
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Tender RSS AI scan error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'tender-rss-ai-scan' } });
      res.status(500).json({ error: "Échec du pré-tri IA : " + e.message });
    }
  });
}
