// Clés d'API du poste de travail.
//
// Le serveur embarqué est lancé avec cwd = dossier des ressources de
// l'application installée : aucun fichier .env n'y existe et une application
// graphique n'hérite pas des variables d'un terminal. Sans ce relais, les
// clés IA (Mistral, Gemini, Anthropic, Nomic) sont donc toujours absentes et
// l'application répond « API non configurée ».
//
// Le fichier `.env` placé dans le dossier de données de l'application
// (userData) est relu à chaque démarrage. Seules les variables listées
// ci-dessous sont transmises : les variables qui pilotent la pile locale
// (PORT, SUPABASE_*, OFFLINE_*) ne peuvent pas être surchargées par ce fichier.
const fs = require('fs');
const path = require('path');

const ALLOWED_KEYS = new Set([
  'MISTRAL_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'NOMIC_API_KEY',
  'NOMIC_API_URL',
  'DOCUMENT_PARSER',
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_PRICE_MARKUP',
  'GEORISQUES_TOKEN',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
]);

function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[match[1]] = value;
  }
  return out;
}

function loadUserEnv(userDataDir, log = () => {}) {
  const file = path.join(userDataDir, '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`Lecture de ${file} impossible :`, err.message);
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (ALLOWED_KEYS.has(key) && value) result[key] = value;
  }
  log(`Clés chargées depuis ${file} : ${Object.keys(result).join(', ') || 'aucune'}`);
  return result;
}

module.exports = { loadUserEnv, parseEnv, ALLOWED_KEYS };
