// Signature personnelle (profiles.mail_signature, Réglages → Mon profil) ajoutée
// aux e-mails partis de POST /api/send-email : factures, propositions, appels
// d'offres, etc. Le compositeur de messages (MailComposeModal) pose déjà la
// signature dans le corps : on ne la double jamais si elle y figure.

const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const normalize = (v: string): string => v.replace(/\r\n/g, '\n').trim();

const signatureToHtml = (signature: string): string => escapeHtml(signature).replace(/\n/g, '<br>');

export interface MailBody { text?: string; html?: string }

export function applyMailSignature(body: MailBody, rawSignature: unknown): MailBody {
  const signature = typeof rawSignature === 'string' ? normalize(rawSignature) : '';
  if (!signature) return body;
  const out: MailBody = { ...body };
  if (typeof body.text === 'string' && !normalize(body.text).includes(signature)) {
    out.text = `${body.text.replace(/\s+$/, '')}\n\n${signature}`;
  }
  if (typeof body.html === 'string' && !body.html.includes(signatureToHtml(signature)) && !normalize(body.html).includes(signature)) {
    out.html = `${body.html}<br><br><div class="mail-signature">${signatureToHtml(signature)}</div>`;
  }
  return out;
}
