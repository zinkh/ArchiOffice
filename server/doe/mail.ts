// Envoi d'un message de l'atelier DOE par le SMTP du cabinet (repli : SMTP de la
// plateforme), comme l'accusé de réception du dépôt des offres. Les relances
// partent sans session humaine : aucun compte mail personnel n'est utilisable,
// et les messages manuels (sollicitation, visa) suivent le même chemin pour que
// l'entreprise reçoive toujours le même expéditeur.
import nodemailer from 'nodemailer';
import { isValidEmail } from '../../src/lib/crDiffusion';

export interface PieceJointeMail {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailCabinet {
  to: string;
  subject: string;
  html: string;
  attachments?: PieceJointeMail[];
}

export type ResultatMail = { ok: true } | { ok: false; raison: string };

/** Nom du cabinet tel qu'il signe les messages. */
export async function nomCabinet(supabaseAdmin: any, tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('settings').select('agency_name').eq('tenant_id', tenantId).maybeSingle();
  return (data as any)?.agency_name || 'Le cabinet';
}

export async function envoyerMailCabinet(supabaseAdmin: any, tenantId: string, mail: MailCabinet): Promise<ResultatMail> {
  try {
    if (!isValidEmail(mail.to)) return { ok: false, raison: 'Adresse e-mail invalide.' };
    const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    const s: any = settings || {};
    const host = s.smtp_host || process.env.SMTP_HOST;
    const port = s.smtp_port || process.env.SMTP_PORT || '587';
    const user = s.smtp_user || process.env.SMTP_USER;
    const pass = s.smtp_pass || process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return { ok: false, raison: "Aucun serveur d'envoi n'est configuré : renseignez le SMTP du cabinet dans Réglages." };
    }
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(String(port), 10),
      secure: String(port) === '465',
      auth: { user, pass },
    });
    const agence = isValidEmail(s.email) ? String(s.email).trim() : undefined;
    const nom = String(s.agency_name || 'Le cabinet').replace(/["\r\n]/g, '');
    await transporter.sendMail({
      from: `"${nom}" <${agence || user}>`,
      to: String(mail.to).trim(),
      replyTo: agence,
      subject: mail.subject.replace(/[\r\n]/g, ' '),
      html: mail.html,
      attachments: mail.attachments,
    });
    return { ok: true };
  } catch (err: any) {
    console.error('[doe] Message non envoyé :', err?.message);
    return { ok: false, raison: "Le message n'a pas pu être envoyé par le serveur d'envoi du cabinet." };
  }
}
