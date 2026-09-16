// Barre de menus de la fenêtre principale — absente jusqu'ici (autoHideMenuBar
// masquait la barre native par défaut, sans qu'aucun menu ne soit jamais posé).
// Construite une seule fois au démarrage (voir main.cjs) et jamais reconstruite :
// les callbacks lisent mainWindow/logFilePath via des fonctions plutôt que des
// valeurs figées, puisque ces deux-là n'existent pas encore au moment où le
// menu est créé (avant createSplashWindow()/showMainWindow()).
const { app, Menu, dialog, shell } = require('electron');

function aboutDetail() {
  return [
    `Version ${app.getVersion()}`,
    '',
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node.js ${process.versions.node}`,
  ].join('\n');
}

function showAboutDialog(getMainWindow) {
  const win = getMainWindow();
  const options = {
    type: 'info',
    title: "À propos d'ArchiOffice",
    message: 'ArchiOffice Client',
    detail: aboutDetail(),
    buttons: ['Fermer'],
    noLink: true,
  };
  // Sans fenêtre parente (menu construit avant showMainWindow()), la boîte de
  // dialogue reste simplement non modale plutôt que d'échouer.
  if (win && !win.isDestroyed()) dialog.showMessageBox(win, options);
  else dialog.showMessageBox(options);
}

function checkForUpdates(log) {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Mises à jour',
      message: 'Vérification indisponible',
      detail: "La vérification des mises à jour n'est disponible que sur une version installée d'ArchiOffice.",
    });
    return;
  }
  // Chargé paresseusement : electron-updater est déjà initialisé par
  // initAutoUpdate() dans main.cjs, ce bouton ne fait que rejouer le même
  // appel à la demande plutôt que d'attendre le prochain lancement.
  const { autoUpdater } = require('electron-updater');
  autoUpdater
    .checkForUpdates()
    .catch((err) => log('[update] checkForUpdates (menu) a échoué :', err?.message || err));
}

/** getMainWindow/getLogFilePath : fonctions, pas des valeurs — le menu est
 *  construit avant que la fenêtre principale et le fichier de journal n'existent. */
function createAppMenu({ getMainWindow, getLogFilePath, log }) {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: "À propos d'ArchiOffice", click: () => showAboutDialog(getMainWindow) },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quitter' },
            ],
          },
        ]
      : []),
    {
      label: 'Fichier',
      submenu: [isMac ? { role: 'close', label: 'Fermer' } : { role: 'quit', label: 'Quitter' }],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'forceReload', label: 'Forcer le rechargement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Vérifier les mises à jour', click: () => checkForUpdates(log) },
        {
          label: 'Ouvrir le journal',
          click: () => {
            const p = getLogFilePath();
            if (p) shell.openPath(p).catch((err) => log('[menu] Échec ouverture journal :', err));
          },
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: "À propos d'ArchiOffice", click: () => showAboutDialog(getMainWindow) }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { createAppMenu };
