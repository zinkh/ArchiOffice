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
import { isPricedModel, MODEL_CATALOG } from './pricing.js';
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

export interface ProviderAvailability {
  provider: string;
  label: string;
  /** Environment variable holding this provider's key. */
  envKey: string;
  /** Whether that variable is set — a provider without a key cannot be
   *  selected, so the admin UI greys it out instead of letting an operator
   *  switch the instance onto a 503. */
  configured: boolean;
  defaultModel: string;
  models: { model: string; label: string }[];
}

/** What the platform back-office needs to render a provider picker: every
 *  supported provider, whether its key is present, and the models it can run.
 *  Never returns a key or any part of one. */
export function listProviderAvailability(): ProviderAvailability[] {
  return Object.entries(PROVIDERS).map(([provider, def]) => ({
    provider,
    label: def.label,
    envKey: def.envKey,
    configured: !!process.env[def.envKey],
    defaultModel: def.defaultModel,
    models: Object.entries(MODEL_CATALOG[provider] || {}).map(([model, cost]) => ({
      model,
      label: cost.label,
    })),
  }));
}

export type LlmSelectionSource = 'override' | 'environment' | 'default';

/**
 * Which provider and model a call would run on, and where that came from.
 * Resolves the pair from a single source rather than field by field: a
 * provider chosen in one place and a model in another produce an invalid
 * pair — an instance with AI_MODEL=gemini-3-flash-preview switched to
 * Anthropic from the back-office would otherwise ask Claude for a Gemini
 * model. So the first source that names either supplies both, and a source
 * naming only a provider falls through to that provider's own default model.
 *
 * Does not check keys or the catalogue: it describes the selection so the
 * admin UI can show it even when it is unusable. resolveLlmProvider() does
 * the validating.
 */
export function describeLlmSelection(opts: ResolveLlmOptions = {}): {
  provider: string;
  model: string;
  source: LlmSelectionSource;
} {
  const candidates: { provider?: string; model?: string; source: LlmSelectionSource }[] = [
    { provider: opts.provider, model: opts.model, source: 'override' },
    { provider: process.env.AI_PROVIDER, model: process.env.AI_MODEL, source: 'environment' },
  ];
  const chosen = candidates.find(c => c.provider || c.model);
  const provider = chosen?.provider || 'gemini';
  return {
    provider,
    model: chosen?.model || PROVIDERS[provider]?.defaultModel || '',
    source: chosen?.source ?? 'default',
  };
}

export function resolveLlmProvider(opts: ResolveLlmOptions = {}): LlmProvider {
  const { provider: providerId, model } = describeLlmSelection(opts);
  const def = PROVIDERS[providerId];
  if (!def) {
    throw new LlmNotConfiguredError(
      `Fournisseur IA non supporté : ${providerId}. Valeurs possibles : ${SUPPORTED_PROVIDERS.join(', ')}.`,
    );
  }

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
export {
  getPlatformAiConfig,
  setPlatformAiConfig,
  invalidatePlatformAiConfigCache,
  parseStoredConfig,
  type PlatformAiConfig,
} from './config.js';
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
