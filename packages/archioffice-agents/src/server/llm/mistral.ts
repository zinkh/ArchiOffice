// ── Mistral adapter ──────────────────────────────────────────────────────────
// Plain fetch against Mistral's OpenAI-shaped chat/completions endpoint, no
// SDK. Unlike Gemini and Claude — where the vendor SDKs carry real behavior
// (streaming helpers, typed errors, block handling) — this request is one
// JSON POST, so a dependency would only add a version to keep current.
//
// Mistral matters here beyond "a third option": it is French and EU-hosted,
// which is the difference between usable and unusable for tenants whose own
// clients impose GDPR or sovereignty constraints on subcontractors — public
// commissioning bodies in particular.
import type {
  LlmChatParams,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
} from './types.js';

export const DEFAULT_MISTRAL_MODEL = 'mistral-large-latest';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MAX_TOKENS = 16000;

// The chat route already races every provider call against its own deadline,
// but that only rejects the promise — the socket would stay open. This is the
// backstop that actually ends the request, set above the route's 100s budget
// so the route's message is the one the user sees.
const REQUEST_TIMEOUT_MS = 120000;

function callId(id: string | undefined, index: number): string {
  return id || `tool_${index}`;
}

function toMistralMessages(system: string | undefined, messages: LlmMessage[]): any[] {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'tool') {
      // OpenAI-shaped APIs take one message per tool result, not one message
      // holding them all.
      for (const [i, r] of msg.results.entries()) {
        out.push({
          role: 'tool',
          name: r.name,
          tool_call_id: callId(r.id, i),
          content: JSON.stringify(r.response),
        });
      }
      continue;
    }

    const toolCalls = msg.toolCalls || [];
    if (!msg.content && toolCalls.length === 0) continue;
    out.push({
      role: 'assistant',
      content: msg.content || '',
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call, i) => ({
              id: callId(call.id, i),
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          }
        : {}),
    });
  }

  return out;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A malformed argument string is the model's error, not a transport
    // failure: hand the tool an empty payload and let the app's own
    // validation reject it with a message the model can act on.
    return {};
  }
}

export function createMistralProvider(opts: { apiKey: string; model?: string }): LlmProvider {
  const model = opts.model || DEFAULT_MISTRAL_MODEL;

  return {
    id: 'mistral',
    model,

    async chat({ system, messages, tools }: LlmChatParams): Promise<LlmChatResult> {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: toMistralMessages(system, messages),
          ...(tools && tools.length > 0
            ? {
                tools: tools.map(t => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parametersJsonSchema,
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
      });

      if (!res.ok) {
        // Read the body for the provider's own explanation, but never echo
        // the request back — it would carry the tenant's data into logs.
        const detail = await res.text().catch(() => '');
        throw new Error(`Mistral a répondu ${res.status}${detail ? ` : ${detail.slice(0, 300)}` : ''}`);
      }

      const json: any = await res.json();
      const message = json?.choices?.[0]?.message ?? {};
      const toolCalls: LlmToolCall[] = (message.tool_calls || []).map((c: any) => ({
        id: c.id,
        name: c.function?.name ?? '',
        args: parseArgs(c.function?.arguments),
      }));

      return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        usage: {
          inputTokens: json?.usage?.prompt_tokens ?? 0,
          outputTokens: json?.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
