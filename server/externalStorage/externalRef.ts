// Le format de référence écrit dans `file_url` quand un fichier vit sur
// l'espace de stockage du cabinet plutôt que dans Supabase Storage.
//
//   archioffice+external://<provider>/<connectionId>/<base64url(externalId)>?name=<nom>
//
// Pourquoi une URI dans `file_url` plutôt que des colonnes dédiées : la
// référence d'un fichier est déjà une chaîne opaque unique qui circule partout
// — `documents.file_url`, `document_versions.file_url`, `plans.file_url`,
// `visas.document_url`, `src/types.ts`, `resolveSignedUrl()`, `SignedImage`,
// `PlanAnnotator`, `meetingExport.ts`, `tenantExport.ts`, et le package agents.
// Un couple (fournisseur, identifiant) imposerait des colonnes sur quatre
// tables ET la propagation d'un tuple dans la douzaine de fichiers frontend qui
// ne passent aujourd'hui que `doc.file_url`. Une chaîne unique préserve
// exactement le contrat que server/storagePaths.ts énonce déjà : `file_url` est
// une RÉFÉRENCE que seul le serveur sait résoudre, pas une URL fetchable.
//
// Conséquence utile : `parseStorageRef()` rend déjà `null` sur tout ce qui ne
// contient pas `/object/public/`, donc ses deux copies dans
// packages/archioffice-agents se comportent correctement sans être touchées
// (retour null, repli sur fetch, échec propre) en attendant le lot d'effets de
// bord qui leur câblera un vrai lecteur.
//
// Le `base64url` de l'identifiant n'est pas décoratif : un identifiant Dropbox
// ou WebDAV contient des `/`, des espaces et des accents, qui casseraient le
// découpage du chemin. Le `?name=` est purement cosmétique (nom de
// téléchargement et d'affichage) : rien d'autoritatif n'en dépend jamais.
import type { ExternalStorageKind } from './provider';

export const EXTERNAL_REF_SCHEME = 'archioffice+external:';

export interface ExternalStorageRef {
  provider: ExternalStorageKind;
  connectionId: string;
  externalId: string;
  fileName?: string;
}

const KINDS = new Set<string>(['google_drive', 'dropbox', 'webdav']);

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

/** Vrai pour une référence vers l'espace de stockage d'un cabinet. Bon marché :
 *  un simple préfixe, appelable sur chaque ligne d'une liste. */
export function isExternalRef(fileUrl: string | null | undefined): boolean {
  return typeof fileUrl === 'string' && fileUrl.startsWith(`${EXTERNAL_REF_SCHEME}//`);
}

export function buildExternalRef(ref: ExternalStorageRef): string {
  const base = `${EXTERNAL_REF_SCHEME}//${ref.provider}/${encodeURIComponent(ref.connectionId)}/${toBase64Url(ref.externalId)}`;
  return ref.fileName ? `${base}?name=${encodeURIComponent(ref.fileName)}` : base;
}

export function parseExternalRef(fileUrl: string | null | undefined): ExternalStorageRef | null {
  if (!isExternalRef(fileUrl)) return null;
  // `archioffice+external:` n'est pas un schéma « spécial » au sens WHATWG, donc
  // URL() le parse sans en réécrire l'autorité : host = fournisseur, pathname =
  // /<connexion>/<identifiant>.
  let url: URL;
  try {
    url = new URL(fileUrl as string);
  } catch {
    return null;
  }
  const provider = url.hostname || url.host;
  if (!KINDS.has(provider)) return null;

  const segments = url.pathname.replace(/^\//, '').split('/');
  if (segments.length !== 2) return null;
  const connectionId = decodeURIComponent(segments[0]);
  if (!connectionId) return null;

  let externalId: string;
  try {
    externalId = fromBase64Url(segments[1]);
  } catch {
    return null;
  }
  if (!externalId) return null;

  const fileName = url.searchParams.get('name') || undefined;
  return { provider: provider as ExternalStorageKind, connectionId, externalId, fileName };
}

/** Vrai pour une référence que CE serveur a émise et sait donc supprimer —
 *  une référence Supabase du bucket donné, ou une référence externe.
 *
 *  Remplace les gardes `file_url.includes('/object/public/<bucket>/')` qui
 *  précédaient les suppressions dans documents.ts et plans.ts : elles rendaient
 *  faux sur une référence externe, ce qui aurait laissé le fichier orphelin sur
 *  l'espace du cabinet. Elles rataient déjà, au passage, les références stockées
 *  « nues » (un chemin sans URL complète). */
export function isOwnStorageRef(fileUrl: string | null | undefined, bucket: string): boolean {
  if (!fileUrl) return false;
  if (isExternalRef(fileUrl)) return true;
  return fileUrl.includes(`/object/public/${bucket}/`);
}
