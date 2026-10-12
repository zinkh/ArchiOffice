// ── Anthropic (Claude) adapter ───────────────────────────────────────────────
// Uses the official @anthropic-ai/sdk, loaded lazily like the Gemini one so
// the dependency only costs anything when a tenant actually runs on Claude.
//
// Two shape differences from Gemini worth knowing when reading this:
//   - Tool calls are correlated by id (tool_use.id ↔ tool_result.tool_use_id),
//     where Gemini matches on the function name alone.
//   - A turn's content blocks are replayed verbatim on the next call (see
//     `raw`), because Claude's thinking blocks carry signatures the API
//     expects back unchanged while a conversation continues on one model.
import type {
  LlmChatParams,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
} from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

// Agent replies are short (a confirmation, a list, a paragraph); this is
// headroom, not a target. Kept well under the model's cap so the request
// stays a plain non-streaming call within the route's own 100s budget.
const MAX_TOKENS = 16000;

/** Falls back to position when a call carries no id, so the assistant turn
 *  and its tool results still pair up: the chat loop appends results in the
 *  order the calls came in. */
function callId(id: string | undefined, index: number): string {
  return id || `tool_${index}`;
}

function toAnthropicMessages(messages: LlmMessage[]): any[] {
  const out: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (!msg.images || msg.images.length === 0) {
        out.push({ role: 'user', content: msg.content });
        continue;
      }
      // Une image jointe (photo, page scannée) part en bloc `image` natif,
      // jamais reconstituée en texte au préalable — voir LlmImage dans
      // types.ts pour pourquoi.
      const content: any[] = msg.images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.data.toString('base64') },
      }));
      if (msg.content) content.push({ type: 'text', text: msg.content });
      out.push({ role: 'user', content });
      continue;
    }

    if (msg.role === 'tool') {
      // Every result of one round goes in a single user message: splitting
      // them across messages teaches the model to stop calling tools in
      // parallel.
      out.push({
        role: 'user',
        content: msg.results.map((r, i) => ({
          type: 'tool_result',
          tool_use_id: callId(r.id, i),
          content: JSON.stringify(r.response),
        })),
      });
      continue;
    }

    // Prefer the provider's own blocks when this turn came from Claude —
    // that's what keeps thinking blocks and their signatures intact.
    if (Array.isArray(msg.raw) && msg.raw.length > 0) {
      out.push({ role: 'assistant', content: msg.raw });
      continue;
    }

    const content: any[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    (msg.toolCalls || []).forEach((call, i) => {
      content.push({ type: 'tool_use', id: callId(call.id, i), name: call.name, input: call.args });
    });
    if (content.length > 0) out.push({ role: 'assistant', content });
  }

  return out;
}

/** Pose le préfixe stable en tête du premier message utilisateur, dans un bloc
 *  marqué `cache_control` : tout ce qui précède (system, tools, préfixe) est
 *  alors mis en cache. Sans effet en dessous du minimum du modèle (1 024 jetons
 *  et plus) : l'appel passe simplement sans cache. */
function withCacheBreakpoint(messages: any[], prefix?: string): any[] {
  if (!prefix) return messages;
  const first = messages.findIndex(m => m.role === 'user' && typeof m.content === 'string');
  if (first < 0) return messages;
  return messages.map((m, i) => i !== first ? m : {
    role: 'user',
    content: [
      { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
    ],
  });
}

export function createAnthropicProvider(opts: { apiKey: string; model?: string }): LlmProvider {
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  let client: any;

  return {
    id: 'anthropic',
    model,
    supportsVision: true,
    // web_search_20250305 est un server tool : Claude exécute la recherche
    // lui-même et rend directement des blocs `web_search_tool_result`, jamais
    // un `tool_use` à exécuter de notre côté (voir le filtre sur
    // `b.type === 'tool_use'` plus bas, qui l'exclut déjà de `toolCalls`
    // sans changement). Se combine sans restriction avec nos propres tools
    // (`type` custom implicite) dans le même appel.
    supportsWebSearch: true,

    async chat({ system, messages, tools, webSearch, cachePrefix }: LlmChatParams): Promise<LlmChatResult> {
      if (!client) {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        client = new Anthropic({ apiKey: opts.apiKey });
      }

      const anthropicTools: any[] = (tools || []).map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parametersJsonSchema,
      }));
      // max_uses borne le coût d'un seul tour : sans lui un agent pourrait
      // enchaîner des recherches indéfiniment sur une seule question.
      if (webSearch) anthropicTools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });

      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: withCacheBreakpoint(toAnthropicMessages(messages), cachePrefix),
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      });

      // Les jetons mis en cache sont comptés à part par Claude : écriture à
      // 125 % et lecture à 10 % du prix d'entrée. Ils sont ramenés ici en
      // jetons d'entrée équivalents pour que la facturation suive le coût réel.
      const cacheWrite = response.usage?.cache_creation_input_tokens ?? 0;
      const cacheRead = response.usage?.cache_read_input_tokens ?? 0;
      const usage = {
        inputTokens: Math.ceil((response.usage?.input_tokens ?? 0) + cacheWrite * 1.25 + cacheRead * 0.1),
        outputTokens: response.usage?.output_tokens ?? 0,
      };

      // A safety decline returns HTTP 200 with empty content. Say so plainly
      // rather than letting the caller treat it as the "model went quiet"
      // case and spend another call asking what went wrong.
      if (response.stop_reason === 'refusal') {
        return {
          text: "Le modèle a refusé de traiter cette demande. Reformulez-la ou contactez le support si le refus paraît injustifié.",
          toolCalls: [],
          usage,
        };
      }

      const blocks: any[] = Array.isArray(response.content) ? response.content : [];
      const text = blocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      const toolCalls: LlmToolCall[] = blocks
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, args: (b.input as Record<string, unknown>) || {} }));

      return { text, toolCalls, usage, raw: blocks };
    },
  };
}
