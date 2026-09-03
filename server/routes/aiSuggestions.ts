// Phase 7 extraction — moved out of server.ts's "─── AI: CCTP Article
// Suggestions ───" section. Deliberately excluded from the lot 3 batch
// alongside Observations/Meetings for being "trop couplé à la facturation
// IA" — getTenantPlan/maybeRefreshMonthlyCredits/deductAiCredit stay in
// server.ts (also consumed directly by the external @zinkh/archioffice-agents
// package's registerAgentRoutes call) and are injected here the same way.
//
// 2026-08 compliance pass: confirmed via full-repo search that nothing in
// src/ currently calls POST /api/ai/suggest-articles — this route is
// exercised only by tests/phase7Batch25.test.ts. It's kept (rather than
// removed) because it's correctly gated behind auth, aiGenerationLimiter and
// AI-credit accounting, unlike the old unauthenticated /api-proxy/**
// passthrough (removed, see proxy.json) which had the same "unused" problem
// with none of those governance controls. Wire it into the CCTP editor UI
// (src/components/pro/) before advertising it, and label whatever it
// returns as AI-generated per the app's AI-content disclosure convention
// (see server/routes/aiSuggestions.ts's response and the CCTP editor).
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
  maybeRefreshMonthlyCredits: (tenantId: string, plan: string) => Promise<void>;
  deductAiCredit: (params: { tenantId: string; userId: string; agentId: string | null; conversationId: string | null; endpointType: string; inputTokens: number; outputTokens: number }) => Promise<any>;
}

export function registerAiSuggestionRoutes(app: Express, { supabaseAdmin, getTenantId, getTenantPlan, maybeRefreshMonthlyCredits, deductAiCredit }: RouteDeps) {
  app.post("/api/ai/suggest-articles", aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { lot_name, existing_articles = [] } = req.body;
      if (!lot_name) return res.status(400).json({ error: "lot_name is required" });

      // Provider/model selection lives in the agents package's llm/ layer —
      // resolved before the credit check below so an unconfigured key still
      // answers 503 rather than 402, exactly as it did when this route
      // instantiated GoogleGenAI itself. Imported dynamically, like the
      // Gemini SDK was here before, so the proprietary agents package is
      // only loaded when an AI route actually runs.
      const { resolveLlmProvider } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider();

      // Refresh monthly allowance if needed, then check balance
      const { plan } = await getTenantPlan(tenantId);
      await maybeRefreshMonthlyCredits(tenantId, plan);

      const { data: tenantData } = await supabaseAdmin.from('tenants')
        .select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', tenantId).single();
      const billingMode = (tenantData as any)?.agent_billing_mode ?? 'prepaid';
      const balance = (tenantData as any)?.ai_credit_balance_eur_cents ?? 0;
      if (billingMode === 'prepaid' && balance <= 0) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      const existingList = existing_articles.length > 0 ? `\nArticles déjà présents (à ne pas dupliquer) : ${existing_articles.join(', ')}` : '';
      const prompt = `Tu es un expert en architecture et construction.
Génère exactement 5 articles techniques pour le lot "${lot_name}" dans un CCTP (Cahier des Clauses Techniques Particulières) architectural français.${existingList}

Réponds UNIQUEMENT avec un tableau JSON valide (sans markdown, sans explication), chaque élément ayant ces champs :
- "numero": numéro de l'article (ex: "1.1")
- "designation": nom court de l'article (ex: "Fourniture et pose de cloisons")
- "description": description technique détaillée (2-3 phrases)
- "unite": unité de mesure (m², ml, u, forfait, etc.)
- "prescriptionsTechniques": normes et prescriptions techniques applicables (1-2 phrases)`;

      const result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
      const text = result.text;

      // Track token usage and deduct cost
      const inputTokens  = result.usage.inputTokens;
      const outputTokens = result.usage.outputTokens;
      if (inputTokens + outputTokens > 0) {
        await deductAiCredit({
          tenantId, userId: req.user.id,
          agentId: null, conversationId: null,
          endpointType: 'suggest_articles',
          inputTokens, outputTokens,
        });
      }

      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return res.status(500).json({ error: "Invalid AI response format" });

      const articles = JSON.parse(jsonMatch[0]);
      res.json({ articles });
    } catch (e: any) {
      // Matched on the code rather than instanceof: the error class comes
      // from a dynamically imported module, so identity checks are fragile.
      // Kept ahead of the Sentry capture so a missing key stays a plain 503.
      if (e?.code === 'LLM_NOT_CONFIGURED') {
        return res.status(503).json({ error: e.message });
      }
      console.error("AI suggest-articles error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'ai-suggest-articles' } });
      res.status(500).json({ error: "AI suggestion failed: " + e.message });
    }
  });
}
