// ── Gemini adapter ───────────────────────────────────────────────────────────
// Wraps @google/genai behind the provider-neutral LlmProvider interface.
// Extracted verbatim (same model, same config keys, same usage counters) from
// the inline calls that used to live in routes.ts and
// server/routes/aiSuggestions.ts, so this step changes no behavior.
//
// It calls models.generateContent() rather than chats.create()/sendMessage():
// the `chats` helper is a thin stateful wrapper that rebuilds exactly these
// `contents` from the history it accumulates, and holding that history in the
// caller instead is what lets the stateless Anthropic/Mistral adapters reuse
// the same loop.
import type {
  LlmChatParams,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
} from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name?: string; response: Record<string, unknown> };
  /** Signature de raisonnement attachée par le modèle à ses propres parts.
   *  Opaque, jamais fabriquée ici : elle n'existe que renvoyée telle quelle. */
  thoughtSignature?: string;
  thought?: boolean;
}

function toGeminiContents(messages: LlmMessage[]): { role: string; parts: GeminiPart[] }[] {
  const contents: { role: string; parts: GeminiPart[] }[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
      continue;
    }

    if (msg.role === 'tool') {
      // Gemini carries tool results on a 'user' turn, one part per call.
      contents.push({
        role: 'user',
        parts: msg.results.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
      });
      continue;
    }

    // Les parts telles que le modèle les a produites, quand on les a — c'est
    // ce qui préserve les signatures de raisonnement (thoughtSignature) que
    // Gemini 3 attache à chaque functionCall et exige de retrouver intactes au
    // tour suivant. Les reconstruire à partir du seul couple (nom, arguments)
    // les perd, et l'API répond alors « Function call is missing a
    // thought_signature in functionCall parts » dès le deuxième appel d'outil
    // d'un même échange. Une signature ne peut pas être fabriquée : la seule
    // façon de la fournir est de rejouer la part d'origine.
    if (Array.isArray(msg.raw) && msg.raw.length > 0) {
      contents.push({ role: 'model', parts: msg.raw as GeminiPart[] });
      continue;
    }

    const parts: GeminiPart[] = [];
    if (msg.content) parts.push({ text: msg.content });
    for (const call of msg.toolCalls || []) {
      parts.push({ functionCall: { name: call.name, args: call.args } });
    }
    // A turn where the model produced neither text nor a tool call (which is
    // exactly the blank-turn case routes.ts recovers from) has nothing to
    // send back: an empty parts array is rejected by the API, so drop it.
    if (parts.length > 0) contents.push({ role: 'model', parts });
  }

  return contents;
}

export function createGeminiProvider(opts: { apiKey: string; model?: string }): LlmProvider {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  // Created lazily and reused across the turns of one request — the SDK
  // client is cheap but there's no reason to rebuild it per tool round.
  let client: any;

  return {
    id: 'gemini',
    model,

    async chat({ system, messages, tools }: LlmChatParams): Promise<LlmChatResult> {
      if (!client) {
        const { GoogleGenAI } = await import('@google/genai');
        client = new GoogleGenAI({ apiKey: opts.apiKey });
      }

      const response = await client.models.generateContent({
        model,
        contents: toGeminiContents(messages),
        config: {
          ...(system ? { systemInstruction: system } : {}),
          ...(tools && tools.length > 0 ? { tools: [{ functionDeclarations: tools as any }] } : {}),
        },
      });

      // Conservées pour être rejouées à l'identique au tour suivant (voir
      // toGeminiContents). `raw` reste opaque pour tout le reste du code :
      // seul cet adaptateur sait le lire, et il ne vit que le temps d'une
      // requête, jamais persisté ni transmis à un autre fournisseur.
      const candidateParts = response.candidates?.[0]?.content?.parts;

      return {
        text: response.text ?? '',
        toolCalls: (response.functionCalls || []).map((c: any) => ({
          name: c.name ?? '',
          args: (c.args as Record<string, unknown>) || {},
        })),
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
        ...(Array.isArray(candidateParts) && candidateParts.length > 0 ? { raw: candidateParts } : {}),
      };
    },
  };
}
