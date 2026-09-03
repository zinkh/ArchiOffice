// ── LLM provider resolution ──────────────────────────────────────────────────
// Single place that decides which provider and model a request runs on, so
// adding Anthropic/Mistral (step 2) and per-tenant BYOK keys (step 3) means
// extending this function, not editing every call site.
//
// Step 1 resolves Gemini only, from the process-wide GEMINI_API_KEY — the
// exact behavior the call sites had inline before.
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { LlmNotConfiguredError, type LlmProvider } from './types.js';

export interface ResolveLlmOptions {
  /** Provider key. Defaults to 'gemini'. */
  provider?: string;
  /** Model id. Defaults to the provider's own default. */
  model?: string;
  /** Explicit key (a tenant's BYOK key, from step 3 on). Falls back to the
   *  provider's process-wide env key when omitted. */
  apiKey?: string;
}

export function resolveLlmProvider(opts: ResolveLlmOptions = {}): LlmProvider {
  const providerId = opts.provider || 'gemini';

  switch (providerId) {
    case 'gemini': {
      const apiKey = opts.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new LlmNotConfiguredError('Gemini API key not configured');
      return createGeminiProvider({ apiKey, model: opts.model || DEFAULT_GEMINI_MODEL });
    }
    default:
      throw new LlmNotConfiguredError(`Fournisseur IA non supporté : ${providerId}`);
  }
}

export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
export { LlmNotConfiguredError } from './types.js';
export type {
  LlmChatParams,
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  LlmToolDef,
  LlmToolResult,
  LlmUsage,
} from './types.js';
