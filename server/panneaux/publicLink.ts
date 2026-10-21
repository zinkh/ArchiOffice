// Lien public de la liste des entreprises d'un chantier (cible du QR code).
//
// Le QR code est imprimé sur un panneau : le lien doit être le même à chaque
// génération et rester valable pendant tout le chantier. Un jeton tiré au hasard
// et stocké en base obligerait à le conserver et à le relire ; on dérive donc le
// jeton de l'identifiant de l'affaire par HMAC, sans état ni migration. La liste
// est destinée au public (le texte la rend consultable par toute personne), le
// jeton sert seulement à empêcher d'énumérer les affaires de la plateforme.
import crypto from 'crypto';

const DOMAIN = 'archioffice-chantier-public-list';
const MAC_LENGTH = 22;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('MAIL_ENCRYPTION_KEY non configuré');
  return crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update(DOMAIN).digest();
}

function mac(projectId: string): string {
  return crypto.createHmac('sha256', key()).update(projectId).digest('base64url').slice(0, MAC_LENGTH);
}

export function signChantierToken(projectId: string): string {
  return `${Buffer.from(projectId, 'utf8').toString('base64url')}.${mac(projectId)}`;
}

/** Rend l'identifiant de l'affaire si le jeton est authentique, sinon null. */
export function verifyChantierToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 160) return null;
  const [body, tag, extra] = token.split('.');
  if (!body || !tag || extra !== undefined) return null;
  let projectId: string;
  try { projectId = Buffer.from(body, 'base64url').toString('utf8'); } catch { return null; }
  if (!PROJECT_ID_RE.test(projectId)) return null;
  const expected = Buffer.from(mac(projectId));
  const given = Buffer.from(tag);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? projectId : null;
}

export function chantierPublicUrl(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chantier/${signChantierToken(projectId)}`;
}
