// ── Provider-neutral LLM types ───────────────────────────────────────────────
// Step 1 of the multi-provider migration: everything above this layer (the
// agent chat loop, the CCTP article suggestions) is written against these
// types only, never against a vendor SDK. Gemini is currently the sole
// implementation (see gemini.ts); Anthropic and Mistral adapters plug in
// behind the same interface without touching their callers.
//
// The shape is deliberately STATELESS — one call carries the full message
// list — unlike @google/genai's `chats` object which accumulates history
// internally. Anthropic's and Mistral's APIs are stateless too, so keeping
// history on the caller's side is the only shape all three can share.

/** A tool the model asked to run. `id` is unset for providers (Gemini) that
 *  don't correlate calls and results by id. */
export interface LlmToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** The outcome of one LlmToolCall, fed back to the model on the next turn. */
export interface LlmToolResult {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; results: LlmToolResult[] };

/** Same shape buildAgentTools() already produces (see tools.ts) — a plain
 *  JSON Schema for the arguments, which maps onto Gemini's
 *  `parametersJsonSchema`, Anthropic's `input_schema` and Mistral's
 *  `function.parameters` with no rewriting. */
export interface LlmToolDef {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmChatParams {
  /** System instruction. Sent out-of-band by Gemini and Anthropic, as a
   *  leading system message by Mistral. */
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
}

export interface LlmChatResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
}

export interface LlmProvider {
  /** Stable provider key ('gemini', 'anthropic', 'mistral') — used in logs
   *  and, from step 2 on, to price a call and record it in
   *  agent_token_usage. */
  readonly id: string;
  /** Concrete model id this instance calls. */
  readonly model: string;
  chat(params: LlmChatParams): Promise<LlmChatResult>;
}

/** Thrown when no usable credentials/model could be resolved. Callers turn
 *  this into an HTTP 503, distinct from a provider call that actually ran
 *  and failed. */
export class LlmNotConfiguredError extends Error {
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}
