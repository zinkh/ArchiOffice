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

/** Une image jointe à un message utilisateur — une photo (carte de visite,
 *  panneau de chantier, véhicule d'entreprise...), ou une page de document
 *  scanné rendue en image. Transmise telle quelle au fournisseur qui sait la
 *  lire (LlmProvider.supportsVision) plutôt que reconstituée en texte par
 *  OCR : un OCR conçu pour du texte scanné à plat (Tesseract) produit un
 *  texte incohérent sur une photo prise en perspective, que le modèle
 *  "corrige" ensuite en une donnée plausible mais inventée — la vision
 *  native évite ce détour en laissant le modèle lire les pixels lui-même. */
export interface LlmImage {
  data: Buffer;
  mimeType: string;
}

export type LlmMessage =
  | { role: 'user'; content: string; images?: LlmImage[] }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: LlmToolCall[];
      /** The provider's own representation of this turn, echoed back
       *  verbatim on the next call when the provider supplies one. It carries
       *  what the neutral fields can't round-trip — Claude's thinking blocks
       *  and their signatures above all, which the API expects to see
       *  unchanged when a conversation continues on the same model. Opaque
       *  here on purpose: only the adapter that produced it reads it, and
       *  every other adapter ignores it. */
      raw?: unknown;
    }
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
  /** Active le tool natif de recherche web du fournisseur (Gemini
   *  `googleSearch`, Claude `web_search_20250305`) EN PLUS de `tools` — pas un
   *  remplacement. Exécuté côté fournisseur : il ne produit jamais de
   *  LlmToolCall à notre charge, contrairement aux tools déclarés dans
   *  `tools`. Sans effet chez un fournisseur qui ne l'annonce pas
   *  (LlmProvider.supportsWebSearch) — voir mistral.ts pour pourquoi Mistral
   *  n'est pas de ceux-là. */
  webSearch?: boolean;
}

export interface LlmChatResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  /** Provider-specific payload for this turn, to be handed back on the
   *  assistant message of the next call. See LlmMessage's `raw`. */
  raw?: unknown;
}

/** Un enregistrement audio tel que le navigateur l'a produit. */
export interface LlmAudio {
  data: Buffer;
  /** Type IANA, éventuellement paramétré ('audio/webm;codecs=opus'). Les
   *  adaptateurs qui n'acceptent que le type nu s'en chargent eux-mêmes. */
  mimeType: string;
}

export interface LlmTranscriptionParams {
  audio: LlmAudio;
  /** Étiquette BCP-47 de la langue attendue ('fr-FR'). Indication, pas
   *  contrainte : un modèle multilingue reste libre de reconnaître autre
   *  chose plutôt que de forcer une transcription fausse. */
  language?: string;
  /** Vocabulaire probable de la dictée — les termes du cabinet, les noms de
   *  projets. Améliore nettement la reconnaissance du jargon (CCTP, DPGF,
   *  APS, gros œuvre) qu'un modèle généraliste écrirait phonétiquement. */
  vocabulary?: string[];
}

export interface LlmTranscriptionResult {
  /** Le texte dicté, sans commentaire du modèle. Vide si l'enregistrement ne
   *  portait aucune parole — un silence n'est pas une erreur. */
  text: string;
  /** `audioInputTokens` compte à part : tous les fournisseurs qui acceptent
   *  de l'audio le facturent au-dessus de leur tarif texte (voir
   *  ModelCost.audioInputUsdPerM). */
  usage: LlmUsage & { audioInputTokens: number };
}

export interface LlmSpeechParams {
  /** Le texte à lire. Toujours celui d'un message déjà affiché — la synthèse
   *  ne fabrique jamais son propre texte. */
  text: string;
  /** Étiquette BCP-47 de la langue à parler ('fr-FR'). */
  language?: string;
  /** Voix prédéfinie du fournisseur, quand il en propose plusieurs. Absente,
   *  l'adaptateur choisit sa voix par défaut. */
  voice?: string;
}

export interface LlmSpeechResult {
  audio: LlmAudio;
  usage: LlmUsage;
}

export interface LlmProvider {
  /** Stable provider key ('gemini', 'anthropic', 'mistral') — used in logs
   *  and, from step 2 on, to price a call and record it in
   *  agent_token_usage. */
  readonly id: string;
  /** Concrete model id this instance calls. */
  readonly model: string;
  /** Le fournisseur sait-il lire une image jointe (LlmMessage.images) ?
   *  Absent/false : buildAgentContext() (context.ts) n'attache jamais
   *  d'image à ce fournisseur et retombe sur l'OCR texte classique pour les
   *  pièces photographiées — dégradé, mais honnête, plutôt que d'envoyer une
   *  image qu'il ignorerait silencieusement ou refuserait. */
  readonly supportsVision?: boolean;
  /** Le fournisseur sait-il exécuter lui-même une recherche web (voir
   *  LlmChatParams.webSearch) ? Absent/false : routes.ts n'envoie jamais ce
   *  paramètre à ce fournisseur, et web_search_enabled reste sans effet tant
   *  que le cabinet ne fait pas tourner ses agents sur un fournisseur qui le
   *  supporte — dégradé, mais honnête, plutôt qu'une capacité qui échouerait
   *  silencieusement ou qu'un appel API rejetterait. */
  readonly supportsWebSearch?: boolean;
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  /** Transcription d'un enregistrement vocal, quand le fournisseur sait lire
   *  l'audio. Optionnel à dessein : Claude n'accepte aucune entrée audio, et
   *  la transcription Mistral (Voxtral) se facture à la minute, hors du
   *  catalogue de prix au jeton sur lequel toute la facturation repose. Le
   *  choix d'un fournisseur capable est fait une fois, dans
   *  resolveTranscriptionProvider(). */
  transcribe?(params: LlmTranscriptionParams): Promise<LlmTranscriptionResult>;
  /** Synthèse vocale d'un texte. Optionnel pour la même raison que
   *  `transcribe` : ni Claude ni Mistral n'exposent de synthèse dans notre
   *  catalogue. resolveSpeechProvider() est le seul appelant. */
  speak?(params: LlmSpeechParams): Promise<LlmSpeechResult>;
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
