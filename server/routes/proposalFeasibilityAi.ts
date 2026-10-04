// Assistance IA de l'étude de faisabilité d'une proposition. Deux gestes, sur
// le modèle de la note méthodologique des appels d'offres (server/routes/tenderAi.ts) :
//
// 1. « Préremplir les rubriques » pose le plan de l'étude. Sans pièce jointe
//    à la proposition (ou hors plan Enterprise), aucun appel au modèle :
//    DEFAULT_FEASIBILITY_TITLES suffit et ne coûte rien, donc ce geste reste
//    ouvert à tous les plans. Avec un programme ou un cahier des charges joint
//    ET le plan Enterprise, l'IA adapte le plan à l'opération.
// 2. « Rédiger avec IA » rédige une rubrique (plan Enterprise uniquement), en
//    combinant tout ce qui est disponible plutôt qu'en choisissant une source :
//    les champs de la proposition, les données publiques du terrain (PLU,
//    Géorisques, monuments historiques, server/feasibilitySiteData.ts), le
//    texte des pièces jointes de la proposition, la bibliothèque documentaire
//    du cabinet (agency_library) et la consigne libre de la rubrique. Chaque
//    source est facultative et indépendante des autres.
//
// Facturation : réserve → exécute → règle, comme tenderAi.ts (un coût
// pessimiste réservé avant l'appel, réglé contre l'usage réel, remboursé en
// cas d'échec).
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { proposalTerrainAddress } from './proposalFeasibility';
import {
  DEFAULT_FEASIBILITY_TITLES, EMPTY_SITE_DATA, feasibilityContextForPrompt, type FeasibilitySiteData,
} from '../../src/lib/feasibilityBlocks';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'proposal_ai'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
  loadSiteData: (address: string) => Promise<FeasibilitySiteData>;
}

const TABLE = 'proposal_feasibility_sections';
const MAX_DOC_CHARS = 30_000; // borne le coût d'un appel, comme MAX_DCE_CHARS côté appels d'offres

async function extractCombinedText(supabaseAdmin: any, tenantId: string, docs: Array<{ name: string; file_url: string; mime_type?: string | null }>): Promise<string> {
  const { extractKnowledgeDocText } = await import('@zinkh/archioffice-agents/server');
  let combined = '';
  for (const doc of docs) {
    if (combined.length >= MAX_DOC_CHARS) break;
    // Les extraits de cartes de l'étude sont des images rattachées à la
    // proposition : ni texte à lire, ni OCR à payer.
    if (doc.mime_type?.startsWith('image/')) continue;
    const text = await extractKnowledgeDocText(supabaseAdmin, tenantId, doc as any).catch(() => null);
    if (text) combined += `\n\n--- ${doc.name} ---\n${text.slice(0, MAX_DOC_CHARS - combined.length)}`;
  }
  return combined;
}

export function registerProposalFeasibilityAiRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, getTenantPlan, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents, loadSiteData } = deps;

  async function runModel(tenantId: string, userId: string, prompt: string): Promise<{ text: string } | { noCredit: true }> {
    const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
    const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));
    const reservedCents = await estimateReserveCents(provider.id, provider.model, Math.ceil(prompt.length / 4));
    if (!(await reserveAiCredit(tenantId, reservedCents))) return { noCredit: true };
    let result;
    try {
      result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
    } catch (e) {
      await refundAiCredit(tenantId, reservedCents).catch(() => {});
      throw e;
    }
    await settleAiCredit({
      tenantId, userId, agentId: null, conversationId: null, endpointType: 'proposal_ai',
      provider: provider.id, model: provider.model, reservedCents,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    });
    return { text: result.text };
  }

  app.post("/api/proposals/:id/feasibility/prefill-sections", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const proposalId = req.params.id;
      const { data: proposal } = await tenantScopedFrom(supabaseAdmin, tenantId, 'proposals')
        .select('id, title, type_projet, categorie_projet, projet_detail, description').eq('id', proposalId).maybeSingle();
      if (!proposal) return res.status(404).json({ error: "Proposition introuvable." });

      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).select('title').eq('proposal_id', proposalId);
      const existingTitles = new Set((existing || []).map((n: any) => String(n.title).trim().toLowerCase()));
      let nextSortOrder = (existing || []).length;

      let titles = DEFAULT_FEASIBILITY_TITLES;
      let source: 'documents' | 'default' = 'default';

      const { plan } = await getTenantPlan(tenantId);
      if (plan === 'enterprise') {
        const { data: docs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
          .select('name, file_url, mime_type').eq('resource_type', 'proposals').eq('resource_id', proposalId);
        const docText = docs?.length ? await extractCombinedText(supabaseAdmin, tenantId, docs as any) : '';
        if (docText.trim()) {
          const prompt = `Tu prépares le sommaire d'une étude de faisabilité rédigée par un cabinet d'architecture français pour son client.
Opération : "${proposal.title}"${proposal.type_projet ? `, type : ${proposal.type_projet}` : ''}${proposal.categorie_projet ? ` (${proposal.categorie_projet})` : ''}.
${proposal.projet_detail || proposal.description ? `Description : ${proposal.projet_detail || proposal.description}\n` : ''}
Voici des extraits des pièces transmises par le client (programme, cahier des charges...) :
${docText}

Propose un sommaire adapté à cette opération (8 à 12 rubriques), en partant de cette structure usuelle et en l'ajustant : ${DEFAULT_FEASIBILITY_TITLES.join(' ; ')}.
Réponds UNIQUEMENT avec un JSON valide (sans markdown), de la forme :
{"titles": ["Titre de la première rubrique", "Titre de la deuxième rubrique", ...]}`;
          const out = await runModel(tenantId, req.user.id, prompt);
          if ('noCredit' in out) return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
          const jsonMatch = out.text.match(/\{[\s\S]*\}/);
          let parsed: unknown = null;
          try { parsed = jsonMatch ? JSON.parse(jsonMatch[0])?.titles : null; } catch { parsed = null; }
          if (Array.isArray(parsed)) {
            const fromAi = parsed.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim().slice(0, 200));
            if (fromAi.length) { titles = fromAi; source = 'documents'; }
          }
        }
      }

      const toInsert = titles
        .filter(title => !existingTitles.has(title.toLowerCase()))
        .map(title => ({
          id: crypto.randomUUID(), proposal_id: proposalId, title, content: '', instructions: '',
          illustrations: [], status: 'a_rediger', sort_order: nextSortOrder++,
        }));
      if (toInsert.length) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert(toInsert);
        if (error) throw error;
      }
      res.json({ sections: toInsert, source });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Proposal feasibility prefill error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'proposal-feasibility-prefill' } });
      res.status(500).json({ error: "Échec du préremplissage des rubriques : " + e.message });
    }
  });

  app.post("/api/proposals/:id/feasibility/:sectionId/draft-ai", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const { id: proposalId, sectionId } = req.params;
      const { plan } = await getTenantPlan(tenantId);
      if (plan !== 'enterprise') return res.status(403).json({ error: "La rédaction assistée est réservée au plan Enterprise." });

      const { data: proposal } = await tenantScopedFrom(supabaseAdmin, tenantId, 'proposals').select('*').eq('id', proposalId).maybeSingle();
      if (!proposal) return res.status(404).json({ error: "Proposition introuvable." });
      const { data: section } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('id, title, content, instructions').eq('id', sectionId).eq('proposal_id', proposalId).maybeSingle();
      if (!section) return res.status(404).json({ error: "Rubrique introuvable." });

      const { data: allSections } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('title, sort_order').eq('proposal_id', proposalId).order('sort_order', { ascending: true });
      const outline = (allSections || []).map((s: any) => s.title).join(' ; ');

      const address = proposalTerrainAddress(proposal);
      const site = address ? await loadSiteData(address).catch(() => EMPTY_SITE_DATA) : EMPTY_SITE_DATA;
      const facts = feasibilityContextForPrompt(proposal, site);

      const { data: specialties } = await tenantScopedFrom(supabaseAdmin, tenantId, 'proposal_specialties')
        .select('specialty_name').eq('proposal_id', proposalId);
      const specialtyLabels = (specialties || []).map((s: any) => s.specialty_name).filter(Boolean).join(', ');

      const { data: proposalDocs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
        .select('name, file_url, mime_type').eq('resource_type', 'proposals').eq('resource_id', proposalId);
      const docText = proposalDocs?.length ? await extractCombinedText(supabaseAdmin, tenantId, proposalDocs as any) : '';
      const { data: agencyDocs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
        .select('name, file_url, mime_type').eq('resource_type', 'agency_library').eq('resource_id', tenantId);
      const agencyText = agencyDocs?.length ? await extractCombinedText(supabaseAdmin, tenantId, agencyDocs as any) : '';

      const prompt = `Tu rédiges une étude de faisabilité pour un cabinet d'architecture français, à remettre à son client avec sa proposition d'honoraires.
Plan de l'étude : ${outline || section.title}.
${facts ? `Données connues du projet et du terrain (les seules dont tu disposes, ne les contredis pas) :\n${facts}\n` : ''}${specialtyLabels ? `Spécialités mobilisées dans l'équipe : ${specialtyLabels}\n` : ''}
${docText.trim() ? `Extraits des pièces transmises par le client (programme, relevés, cahier des charges...) :\n${docText}\n` : ''}${agencyText.trim() ? `Extraits de documents du cabinet (présentation, études déjà rédigées...) : reprends-en le style et le vocabulaire, jamais les données d'une autre opération :\n${agencyText}\n` : ''}${section.content?.trim() ? `Texte déjà saisi dans cette rubrique, à reprendre et compléter plutôt qu'à ignorer :\n${section.content}\n` : ''}${section.instructions?.trim() ? `Consigne de l'architecte pour cette rubrique : ${section.instructions}\n` : ''}
Rédige le contenu de la rubrique "${section.title}" : un texte professionnel en français, 2 à 5 paragraphes, sans titre ni markdown, prêt à être relu par l'architecte.
Règles impératives : n'invente aucune règle d'urbanisme, aucune surface, aucun chiffre ni aucune servitude absents des données ci-dessus. Quand une information nécessaire manque (hauteur maximale, emprise au sol, recul...), écris explicitement qu'elle est « à vérifier » auprès du règlement ou du service concerné.`;

      const out = await runModel(tenantId, req.user.id, prompt);
      if ('noCredit' in out) return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });

      const content = out.text.trim();
      await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .update({ content, status: content ? 'redige' : 'a_rediger', updated_at: new Date().toISOString() }).eq('id', sectionId);
      res.json({ content });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Proposal feasibility draft error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'proposal-feasibility-draft' } });
      res.status(500).json({ error: "Échec de la rédaction assistée : " + e.message });
    }
  });
}
