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
  provider?: string;
  model?: string;
}

const SETTING_KEY = 'ai_provider';

// Read on every AI call, so it is cached rather than queried each time. The
// window is short enough that a switch made in /admin takes effect while the
// operator is still looking at the page, and the write path clears the cache
// outright — but that only clears it in the process that served the write, so
// a multi-instance deployment still converges on this TTL rather than
// instantly.
const CACHE_TTL_MS = 30_000;

let cached: { value: PlatformAiConfig; at: number } | null = null;

export function invalidatePlatformAiConfigCache(): void {
  cached = null;
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
      const raw = data.value as Record<string, unknown>;
      value = {
        ...(typeof raw.provider === 'string' && raw.provider ? { provider: raw.provider } : {}),
        ...(typeof raw.model === 'string' && raw.model ? { model: raw.model } : {}),
      };
    }
  } catch (e: any) {
    console.warn(`[ai config] platform_settings lookup failed, falling back to env: ${e?.message}`);
  }

  cached = { value, at: Date.now() };
  return value;
}

/** Writes the operator's selection. Callers must validate provider/model
 *  first — see the admin route, which refuses a model outside the catalogue
 *  or a provider with no key configured. */
export async function setPlatformAiConfig(
  supabaseAdmin: any,
  config: PlatformAiConfig,
  updatedBy?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from('platform_settings').upsert(
    {
      key: SETTING_KEY,
      value: config,
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
