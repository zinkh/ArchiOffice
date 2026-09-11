// Pont IPC de l'écran de démarrage (electron/splash.html). Séparé du pont
// principal (electron/preload.cjs) à dessein : cette fenêtre n'a besoin que
// de recevoir la liste des étapes puis leurs mises à jour, jamais d'appeler
// quoi que ce soit dans l'autre sens — pas question de lui exposer le pont
// complet de la fenêtre principale (notifications, emplacement des
// données...) pour un écran qui disparaît après quelques secondes.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('archiofficeSplash', {
  /** payload: { appName, tagline, steps: [{ id, label }] } — envoyé une fois,
   *  dès que cette page a fini de charger. */
  onInit: (callback) => ipcRenderer.on('splash:init', (_e, payload) => callback(payload)),

  /** payload: { id, status: 'active'|'done'|'error', detail?: string } */
  onUpdate: (callback) => ipcRenderer.on('splash:update', (_e, payload) => callback(payload)),

  /** payload: { message, logPath } — démarrage définitivement en échec. */
  onFatal: (callback) => ipcRenderer.on('splash:fatal', (_e, payload) => callback(payload)),

  quit: () => ipcRenderer.invoke('splash:quit'),
});
