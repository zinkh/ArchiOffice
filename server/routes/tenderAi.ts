// Assistance IA sur le dossier de candidature d'un appel d'offres — réservée
// au plan Enterprise (comme l'automatisation MAF, voir
// src/pages/MafDeclaration.tsx). Quatre gestes :
//
// 1. "Analyser le DCE" — lit le texte des documents attachés à l'appel
//    d'offres (resource_type='tenders') et en déduit une liste de pièces
//    demandées (tender_pieces), avec le statut 'detectee_ia' tant que
//    personne ne les a confirmées "fournies".
// 2. "Chercher dans le DCE" — même lecture, pour l'enveloppe prévisionnelle
//    des honoraires.
// 3. "Préremplir les titres" — pose le plan de sections d'une note
//    méthodologique, depuis le DCE quand il en impose un, sinon depuis une
//    structure usuelle.
// 4. Rédiger le contenu d'une section de note méthodologique, à partir du
//    contexte de l'affaire (spécialités mobilisées, nommément le cotraitant
//    retenu pour chacune quand il est connu — onglet Partenaires), enrichi
//    de tout ce qui est disponible parmi le texte du DCE et la bibliothèque
//    documentaire du cabinet (resource_type='agency_library', réglée depuis
//    /settings — voir ATTACHABLE_RESOURCE_TYPES) : les deux sources se
//    combinent, l'une n'exclut jamais l'autre.
//
// Tous suivent le patron réserve → exécute → règle déjà en place pour
// le chat des agents (server.ts, packages/archioffice-agents/src/server/
// routes.ts) plutôt que le lire-puis-déduire plus ancien de aiSuggestions.ts :
// un coût pessimiste est réservé avant l'appel au modèle, réglé contre le
// coût réel ensuite, remboursé en cas d'échec — sauf "Préremplir les titres"
// sans DCE attaché, qui n'appelle aucun modèle et ne coûte donc rien.
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

// Titres proposés faute de DCE à analyser (voir prefill-sections ci-dessous) —
// la structure usuelle d'un mémoire technique de candidature MOE en marché
// public français, pas une liste exhaustive : l'architecte reste libre d'en
// renommer, supprimer ou ajouter après coup comme n'importe quelle section.
const DEFAULT_METHODOLOGY_TITLES = [
  'Compréhension des enjeux du projet',
  "Organisation et moyens de l'équipe de maîtrise d'œuvre",
  'Méthodologie de conception',
  'Méthodologie de suivi de chantier',
  "Démarche environnementale et développement durable",
  "Planning prévisionnel de l'opération",
];

function requireEnterprisePlan(plan: string, res: any): boolean {
  if (plan !== 'enterprise') {
    res.status(403).json({ error: "Cette assistance IA est réservée au plan Enterprise." });
    return false;
  }
  return true;
}

