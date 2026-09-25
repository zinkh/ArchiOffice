// ── Moteur de lecture des documents : local ou Nomic ────────────────────────
// Deux moteurs pour la même question, « quel est le texte de ce fichier ? » :
//   - local : pdf-parse (couche texte) + mammoth (DOCX), Tesseract en repli
//     sur un scan (ocr.ts). Gratuit, mais aveugle sur un plan : cartouche,
//     nomenclatures et annotations y sont souvent du vectoriel ou de l'image ;
//   - nomic : Nomic Parse (nomic.ts), des modèles entraînés sur des pièces
//     d'ingénierie, facturés à la page sur le compte Nomic de l'opérateur.
//
// Réglé par l'opérateur depuis /admin, stocké dans platform_settings sous la
// clé 'document_parser', même mécanique et même cache que le fournisseur IA
// (llm/config.ts). Priorité : réglage /admin → DOCUMENT_PARSER → local.
//
// Nomic en échec (réseau, quota, format refusé) retombe sur le moteur local
// plutôt que de rendre le document illisible : ici la lecture est un moyen,
// pas une donnée qui atterrirait au mauvais endroit — à la différence du
// stockage externe, où un repli silencieux remplirait le quota qu'on évite.
import { isNomicConfigured, nomicContentType, nomicParseDocument } from './nomic.js';

export type DocumentParserEngine = 'local' | 'nomic';
export const DOCUMENT_PARSER_ENGINES: DocumentParserEngine[] = ['local', 'nomic'];

const SETTING_KEY = 'document_parser';
const CACHE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;
/** Budget de Nomic pour un document, sous les enveloppes des appelants
 *  (45 s pour extractDocumentText, 60 s pour une pièce jointe d'agent) pour
 *  laisser au moteur local le temps de prendre le relais. */
export const NOMIC_PARSE_TIMEOUT_MS = 35_000;

// Les extracteurs (extractDocumentText...) ne reçoivent pas de client
// Supabase : l'hôte dépose le sien au démarrage, comme setExternalFileReader.
// Sans lui, le réglage stocké n'est pas lu et seul DOCUMENT_PARSER compte.
let settingsClient: any = null;
let cached: { value: DocumentParserEngine | null; at: number } | null = null;

export function setDocumentParserSettingsClient(supabaseAdmin: any): void {
  settingsClient = supabaseAdmin;
  cached = null;
}

export function invalidateDocumentParserCache(): void {
  cached = null;
}

function isEngine(value: unknown): value is DocumentParserEngine {
  return typeof value === 'string' && (DOCUMENT_PARSER_ENGINES as string[]).includes(value);
}

async function readStoredEngine(): Promise<DocumentParserEngine | null> {
  if (!settingsClient) return null;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: DocumentParserEngine | null = null;
  try {
    const { data, error } = await settingsClient
      .from('platform_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    if (error) console.warn(`[document parser] platform_settings illisible, repli sur l'environnement : ${error.message}`);
    else if (isEngine(data?.value?.engine)) value = data.value.engine;
  } catch (e: any) {
    console.warn(`[document parser] lecture du réglage impossible : ${e?.message}`);
  }
  cached = { value, at: Date.now() };
  return value;
}

export async function describeDocumentParser(): Promise<{ engine: DocumentParserEngine; source: 'database' | 'environment' | 'default' }> {
  const stored = await readStoredEngine();
  if (stored) return { engine: stored, source: 'database' };
  const env = process.env.DOCUMENT_PARSER;
  if (isEngine(env)) return { engine: env, source: 'environment' };
  return { engine: 'local', source: 'default' };
}

export async function setDocumentParserEngine(supabaseAdmin: any, engine: DocumentParserEngine, updatedBy?: string): Promise<void> {
  const { error } = await supabaseAdmin.from('platform_settings').upsert(
    { key: SETTING_KEY, value: { engine }, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null },
    { onConflict: 'key' },
  );
  if (error) throw error;
  cached = null;
}

/** Moteur réellement utilisable pour ce fichier : Nomic seulement s'il est
 *  choisi, que sa clé est présente et que le format lui est acceptable. */
export async function shouldUseNomic(filename: string): Promise<boolean> {
  if (!isNomicConfigured() || !nomicContentType(filename)) return false;
  return (await describeDocumentParser()).engine === 'nomic';
}

/**
 * Lit un fichier avec Nomic si c'est le moteur actif. Rend null quand le
 * moteur local doit s'en charger — Nomic non retenu, ou en échec — pour que
 * l'appelant poursuive sur son chemin habituel sans autre branche.
 */
export async function parseWithActiveEngine(filename: string, buffer: Buffer): Promise<string | null> {
  if (!(await shouldUseNomic(filename))) return null;
  const start = Date.now();
  try {
    const text = await nomicParseDocument(filename, buffer, NOMIC_PARSE_TIMEOUT_MS);
    console.log(`[document parser] "${filename}" lu par Nomic en ${Date.now() - start} ms (${text.length} caractères)`);
    return text.trim() ? text : null;
  } catch (e: any) {
    console.warn(`[document parser] Nomic en échec sur "${filename}", repli sur le moteur local : ${e?.message}`);
    return null;
  }
}
