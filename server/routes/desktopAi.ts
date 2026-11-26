// Relais IA du client Electron : /api/desktop/v1/ai/*.
//
// L'IA est réservée aux abonnés payants et le poste de bureau ne détient aucune
// clé de fournisseur (voir llm/index.ts, setLlmRelay). Le serveur local envoie
// donc ici chaque appel de modèle, avec la session cloud de la personne ; ce
// serveur-ci, qui est celui où le cabinet paie :
//   1. relit l'abonnement (jamais le plan envoyé par le poste) ;
//   2. choisit le fournisseur du cabinet (/admin) avec SES clés ;
//   3. réserve, appelle, puis règle les crédits IA du cabinet.
// Le poste ne reçoit que le résultat du modèle, jamais une clé.
//
// Une instance en mode poste de bureau (OFFLINE_MODE) n'enregistre pas ces
// routes : elle n'est pas la source de l'abonnement.
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { hasActiveDriveSubscription } from '../desktop/driveAccess';

export const AI_SUBSCRIPTION_REQUIRED = 'AI_SUBSCRIPTION_REQUIRED';
export const DESKTOP_AI_BASE = '/api/desktop/v1/ai';
const SUBSCRIPTION_MESSAGE = 'Les fonctionnalités IA sont réservées aux cabinets disposant d’un abonnement payant actif.';
/** Un appel plus gros que cela (images et pièces en base64 comprises) est refusé avant tout appel de modèle. */
const MAX_ESTIMATED_INPUT_TOKENS = 2_000_000;

type Operation = 'chat' | 'transcribe' | 'speak';
const ENDPOINT_TYPE = { chat: 'agent', transcribe: 'transcription', speak: 'speech' } as const;

export interface DesktopAiDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  maybeRefreshMonthlyCredits: (tenantId: string, plan: string) => Promise<void>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number, audioInputTokens?: number) => Promise<number>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'agent' | 'transcription' | 'speech';
    provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number; audioInputTokens?: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
}

class RefusedError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function registerDesktopAiRoutes(app: Express, deps: DesktopAiDeps): void {
  if (process.env.OFFLINE_MODE === 'true') return;
  const { supabaseAdmin: db } = deps;

  /** Cabinet servi et abonnement payant vérifié sur la base du serveur. */
  async function entitledTenant(req: any): Promise<{ tenantId: string; plan: string }> {
    const tenantId = await deps.getTenantId(req.user.id);
    const { data, error } = await db.from('tenants')
      .select('plan, trial_ends_at, suspended_at').eq('id', tenantId).maybeSingle();
    if (error) throw new RefusedError(503, 'AI_ENTITLEMENT_UNAVAILABLE', 'Vérification de l’abonnement indisponible. Réessayez ultérieurement.');
    if (!hasActiveDriveSubscription(data)) throw new RefusedError(402, AI_SUBSCRIPTION_REQUIRED, SUBSCRIPTION_MESSAGE);
    return { tenantId, plan: data.plan };
  }

  async function resolveFor(operation: Operation | 'describe', tenantId: string) {
    const llm = await import('@zinkh/archioffice-agents/server/llm');
    const config = await llm.getTenantAiConfig(db, tenantId);
    if (operation === 'transcribe') return llm.resolveTranscriptionProvider(config);
    if (operation === 'speak') return llm.resolveSpeechProvider(config);
    return llm.resolveLlmProvider(config);
  }

  function describe(provider: any) {
    return {
      provider: provider.id, model: provider.model,
      supportsVision: !!provider.supportsVision, supportsWebSearch: !!provider.supportsWebSearch,
    };
  }

