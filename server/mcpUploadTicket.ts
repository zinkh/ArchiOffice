// Jeton signé qui autorise UN dépôt de fichier par PUT sur /mcp-upload/:ticket
// (voir server/routes/mcpUpload.ts). Stateless, sur le patron de
// server/externalStorage/externalTicket.ts : deux requêtes successives
// atterrissent sur des conteneurs différents, une Map par processus
// échouerait de façon intermittente. Même clé (MAIL_ENCRYPTION_KEY) avec une
// séparation de domaine explicite pour qu'un jeton ne serve jamais à autre chose.
import crypto from 'crypto';

const DOMAIN = 'archioffice-mcp-upload-ticket';
/** Quinze minutes : le temps d'un PUT, pas celui d'une session. */
export const MCP_UPLOAD_TICKET_TTL_SECONDS = 15 * 60;

export interface McpUploadTicketPayload {
  /** cabinet */
  t: string;
  /** personne au nom de qui le fichier est déposé */
  u: string;
  /** type de fiche cible */
  r: string;
  /** identifiant de la fiche cible */
  i: string;
  /** nom du fichier */
  n: string;
  /** type MIME */
  m: string;
  c?: string;
  d?: string;
  /** expiration, secondes epoch */
  x: number;
}

function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('MAIL_ENCRYPTION_KEY non configuré');
  return crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update(DOMAIN).digest();
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signMcpUploadTicket(payload: Omit<McpUploadTicketPayload, 'x'>, ttlSeconds = MCP_UPLOAD_TICKET_TTL_SECONDS): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, x: Math.floor(Date.now() / 1000) + ttlSeconds }), 'utf8'));
  return `${body}.${b64url(crypto.createHmac('sha256', key()).update(body).digest())}`;
}

/** Null si le jeton est mal formé, altéré ou expiré — jamais d'exception. */
export function verifyMcpUploadTicket(ticket: string | undefined | null): McpUploadTicketPayload | null {
  if (!ticket || typeof ticket !== 'string') return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  let expected: Buffer;
  try {
    expected = crypto.createHmac('sha256', key()).update(body).digest();
  } catch {
    return null;
  }
  const provided = unb64url(ticket.slice(dot + 1));
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  let payload: McpUploadTicketPayload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.t || !payload?.u || !payload?.r || !payload?.i || !payload?.n || typeof payload.x !== 'number') return null;
  if (payload.x < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
