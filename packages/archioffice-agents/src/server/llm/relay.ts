// ── Fournisseur « relais » du client Electron ────────────────────────────────
// Le poste de bureau ne détient aucune clé d'IA : ses appels sont relayés vers
// le serveur en ligne (/api/desktop/v1/ai/*), qui vérifie l'abonnement payant,
// choisit le fournisseur du cabinet, appelle le modèle et facture les crédits.
//
// Ce fichier ne connaît ni l'authentification ni le réseau : l'hôte lui fournit
// un `LlmRelay` (voir setLlmRelay dans index.ts). Il ne fait que traduire les
// paramètres d'un appel en JSON (les Buffer voyagent en base64) et la réponse
// en résultats typés, pour que tous les appelants (chat des agents, CCTP,
// suggestions, dictée, voix) restent écrits contre `LlmProvider` sans changer.
import type {
  LlmChatParams,
  LlmChatResult,
  LlmProvider,
  LlmSpeechParams,
  LlmSpeechResult,
  LlmTranscriptionParams,
  LlmTranscriptionResult,
} from './types.js';

export type LlmRelayOperation = 'chat' | 'transcribe' | 'speak';

/** Ce que l'on sait du fournisseur actif du cabinet, tel que le serveur en
 *  ligne l'a annoncé la dernière fois. Lu de façon synchrone par
 *  resolveLlmProvider(), donc mis en cache par l'hôte. */
export interface LlmRelayCapabilities {
  provider?: string;
  model?: string;
  supportsVision: boolean;
  supportsWebSearch: boolean;
}

export interface LlmRelay {
  capabilities(): LlmRelayCapabilities;
  /** Envoie la charge utile au serveur en ligne et rend sa réponse JSON.
   *  Lève LlmNotConfiguredError si l'appel est refusé (abonnement, crédit,
   *  compte cloud non lié, serveur injoignable). */
  call(operation: LlmRelayOperation, payload: Record<string, unknown>): Promise<any>;
}

const toBase64 = (data: Buffer) => data.toString('base64');
const fromBase64 = (data: unknown) => Buffer.from(String(data ?? ''), 'base64');

export function encodeChatParams(params: LlmChatParams): Record<string, unknown> {
  return {
    ...params,
    messages: params.messages.map(message =>
      message.role === 'user' && message.images?.length
        ? { ...message, images: message.images.map(image => ({ mimeType: image.mimeType, data: toBase64(image.data) })) }
        : message,
    ),
  };
}

export function decodeChatParams(body: any): LlmChatParams {
  return {
    ...body,
    messages: (body.messages as any[]).map(message =>
      message.role === 'user' && Array.isArray(message.images)
        ? { ...message, images: message.images.map((image: any) => ({ mimeType: image.mimeType, data: fromBase64(image.data) })) }
        : message,
    ),
  };
}

export function createRelayProvider(relay: LlmRelay): LlmProvider {
  const caps = relay.capabilities();
  return {
    get id() { return relay.capabilities().provider ?? 'cloud'; },
    get model() { return relay.capabilities().model ?? 'archioffice-cloud'; },
    supportsVision: caps.supportsVision,
    supportsWebSearch: caps.supportsWebSearch,

    async chat(params: LlmChatParams): Promise<LlmChatResult> {
      const result = await relay.call('chat', encodeChatParams(params));
      return {
        text: String(result.text ?? ''),
        toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
        usage: {
          inputTokens: Number(result.usage?.inputTokens) || 0,
          outputTokens: Number(result.usage?.outputTokens) || 0,
        },
        raw: result.raw,
      };
    },

    async transcribe(params: LlmTranscriptionParams): Promise<LlmTranscriptionResult> {
      const result = await relay.call('transcribe', {
        ...params,
        audio: { mimeType: params.audio.mimeType, data: toBase64(params.audio.data) },
      });
      return {
        text: String(result.text ?? ''),
        usage: {
          inputTokens: Number(result.usage?.inputTokens) || 0,
          outputTokens: Number(result.usage?.outputTokens) || 0,
          audioInputTokens: Number(result.usage?.audioInputTokens) || 0,
        },
      };
    },

    async speak(params: LlmSpeechParams): Promise<LlmSpeechResult> {
      const result = await relay.call('speak', { ...params });
      return {
        audio: { mimeType: String(result.audio?.mimeType ?? 'audio/wav'), data: fromBase64(result.audio?.data) },
        usage: {
          inputTokens: Number(result.usage?.inputTokens) || 0,
          outputTokens: Number(result.usage?.outputTokens) || 0,
        },
      };
    },
  };
}
