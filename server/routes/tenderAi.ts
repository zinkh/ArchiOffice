// Assistance IA sur le dossier de candidature d'un appel d'offres — réservée
// au plan Enterprise (comme l'automatisation MAF, voir
// src/pages/MafDeclaration.tsx). Deux gestes :
//
// 1. "Analyser le DCE" — lit le texte des documents attachés à l'appel
//    d'offres (resource_type='tenders') et en déduit une liste de pièces
//    demandées (tender_pieces), avec le statut 'detectee_ia' tant que
//    personne ne les a confirmées "fournies".
// 2. "Rédiger avec IA" — ébauche le contenu d'une section de note
//    méthodologique à partir du contexte de l'affaire.
//
// Les deux suivent le patron réserve → exécute → règle déjà en place pour
// le chat des agents (server.ts, packages/archioffice-agents/src/server/
// routes.ts) plutôt que le lire-puis-déduire plus ancien de aiSuggestions.ts :
// un coût pessimiste est réservé avant l'appel au modèle, réglé contre le
// coût réel ensuite, remboursé en cas d'échec.
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';

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

const MAX_DCE_CHARS = 40_000; // borne le coût d'un appel, comme MAX_DOC_BYTES côté agents
const SECTIONS = ['candidature', 'offre_technique', 'offre_financiere'];

function requireEnterprisePlan(plan: string, res: any): boolean {
  if (plan !== 'enterprise') {
    res.status(403).json({ error: "Cette assistance IA est réservée au plan Enterprise." });
    return false;
  }
  return true;
}

