// ── Lien « j'ai bien reçu » d'un additif au DCE ──────────────────────────────
// Le mail d'additif porte un lien propre à chaque entreprise. Ce lien ne donne accès à RIEN d'autre
// qu'à la confirmation de réception de CET additif : il ne remplace pas le lien de dépôt (dont le
// jeton n'existe qu'une fois, voir tokens.ts) et ne révoque donc rien.
//
// SANS état, comme les tickets de fichiers externes (externalTicket.ts) : un HMAC ne demande rien
// à partager entre conteneurs. Même clé (MAIL_ENCRYPTION_KEY, déjà obligatoire) avec une séparation
// de domaine : un ticket de ce module ne peut jamais valoir pour un autre usage de la clé.
import crypto from 'crypto';

const DOMAIN = 'archioffice-consultation-additif-accuse';
/** Un additif reste confirmable longtemps : une entreprise lit parfois son courrier avec retard. */
export const ACCUSE_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface AccusePayload {
  /** cabinet */
  t: string;
  /** affaire */
  p: string;
  /** entreprise (identifiant dans consultation.entreprises) */
  e: string;
  /** additif (identifiant dans consultation.dce_revisions) */
  r: string;
  /** expiration, en secondes epoch */
  x: number;
}

function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('MAIL_ENCRYPTION_KEY non configuré');
  return crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update(DOMAIN).digest();
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signerAccuse(payload: Omit<AccusePayload, 'x'>, ttlSeconds: number = ACCUSE_TTL_SECONDS): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, x: Math.floor(Date.now() / 1000) + ttlSeconds }), 'utf8'));
  return `${body}.${b64url(crypto.createHmac('sha256', key()).update(body).digest())}`;
}

/** Null si le ticket est mal formé, altéré ou expiré : jamais d'exception. */
export function lireAccuse(ticket: unknown): AccusePayload | null {
  if (typeof ticket !== 'string' || ticket.length > 2000) return null;
  const point = ticket.indexOf('.');
  if (point <= 0) return null;
  const body = ticket.slice(0, point);
  let attendu: Buffer;
  try { attendu = crypto.createHmac('sha256', key()).update(body).digest(); } catch { return null; }
  const fourni = unb64url(ticket.slice(point + 1));
  if (fourni.length !== attendu.length || !crypto.timingSafeEqual(fourni, attendu)) return null;
  let payload: AccusePayload;
  try { payload = JSON.parse(unb64url(body).toString('utf8')); } catch { return null; }
  if (!payload?.t || !payload?.p || !payload?.e || !payload?.r || typeof payload.x !== 'number') return null;
  if (payload.x < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Adresse du lien « j'ai bien reçu » (page publique de confirmation). */
export function lienAccuse(ticket: string): string {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/public/additif/accuse/${ticket}`;
}

/** Échappe le texte inséré dans la page de confirmation (noms d'entreprise et d'opération). */
export function echapperHtml(texte: string): string {
  return String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