// Lit et concatène le texte extrait d'un ensemble de documents (DCE d'un
// appel d'offres, ou bibliothèque du cabinet), jusqu'à MAX_DCE_CHARS — même
// borne pour les deux sources, par cohérence de coût. Partagé par
// analyze-dce, estimate-enveloppe et les deux gestes de la note
// méthodologique ci-dessous plutôt que dupliqué une quatrième fois.
async function extractCombinedText(supabaseAdmin: any, tenantId: string, docs: Array<{ name: string; file_url: string }>): Promise<string> {
  const { extractKnowledgeDocText } = await import('@zinkh/archioffice-agents/server');
  let combinedText = '';
  for (const doc of docs) {
    if (combinedText.length >= MAX_DCE_CHARS) break;
    const text = await extractKnowledgeDocText(supabaseAdmin, tenantId, doc as any).catch(() => null);
    if (text) combinedText += `\n\n--- ${doc.name} ---\n${text.slice(0, MAX_DCE_CHARS - combinedText.length)}`;
  }
  return combinedText;
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

  // "Chercher dans le DCE" pour l'enveloppe prévisionnelle des honoraires
  // (onglet Aperçu > Évaluation) — même lecture des documents DCE que
  // "Analyser le DCE" ci-dessus, mais pour une seule valeur plutôt qu'une
  // liste de pièces. Best-effort : si le DCE n'annonce aucun budget
  // prévisionnel, l'IA renvoie null plutôt que d'inventer un montant, et le
  // champ reste à saisir manuellement.
  app.post("/api/tenders/:id/estimate-enveloppe", aiGenerationLimiter, async (req: any, res: any) => {
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

Cherche l'enveloppe prévisionnelle des honoraires de maîtrise d'œuvre annoncée par le maître d'ouvrage (montant en euros HT, pas le montant des travaux). Réponds UNIQUEMENT avec un JSON valide (sans markdown), de la forme :
{"enveloppe_previsionnelle": nombre ou null, "source_hint": "où c'est écrit, ex. \\"RC p.3\\", ou null"}
Si aucun montant d'honoraires n'est explicitement annoncé, réponds avec enveloppe_previsionnelle: null plutôt que d'estimer une valeur.`;

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
      const enveloppe = typeof parsed?.enveloppe_previsionnelle === 'number' && parsed.enveloppe_previsionnelle > 0 ? parsed.enveloppe_previsionnelle : null;

      if (enveloppe !== null) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').update({ enveloppe_previsionnelle: enveloppe }).eq('id', tenderId);
      }
      res.json({ enveloppe_previsionnelle: enveloppe, source_hint: parsed?.source_hint || null });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Tender enveloppe estimation error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'tender-estimate-enveloppe' } });
      res.status(500).json({ error: "Échec de la recherche dans le DCE : " + e.message });
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

      // Spécialités mobilisées ET le cotraitant nommément saisi en face de
      // chacune (onglet Partenaires, tender_specialties.contact_id) — sans
      // ça, la note ne pouvait citer aucun nom, seulement des intitulés de
      // métier génériques.
      const { data: specialties } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').select('specialty_name, contact_id').eq('tender_id', tenderId);
      const specialtyContactIds = [...new Set((specialties || []).map((s: any) => s.contact_id).filter(Boolean))];
      const { data: specialtyContacts } = specialtyContactIds.length
        ? await supabaseAdmin.from('contacts').select('id, name').eq('tenant_id', tenantId).in('id', specialtyContactIds)
        : { data: [] as any[] };
      const contactNameById = new Map((specialtyContacts || []).map((c: any) => [c.id, c.name]));
      const specialtyLabels = (specialties || [])
        .map((s: any) => {
          const contactName = s.contact_id ? contactNameById.get(s.contact_id) : null;
          return s.specialty_name ? `${s.specialty_name}${contactName ? ` (${contactName})` : ''}` : contactName;
        })
        .filter(Boolean).join(', ');

      // Combine les deux sources documentaires plutôt que de choisir entre
      // elles : le DCE de l'affaire (enjeux et exigences réels du marché) et
      // la bibliothèque du cabinet (style, exemples déjà rédigés,
      // présentation de ses cotraitants habituels) s'enrichissent l'un
      // l'autre pour une même section. Best-effort chacune — l'absence de
      // l'une n'empêche pas d'utiliser l'autre, ni de rédiger avec le seul
      // contexte de l'affaire si aucune des deux n'est disponible.
      const { data: dceDocs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('name, file_url').eq('resource_type', 'tenders').eq('resource_id', tenderId);
      const dceText = dceDocs?.length ? await extractCombinedText(supabaseAdmin, tenantId, dceDocs as any) : '';
      const { data: agencyDocs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('name, file_url').eq('resource_type', 'agency_library').eq('resource_id', tenantId);
      const agencyText = agencyDocs?.length ? await extractCombinedText(supabaseAdmin, tenantId, agencyDocs as any) : '';

      const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));

      const prompt = `Tu rédiges une note méthodologique (mémoire technique) pour la candidature d'un cabinet d'architecture français à un appel d'offres.
Affaire : "${tender.title}" — client : ${tender.client}${tender.type ? ` — type de marché : ${tender.type}` : ''}.
${tender.description ? `Description de l'opération : ${tender.description}\n` : ''}${specialtyLabels ? `Spécialités mobilisées, avec le nom du cotraitant retenu quand il est connu — cite-les nommément là où c'est pertinent : ${specialtyLabels}\n` : ''}
${dceText.trim() ? `Voici des extraits du dossier de consultation des entreprises (DCE) de cette affaire — appuie-toi dessus pour coller aux enjeux et exigences réels du marché :\n${dceText}\n` : ''}${agencyText.trim() ? `Voici des extraits de documents du cabinet (présentation, exemples de notes méthodologiques déjà rédigées, présentation de ses cotraitants habituels...) — reprends-en le style, le vocabulaire et les éléments factuels pertinents :\n${agencyText}\n` : ''}
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

  // "Préremplir les titres" — pose le plan de sections de la note
  // méthodologique avant toute rédaction. Sans DCE attaché, pas d'appel IA :
  // DEFAULT_METHODOLOGY_TITLES suffit et ne coûte rien. Un DCE attaché fait
  // préférer la structure réellement exigée par le règlement de consultation
  // (certains RC imposent un sommaire précis pour la note méthodologique,
  // avec un nombre de pages par partie) à ce plan générique.
  app.post("/api/tenders/:id/methodology/prefill-sections", aiGenerationLimiter, async (req: any, res: any) => {
    const tenantId = await getTenantId(req.user.id);
    try {
      const { id: tenderId } = req.params;
      const { plan } = await getTenantPlan(tenantId);
      if (!requireEnterprisePlan(plan, res)) return;

      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, title, client, type').eq('id', tenderId).maybeSingle();
      if (!tender) return res.status(404).json({ error: "Appel d'offres introuvable." });

      const { data: existingNotes } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').select('title, sort_order').eq('tender_id', tenderId);
      const existingTitles = new Set((existingNotes || []).map((n: any) => String(n.title).trim().toLowerCase()));
      let nextSortOrder = (existingNotes || []).length;

      let titles: string[] = DEFAULT_METHODOLOGY_TITLES;
      let source: 'dce' | 'default' = 'default';

      const { data: docs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('name, file_url').eq('resource_type', 'tenders').eq('resource_id', tenderId);
      if (docs?.length) {
        const combinedText = await extractCombinedText(supabaseAdmin, tenantId, docs as any);
        if (combinedText.trim()) {
          const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
          const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));

          const prompt = `Tu prépares le sommaire d'une note méthodologique (mémoire technique) pour la candidature d'un cabinet d'architecture français à un appel d'offres.
