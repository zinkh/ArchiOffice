// Contrôle des OCTETS d'un fichier déposé sur le portail des offres.
//
// Le nom et le type MIME envoyés par le navigateur ne valent rien : un
// exécutable peut s'appeler « devis.pdf ». Seul le contenu fait foi. Les
// formats admis (PDF, Word, Excel, ODS, ODT) sont tous inspectables sans rien
// décompresser : un PDF se reconnaît à son en-tête, les quatre autres sont des
// archives ZIP dont l'annuaire central liste les entrées. On vérifie qu'elles
// correspondent bien au format annoncé et qu'aucune ne porte de macro ni de
// programme.
//
// Aucun format de plan (DWG, DXF) n'est accepté, ni de format à macros (docm,
// xlsm) ni d'ancien binaire (doc, xls) : voir src/lib/consultationDepot.ts.
import { extensionDe, type DepotExtension } from '../../src/lib/consultationDepot';
import { looksDangerous } from '../documentUpload';

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_ENTREES_ZIP = 5000;

export const MIME_PAR_EXTENSION: Record<DepotExtension, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
};

/** Entrées qui n'ont rien à faire dans un document bureautique. */
const ENTREE_ACTIVE = /(^|\/)(vbaProject\.bin|macrosheets\/|Basic\/|Scripts\/)|\.(exe|dll|com|scr|bat|cmd|vbs|js|jar|msi|ps1|sh)$/i;

/** Noms des entrées de l'annuaire central d'une archive ZIP, ou null si elle est illisible ou hors périmètre (ZIP64). */
export function listerEntreesZip(buf: Buffer): string[] | null {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
  if (total > MAX_ENTREES_ZIP || cdOffset + cdSize > buf.length) return null;

  const noms: string[] = [];
  let pos = cdOffset;
  for (let n = 0; n < total; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > buf.length) return null;
    noms.push(buf.toString('utf8', pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return noms;
}

export type VerificationOctets = { ok: true; mime: string } | { ok: false; raison: string };

const refus = (nom: string, detail: string): VerificationOctets => ({
  ok: false,
  raison: `« ${nom} » : ${detail}`,
});

export function verifierOctets(nom: string, buf: Buffer): VerificationOctets {
  const ext = extensionDe(nom) as DepotExtension;
  if (!(ext in MIME_PAR_EXTENSION)) return refus(nom, 'format non accepté (PDF, Word, Excel, ODS ou ODT).');
  if (buf.length === 0) return refus(nom, 'le fichier est vide.');
  if (looksDangerous(buf)) return refus(nom, 'contenu non autorisé.');

  if (ext === 'pdf') {
    const tete = buf.subarray(0, 1024).toString('latin1');
    if (!tete.includes('%PDF-')) return refus(nom, "ce n'est pas un PDF valide.");
    if (buf.includes('/Launch')) return refus(nom, 'ce PDF déclenche une action au lancement et ne peut pas être accepté.');
    return { ok: true, mime: MIME_PAR_EXTENSION.pdf };
  }

  if (!buf.subarray(0, 4).equals(ZIP_LOCAL_HEADER)) {
    return refus(nom, `ce n'est pas un fichier .${ext} valide (les anciens formats .doc et .xls ne sont pas acceptés).`);
  }
  const entrees = listerEntreesZip(buf);
  if (!entrees) return refus(nom, 'archive illisible.');
  if (entrees.some(e => ENTREE_ACTIVE.test(e))) {
    return refus(nom, 'le fichier contient des macros ou des programmes et ne peut pas être accepté.');
  }

  const a = (nomEntree: string) => entrees.includes(nomEntree);
  const commence = (prefixe: string) => entrees.some(e => e.startsWith(prefixe));

  if (ext === 'docx' && !(a('[Content_Types].xml') && commence('word/'))) {
    return refus(nom, "ce n'est pas un document Word (.docx) valide.");
  }
  if (ext === 'xlsx' && !(a('[Content_Types].xml') && commence('xl/'))) {
    return refus(nom, "ce n'est pas un classeur Excel (.xlsx) valide.");
  }
  if (ext === 'ods' || ext === 'odt') {
    if (!(a('mimetype') && a('content.xml'))) return refus(nom, `ce n'est pas un document .${ext} valide.`);
    // Le type est écrit en clair juste après l'en-tête de la première entrée,
    // que la spécification ODF impose non compressée.
    if (buf.subarray(30, 38).toString('latin1') === 'mimetype') {
      const attendu = MIME_PAR_EXTENSION[ext];
      if (buf.subarray(38, 38 + attendu.length).toString('latin1') !== attendu) {
        return refus(nom, `ce n'est pas un document .${ext} valide.`);
      }
    }
  }
  return { ok: true, mime: MIME_PAR_EXTENSION[ext] };
}
