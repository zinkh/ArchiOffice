// Côté poste de bureau : envoie les appels de modèle au serveur en ligne.
//
// Branché au démarrage par server.ts (setLlmRelay) quand OFFLINE_MODE est
// actif. Le poste n'a jamais de clé d'IA : il présente la session cloud de la
// personne (la même que la synchronisation et Drive) et le serveur en ligne
// vérifie l'abonnement payant, appelle le fournisseur et facture le cabinet
// (server/routes/desktopAi.ts). L'origine du service est celle livrée avec le
// client (electron/driveTrust.json), jamais une valeur reçue d'une requête.
import { readCloudLinkState, readEncryptedCloudSession, writeEncryptedCloudSession } from '../cloudLinkState';
import { encryptForStorage, decryptFromStorage } from '../ipcCrypto';
import { createCloudSupabaseClient, restoreCloudSession } from '../cloudSyncClient';
import { cloudServiceOrigin } from './localDriveRuntime';

const AI_PATH = '/api/desktop/v1/ai';
/** Une rédaction longue (CCTP) peut durer plusieurs minutes chez le fournisseur. */
const CALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024;
const TOKEN_MARGIN_MS = 60 * 1000;

interface RelayCapabilities {
  provider?: string;
  model?: string;
  supportsVision: boolean;
  supportsWebSearch: boolean;
}

export interface DesktopAiRelayOptions {
  /** Appelé avec le solde de crédits IA du cabinet, tel que le cloud le rend après un appel. */
  onBalance?: (tenantId: string, balanceEurCents: number, billingMode?: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

async function notConfigured(message: string): Promise<Error> {
  const { LlmNotConfiguredError } = await import('@zinkh/archioffice-agents/server/llm');
  return new LlmNotConfiguredError(message);
}

export function createDesktopAiRelay(options: DesktopAiRelayOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  let capabilities: RelayCapabilities = { supportsVision: true, supportsWebSearch: false };
  let cachedToken: { value: string; expiresAt: number } | null = null;
  let tokenInFlight: Promise<string> | null = null;

  async function requestAccessToken(): Promise<string> {
    const link = readCloudLinkState();
    const encrypted = readEncryptedCloudSession();
    if (!link?.importCompleted || !encrypted) {
      throw await notConfigured('Connectez ce poste à votre compte cloud ArchiOffice pour utiliser l’IA, réservée aux abonnés payants.');
    }
    let client: ReturnType<typeof createCloudSupabaseClient> | undefined;
    try {
      client = createCloudSupabaseClient();
      const session = await restoreCloudSession(client, await decryptFromStorage(encrypted));
      if (!session || session.user.id !== link.cloudUserId) throw new Error('session');
      // Le jeton de rafraîchissement tourne à chaque usage : le conserver avant tout autre appel.
      writeEncryptedCloudSession(await encryptForStorage(session.refresh_token));
      const expiresAt = (session.expires_at ?? 0) * 1000 || Date.now() + 5 * 60 * 1000;
      cachedToken = { value: session.access_token, expiresAt };
      return session.access_token;
    } catch {
      throw await notConfigured('Reconnectez le compte cloud de ce poste pour utiliser l’IA.');
    } finally {
      await client?.auth.stopAutoRefresh();
    }
  }

  /** Un seul rafraîchissement à la fois : deux appels IA simultanés ne doivent pas
   *  consommer deux fois le même jeton de rafraîchissement. */
  function accessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt - TOKEN_MARGIN_MS > Date.now()) return Promise.resolve(cachedToken.value);
    tokenInFlight ??= requestAccessToken().finally(() => { tokenInFlight = null; });
    return tokenInFlight;
  }

  async function send(method: 'GET' | 'POST', route: string, body?: Record<string, unknown>): Promise<any> {
    if (!cloudServiceOrigin) throw await notConfigured('Service en ligne non configuré dans cette version du client.');
    const link = readCloudLinkState();
    const token = await accessToken();
    let response: Response;
    try {
      response = await doFetch(`${cloudServiceOrigin}${AI_PATH}${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(link ? { 'X-Tenant-Id': link.tenantId } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw await notConfigured('Le service ArchiOffice en ligne est injoignable. L’IA nécessite une connexion.');
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw await notConfigured('Réponse IA trop volumineuse.');
    }
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      // L'abonnement et le crédit sont jugés par le serveur en ligne ; son message fait foi.
      const { DESKTOP_AI_PAID_ONLY_MESSAGE } = await import('@zinkh/archioffice-agents/server/llm');
      if (payload.code === 'AI_SUBSCRIPTION_REQUIRED') throw await notConfigured(DESKTOP_AI_PAID_ONLY_MESSAGE);
      throw await notConfigured(String(payload.error || `Le service IA a refusé la demande (${response.status}).`));
    }
    return payload;
  }

  function remember(payload: any): void {
    if (typeof payload?.supportsVision === 'boolean' || typeof payload?.supportsWebSearch === 'boolean') {
      capabilities = {
        provider: payload.provider, model: payload.model,
        supportsVision: payload.supportsVision !== false, supportsWebSearch: payload.supportsWebSearch === true,
      };
    }
  }

  async function mirrorBalance(payload: any): Promise<void> {
    const tenantId = readCloudLinkState()?.tenantId;
    if (!tenantId || !Number.isFinite(payload?.balance_eur_cents)) return;
    try { await options.onBalance?.(tenantId, payload.balance_eur_cents, payload.billing_mode); }
    catch { /* le solde local n'est qu'un miroir d'affichage et de garde-fou */ }
  }

  return {
    capabilities: () => capabilities,

    async call(operation: 'chat' | 'transcribe' | 'speak', body: Record<string, unknown>) {
      const payload = await send('POST', `/${operation}`, body);
      remember(payload);
      await mirrorBalance(payload);
      return payload;
    },

    /** Meilleur effort : renseigne le fournisseur actif avant le premier appel. */
    async refreshCapabilities(): Promise<void> {
      try {
        if (!readCloudLinkState()?.importCompleted) return;
        const payload = await send('GET', '/capabilities');
        remember(payload);
        await mirrorBalance(payload);
      } catch { /* hors ligne, non abonné ou non lié : le prochain appel le dira */ }
    },
  };
}
