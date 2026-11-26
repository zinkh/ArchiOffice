// Lecture des métadonnées embarquées dans un fichier déposé (PDF, Word, Excel, PowerPoint, OpenDocument) pour
// proposer un émetteur. Aucune dépendance à React ni au réseau : la page GED appelle ces fonctions sur les octets
// du fichier. Tout est facultatif : un fichier sans métadonnées, chiffré ou illisible rend simplement `null`.
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

export interface DocumentMetadata {
  /** Auteur déclaré (PDF « Author », Office `dc:creator`). */
  author: string;
  /** Société déclarée (Office `Company`). */
  organization: string;
  /** Dernière personne à avoir enregistré le fichier (Office `lastModifiedBy`). */
  lastModifiedBy: string;
  /** Logiciel producteur (PDF « Creator »). Jamais proposé comme émetteur. */
  software: string;
  title: string;
  /** Date de création au format ISO, ou ''. */
  createdAt: string;
}

export const EMPTY_METADATA: DocumentMetadata = { author: '', organization: '', lastModifiedBy: '', software: '', title: '', createdAt: '' };

/** Plafond de lecture : au-delà, l'analyse d'un PDF bloquerait l'onglet pour un gain mince. */
export const MAX_METADATA_BYTES = 60 * 1024 * 1024;

// Valeurs par défaut posées par les logiciels : elles ne désignent aucun émetteur.
const GENERIC = new Set([
  'admin', 'administrateur', 'administrator', 'user', 'utilisateur', 'unknown', 'inconnu', 'author', 'auteur',
  'owner', 'proprietaire', 'pc', 'microsoft', 'microsoft office user', 'windows user', 'default', 'anonymous', 'anonyme',
  'autodesk', 'autocad', 'acrobat', 'adobe',
]);

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function isGenericName(value: string): boolean {
  const v = fold(value);
  return !v || v.length < 2 || GENERIC.has(v) || /^(microsoft|adobe|autodesk|libreoffice|openoffice|google|pdf|word|excel)\b/.test(v);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? decodeXml(m[1]) : '';
}

/** Émetteurs plausibles, du plus fiable au moins fiable : société, auteur, dernier auteur. Sans doublons ni valeurs génériques. */
export function emetteurCandidates(meta: DocumentMetadata | null): string[] {
  if (!meta) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [meta.organization, meta.author, meta.lastModifiedBy]) {
    const value = v.trim();
    const key = fold(value);
    if (isGenericName(value) || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function readOffice(data: Uint8Array): Promise<DocumentMetadata | null> {
  const zip = await JSZip.loadAsync(data);
  const core = await zip.file('docProps/core.xml')?.async('string');
  const app = await zip.file('docProps/app.xml')?.async('string');
  // OpenDocument : meta.xml (dc:creator, meta:initial-creator, dc:title, meta:creation-date).
  const odf = await zip.file('meta.xml')?.async('string');
  if (!core && !app && !odf) return null;
  const meta: DocumentMetadata = { ...EMPTY_METADATA };
  if (core) {
    meta.author = xmlTag(core, 'dc:creator');
    meta.lastModifiedBy = xmlTag(core, 'cp:lastModifiedBy');
    meta.title = xmlTag(core, 'dc:title');
    meta.createdAt = xmlTag(core, 'dcterms:created');
  }
  if (app) {
    meta.organization = xmlTag(app, 'Company');
    meta.software = xmlTag(app, 'Application');
  }
  if (odf) {
    meta.author = meta.author || xmlTag(odf, 'meta:initial-creator');
    meta.lastModifiedBy = meta.lastModifiedBy || xmlTag(odf, 'dc:creator');
    meta.title = meta.title || xmlTag(odf, 'dc:title');
    meta.createdAt = meta.createdAt || xmlTag(odf, 'meta:creation-date');
    meta.software = meta.software || xmlTag(odf, 'meta:generator');
  }
  return meta;
}

async function readPdf(data: Uint8Array): Promise<DocumentMetadata> {
  const pdf = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  return {
    ...EMPTY_METADATA,
    author: pdf.getAuthor() || '',
    software: pdf.getCreator() || pdf.getProducer() || '',
    title: pdf.getTitle() || '',
    createdAt: pdf.getCreationDate()?.toISOString() || '',
  };
}

const OFFICE_EXT = /\.(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|odt|ods|odp)$/i;

/** True quand on sait lire les métadonnées de ce type de fichier. */
export function canReadMetadata(fileName: string): boolean {
  return /\.pdf$/i.test(fileName) || OFFICE_EXT.test(fileName);
}

/** Métadonnées d'un fichier, ou `null` (type non pris en charge, fichier vide, chiffré ou illisible). Ne lève jamais. */
export async function readDocumentMetadata(data: ArrayBuffer | Uint8Array, fileName: string): Promise<DocumentMetadata | null> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_METADATA_BYTES || !canReadMetadata(fileName)) return null;
  try {
    return /\.pdf$/i.test(fileName) ? await readPdf(bytes) : await readOffice(bytes);
  } catch {
    return null;
  }
}
