// Choix du chemin d'envoi d'un message écrit par une personne connectée (diffusion d'un
// compte-rendu, envoi des réserves).
//
// Un cabinet qui n'a pas renseigné son propre SMTP retombait sur le SMTP de la PLATEFORME
// (SMTP_HOST / SMTP_USER de l'instance) : ce serveur refuse l'adresse du cabinet (« sender
// mismatch »), `sendMailWithSenderFallback` renvoyait alors le message depuis l'identifiant
// du SMTP, soit l'adresse de la plateforme, que le destinataire voyait comme expéditeur.
//
// Règle :
//   - SMTP propre au cabinet : essayé d'abord (le message part de l'adresse de l'agence), la boîte
//     connectée de la personne ne sert qu'en repli ;
//   - pas de SMTP propre, mais une boîte connectée (Gmail, Outlook, IMAP) : le message part de
//     cette boîte, jamais de l'adresse de la plateforme ;
//   - ni l'un ni l'autre : le SMTP de la plateforme, seul chemin restant.
import { combinedSendError, sendMailWithSenderFallback } from './smtpSend';
import { sendViaAccount } from './mailSend';

interface Mailer { sendMail: (options: any) => Promise<any> }

export interface MailRoute {
  supabaseAdmin: any;
  /** Transport SMTP (celui du cabinet, à défaut celui de la plateforme), null si aucun n'est configuré. */
  transporter: Mailer | null;
  smtpUser?: string | null;
  /** Boîte connectée par défaut de la personne, null s'il n'y en a pas. */
  defaultAccount: any | null;
  /** Le cabinet a renseigné son propre SMTP (et non celui de la plateforme). */
  ownSmtp: boolean;
  from?: string;
  replyTo?: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

/** Vrai quand les réglages du cabinet portent un SMTP complet (hôte, identifiant, mot de passe). */
export function hasOwnSmtp(settings: any): boolean {
  return !!(settings?.smtp_host && settings?.smtp_user && settings?.smtp_pass);
}

/** Envoie le message par le meilleur chemin disponible (voir l'en-tête). Relance l'erreur du dernier chemin essayé. */
export async function sendViaBestRoute(route: MailRoute, mail: OutgoingMail): Promise<void> {
  const bySmtp = () => sendMailWithSenderFallback(route.transporter!, {
    from: route.from, replyTo: route.replyTo, to: mail.to,
    subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments,
  }, route.smtpUser);
  const byAccount = () => sendViaAccount(route.supabaseAdmin, route.defaultAccount, mail);

  // Une boîte connectée prime sur le SMTP de la plateforme.
  if (route.defaultAccount && !(route.ownSmtp && route.transporter)) {
    await byAccount();
    return;
  }
  if (!route.transporter) throw new Error('Aucun moyen d\'envoi configuré.');
  if (!route.defaultAccount) {
    await bySmtp();
    return;
  }
  try {
    await bySmtp();
  } catch (smtpError) {
    console.warn('[mailRoute] envoi par le SMTP du cabinet impossible', (smtpError as any)?.message);
    try {
      await byAccount();
    } catch (accountError) {
      throw new Error(combinedSendError(route.defaultAccount, accountError, smtpError));
    }
  }
}
