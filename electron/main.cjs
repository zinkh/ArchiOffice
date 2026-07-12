const { app, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startOfflineDataStack } = require('./pgBootstrap.cjs');

// package.json's "name" is the npm workspace root ("react-example", a
// leftover scaffold name) — Electron otherwise uses it verbatim for both the
// title bar and the default userData path (%APPDATA%\react-example\...), so
// this must be set explicitly, before anything calls app.getPath('userData').
app.setName('ArchiOffice Client');

const PORT = process.env.PORT || '3130';
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

// Public, safe to embed — the anon/publishable key + URL, same trust model
// as the real web app's own client-side bundle (Row Level Security applies
// to every cloud-link request; never a service-role key, see
// server/cloudSyncClient.ts's own comment for why that's a hard line). Used
// only for the optional "log into your existing cloud account" first-run
// flow — the app's normal data operations never touch this, they go
// through SUPABASE_URL (the local loopback, below) as always.
const CLOUD_SUPABASE_URL = 'https://tkhcpkwakvqsnmpgfkjp.supabase.co';
const CLOUD_SUPABASE_ANON_KEY = 'sb_publishable_vajyn6z5pbHzrCbK9IKdOQ_zxKFU4ul';

let serverProcess = null;
let mainWindow = null;
let offlineStack = null;
let logStream = null;
let logFilePath = null;

// Launched from the Start Menu / a desktop shortcut, this app has no visible
// console — without this, any failure during startup (Postgres/PostgREST not
// coming up, etc.) is completely invisible. Every diagnostic message below
// goes through log() instead of console.* so it lands in a file the user can
// actually find and share.
function initLogging() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, 'main.log');
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  return logFilePath;
}

function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(formatArg).join(' ')}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

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

// Bridges the spawned server process's server/ipcCrypto.ts requests to
// Electron's safeStorage (main-process-only API, DPAPI-backed on Windows —
// unreachable from the server process itself, which runs as a plain Node
// process via ELECTRON_RUN_AS_NODE). Ciphertext travels as base64 strings
// over the IPC channel (Buffers don't survive Node's structured-clone IPC
// serialization cleanly).
function handleIpcMessage(child, msg) {
  if (!msg || (msg.type !== 'safeStorage:encrypt' && msg.type !== 'safeStorage:decrypt')) return;
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Le chiffrement sécurisé du système d'exploitation n'est pas disponible sur cette machine.");
    }
    let value;
    if (msg.type === 'safeStorage:encrypt') {
      value = safeStorage.encryptString(msg.value).toString('base64');
      child.send({ type: 'safeStorage:encrypt:result', requestId: msg.requestId, value });
    } else {
      value = safeStorage.decryptString(Buffer.from(msg.value, 'base64'));
      child.send({ type: 'safeStorage:decrypt:result', requestId: msg.requestId, value });
    }
  } catch (err) {
    const responseType = msg.type === 'safeStorage:encrypt' ? 'safeStorage:encrypt:result' : 'safeStorage:decrypt:result';
    child.send({ type: responseType, requestId: msg.requestId, error: err.message });
  }
}

async function startServer() {
  const { cwd, serverEntry } = resolvePaths();
  const dataDir = app.getPath('userData');
  const resourcesDir = app.isPackaged ? process.resourcesPath : null;

  log('Démarrage de la pile de données locale (Postgres + PostgREST)...');
  offlineStack = await startOfflineDataStack(dataDir, log, resourcesDir);
  log('Pile de données locale prête, lancement du serveur applicatif...');

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
      OFFLINE_PG_URL: offlineStack.pgUrl,
      SUPABASE_URL: `http://127.0.0.1:${PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: crypto.randomBytes(24).toString('hex'),
      CLOUD_SUPABASE_URL,
      CLOUD_SUPABASE_ANON_KEY,
    },
    // 'ipc' gives the spawned process process.send()/process.on('message')
    // to reach safeStorage (main-process-only, see the message handler
    // below) — needed to encrypt the cloud-link refresh token before it's
    // ever written to disk (server/ipcCrypto.ts, server/cloudLinkState.ts).
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  serverProcess.stdout.on('data', (d) => log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => log('[server:err]', d.toString().trim()));
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`Le serveur local s'est arrêté de façon inattendue (code ${code}).`);
    }
  });
  serverProcess.on('error', (err) => log('Échec du lancement du serveur local :', err));
  serverProcess.on('message', (msg) => handleIpcMessage(serverProcess, msg));

  // Generous timeout: first launch also initialises the local Postgres and
  // applies the schema (see pgBootstrap.cjs), which takes longer than a warm start.
  await waitForServer(HEALTH_URL, 90000);
  log('Serveur applicatif prêt.');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    autoHideMenuBar: true,
    title: 'ArchiOffice Client',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // The loaded page's <title> ("ArchiOffice - Architectural Office
  // Management", shared with the cloud web build's browser tab) would
  // otherwise overwrite this window's title after every navigation.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  try {
    await serverStartPromise;
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  } catch (err) {
    const message = [
      "ArchiOffice n'a pas pu démarrer :",
      '',
      err.message,
      '',
      'Journal détaillé :',
      logFilePath || '(indisponible)',
    ].join('\n');
    await mainWindow.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent(message)}`);
  }
}

let serverStartPromise = null;

app.whenReady().then(() => {
  initLogging();
  log('ArchiOffice démarre — journal :', logFilePath);
  serverStartPromise = startServer().catch((err) => {
    log('Échec du démarrage :', err);
    throw err;
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
