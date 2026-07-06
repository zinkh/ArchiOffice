const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startOfflineDataStack } = require('./pgBootstrap.cjs');

const PORT = process.env.PORT || '3130';
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

let serverProcess = null;
let mainWindow = null;
let offlineStack = null;

function resolvePaths() {
  if (app.isPackaged) {
    const resourcesDir = process.resourcesPath;
    return {
      cwd: resourcesDir,
      serverEntry: path.join(resourcesDir, 'dist-server', 'server.cjs'),
    };
  }
  const repoRoot = path.join(__dirname, '..');
  return {
    cwd: repoRoot,
    serverEntry: path.join(repoRoot, 'dist-server', 'server.cjs'),
  };
}

async function startServer() {
  const { cwd, serverEntry } = resolvePaths();
  const dataDir = app.getPath('userData');

  offlineStack = await startOfflineDataStack(dataDir, console.log);

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd,
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      OFFLINE_MODE: 'true',
      OFFLINE_DATA_DIR: dataDir,
      OFFLINE_POSTGREST_URL: offlineStack.postgrestUrl,
      SUPABASE_URL: `http://127.0.0.1:${PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: crypto.randomBytes(24).toString('hex'),
    },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[ArchiOffice] Le serveur local s'est arrêté de façon inattendue (code ${code}).`);
    }
  });
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Le serveur local n'a pas démarré à temps."));
          return;
        }
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  try {
    // Generous timeout: first launch also initialises the local Postgres and
    // applies the schema (see pgBootstrap.cjs), which takes longer than a warm start.
    await waitForServer(HEALTH_URL, 60000);
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  } catch (err) {
    await mainWindow.loadURL(
      `data:text/plain,${encodeURIComponent("ArchiOffice n'a pas pu démarrer : " + err.message)}`,
    );
  }
}

app.whenReady().then(() => {
  startServer().catch((err) => {
    console.error('[ArchiOffice] Échec du démarrage de la pile de données locale :', err);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
  if (offlineStack) offlineStack.stop().catch(() => {});
});
