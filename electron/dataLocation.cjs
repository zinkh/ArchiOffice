// Où vivent les données locales de ce poste : la base de données Postgres
// embarquée, et les fichiers uploadés (devis, plans, photos de chantier...).
// Par défaut, les deux vivaient sous le même dossier imposé par le système
// (electron/pgBootstrap.cjs's dataDir == server/offlineAccount.ts's
// OFFLINE_DATA_DIR). Ce module laisse l'utilisateur choisir un autre
// emplacement pour chacun séparément — typiquement pour mettre les
// documents sur un disque réseau ou un dossier synchronisé (le cabinet peut
// vouloir ses PDF accessibles depuis plusieurs postes), tout en gardant la
// base sur un disque local, où elle doit impérativement rester : un
// Postgres dont le répertoire de données vit dans un dossier synchronisé
// (Drive, Dropbox, OneDrive...) ou sur un partage réseau s'expose à des
// écritures partielles et des verrous de fichiers que ces systèmes ne
// respectent pas comme un disque local — un risque réel de base corrompue,
// pas une simple précaution de façade.
//
// Le choix n'est proposé QU'UNE FOIS, au tout premier lancement, avant que
// la moindre donnée n'existe : le déplacer ensuite reviendrait à migrer un
// Postgres déjà peuplé (arrêt propre, copie intégrale vérifiée, reprise —
// une opération à risque, volontairement hors du périmètre ici). Un poste
// déjà installé avant l'existence de ce choix (repéré par un `pgdata/` déjà
// présent à l'emplacement historique) ne se voit donc jamais posé la
// question : il continue, silencieusement, sur cet emplacement.
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');

/** Le petit fichier-pointeur qui dit où trouver le reste — toujours à
 *  l'emplacement standard du système, jamais lui-même déplaçable : il ne
 *  contient que deux chemins, rien qui grossisse ou mérite d'être ailleurs. */
function configPath(app) {
  return path.join(app.getPath('userData'), 'data-location.json');
}

function defaultDbDataDir(app) {
  return app.getPath('userData');
}

function defaultStorageDataDir(app) {
  return path.join(app.getPath('userData'), 'storage');
}

/** Un `pgdata/` déjà présent à l'emplacement historique signe un poste
 *  installé avant l'existence de ce choix. */
function legacyInstallDetected(app) {
  return fs.existsSync(path.join(defaultDbDataDir(app), 'pgdata'));
}

function readConfig(app) {
  const p = configPath(app);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (parsed?.dbDataDir && parsed?.storageDataDir) return parsed;
  } catch {
    // Fichier corrompu/illisible : traité comme absent, on retombe sur la
    // détection d'installation existante puis, à défaut, sur le choix.
  }
  return null;
}

function writeConfig(app, config) {
  fs.writeFileSync(configPath(app), JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Écrit puis relit un fichier-sonde : un dossier peut exister et sembler
 *  correct (un chemin réseau débranché, par exemple) sans être réellement
 *  inscriptible. Laisse le dossier vide derrière elle, condition qu'initdb
 *  impose au dossier de données Postgres. */
function checkWritable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.archioffice-write-check-${Date.now()}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
}

async function pickFolder(title, defaultPath) {
  const result = await dialog.showOpenDialog({
    title,
    defaultPath,
    buttonLabel: 'Choisir ce dossier',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

/**
 * @param {import('electron').App} app
 * @param {(msg: string) => void} [log]
 * @returns {Promise<{ dbDataDir: string, storageDataDir: string }>}
 */
async function resolveDataLocation(app, log = console.log) {
  const existing = readConfig(app);
  if (existing) return existing;

  if (legacyInstallDetected(app)) {
    const config = { dbDataDir: defaultDbDataDir(app), storageDataDir: defaultStorageDataDir(app) };
    writeConfig(app, config);
    log('[dataLocation] Poste déjà installé — emplacement historique conservé, sans le proposer.');
    return config;
  }

  const { response: choice } = await dialog.showMessageBox({
    type: 'question',
    title: 'Emplacement des données',
    message: "Où souhaitez-vous stocker les données d'ArchiOffice sur ce poste ?",
    detail:
      "Par défaut, tout est stocké dans le dossier standard de l'application.\n\n" +
      "Vous pouvez choisir un autre emplacement pour vos documents (devis, plans, photos de chantier), y compris un disque réseau ou un dossier synchronisé (Drive, Dropbox, OneDrive...).\n\n" +
      "La base de données, elle, doit impérativement rester sur un disque local : ne la placez jamais dans un dossier synchronisé, au risque de la corrompre.\n\n" +
      "Ce choix ne sera proposé qu'une seule fois, maintenant.",
    buttons: ['Emplacement par défaut', 'Choisir un emplacement…'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  let dbDataDir = defaultDbDataDir(app);
  let storageDataDir = defaultStorageDataDir(app);

  if (choice === 1) {
    const chosenDb = await pickFolder('Dossier de la base de données — disque local uniquement', dbDataDir);
    if (chosenDb) dbDataDir = chosenDb;

    const chosenStorage = await pickFolder('Dossier des documents (devis, plans, photos…)', storageDataDir);
    if (chosenStorage) storageDataDir = chosenStorage;
  }

  try {
    checkWritable(dbDataDir);
    checkWritable(storageDataDir);
  } catch (err) {
    dialog.showErrorBox(
      'Emplacement inaccessible',
      `Impossible d'écrire dans l'un des dossiers choisis :\n${err.message}\n\nL'emplacement par défaut sera utilisé à la place. Vous pourrez réessayer en réinstallant l'application.`
    );
    dbDataDir = defaultDbDataDir(app);
    storageDataDir = defaultStorageDataDir(app);
  }

  const config = { dbDataDir, storageDataDir };
  writeConfig(app, config);
  log(`[dataLocation] Base de données : ${dbDataDir}`);
  log(`[dataLocation] Documents : ${storageDataDir}`);
  return config;
}

module.exports = { resolveDataLocation, configPath, defaultDbDataDir, defaultStorageDataDir };
