// Côté client des notifications système : abonnement Web Push pour la PWA
// (voir server/push.ts pour la vue d'ensemble des deux transports).
import { apiFetch } from './api';

export interface PushConfig {
  configured: boolean;
  publicKey: string | null;
}

export interface PushPreferences {
  muted: string[];
  devices: number;
  configured: boolean;
}

export type PushStatus =
  | 'unsupported'   // navigateur sans service worker ou sans API Push
  | 'unconfigured'  // instance sans clés VAPID
  | 'denied'        // permission refusée par l'utilisateur
  | 'enabled'
  | 'disabled';

/**
 * iOS ne propose l'API Push que depuis un écran d'accueil, pas dans l'onglet
 * Safari : `window.PushManager` y est simplement absent tant que l'app n'est
 * pas installée. On teste donc la capacité, jamais l'agent utilisateur.
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/**
 * Vrai quand la page tourne dans une PWA installée. Sert uniquement à
 * expliquer à un utilisateur iOS pourquoi le bouton est indisponible.
 */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
}

export function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    // iPadOS se présente comme un Mac ; l'écran tactile le trahit.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// La clé publique VAPID voyage en base64url et doit être passée au navigateur
// sous forme d'octets bruts.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    return await apiFetch<PushConfig>('/api/push/config');
  } catch {
    return { configured: false, publicKey: null };
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported';
  const { configured } = await fetchPushConfig();
  if (!configured) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'enabled' : 'disabled';
}

/**
 * Demande la permission puis enregistre l'abonnement côté serveur. À n'appeler
 * que depuis un geste utilisateur : les navigateurs bloquent d'office une
 * demande de permission déclenchée au chargement.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported';

  const { configured, publicKey } = await fetchPushConfig();
  if (!configured || !publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled';

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  // Un abonnement existant peut avoir été créé avec une autre clé publique
  // (rotation VAPID, changement d'instance) : il ne recevra plus rien. On le
  // remplace plutôt que de le réutiliser à l'aveugle.
  if (subscription) {
    const existingKey = subscription.options?.applicationServerKey;
    const wantedKey = urlBase64ToUint8Array(publicKey);
    if (!existingKey || !sameKey(existingKey, wantedKey)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Obligatoire sur Chrome : un abonnement sans charge utile visible
      // serait refusé.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await apiFetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription.toJSON()),
  });
  return 'enabled';
}

function sameKey(a: ArrayBuffer, b: Uint8Array): boolean {
  const view = new Uint8Array(a);
  if (view.length !== b.length) return false;
  return view.every((byte, i) => byte === b[i]);
}

export async function disablePush(): Promise<PushStatus> {
  const subscription = await currentSubscription();
  if (!subscription) return 'disabled';
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});
  // Best effort : si le serveur est injoignable, l'endpoint mourra de
  // lui-même et sera purgé au premier envoi en 404/410 (server/push.ts).
  await apiFetch('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  return 'disabled';
}

/**
 * Réaligne le serveur sur l'abonnement réel du navigateur au démarrage. Un
 * endpoint peut changer sans action de l'utilisateur (le navigateur le fait
 * tourner, ou l'a régénéré après une purge de données) : sans ce rappel, le
 * serveur continuerait à pousser vers un endpoint mort et la personne
 * croirait les notifications actives.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch {
    /* silencieux : purement opportuniste */
  }
}

export async function sendTestPush(): Promise<void> {
  await apiFetch('/api/push/test', { method: 'POST' });
}

export async function fetchPushPreferences(): Promise<PushPreferences> {
  return apiFetch<PushPreferences>('/api/push/preferences');
}

export async function savePushPreferences(muted: string[]): Promise<void> {
  await apiFetch('/api/push/preferences', {
    method: 'PUT',
    body: JSON.stringify({ muted }),
  });
}