export function registerTenderAiRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, getTenantPlan, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents } = deps;

  app.post("/api/tenders/:id/analyze-dce", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const { id: tenderId } = req.params;
      const { plan } = await getTenantPlan(tenantId);
      if (!requireEnterprisePlan(plan, res)) return;

      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, title, client, type').eq('id', tenderId).maybeSingle();
      if (!tender) return res.status(404).json({ error: "Appel d'offres introuvable." });

      const { data: docs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('name, file_url').eq('resource_type', 'tenders').eq('resource_id', tenderId);
      if (!docs?.length) return res.status(400).json({ error: "Aucun document DCE attaché — déposez d'abord le règlement de consultation ou le CCTP." });

      const { extractKnowledgeDocText } = await import('@zinkh/archioffice-agents/server');
      let combinedText = '';
      for (const doc of docs) {
        if (combinedText.length >= MAX_DCE_CHARS) break;
        const text = await extractKnowledgeDocText(supabaseAdmin, tenantId, doc as any).catch(() => null);
        if (text) combinedText += `\n\n--- ${(doc as any).name} ---\n${text.slice(0, MAX_DCE_CHARS - combinedText.length)}`;
      }
      if (!combinedText.trim()) return res.status(400).json({ error: "Impossible d'extraire le texte des documents DCE (scan illisible ou format non supporté)." });

      const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));

      const prompt = `Tu es un assistant pour un cabinet d'architecture français qui répond à un appel d'offres.
Voici des extraits du dossier de consultation des entreprises (DCE) de l'affaire "${tender.title}" (client : ${tender.client}) :
${combinedText}

Identifie la liste des pièces à fournir dans la candidature (règlement de consultation, CCAP...). Réponds UNIQUEMENT avec un JSON valide (sans markdown), de la forme :
{"pieces": [{"section": "candidature" | "offre_technique" | "offre_financiere", "label": "intitulé de la pièce", "obligatoire": true, "quantity_required": null ou un nombre (ex. 3 pour \"3 références exigées\"), "source_hint": "où c'est écrit, ex. \\"RC p.5\\""}]}
N'invente rien : ne liste que les pièces réellement mentionnées dans le texte fourni.`;

      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const reservedCents = await estimateReserveCents(provider.id, provider.model, estimatedInputTokens);
      if (!(await reserveAiCredit(tenantId, reservedCents))) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      let result;
      try {
        result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
      } catch (e) {
        await refundAiCredit(tenantId, reservedCents).catch(() => {});
        throw e;
      }
      await settleAiCredit({
        tenantId, userId: req.user.id, agentId: null, conversationId: null, endpointType: 'tender_ai',
        provider: provider.id, model: provider.model, reservedCents,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: "Réponse IA invalide." });
      const parsed = JSON.parse(jsonMatch[0]);
      const pieces = Array.isArray(parsed?.pieces) ? parsed.pieces : [];

      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').select('section, label').eq('tender_id', tenderId);
      const existingKeys = new Set((existing || []).map((p: any) => `${p.section}:::${p.label}`.toLowerCase()));

      const toInsert = pieces
        .filter((p: any) => p?.label && !existingKeys.has(`${SECTIONS.includes(p.section) ? p.section : 'candidature'}:::${p.label}`.toLowerCase()))
        .map((p: any) => ({
          id: crypto.randomUUID(), tender_id: tenderId,
          section: SECTIONS.includes(p.section) ? p.section : 'candidature',
          label: String(p.label).slice(0, 500),
          obligatoire: p.obligatoire !== false,
          quantity_required: typeof p.quantity_required === 'number' ? p.quantity_required : null,
          status: 'detectee_ia',
          source_hint: p.source_hint ? String(p.source_hint).slice(0, 200) : null,
        }));

      if (toInsert.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').insert(toInsert);
      res.json({ inserted: toInsert.length, total_detected: pieces.length });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Tender DCE analysis error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'tender-analyze-dce' } });
      res.status(500).json({ error: "Échec de l'analyse du DCE : " + e.message });
    }
  });

  app.post("/api/tenders/:id/methodology/:noteId/draft-ai", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const { id: tenderId, noteId } = req.params;
      const { plan } = await getTenantPlan(tenantId);
      if (!requireEnterprisePlan(plan, res)) return;

      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, title, client, type, description').eq('id', tenderId).maybeSingle();
      if (!tender) return res.status(404).json({ error: "Appel d'offres introuvable." });
      const { data: note } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').select('id, title').eq('id', noteId).eq('tender_id', tenderId).maybeSingle();
      if (!note) return res.status(404).json({ error: "Section introuvable." });

      const { data: specialties } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').select('specialty_name').eq('tender_id', tenderId);
      const specialtyLabels = (specialties || []).map((s: any) => s.specialty_name).filter(Boolean).join(', ');

      const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));

      const prompt = `Tu rédiges une note méthodologique (mémoire technique) pour la candidature d'un cabinet d'architecture français à un appel d'offres.
Affaire : "${tender.title}" — client : ${tender.client}${tender.type ? ` — type de marché : ${tender.type}` : ''}.
${tender.description ? `Description de l'opération : ${tender.description}\n` : ''}${specialtyLabels ? `Spécialités mobilisées : ${specialtyLabels}\n` : ''}
Rédige le contenu de la section "${note.title}" de cette note méthodologique : un texte professionnel en français, 2 à 4 paragraphes, sans titre ni markdown, prêt à être relu et complété par l'équipe.`;

      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const reservedCents = await estimateReserveCents(provider.id, provider.model, estimatedInputTokens);
      if (!(await reserveAiCredit(tenantId, reservedCents))) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      let result;
      try {
        result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
      } catch (e) {
        await refundAiCredit(tenantId, reservedCents).catch(() => {});
        throw e;
      }
      await settleAiCredit({
        tenantId, userId: req.user.id, agentId: null, conversationId: null, endpointType: 'tender_ai',
        provider: provider.id, model: provider.model, reservedCents,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });

      const content = result.text.trim();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').update({ content, status: 'redige', updated_at: new Date().toISOString() }).eq('id', noteId);
      res.json({ content });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Tender methodology draft error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'tender-methodology-draft' } });
      res.status(500).json({ error: "Échec de la rédaction assistée : " + e.message });
    }
  });
}
