// Notifications système du client Electron.
//
// Le poste de travail n'a pas de service de push pour le réveiller (voir
// electron/preload.cjs) : c'est lui qui vient chercher, à intervalle fixe, les
// notifications que le serveur a déposées dans notification_outbox, et les
// fait afficher par le processus principal.
//
// Ce fichier est chargé dans tous les cas ; il ne fait rien si le pont
// Electron est absent, c'est-à-dire dans un navigateur.
import { apiFetch } from './api';

export interface DesktopBridge {
  isDesktop: boolean;
  notify: (payload: { title: string; body?: string; url?: string }) => Promise<boolean>;
  setBadgeCount: (count: number) => Promise<boolean>;
  onNotificationClick: (callback: (url: string) => void) => () => void;
}

interface PendingNotification {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  category: string | null;
  tag: string | null;
  created_at: string;
}

// Assez court pour qu'une alerte reste utile, assez long pour rester
// négligeable : une requête par minute sur une route qui lit un index.
const POLL_INTERVAL_MS = 60 * 1000;

export function desktopBridge(): DesktopBridge | null {
  const bridge = (window as any).archiofficeDesktop;
  return bridge?.isDesktop ? (bridge as DesktopBridge) : null;
}

export function isDesktopClient(): boolean {
  return desktopBridge() !== null;
}

/**
 * Démarre le relevé périodique. Renvoie la fonction d'arrêt.
 * `onNavigate` reçoit la route in-app à ouvrir quand une notification est
 * cliquée — la navigation appartient au routeur React, pas à ce module.
 */
export function startDesktopNotifications(onNavigate: (url: string) => void): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => {};

  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const pending = await apiFetch<PendingNotification[]>('/api/notifications/pending');
      for (const item of pending) {
        await bridge.notify({
          title: item.title,
          body: item.body || undefined,
          url: item.url || undefined,
        });
      }
    } catch {
      // Serveur local pas encore prêt, session expirée, machine en veille :
      // rien à signaler, le prochain tour réessaiera.
    }

    try {
      const { count } = await apiFetch<{ count: number }>('/api/notifications/unread-count');
      await bridge.setBadgeCount(count);
    } catch {
      /* la pastille n'est qu'un confort */
    }
  };

  const timer = setInterval(poll, POLL_INTERVAL_MS);
  // Un relevé immédiat au démarrage : le poste vient peut-être d'être rallumé
  // sur des alertes émises pendant la nuit.
  poll();

  // Revenir sur la fenêtre est le moment où l'on s'attend à voir l'état à
  // jour, sans attendre la fin de l'intervalle en cours.
  const onVisible = () => {
    if (document.visibilityState === 'visible') poll();
  };
  document.addEventListener('visibilitychange', onVisible);

  const unsubscribe = bridge.onNotificationClick(onNavigate);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    unsubscribe();
  };
}
