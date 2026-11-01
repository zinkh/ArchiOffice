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
  checkDriveRemoteVersion: (nodeId) => ipcRenderer.invoke('desktop:drive-check-remote',nodeId),
  refreshDriveDocument: (nodeId) => ipcRenderer.invoke('desktop:drive-refresh-working',nodeId),
  openWindowsDrive: () => ipcRenderer.invoke('desktop:drive-windows-open'),
  enableWindowsDriveEditing: (projectId) => ipcRenderer.invoke('desktop:drive-windows-enable-editing',projectId),
  checkWindowsDriveCatalog: (projectId) => ipcRenderer.invoke('desktop:drive-windows-check-catalog',projectId),
  refreshWindowsDriveCatalog: (projectId,token) => ipcRenderer.invoke('desktop:drive-windows-refresh-catalog',projectId,token),
  openPreviousWindowsDriveProject: (projectId) => ipcRenderer.invoke('desktop:drive-windows-previous',projectId),
  removeWindowsDriveProject: (projectId) => ipcRenderer.invoke('desktop:drive-windows-remove',projectId),
  getWindowsDrivePreview: () => ipcRenderer.invoke('desktop:drive-windows-status'),
  startWindowsDrivePreview: (projectId) => ipcRenderer.invoke('desktop:drive-windows-start',projectId),
  stopWindowsDrivePreview: () => ipcRenderer.invoke('desktop:drive-windows-stop'),
  restartDriveDocument: (nodeId) => ipcRenderer.invoke('desktop:drive-restart-working',nodeId),
  revealDriveCopies: (nodeId) => ipcRenderer.invoke('desktop:drive-reveal-copies',nodeId),
  preserveDriveConflict: (nodeId) => ipcRenderer.invoke('desktop:drive-preserve-conflict',nodeId),
  getDriveDocumentStatuses: (nodeIds) => ipcRenderer.invoke('desktop:drive-document-statuses', nodeIds),
  openDriveDocument: (nodeId) => ipcRenderer.invoke('desktop:drive-working-open', nodeId),
  uploadDriveDocument: (nodeId) => ipcRenderer.invoke('desktop:drive-working-upload', nodeId),
  retryDriveTransfers: () => ipcRenderer.invoke('desktop:drive-retry'),
  getDriveStatus: () => ipcRenderer.invoke('desktop:drive-status'),
  enqueueDriveFile: () => ipcRenderer.invoke('desktop:drive-enqueue'),

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

  /** Les dossiers résolus au premier lancement — voir electron/dataLocation.cjs. */
  getDataLocation: () => ipcRenderer.invoke('desktop:get-data-location'),

  /** Ouvre le dossier de la base ('db') ou des documents ('storage') dans
   *  l'explorateur de fichiers du système. Le chemin réel n'est jamais
   *  transmis au renderer : celui-ci ne fait que désigner LEQUEL ouvrir. */
  openDataFolder: (kind) => ipcRenderer.invoke('desktop:open-data-folder', kind),

  /** Sélectionne un fichier du cabinet dans l'Explorateur. `ref` est sa clé de
   *  stockage { bucket, path }, jamais un chemin de disque : le processus principal
   *  reconstruit le sien (electron/fileAccess.cjs). Renvoie false si introuvable. */
  revealFile: (ref) => ipcRenderer.invoke('desktop:reveal-file', ref),

  /** Ouvre un fichier du cabinet dans son application associée. Renvoie 'ok',
   *  'introuvable', 'type_non_ouvrable' (jamais un programme) ou 'echec'. */
  openFile: (ref) => ipcRenderer.invoke('desktop:open-file', ref),
});
