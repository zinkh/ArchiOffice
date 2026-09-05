// Branche les deux canaux de notification système une fois la personne
// authentifiée : le Web Push pour la PWA, le relevé périodique pour le client
// Electron (voir server/push.ts pour la raison de cette dualité).
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startDesktopNotifications, isDesktopClient } from '../lib/desktopNotifications';
import { syncPushSubscription } from '../lib/push';

export function useNotificationBridge(enabled: boolean) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;

    if (isDesktopClient()) {
      // Le clic sur une notification native passe par le routeur plutôt que
      // par window.location : recharger toute l'application ferait perdre
      // l'état en cours (un CCTP en cours d'édition, par exemple).
      return startDesktopNotifications(url => navigate(url));
    }

    // Navigateur : l'abonnement lui-même est créé depuis les réglages, sur un
    // geste de l'utilisateur. Ici on se contente de réaligner le serveur sur
    // l'endpoint réellement en vigueur, qui peut avoir changé sans que
    // personne ne l'ait demandé.
    syncPushSubscription();
  }, [enabled, navigate]);
}
