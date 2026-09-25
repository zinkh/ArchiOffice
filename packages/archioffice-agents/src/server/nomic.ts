// ── Client Nomic Platform (Parse / Extract) ─────────────────────────────────
// Nomic n'expose pas d'API de chat : ses modèles propres servent à LIRE des
// documents techniques (plans, CCTP, notices) et à en tirer des données
// structurées. C'est donc un moteur de lecture et d'extraction, pas un
// quatrième fournisseur dans llm/ — il ne passe jamais par LlmProvider.
//
// Protocole relevé sur le SDK officiel (github.com/nomic-ai/nomic,
// nomic/client.py), sans dépendance ajoutée :
//   1. POST /v1/upload   {files:[{id,size,content_type}]} → upload_url
//      (URL S3 présignée) + nomic_url (référence nomic://...) ;
//   2. PUT  upload_url   octets bruts, chiffrement côté serveur imposé ;
//   3. POST /v1/parse    {file_url, options}                → task_id
//      POST /v1/extract  {file_urls, extraction_schema, system_prompt} → task_id
//   4. GET  /v1/status/:task_id jusqu'à COMPLETED/FAILED, puis GET result_url
//      (présignée, sans jeton).
// Une clé d'API Nomic commence par « nk- » et se pose en Bearer telle quelle.

const DEFAULT_BASE_URL = 'https://api-atlas.nomic.ai';
const POLL_INTERVAL_MS = 1500;
/** Chaque appel HTTP isolé : au-delà, le fournisseur est considéré injoignable. */
const REQUEST_TIMEOUT_MS = 30_000;

export class NomicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NomicError';
  }
}

export function isNomicConfigured(): boolean {
  return !!process.env.NOMIC_API_KEY;
}

function baseUrl(): string {
  return (process.env.NOMIC_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const key = process.env.NOMIC_API_KEY;
  if (!key) throw new NomicError('NOMIC_API_KEY non configurée.');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function nomicFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 500);
    throw new NomicError(`Nomic ${res.status} sur ${new URL(url).pathname}${body ? ` : ${body}` : ''}`);
  }
  return res;
}

// Types que la plateforme accepte (PDF, Office, images) — le SDK refuse tout
// le reste avant même l'envoi. Un fichier hors de cette liste reste sur le
// moteur local.
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
};

export function nomicContentType(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [ext, mime] of Object.entries(CONTENT_TYPES)) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

/** Dépose un fichier sur la plateforme et renvoie sa référence nomic://. */
export async function nomicUploadFile(filename: string, buffer: Buffer): Promise<string> {
  const contentType = nomicContentType(filename);
  if (!contentType) throw new NomicError(`Format non pris en charge par Nomic : ${filename}`);

  const res = await nomicFetch(`${baseUrl()}/v1/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ files: [{ id: filename, size: buffer.length, content_type: contentType }] }),
  });
  const json: any = await res.json();
  const file = json?.files?.[0];
  if (!file?.upload_url || !file?.nomic_url) throw new NomicError('Réponse de dépôt Nomic inattendue.');

  await nomicFetch(file.upload_url, {
    method: 'PUT',
    headers: { 'x-amz-server-side-encryption': 'AES256' },
    body: new Uint8Array(buffer),
  });
  return String(file.nomic_url);
}

/** Attend la fin d'une tâche et renvoie le JSON de son résultat. */
async function waitForTask(taskId: string, deadline: number): Promise<any> {
  for (;;) {
    const res = await nomicFetch(`${baseUrl()}/v1/status/${encodeURIComponent(taskId)}`, { headers: authHeaders() });
    const status: any = await res.json();
    if (status?.status === 'COMPLETED') {
      if (!status.result_url) return status.result ?? null;
      const result = await nomicFetch(String(status.result_url));
      return result.json();
    }
    if (status?.status === 'FAILED') throw new NomicError(`Tâche Nomic en échec : ${status.error || 'raison inconnue'}`);
    if (Date.now() + POLL_INTERVAL_MS > deadline) throw new NomicError('Nomic n\'a pas terminé dans le délai imparti.');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function startTask(path: string, payload: unknown): Promise<string> {
  const res = await nomicFetch(`${baseUrl()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json: any = await res.json();
  if (!json?.task_id) throw new NomicError(`Réponse Nomic sans task_id sur ${path}.`);
  return String(json.task_id);
}

/**
 * Lit un document (plan, CCTP, notice...) et en rend le texte. Mode
 * « hybrid » : couche texte quand elle existe, OCR sur les images
 * incrustées, modèle vision pour les tableaux — exactement le cas d'un plan
 * PDF où cartouche et nomenclatures sont souvent vectorisés ou scannés.
 * OCR « latin » : couvre le français (accents compris), « en » ne le fait pas.
 */
export async function nomicParseDocument(filename: string, buffer: Buffer, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const fileUrl = await nomicUploadFile(filename, buffer);
  const taskId = await startTask('/v1/parse', {
    file_url: fileUrl,
    options: { content_extraction_mode: 'hybrid', ocr_language: 'latin' },
  });
  return nomicParseResultToText(await waitForTask(taskId, deadline));
}

/**
 * Extraction structurée sur un ou plusieurs fichiers déjà déposés : Nomic
 * lit les documents et remplit le schéma JSON fourni. `system_prompt` oriente
 * l'extraction (vocabulaire, niveau de détail attendu).
 */
export async function nomicExtract(fileUrls: string[], schema: Record<string, unknown>, systemPrompt: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  const taskId = await startTask('/v1/extract', { file_urls: fileUrls, extraction_schema: schema, system_prompt: systemPrompt });
  const raw = await waitForTask(taskId, deadline);
  // Le SDK retire status/error du JSON de résultat ; la donnée utile peut être
  // à la racine ou sous `result` selon la version de l'API.
  return raw && typeof raw === 'object' && 'result' in raw && raw.result && typeof raw.result === 'object' ? raw.result : raw;
}

const TEXT_KEYS = ['markdown', 'text', 'content'] as const;

/**
 * Aplatit le JSON rendu par /v1/parse en texte lisible. La forme exacte
 * (pages, blocs, tableaux) n'est pas documentée publiquement : on parcourt
 * l'arbre dans l'ordre et on retient, pour chaque nœud, le premier champ
 * textuel parmi markdown/text/content — sans redescendre dans ce nœud, pour
 * ne pas répéter un bloc dont la page a déjà rendu le texte complet.
 */
export function nomicParseResultToText(result: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) { parts.push(value.trim()); return; }
    }
    Object.values(obj).forEach(visit);
  };
  visit(result);
  return parts.join('\n\n');
}
