// Ce qui part vers le cabinet et vers l'entreprise quand une remise arrive :
// l'accusé de réception par e-mail (preuve de dépôt) et la notification des
// personnes de l'affaire. Meilleur effort partout : une notification ratée ne
// doit jamais faire perdre un dépôt déjà enregistré.
import nodemailer from 'nodemailer';
import { isValidEmail } from '../../src/lib/crDiffusion';
import { construireAccuse, type ParametresAccuse } from '../../src/lib/consultationDepot';
import { notifyUsers } from '../push';
import { listTenantAdminIds } from '../tenantMemberships';

/** Envoie l'accusé par le SMTP du cabinet (repli : SMTP de la plateforme). Rend vrai si le message est parti. */
export async function envoyerAccuse(
  supabaseAdmin: any,
  tenantId: string,
  destinataire: string | null | undefined,
  params: ParametresAccuse,
): Promise<boolean> {
  try {
    if (!isValidEmail(destinataire)) return false;
    const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    const s: any = settings || {};
    const host = s.smtp_host || process.env.SMTP_HOST;
    const port = s.smtp_port || process.env.SMTP_PORT || '587';
    const user = s.smtp_user || process.env.SMTP_USER;
    const pass = s.smtp_pass || process.env.SMTP_PASS;
    if (!host || !user || !pass) return false;

    const { subject, html } = construireAccuse(params);
    const agence = isValidEmail(s.email) ? String(s.email).trim() : undefined;
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(String(port), 10),
      secure: String(port) === '465',
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `"${String(params.cabinet).replace(/["\r\n]/g, '')}" <${agence || user}>`,
      to: String(destinataire).trim(),
      replyTo: agence,
      subject,
      html,
    });
    return true;
  } catch (err: any) {
    console.error('[consultation-depot] Accusé de réception non envoyé :', err?.message);
    return false;
  }
}

/** Les membres de l'affaire, et à défaut (ou en plus) les administrateurs du cabinet. */
export async function destinatairesAffaire(supabaseAdmin: any, tenantId: string, projectId: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const { data } = await supabaseAdmin
      .from('project_members').select('user_id').eq('tenant_id', tenantId).eq('project_id', projectId);
    (data || []).forEach((m: any) => m.user_id && ids.add(String(m.user_id)));
  } catch { /* meilleur effort */ }
  try {
    (await listTenantAdminIds(supabaseAdmin, tenantId)).forEach(id => ids.add(id));
  } catch { /* meilleur effort */ }
  return [...ids];
}

export async function notifierDepot(
  supabaseAdmin: any,
  tenantId: string,
  projectId: string,
  texte: { titre: string; corps: string },
): Promise<void> {
  const destinataires = await destinatairesAffaire(supabaseAdmin, tenantId, projectId);
  await notifyUsers(supabaseAdmin, tenantId, destinataires, {
    title: texte.titre,
    body: texte.corps,
    url: `/projects/${projectId}?tab=ACT`,
    category: 'Projets',
    tag: `depot-offre-${projectId}`,
  });
}
