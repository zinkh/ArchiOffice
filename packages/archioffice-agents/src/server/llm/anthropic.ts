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
      out.push({ role: 'user', content: msg.content });
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

export function createAnthropicProvider(opts: { apiKey: string; model?: string }): LlmProvider {
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  let client: any;

  return {
    id: 'anthropic',
    model,

    async chat({ system, messages, tools }: LlmChatParams): Promise<LlmChatResult> {
      if (!client) {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        client = new Anthropic({ apiKey: opts.apiKey });
      }

      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
        ...(tools && tools.length > 0
          ? {
              tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parametersJsonSchema,
              })),
            }
          : {}),
      });

      const usage = {
        inputTokens: response.usage?.input_tokens ?? 0,
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
