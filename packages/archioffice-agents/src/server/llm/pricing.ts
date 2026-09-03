// ── Per-model pricing ────────────────────────────────────────────────────────
// Until step 2 the app billed every AI call at two flat rates tuned for
// gemini-3-flash-preview (AI_PRICE_INPUT_PER_M / AI_PRICE_OUTPUT_PER_M in
// server.ts). With several providers selectable that under-bills badly: a
// Claude Opus call costs 10x a Gemini Flash call on input and ~8x on output,
// so a single flat rate would have the tenant paying Flash prices for it.
//
// So cost is now a fact per model (what the provider charges us), and margin
// is one knob (AI_PRICE_MARKUP) applied on top. The default markup of 1.3333
// reproduces the previous Gemini rates to the cent: 0.50 x 1.3333 = 0.67 and
// 3.00 x 1.3333 = 4.00, the two values it replaces.
//
// USD figures are treated as EUR: the previous rates did the same (they were
// derived from Google's USD prices and stored as EUR), so the exchange rate
// is absorbed into the markup rather than tracked separately. That costs some
// margin — Mistral, which publishes both, charges EUR at ~1.1x its USD price,
// so the effective markup on those rows is ~1.21 rather than 1.3333. Well
// inside the margin, but the reason to add an explicit rate here rather than
// raise AI_PRICE_MARKUP if it ever needs correcting.

export interface ModelCost {
  /** Provider's own price, USD per million input tokens. */
  inputUsdPerM: number;
  /** Provider's own price, USD per million output tokens. */
  outputUsdPerM: number;
  /** Human-readable label for the model picker. */
  label: string;
}

// Every model the app can run. A model absent from this table cannot be
// selected at all (see resolveLlmProvider) — we never run a model we can't
// price, because that means billing a tenant an amount we invented.
export const MODEL_CATALOG: Record<string, Record<string, ModelCost>> = {
  // Google, https://ai.google.dev/gemini-api/docs/pricing
  gemini: {
    'gemini-3-flash-preview': { inputUsdPerM: 0.50, outputUsdPerM: 3.00, label: 'Gemini 3 Flash' },
  },
  // Anthropic, first-party API rates (verified 2026-06-24).
  anthropic: {
    'claude-opus-5':   { inputUsdPerM: 5.00, outputUsdPerM: 25.00, label: 'Claude Opus 5' },
    'claude-sonnet-5': { inputUsdPerM: 2.00, outputUsdPerM: 10.00, label: 'Claude Sonnet 5' },
    'claude-haiku-4-5': { inputUsdPerM: 1.00, outputUsdPerM: 5.00, label: 'Claude Haiku 4.5' },
  },
  // Mistral, from https://mistral.ai/pricing (verified Sept. 2026). Medium
  // 3.5 is the one the vendor positions for long-horizon tasks and
  // synchronous tool-calling — i.e. what the agents actually do — which is
  // why it's here despite costing 3x Large 3 on input and 5x on output.
  mistral: {
    'mistral-large-latest':  { inputUsdPerM: 0.50, outputUsdPerM: 1.50, label: 'Mistral Large 3' },
    'mistral-medium-latest': { inputUsdPerM: 1.50, outputUsdPerM: 7.50, label: 'Mistral Medium 3.5' },
    'mistral-small-latest':  { inputUsdPerM: 0.15, outputUsdPerM: 0.60, label: 'Mistral Small 4' },
  },
};

/** Margin applied to the provider's own cost. 1.3333 reproduces the flat
 *  rates this table replaces; raise or lower it to move margin on every
 *  model at once. */
function markup(): number {
  const raw = parseFloat(process.env.AI_PRICE_MARKUP || '');
  return Number.isFinite(raw) && raw > 0 ? raw : 1.3333;
}

export function getModelCost(provider: string, model: string): ModelCost | undefined {
  return MODEL_CATALOG[provider]?.[model];
}

export function isPricedModel(provider: string, model: string): boolean {
  return !!getModelCost(provider, model);
}

/** Every (provider, model) pair the app can run, for the config UI. */
export function listPricedModels(): { provider: string; model: string; label: string }[] {
  return Object.entries(MODEL_CATALOG).flatMap(([provider, models]) =>
    Object.entries(models).map(([model, cost]) => ({ provider, model, label: cost.label })),
  );
}

/**
 * What to charge a tenant for one call, in EUR cents.
 *
 * Rounds up to at least 1 cent, as the flat-rate version it replaces did:
 * a call that costs a fraction of a cent still consumes a cent of credit.
 */
export function priceEurCents(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost = getModelCost(provider, model);
  if (!cost) {
    // Unreachable while resolveLlmProvider rejects unpriced models, kept so a
    // future caller can't silently bill zero. Charges the most expensive
    // known rates: over-billing is visible and refundable, under-billing is
    // neither.
    const worst = Object.values(MODEL_CATALOG)
      .flatMap(models => Object.values(models))
      .reduce((a, b) => (b.outputUsdPerM > a.outputUsdPerM ? b : a));
    console.warn(`[ai pricing] unpriced model ${provider}/${model} — billed at the highest known rate`);
    return priceFrom(worst, inputTokens, outputTokens);
  }
  return priceFrom(cost, inputTokens, outputTokens);
}

function priceFrom(cost: ModelCost, inputTokens: number, outputTokens: number): number {
  const eur =
    ((inputTokens / 1_000_000) * cost.inputUsdPerM + (outputTokens / 1_000_000) * cost.outputUsdPerM) * markup();
  return Math.max(1, Math.ceil(eur * 100));
}
