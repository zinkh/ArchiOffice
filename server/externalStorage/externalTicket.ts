// Le jeton qui autorise la lecture d'un fichier hébergé sur l'espace du cabinet.
//
// Pourquoi un jeton et pas le JWT de l'application : `openSignedUrl()`
// (src/lib/signedStorageUrl.ts) ouvre l'URL par `window.open()`, et
// `<SignedImage>` la pose dans un `src` — deux navigations nues, sans en-tête
// Authorization. C'est exactement le rôle que remplit une URL signée Supabase
// aujourd'hui ; on reproduit le même contrat pour un fichier externe.
//
// Pourquoi SANS état : /api/storage/signed-url et la requête qui suit sont deux
// requêtes HTTP indépendantes qui, derrière le répartiteur de charge, atterrissent
// sur des conteneurs différents. Une Map par processus se serait comportée comme
// les nonces OAuth d'avant leur passage en table (voir server/oauthState.ts),
// c'est-à-dire en échouant de façon intermittente et incompréhensible. Un HMAC
// n'a rien à partager entre conteneurs : la clé suffit.
//
// La clé est MAIL_ENCRYPTION_KEY, déjà obligatoire au démarrage et déjà de 32
// octets (server/secretsCrypto.ts), avec une séparation de domaine explicite
// pour qu'un jeton ne puisse jamais être confondu avec un autre usage de cette
// même clé. Pas de variable d'environnement supplémentaire à faire déployer.
import crypto from 'crypto';

const DOMAIN = 'archioffice-external-storage-ticket';
/** Une heure, comme les URL signées Supabase que cette route remplace
 *  (SIGNED_URL_TTL_SECONDS dans server/routes/storageAccess.ts) : assez pour
 *  qu'une page ouverte longtemps continue d'afficher ses images, assez court
 *  pour borner la durée de vie d'un lien qui fuiterait. */
export const EXTERNAL_TICKET_TTL_SECONDS = 60 * 60;

export interface ExternalTicketPayload {
  /** cabinet */
  t: string;
  /** connexion */
  c: string;
  /** identifiant chez le fournisseur */
  e: string;
  /** nom de fichier, pour le Content-Disposition */
  n?: string;
  /** expiration, en secondes epoch */
  x: number;
}

function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('MAIL_ENCRYPTION_KEY non configuré');
  return crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update(DOMAIN).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signExternalTicket(
  payload: Omit<ExternalTicketPayload, 'x'>,
  ttlSeconds: number = EXTERNAL_TICKET_TTL_SECONDS,
): string {
  const body = b64url(
    Buffer.from(JSON.stringify({ ...payload, x: Math.floor(Date.now() / 1000) + ttlSeconds }), 'utf8'),
  );
  const sig = b64url(crypto.createHmac('sha256', key()).update(body).digest());
  return `${body}.${sig}`;
}

/** Null si le jeton est mal formé, altéré ou expiré — jamais d'exception : la
 *  route se contente de répondre 401. */
export function verifyExternalTicket(ticket: string | undefined | null): ExternalTicketPayload | null {
  if (!ticket || typeof ticket !== 'string') return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);

  let expected: Buffer;
  try {
    expected = crypto.createHmac('sha256', key()).update(body).digest();
  } catch {
    return null;
  }
  const provided = unb64url(sig);
  // timingSafeEqual exige deux tampons de même longueur : on filtre avant, sinon
  // il lève au lieu de répondre faux.
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  let payload: ExternalTicketPayload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.t || !payload?.c || !payload?.e || typeof payload.x !== 'number') return null;
  if (payload.x < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
