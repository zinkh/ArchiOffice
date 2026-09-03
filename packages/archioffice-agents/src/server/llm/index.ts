// ── LLM provider resolution ──────────────────────────────────────────────────
// Single place that decides which provider, model and key a request runs on,
// so step 3 (per-tenant BYOK keys) means extending this function rather than
// editing call sites.
//
// Two invariants hold here:
//   - A model absent from MODEL_CATALOG is refused. We never run a model we
//     can't price, because that means billing a tenant an invented amount.
//   - A provider with no key configured is refused with LlmNotConfiguredError,
//     which the routes turn into a 503 (distinct from a call that ran and
//     failed).
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { createMistralProvider, DEFAULT_MISTRAL_MODEL } from './mistral.js';
import { isPricedModel } from './pricing.js';
import { LlmNotConfiguredError, type LlmProvider } from './types.js';

export interface ResolveLlmOptions {
  /** Provider key: 'gemini', 'anthropic' or 'mistral'. Defaults to the
   *  AI_PROVIDER environment variable, else Gemini. */
  provider?: string;
  /** Model id. Defaults to the provider's own default. */
  model?: string;
  /** Explicit key (a tenant's BYOK key, from step 3 on). Falls back to the
   *  provider's process-wide environment key. */
  apiKey?: string;
}

interface ProviderDef {
  envKey: string;
  defaultModel: string;
  /** Label used in the "not configured" message shown to the user. */
  label: string;
  create(opts: { apiKey: string; model: string }): LlmProvider;
}

const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    envKey: 'GEMINI_API_KEY',
    defaultModel: DEFAULT_GEMINI_MODEL,
    label: 'Gemini',
    create: createGeminiProvider,
  },
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    label: 'Claude (Anthropic)',
    create: createAnthropicProvider,
  },
  mistral: {
    envKey: 'MISTRAL_API_KEY',
    defaultModel: DEFAULT_MISTRAL_MODEL,
    label: 'Mistral',
    create: createMistralProvider,
  },
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);

export function resolveLlmProvider(opts: ResolveLlmOptions = {}): LlmProvider {
  const providerId = opts.provider || process.env.AI_PROVIDER || 'gemini';
  const def = PROVIDERS[providerId];
  if (!def) {
    throw new LlmNotConfiguredError(
      `Fournisseur IA non supporté : ${providerId}. Valeurs possibles : ${SUPPORTED_PROVIDERS.join(', ')}.`,
    );
  }

  const model = opts.model || process.env.AI_MODEL || def.defaultModel;
  if (!isPricedModel(providerId, model)) {
    throw new LlmNotConfiguredError(
      `Modèle IA inconnu ou non tarifé : ${providerId}/${model}. Ajoutez-le au catalogue avant de l'utiliser.`,
    );
  }

  const apiKey = opts.apiKey || process.env[def.envKey];
  if (!apiKey) {
    // The Gemini wording is the one the two AI routes have always returned on
    // a missing key; kept verbatim so nothing downstream has to change.
    if (providerId === 'gemini') throw new LlmNotConfiguredError('Gemini API key not configured');
    throw new LlmNotConfiguredError(`Clé API ${def.label} non configurée (${def.envKey}).`);
  }

  return def.create({ apiKey, model });
}

export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
export { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
export { createMistralProvider, DEFAULT_MISTRAL_MODEL } from './mistral.js';
export {
  MODEL_CATALOG,
  getModelCost,
  isPricedModel,
  listPricedModels,
  priceEurCents,
  type ModelCost,
} from './pricing.js';
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
