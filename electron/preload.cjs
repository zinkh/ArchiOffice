// Pont IPC du client de bureau.
//
// Chromium embarqué dans Electron n'est enregistré auprès d'aucun service de
// push (FCM et consorts sont liés à un navigateur, pas à une application) :
// le Web Push de la PWA ne peut donc pas fonctionner ici. Le renderer va
// chercher ses notifications par /api/notifications/pending
// (src/lib/desktopNotifications.ts) et les fait afficher par le processus
// principal via ce pont, qui passe par les notifications natives du système.
//
// Rien d'autre n'est exposé : contextIsolation reste actif et le renderer
// n'obtient ni require, ni accès au système de fichiers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('archiofficeDesktop', {
  isDesktop: true,

  /** Affiche une notification système. { title, body, url } */
  notify: (payload) => ipcRenderer.invoke('desktop:notify', payload),

  /** Pastille de comptage sur l'icône du dock / de la barre des tâches. */
  setBadgeCount: (count) => ipcRenderer.invoke('desktop:badge', count),

  /**
   * Prévient le renderer qu'une notification a été cliquée, avec la route
   * in-app à ouvrir. Renvoie une fonction de désinscription.
   */
  onNotificationClick: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('desktop:notification-click', listener);
    return () => ipcRenderer.removeListener('desktop:notification-click', listener);
  },
});
