import * as Sentry from '@sentry/node';
import type { AgentRow } from '../types.js';
import { buildAgentSystemPrompt } from './systemPrompts.js';
import { buildAgentContext } from './context.js';
import { parseArtifactFromText, generateArtifact } from './artifacts.js';
import { buildAgentTools, executeAgentAction } from './tools.js';
import { resolveLlmProvider, getPlatformAiConfig, LlmNotConfiguredError, type LlmMessage, type LlmToolResult } from './llm/index.js';

type GetTenantId = (userId: string) => Promise<string>;
type GetTenantPlan = (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
type DeductAiCreditFn = (params: {
  tenantId: string; userId: string;
  agentId: string | null; conversationId: string | null;
  endpointType: 'agent' | 'suggest_articles';
  // Which model actually ran: the cost per token differs by an order of
  // magnitude between them, so billing can't be computed without it.
  provider: string; model: string;
  inputTokens: number; outputTokens: number;
}) => Promise<{ newBalance: number; costCents: number }>;

interface BillingHelpers {
  deductAiCredit: DeductAiCreditFn;
  maybeRefreshMonthlyCredits: (tenantId: string, plan: string) => Promise<void>;
  PLAN_AI_MONTHLY_CREDIT_CENTS: Record<string, number>;
  // Base URL the agent action tools call back into (e.g. http://127.0.0.1:PORT)
  // — actions execute through the app's own REST API, forwarding the
  // caller's auth token, so they run through the exact same validation and
  // side effects as a human using the UI.
  baseUrl: string;
}

export function registerAgentRoutes(
  app: any,
  supabaseAdmin: any,
  getTenantId: GetTenantId,
  getTenantPlan: GetTenantPlan,
  billing?: BillingHelpers
): void {

  // GET /api/agent-templates
  app.get('/api/agent-templates', async (req: any, res: any) => {
    try {
      const { data, error } = await supabaseAdmin.from('agents').select('*').is('tenant_id', null).eq('is_system_template', true);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/agents
  app.get('/api/agents', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('agents').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agents
  app.post('/api/agents', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { slug, name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, action_scopes, system_prompt_override, from_template_id } = req.body;

      let agentData: any = { tenant_id: tenantId };

      if (from_template_id) {
        const { data: template, error: tErr } = await supabaseAdmin.from('agents').select('*').eq('id', from_template_id).is('tenant_id', null).single();
        if (tErr || !template) return res.status(404).json({ error: 'Template not found' });
        const t = template as any;
        // Write permissions and web access are never inherited from a
        // template — the tenant must opt in explicitly per activated agent.
        agentData = { ...agentData, slug: t.slug, name: t.name, role_title: t.role_title, avatar_initials: t.avatar_initials, avatar_color: t.avatar_color, tone: t.tone, directives: t.directives, context_scopes: t.context_scopes, action_scopes: [], web_fetch_enabled: false, is_active: true, is_system_template: false };
      } else {
        if (!slug || !name || !role_title) return res.status(400).json({ error: 'slug, name, role_title required' });
        agentData = { ...agentData, slug, name, role_title, avatar_initials: avatar_initials || 'AI', avatar_color: avatar_color || '#206bc4', tone, directives, context_scopes: context_scopes || [], action_scopes: action_scopes || [], web_fetch_enabled: false, system_prompt_override, is_active: true, is_system_template: false };
      }

      const { data, error } = await supabaseAdmin.from('agents').insert(agentData).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/agents/:id
  app.put('/api/agents/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, action_scopes, web_fetch_enabled, system_prompt_override, is_active } = req.body;
      const { data, error } = await supabaseAdmin.from('agents').update({ name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, action_scopes, web_fetch_enabled: !!web_fetch_enabled, system_prompt_override, is_active }).eq('id', id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: agent } = await supabaseAdmin.from('agents').select('id').eq('id', id).eq('tenant_id', tenantId).single();
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      const { error } = await supabaseAdmin.from('agents').update({ is_active: false }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/agents/token-balance
  app.get('/api/agents/token-balance', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: tenant } = await supabaseAdmin.from('tenants')
        .select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', tenantId).single();
      const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data: usage } = await supabaseAdmin.from('agent_token_usage')
        .select('cost_eur_cents').eq('tenant_id', tenantId).gte('created_at', firstOfMonth);
      const monthlyUsedCents = ((usage as any) || []).reduce((sum: number, r: any) => sum + (r.cost_eur_cents ?? 0), 0);
      res.json({
        balance_eur_cents: (tenant as any)?.ai_credit_balance_eur_cents ?? 0,
        billing_mode: (tenant as any)?.agent_billing_mode ?? 'prepaid',
        monthly_used_cents: monthlyUsedCents,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/agents/:id/conversation
  app.get('/api/agents/:id/conversation', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: agentId } = req.params;
      const userId = req.user.id;

      const { data: agent } = await supabaseAdmin.from('agents').select('id').eq('id', agentId).eq('tenant_id', tenantId).single();
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      let { data: conv } = await supabaseAdmin.from('agent_conversations').select('*').eq('agent_id', agentId).eq('user_id', userId).single();
      if (!conv) {
        const { data: newConv, error: cErr } = await supabaseAdmin.from('agent_conversations').insert({ tenant_id: tenantId, agent_id: agentId, user_id: userId }).select().single();
        if (cErr) throw cErr;
        conv = newConv;
      }

      const { data: messages } = await supabaseAdmin.from('agent_messages').select('*').eq('conversation_id', (conv as any).id).order('created_at', { ascending: true }).limit(50);
      res.json({ conversation: conv, messages: messages || [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/agents/:id/conversation
  app.delete('/api/agents/:id/conversation', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: agentId } = req.params;
      const { data: conv } = await supabaseAdmin.from('agent_conversations').select('id').eq('agent_id', agentId).eq('user_id', req.user.id).eq('tenant_id', tenantId).single();
      if (conv) {
        await supabaseAdmin.from('agent_messages').delete().eq('conversation_id', (conv as any).id);
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agents/:id/chat
  app.post('/api/agents/:id/chat', async (req: any, res: any) => {
    // Neither Google's standard Gemini API (unlike Vertex AI) nor this app
    // previously exposed per-request timing anywhere — a slow-but-successful
    // call left no trace to diagnose after the fact, only a timeout left a
    // (untimed) Sentry exception. These console.log lines are deliberately
    // plain (not Sentry) so every call's timing is visible in server logs
    // regardless of whether anything actually failed.
    const chatRequestStart = Date.now();
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: agentId } = req.params;
      const { message, document_ids } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
      const attachedDocumentIds: string[] = Array.isArray(document_ids) ? document_ids : [];

      const { plan } = await getTenantPlan(tenantId);
      if (plan !== 'enterprise') {
        return res.status(403).json({ error: 'Plan Enterprise requis pour accéder aux agents IA.', code: 'ENTERPRISE_REQUIRED' });
      }

      // Refresh monthly allowance if billing helpers available
      if (billing) {
        await billing.maybeRefreshMonthlyCredits(tenantId, plan);
      }

      const { data: tenantData } = await supabaseAdmin.from('tenants')
        .select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', tenantId).single();
      const billingMode = (tenantData as any)?.agent_billing_mode ?? 'prepaid';
      const balance = (tenantData as any)?.ai_credit_balance_eur_cents ?? 0;
      if (billingMode === 'prepaid' && balance <= 0) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      const { data: agent, error: agentErr } = await supabaseAdmin.from('agents').select('*').eq('id', agentId).eq('tenant_id', tenantId).eq('is_active', true).single();
      if (agentErr || !agent) return res.status(404).json({ error: 'Agent introuvable ou inactif' });

      let { data: conv } = await supabaseAdmin.from('agent_conversations').select('*').eq('agent_id', agentId).eq('user_id', req.user.id).single();
      if (!conv) {
        const { data: newConv, error: cErr } = await supabaseAdmin.from('agent_conversations').insert({ tenant_id: tenantId, agent_id: agentId, user_id: req.user.id }).select().single();
        if (cErr) throw cErr;
        conv = newConv;
      }
      const convId = (conv as any).id;

      const { data: history } = await supabaseAdmin.from('agent_messages').select('role, content').eq('conversation_id', convId).order('created_at', { ascending: true }).limit(20);
      const contextStart = Date.now();
      const ctx = await buildAgentContext(supabaseAdmin, tenantId, req.user.id, (agent as any).context_scopes || [], attachedDocumentIds);
      console.log(`[agent chat] context built in ${Date.now() - contextStart}ms conv=${convId} agent=${agentId} attachedDocs=${attachedDocumentIds.length}`);
      const systemPrompt = buildAgentSystemPrompt(agent as AgentRow, ctx);

      // Which provider/model this call runs on is decided in llm/: the
      // platform setting picked in /admin when there is one, else
      // AI_PROVIDER/AI_MODEL, else Gemini. The lookup is cached, so this is
      // not a database round trip per call. A missing key throws
      // LlmNotConfiguredError, turned into a 503 by the catch block below.
      const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));

      const actionScopes: string[] = (agent as any).action_scopes || [];
      const webFetchEnabled: boolean = !!(agent as any).web_fetch_enabled;
      const tools = buildAgentTools(actionScopes, webFetchEnabled);

      // The full conversation, owned here rather than inside a vendor SDK's
      // stateful chat object: stored history, then the new user message, then
      // one assistant/tool pair per function-calling round below. Every
      // provider we target is stateless, so this is the shape they all share.
      const messages: LlmMessage[] = ((history as any) || []).map((m: any) => (
        m.role === 'assistant'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content }
      ));
      messages.push({ role: 'user', content: message });
      // Bounds how long a stuck/slow provider call can hold the request open —
      // shorter than the client's own abort timeout (AgentChat.tsx, 130s) so
      // the client always gets this explicit message instead of a silent
      // connection drop. Was 55s, which cut off a plain "read this document"
      // request (no tool calls, and the attached PDF itself parsed in well
      // under a second — verified directly, so document size wasn't the
      // cause here) — i.e. the model's own response time alone can exceed 55s
      // on an ordinary request, not just on a large prompt or a multi-round
      // tool-calling exchange. Widened for headroom against that.
      const AGENT_CHAT_TIMEOUT_MS = 100000;
      const withTimeout = <T>(p: Promise<T>): Promise<T> => Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error("L'agent IA n'a pas répondu à temps."), { code: 'AGENT_TIMEOUT' })), AGENT_CHAT_TIMEOUT_MS)
        ),
      ]);

      // Wraps every provider call (initial, function-calling rounds, and the
      // blank-turn clarification below) with timing so a slow-but-successful
      // call is visible in logs, not just an eventual timeout — see the
      // comment on chatRequestStart above. Reads `messages` at call time, so
      // each round sends whatever the loop has appended since the last one.
      let llmCallCount = 0;
      const timedChat = async () => {
        llmCallCount++;
        const callIndex = llmCallCount;
        const callStart = Date.now();
        const label = `${provider.id}/${provider.model}`;
        try {
          const r = await withTimeout(provider.chat({ system: systemPrompt, messages, tools }));
          console.log(`[agent chat] llm call #${callIndex} (${label}) ok in ${Date.now() - callStart}ms conv=${convId} agent=${agentId}`);
          return r;
        } catch (e: any) {
          console.log(`[agent chat] llm call #${callIndex} (${label}) failed after ${Date.now() - callStart}ms conv=${convId} agent=${agentId}: ${e?.code || e?.message}`);
          throw e;
        }
      };

      let result = await timedChat();
      let inputTokens  = result.usage.inputTokens;
      let outputTokens = result.usage.outputTokens;

      // Function-calling loop: the model may chain several tool calls (e.g.
      // create_contact then create_proposal with the returned id) before it
      // produces a final natural-language reply.
      const actionSummaries: string[] = [];
      const MAX_FUNCTION_ROUNDS = 4;
      let round = 0;
      if (tools.length > 0 && billing?.baseUrl) {
        const authHeader = req.headers.authorization as string | undefined;
        while (result.toolCalls.length > 0 && round < MAX_FUNCTION_ROUNDS) {
          round++;
          messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls, raw: result.raw });
          const results: LlmToolResult[] = [];
          for (const call of result.toolCalls) {
            const { response, summary } = await executeAgentAction(billing.baseUrl, authHeader, actionScopes, webFetchEnabled, call);
            if (summary) actionSummaries.push(summary);
            results.push({ id: call.id, name: call.name, response });
          }
          messages.push({ role: 'tool', results });
          result = await timedChat();
          inputTokens  += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
        }
      }

      const rawText = result.text;

      let { cleanText, spec } = parseArtifactFromText(rawText);
      // Gemini sometimes ends a function-calling turn (e.g. after a few
      // fetch_url/search_records reads) with no tool calls left AND no
      // text — often because it read enough to conclude an action can't be
      // completed as asked, but never says why. A generic "something's
      // missing, please clarify" fallback here just repeats itself verbatim
      // when the user then asks "what's missing?" — so instead of guessing,
      // ask the model directly to name the real blocker in its own words.
      if (!cleanText.trim()) {
        try {
          // Text only, deliberately without result.toolCalls: a call still
          // pending here was never executed (the round cap cut the loop
          // short), and replaying an unanswered call is rejected by
          // providers that require a result for every one. `raw` is dropped
          // in that same case — it carries those very calls among the
          // provider's own blocks, so passing it would reintroduce exactly
          // what omitting toolCalls avoids — and kept otherwise, so an
          // ordinary blank turn's thinking blocks still round-trip. On that
          // ordinary blank turn there is neither text nor calls, so this
          // push is a no-op the adapters drop.
          const hasPendingCalls = result.toolCalls.length > 0;
          messages.push({
            role: 'assistant',
            content: result.text,
            ...(hasPendingCalls ? {} : { raw: result.raw }),
          });
          messages.push({
            role: 'user',
            content: "Tu n'as donné aucune réponse à l'utilisateur pour ce message. En 1 à 2 phrases, explique précisément ce qui t'empêche de terminer cette action (l'information exacte qui te manque, ou la raison du blocage) — sans appeler à nouveau d'outil, juste du texte.",
          });
          const clarify = await timedChat();
          inputTokens += clarify.usage.inputTokens;
          outputTokens += clarify.usage.outputTokens;
          const clarifyText = parseArtifactFromText(clarify.text).cleanText;
          if (clarifyText.trim()) cleanText = clarifyText;
        } catch {
          // Network/timeout on the clarification round — fall through to the
          // generic message below rather than failing the whole request.
        }
      }
      const finalText = cleanText.trim() || (actionSummaries.length > 0
        ? "Je me suis arrêtée après ces étapes sans pouvoir conclure, et je n'ai pas réussi à préciser pourquoi. Pouvez-vous reformuler votre demande ?"
        : "Je n'ai pas pu produire de réponse. Pouvez-vous reformuler votre demande ?");
      const reply = actionSummaries.length > 0
        ? actionSummaries.map(s => `✅ ${s}`).join('\n') + '\n\n' + finalText
        : finalText;
      const artifact = spec ? generateArtifact(spec) : undefined;

      let newBalance = balance;
      let costCents = 0;

      if ((inputTokens + outputTokens) > 0 && billing) {
        const deducted = await billing.deductAiCredit({
          tenantId, userId: req.user.id,
          agentId, conversationId: convId,
          endpointType: 'agent',
          provider: provider.id, model: provider.model,
          inputTokens, outputTokens,
        });
        newBalance = deducted.newBalance;
        costCents = deducted.costCents;
      } else if ((inputTokens + outputTokens) > 0) {
        await supabaseAdmin.from('tenants')
          .update({ agent_token_balance: Math.max(0, ((tenantData as any)?.agent_token_balance ?? 0) - (inputTokens + outputTokens)) })
          .eq('id', tenantId);
        await supabaseAdmin.from('agent_token_usage').insert({
          tenant_id: tenantId, agent_id: agentId,
          user_id: req.user.id, conversation_id: convId,
          tokens_used: inputTokens + outputTokens,
        });
      }

      await supabaseAdmin.from('agent_messages').insert([
        { conversation_id: convId, tenant_id: tenantId, role: 'user', content: message },
        { conversation_id: convId, tenant_id: tenantId, role: 'assistant', content: reply },
      ]);

      await supabaseAdmin.from('agent_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);

      console.log(`[agent chat] done in ${Date.now() - chatRequestStart}ms conv=${convId} agent=${agentId} llmCalls=${llmCallCount} rounds=${round} tokens=${inputTokens + outputTokens}`);

      res.json({
        reply,
        tokens_used: inputTokens + outputTokens,
        cost_eur_cents: costCents,
        remaining_balance: newBalance,
        ...(artifact ? { artifact } : {}),
      });
    } catch (e: any) {
      // Kept ahead of the Sentry capture below so a missing/unusable API key
      // stays the plain 503 it was when this check ran inline, rather than
      // becoming a reported exception.
      if (e instanceof LlmNotConfiguredError) {
        return res.status(503).json({ error: e.message });
      }
      console.error(`[agent chat error] ${e.message} (totalMs=${Date.now() - chatRequestStart})`);
      // Richer than captureConsoleIntegration's plain-string capture — tags
      // this by agent so failures for a specific agent are easy to isolate.
      Sentry.captureException(e, {
        tags: { feature: 'agent-chat', agent_id: req.params?.id, timeout: e.code === 'AGENT_TIMEOUT' },
        extra: { userId: req.user?.id },
      });
      if (e.code === 'AGENT_TIMEOUT') {
        return res.status(504).json({ error: e.message, code: 'AGENT_TIMEOUT' });
      }
      res.status(500).json({ error: `Erreur lors de la communication avec l'agent : ${e.message}` });
    }
  });
}
