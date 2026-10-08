// Pièces jointes reçues d'un client pour un e-mail (POST /api/send-email).
//
// Elles étaient relayées telles quelles à nodemailer, qui accepte pour une pièce
// jointe `path` (lecture d'un fichier du serveur), `href` (lecture d'une adresse,
// donc le réseau interne), `raw`, `headers`... : toute personne connectée pouvait
// se faire envoyer `.env` ou une clé du serveur. Le serveur ne garde ici que des
// OCTETS reçus en base64, sous un nom nettoyé : c'est tout ce que l'application
// envoie légitimement (src/lib/emailAttachments.ts), et c'est tout ce que nodemailer
// reçoit en retour, sous forme de Buffer.

export const MAX_EMAIL_ATTACHMENTS = 20;
/** Poids total décodé : marge sous les 25 Mo que la plupart des relais SMTP refusent. */
export const MAX_EMAIL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export interface SafeEmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export type SanitizedAttachments = { ok: true; attachments: SafeEmailAttachment[] } | { ok: false; error: string };

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTENT_TYPE_RE = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/;

/** Nom de fichier sans chemin, sans caractère de contrôle, de longueur raisonnable. */
function cleanFilename(raw: unknown): string {
  const name = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()!.replace(/^\.+/, '').trim();
  return (base || 'piece-jointe').slice(0, 200);
}

/** Taille décodée d'une chaîne base64, sans la décoder. */
const decodedSize = (b64: string): number =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

export function sanitizeEmailAttachments(raw: unknown): SanitizedAttachments {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Pièces jointes invalides.' };
  if (raw.length > MAX_EMAIL_ATTACHMENTS) {
    return { ok: false, error: `Au plus ${MAX_EMAIL_ATTACHMENTS} pièces jointes par message.` };
  }

  const attachments: SafeEmailAttachment[] = [];
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Pièce jointe invalide.' };
    const { filename, content, encoding, contentType } = item as Record<string, unknown>;
    if (encoding !== undefined && encoding !== 'base64') return { ok: false, error: 'Pièce jointe invalide : seul l\'encodage base64 est accepté.' };
    if (typeof content !== 'string' || content.length === 0) return { ok: false, error: 'Pièce jointe invalide : contenu manquant.' };
    const compact = content.replace(/\s+/g, '');
    if (!BASE64_RE.test(compact) || compact.length % 4 === 1) return { ok: false, error: 'Pièce jointe invalide : contenu illisible.' };

    total += decodedSize(compact);
    if (total > MAX_EMAIL_ATTACHMENTS_BYTES) {
      return { ok: false, error: `Les pièces jointes dépassent ${Math.round(MAX_EMAIL_ATTACHMENTS_BYTES / (1024 * 1024))} Mo.` };
    }

    attachments.push({
      filename: cleanFilename(filename),
      content: Buffer.from(compact, 'base64'),
      ...(typeof contentType === 'string' && CONTENT_TYPE_RE.test(contentType) ? { contentType } : {}),
    });
  }
  return { ok: true, attachments };
}