Affaire : "${tender.title}" — client : ${tender.client}${tender.type ? ` — type de marché : ${tender.type}` : ''}.
Voici des extraits du dossier de consultation des entreprises (DCE) :
${combinedText}

Si le règlement de consultation impose un sommaire précis pour la note méthodologique (parties attendues, critères de jugement de l'offre technique...), reprends-le. Sinon, propose un sommaire usuel pour ce type de marché. Réponds UNIQUEMENT avec un JSON valide (sans markdown), de la forme :
{"titles": ["Titre de la première section", "Titre de la deuxième section", ...]}`;

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
          const parsedTitles = jsonMatch ? JSON.parse(jsonMatch[0])?.titles : null;
          if (Array.isArray(parsedTitles) && parsedTitles.length) {
            titles = parsedTitles.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().slice(0, 200));
            source = 'dce';
          }
        }
      }

      const toInsert = titles
        .filter(title => !existingTitles.has(title.toLowerCase()))
        .map(title => ({
          id: crypto.randomUUID(), tender_id: tenderId, title, content: '', status: 'a_rediger',
          sort_order: nextSortOrder++,
        }));

      if (toInsert.length) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').insert(toInsert);
        if (error) throw error;
      }
      res.json({ notes: toInsert, source });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error("Tender methodology prefill error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'tender-methodology-prefill' } });
      res.status(500).json({ error: "Échec du préremplissage des titres : " + e.message });
    }
  });
}
