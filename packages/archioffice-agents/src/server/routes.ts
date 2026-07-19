import * as Sentry from '@sentry/node';
import type { AgentRow } from '../types.js';
import { buildAgentSystemPrompt } from './systemPrompts.js';
import { buildAgentContext } from './context.js';
import { parseArtifactFromText, generateArtifact } from './artifacts.js';
import { buildAgentTools, executeAgentAction } from './tools.js';

type GetTenantId = (userId: string) => Promise<string>;
type GetTenantPlan = (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
type DeductAiCreditFn = (params: {
  tenantId: string; userId: string;
  agentId: string | null; conversationId: string | null;
  endpointType: 'agent' | 'suggest_articles';
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
        // Write permissions are never inherited from a template — the tenant
        // must opt in explicitly per activated agent.
        agentData = { ...agentData, slug: t.slug, name: t.name, role_title: t.role_title, avatar_initials: t.avatar_initials, avatar_color: t.avatar_color, tone: t.tone, directives: t.directives, context_scopes: t.context_scopes, action_scopes: [], is_active: true, is_system_template: false };
      } else {
        if (!slug || !name || !role_title) return res.status(400).json({ error: 'slug, name, role_title required' });
        agentData = { ...agentData, slug, name, role_title, avatar_initials: avatar_initials || 'AI', avatar_color: avatar_color || '#206bc4', tone, directives, context_scopes: context_scopes || [], action_scopes: action_scopes || [], system_prompt_override, is_active: true, is_system_template: false };
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
      const { name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, action_scopes, system_prompt_override, is_active } = req.body;
      const { data, error } = await supabaseAdmin.from('agents').update({ name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, action_scopes, system_prompt_override, is_active }).eq('id', id).eq('tenant_id', tenantId).select().single();
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
      const ctx = await buildAgentContext(supabaseAdmin, tenantId, req.user.id, (agent as any).context_scopes || [], attachedDocumentIds);
      const systemPrompt = buildAgentSystemPrompt(agent as AgentRow, ctx);

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(503).json({ error: 'Gemini API key not configured' });

      const { GoogleGenAI } = await import('@google/genai');
      const genai = new GoogleGenAI({ apiKey });

      const geminiHistory = ((history as any) || []).map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const actionScopes: string[] = (agent as any).action_scopes || [];
      const tools = buildAgentTools(actionScopes);

      const chat = genai.chats.create({
        model: 'gemini-3-flash-preview',
        config: {
          systemInstruction: systemPrompt,
          ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools as any }] } : {}),
        },
        history: geminiHistory,
      });
      // Bounds how long a stuck/slow Gemini call can hold the request open —
      // shorter than the client's own abort timeout so the client always gets
      // this explicit message instead of a silent connection drop.
      const AGENT_CHAT_TIMEOUT_MS = 55000;
      const withTimeout = <T>(p: Promise<T>): Promise<T> => Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error("L'agent IA n'a pas répondu à temps."), { code: 'AGENT_TIMEOUT' })), AGENT_CHAT_TIMEOUT_MS)
        ),
      ]);

      let result = await withTimeout(chat.sendMessage({ message }));
      let inputTokens  = (result as any).usageMetadata?.promptTokenCount ?? 0;
      let outputTokens = (result as any).usageMetadata?.candidatesTokenCount ?? 0;

      // Function-calling loop: the model may chain several tool calls (e.g.
      // create_contact then create_proposal with the returned id) before it
      // produces a final natural-language reply.
      const actionSummaries: string[] = [];
      const MAX_FUNCTION_ROUNDS = 4;
      let round = 0;
      if (tools.length > 0 && billing?.baseUrl) {
        const authHeader = req.headers.authorization as string | undefined;
        while (result.functionCalls && result.functionCalls.length > 0 && round < MAX_FUNCTION_ROUNDS) {
          round++;
          const responseParts: { functionResponse: { name?: string; response: Record<string, unknown> } }[] = [];
          for (const call of result.functionCalls) {
            const { response, summary } = await executeAgentAction(billing.baseUrl, authHeader, actionScopes, call);
            if (summary) actionSummaries.push(summary);
            responseParts.push({ functionResponse: { name: call.name, response } });
          }
          result = await withTimeout(chat.sendMessage({ message: responseParts }));
          inputTokens  += (result as any).usageMetadata?.promptTokenCount ?? 0;
          outputTokens += (result as any).usageMetadata?.candidatesTokenCount ?? 0;
        }
      }

      const rawText = result.text ?? '';

      const { cleanText, spec } = parseArtifactFromText(rawText);
      const reply = actionSummaries.length > 0
        ? actionSummaries.map(s => `✅ ${s}`).join('\n') + '\n\n' + cleanText
        : cleanText;
      const artifact = spec ? generateArtifact(spec) : undefined;

      let newBalance = balance;
      let costCents = 0;

      if ((inputTokens + outputTokens) > 0 && billing) {
        const deducted = await billing.deductAiCredit({
          tenantId, userId: req.user.id,
          agentId, conversationId: convId,
          endpointType: 'agent',
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

      res.json({
        reply,
        tokens_used: inputTokens + outputTokens,
        cost_eur_cents: costCents,
        remaining_balance: newBalance,
        ...(artifact ? { artifact } : {}),
      });
    } catch (e: any) {
      console.error('[agent chat error]', e.message);
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