  function fail(res: any, e: any, operation: string) {
    if (e instanceof RefusedError) return res.status(e.status).json({ error: e.message, code: e.code });
    // Comparé au code : la classe vient d'un module importé dynamiquement.
    if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message, code: 'LLM_NOT_CONFIGURED' });
    console.error(`[desktop-ai] ${operation} :`, e?.message);
    Sentry.captureException(e, { tags: { feature: 'desktop-ai-relay', operation } });
    return res.status(502).json({ error: 'Le fournisseur IA a échoué : ' + (e?.message ?? 'erreur inconnue'), code: 'AI_PROVIDER_FAILED' });
  }

  app.get(`${DESKTOP_AI_BASE}/capabilities`, async (req: any, res: any) => {
    try {
      const { tenantId } = await entitledTenant(req);
      const provider = await resolveFor('chat', tenantId);
      // Le poste recopie le solde et le mode de facturation pour que ses propres
      // contrôles de crédit (affichage, garde-fous) reflètent le cabinet en ligne.
      const { data: tenant } = await db.from('tenants')
        .select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', tenantId).maybeSingle();
      res.json({
        ...describe(provider),
        balance_eur_cents: tenant?.ai_credit_balance_eur_cents ?? 0,
        billing_mode: tenant?.agent_billing_mode ?? 'prepaid',
      });
    } catch (e) { fail(res, e, 'capabilities'); }
  });

  const handler = (operation: Operation) => async (req: any, res: any) => {
    try {
      const { tenantId, plan } = await entitledTenant(req);
      const body = req.body ?? {};
      const llm = await import('@zinkh/archioffice-agents/server/llm');

      let call: (provider: any) => Promise<any>;
      if (operation === 'chat') {
        if (!Array.isArray(body.messages) || body.messages.length === 0) throw new RefusedError(400, 'BAD_REQUEST', 'messages est requis.');
        const params = llm.decodeChatParams(body);
        call = provider => provider.chat(params);
      } else if (operation === 'transcribe') {
        if (!body.audio?.data) throw new RefusedError(400, 'BAD_REQUEST', 'audio est requis.');
        const params = { ...body, audio: { mimeType: String(body.audio.mimeType ?? ''), data: Buffer.from(String(body.audio.data), 'base64') } };
        call = provider => provider.transcribe(params);
      } else {
        if (typeof body.text !== 'string' || !body.text.trim()) throw new RefusedError(400, 'BAD_REQUEST', 'text est requis.');
        call = provider => provider.speak({ text: body.text, language: body.language, voice: body.voice });
      }

      const provider = await resolveFor(operation, tenantId);
      if (operation === 'transcribe' && !provider.transcribe) throw new RefusedError(503, 'LLM_NOT_CONFIGURED', 'Le fournisseur IA actif ne sait pas transcrire d’audio.');
      if (operation === 'speak' && !provider.speak) throw new RefusedError(503, 'LLM_NOT_CONFIGURED', 'Le fournisseur IA actif ne sait pas synthétiser de la voix.');

      const estimatedInputTokens = Math.ceil(JSON.stringify(body).length / 4);
      if (estimatedInputTokens > MAX_ESTIMATED_INPUT_TOKENS) throw new RefusedError(413, 'PAYLOAD_TOO_LARGE', 'La demande est trop volumineuse.');

      await deps.maybeRefreshMonthlyCredits(tenantId, plan);
      const reservedCents = await deps.estimateReserveCents(provider.id, provider.model, estimatedInputTokens);
      if (!(await deps.reserveAiCredit(tenantId, reservedCents))) {
        throw new RefusedError(402, 'NO_TOKENS', 'Crédit IA épuisé. Veuillez recharger votre compte.');
      }

      let result: any;
      try {
        result = await call(provider);
      } catch (e) {
        await deps.refundAiCredit(tenantId, reservedCents).catch(() => {});
        throw e;
      }

      const usage = result.usage ?? {};
      const { newBalance, costCents } = await deps.settleAiCredit({
        tenantId, userId: req.user.id, agentId: null, conversationId: null,
        endpointType: ENDPOINT_TYPE[operation],
        provider: provider.id, model: provider.model, reservedCents,
        inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0,
        audioInputTokens: Number(usage.audioInputTokens) || 0,
      });

      const payload = operation === 'speak'
        ? { ...result, audio: { mimeType: result.audio.mimeType, data: result.audio.data.toString('base64') } }
        : result;
      res.json({ ...payload, ...describe(provider), cost_eur_cents: costCents, balance_eur_cents: newBalance });
    } catch (e) { fail(res, e, operation); }
  };

  for (const operation of ['chat', 'transcribe', 'speak'] as const) {
    app.post(`${DESKTOP_AI_BASE}/${operation}`, aiGenerationLimiter, handler(operation));
  }
}
