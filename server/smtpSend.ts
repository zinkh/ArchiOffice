// Envoi par un SMTP avec repli sur l'expéditeur authentifié.
//
// Beaucoup de serveurs SMTP (Infomaniak, OVH, Office 365...) refusent un message dont l'adresse
// d'expédition (`From`) n'est pas celle de la boîte avec laquelle on s'est authentifié :
// « 550 5.7.1 Sender mismatch », « Sender address rejected: not owned by user »...
// ArchiOffice écrit depuis l'adresse de l'agence ou l'adresse personnelle d'une personne
// (server/emailSender.ts), qui n'est pas toujours l'identifiant du SMTP du cabinet.
//
// Plutôt que de laisser l'envoi échouer, on le rejoue UNE fois depuis la boîte authentifiée, en gardant
// l'adresse voulue en « Répondre à » : le destinataire répond à la bonne personne, et le message part.
import { isValidEmail } from '../src/lib/crDiffusion';

const SENDER_REFUSED = /sender mismatch|sender address rejected|not owned by (the )?user|not authori[sz]ed to send (as|from)|from address .*(not|differ)|authenticated sender|553\b.*(sender|from)/i;

/** Vrai quand le serveur refuse l'adresse d'expédition (et non le destinataire, le contenu ou les identifiants). */
export function isSenderRefused(err: unknown): boolean {
  const e = err as { response?: unknown; message?: unknown } | null;
  return SENDER_REFUSED.test(`${String(e?.response ?? '')} ${String(e?.message ?? '')}`);
}

interface Mailer { sendMail: (options: any) => Promise<any> }

/** Adresse seule d'un en-tête From (`"Nom" <a@b.fr>` ou `a@b.fr`). */
function addressOf(from: unknown): string {
  const text = typeof from === 'string' ? from : String((from as { address?: string } | null)?.address ?? '');
  const match = text.match(/<([^<>]+)>/);
  return (match ? match[1] : text).trim();
}

/**
 * Envoie le message ; si le serveur refuse l'expéditeur, le renvoie depuis `authUser` (l'identifiant SMTP,
 * quand c'est une adresse e-mail) avec l'expéditeur d'origine en « Répondre à ». Toute autre erreur est relancée telle quelle.
 */
export async function sendMailWithSenderFallback(transporter: Mailer, options: Record<string, any>, authUser: string | null | undefined) {
  try {
    return await transporter.sendMail(options);
  } catch (err) {
    if (!isSenderRefused(err)) throw err;
    if (!authUser || !isValidEmail(authUser)) {
      // Pas d'adresse authentifiée à utiliser : on dit clairement quoi faire plutôt que de répéter le code SMTP.
      const e: any = new Error(`Le serveur d'envoi refuse l'adresse d'expédition (${addressOf(options.from)}) : elle doit correspondre à la boîte du SMTP. Renseignez dans les réglages du cabinet l'adresse e-mail de cette boîte comme identifiant SMTP.`);
      e.cause = err;
      throw e;
    }
    const original = addressOf(options.from);
    return transporter.sendMail({
      ...options,
      from: authUser.trim(),
      replyTo: options.replyTo || (isValidEmail(original) ? original : undefined),
    });
  }
}

/**
 * Message d'erreur d'un envoi qui a essayé deux chemins : la boîte connectée (Gmail, Outlook...) PUIS le SMTP du cabinet.
 * Sans cela, seule l'erreur du dernier chemin s'affichait et masquait la vraie cause (ex. Gmail refusé, puis « Sender mismatch » du SMTP).
 */
export function combinedSendError(account: { provider?: string } | null, accountError: unknown, smtpError: unknown): string {
  const text = (e: unknown) => String((e as { message?: unknown })?.message ?? e ?? 'erreur inconnue').trim();
  const label = account?.provider === 'google' ? 'Gmail' : account?.provider === 'microsoft' ? 'Outlook' : 'Boîte connectée';
  return `${label} : ${text(accountError)} — SMTP du cabinet : ${text(smtpError)}`.slice(0, 600);
}
