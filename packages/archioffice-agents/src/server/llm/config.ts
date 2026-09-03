// ── Platform-level AI provider selection ─────────────────────────────────────
// Which provider and model the instance runs on used to come only from
// AI_PROVIDER / AI_MODEL, so changing it meant a restart. It is now also
// settable from the platform back-office (/admin), stored in
// platform_settings under the key 'ai_provider'.
//
// Precedence, highest first:
//   1. an explicit argument to resolveLlmProvider() (a tenant's own choice,
//      from the BYOK step on)
//   2. this stored platform setting — the operator's deliberate act
//   3. AI_PROVIDER / AI_MODEL — the instance's boot default
//   4. Gemini
//
// The stored setting outranks the environment on purpose: otherwise an
// instance that sets AI_PROVIDER could never be switched from the UI, which
// is the whole point of the setting.

export interface PlatformAiConfig {
  /** Provider the platform currently runs on. */
  provider?: string;
  /** Model chosen for the active provider — `models[provider]`, resolved
   *  here so callers never have to know the shape below. */
  model?: string;
  /** One model per provider, remembered independently. Switching provider
   *  therefore restores the model that was picked for it rather than
   *  resetting to that provider's default, which matters because a switch is
   *  often a temporary trial: going to Mistral and back should not silently
   *  lose a deliberate choice of Claude Sonnet over Opus. */
  models?: Record<string, string>;
}

const SETTING_KEY = 'ai_provider';

// Read on every AI call, so it is cached rather than queried each time. The
// window is short enough that a switch made in /admin takes effect while the
// operator is still looking at the page, and the write path clears the cache
// outright — but that only clears it in the process that served the write, so
// a multi-instance deployment still converges on this TTL rather than
// instantly.
// Disabled under test: a time-based cache makes an integration test depend on
// what the tests before it happened to read, which is exactly the kind of
// order-dependent failure that is expensive to diagnose and easy to
// mis-attribute to the code under test.
const CACHE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

let cached: { value: PlatformAiConfig; at: number } | null = null;

export function invalidatePlatformAiConfigCache(): void {
  cached = null;
}

/**
 * Normalizes the stored row, tolerating the earlier `{provider, model}` shape
 * that predates per-provider models: a row written then is read as that one
 * model belonging to its own provider, so an operator's existing selection
 * survives the upgrade untouched and is rewritten in the new shape on their
 * next save. No data migration needed for a single JSONB row.
 */
export function parseStoredConfig(raw: Record<string, unknown>): PlatformAiConfig {
  const provider = typeof raw.provider === 'string' && raw.provider ? raw.provider : undefined;

  const models: Record<string, string> = {};
  if (raw.models && typeof raw.models === 'object') {
    for (const [key, model] of Object.entries(raw.models as Record<string, unknown>)) {
      if (typeof model === 'string' && model) models[key] = model;
    }
  }
  // Legacy shape: a bare `model` belongs to the provider stored alongside it.
  if (typeof raw.model === 'string' && raw.model && provider && !models[provider]) {
    models[provider] = raw.model;
  }

  return {
    ...(provider ? { provider } : {}),
    ...(provider && models[provider] ? { model: models[provider] } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
  };
}

export async function getPlatformAiConfig(supabaseAdmin: any): Promise<PlatformAiConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value: PlatformAiConfig = {};
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    // An error here is not fatal: an instance that hasn't run the
    // platform_settings migration yet, or a transient database failure, must
    // fall back to the environment default rather than take AI down with it.
    if (error) {
      console.warn(`[ai config] platform_settings unreadable, falling back to env: ${error.message}`);
    } else if (data?.value && typeof data.value === 'object') {
      value = parseStoredConfig(data.value as Record<string, unknown>);
    }
  } catch (e: any) {
    console.warn(`[ai config] platform_settings lookup failed, falling back to env: ${e?.message}`);
  }

  cached = { value, at: Date.now() };
  return value;
}

/** Writes the operator's selection. Callers must validate provider and every
 *  model first — see the admin route, which refuses a model outside the
 *  catalogue or an active provider with no key configured. Only `provider`
 *  and `models` are persisted; `model` is derived on read. */
export async function setPlatformAiConfig(
  supabaseAdmin: any,
  config: { provider: string; models: Record<string, string> },
  updatedBy?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from('platform_settings').upsert(
    {
      key: SETTING_KEY,
      value: { provider: config.provider, models: config.models },
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    // Explicit: the conflict target is the primary key `key`, not the `id`
    // column this table doesn't have.
    { onConflict: 'key' },
  );
  if (error) throw error;
  invalidatePlatformAiConfigCache();
}
