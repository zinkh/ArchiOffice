// Diffusion d'un compte-rendu de chantier par e-mail : le PDF en pièce jointe,
// et dans le corps de CHAQUE message les seules observations qui concernent le
// destinataire (src/lib/crDiffusion.ts).
//
// Le client envoie le PDF (généré dans le navigateur, avec les photos) et les
// identifiants des contacts cochés. Il n'envoie JAMAIS d'adresse : le serveur
// rejoue la liste des destinataires depuis l'opération (lots, intervenants,
// observations du compte-rendu) et n'écrit qu'à ceux-là, à l'adresse de leur
// fiche. Un identifiant étranger à l'opération est simplement ignoré.
//
// L'envoi passe par le SMTP du cabinet, comme les autres envois avec pièce
// jointe (POST /api/send-email) : les comptes Gmail/Outlook connectés n'ont pas
// encore de chemin d'envoi avec pièce jointe. Le compte-rendu ne passe au statut
// « diffusé » que si au moins un message est parti.
import type { Express } from 'express';
import nodemailer from 'nodemailer';
import { sendEmailLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { handleDocumentUpload } from '../documentUpload';
import {
  buildDiffusionMail, buildDiffusionRecipients, MAX_DIFFUSION_RECIPIENTS,
  type DiffusionRecipient,
} from '../../src/lib/crDiffusion';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

/** Un compte-rendu avec ses photos reste sous ce poids ; au-delà, la plupart des boîtes refuseraient le message. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const parseContactIds = (raw: unknown): string[] => {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length <= 64))] : [];
  } catch {
    return [];
  }
};

const safeFilename = (name: unknown, fallback: string): string => {
  const base = typeof name === 'string' ? name.replace(/[\r\n\\/"]/g, '_').trim() : '';
  return (base || fallback).slice(0, 120);
};

export function registerSiteReportDiffusionRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.post("/api/reports/:reportId/diffuse", sendEmailLimiter, handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;

      const file = req.file;
      if (!file?.buffer?.length) return res.status(400).json({ error: 'Le PDF du compte-rendu est manquant.' });
      if (file.buffer.length > MAX_PDF_BYTES) return res.status(413).json({ error: 'Le PDF dépasse 20 Mo : réduisez le nombre de photos.' });
      if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'Le fichier joint n\'est pas un PDF.' });

      const requestedIds = parseContactIds(req.body?.contact_ids);
      if (requestedIds.length === 0) return res.status(400).json({ error: 'Aucun destinataire sélectionné.' });
      if (requestedIds.length > MAX_DIFFUSION_RECIPIENTS) {
        return res.status(400).json({ error: `Au plus ${MAX_DIFFUSION_RECIPIENTS} destinataires par diffusion.` });
      }

      const { data: report } = await tenantScopedFrom(supabaseAdmin, tenantId, 'site_reports').select('*').eq('id', reportId).maybeSingle();
      if (!report) return res.status(404).json({ error: 'Compte-rendu introuvable.' });
      const projectId = (report as any).project_id;

      const [projectRes, lotsRes, stakeholdersRes, linksRes, settingsRes, profileRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('name, project_code, address').eq('id', projectId).maybeSingle(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'project_lots').select('id, project_id, lot_number, lot_title, contact_id').eq('project_id', projectId),
        tenantScopedFrom(supabaseAdmin, tenantId, 'project_stakeholders').select('id, project_id, name, role, contact_id').eq('project_id', projectId),
        supabaseAdmin.from('observation_reports').select('observation_id').eq('report_id', reportId),
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabaseAdmin.from('profiles').select('mail_signature').eq('id', req.user.id).maybeSingle(),
      ]);
      const project: any = projectRes.data;
      if (!project) return res.status(404).json({ error: 'Opération introuvable.' });
      const lots: any[] = lotsRes.data || [];
      const stakeholders: any[] = stakeholdersRes.data || [];
      const settings: any = settingsRes.data;
      if (!settings) return res.status(500).json({ error: 'Réglages du cabinet introuvables.' });

      const contactIds = [...new Set([...lots, ...stakeholders].map(x => x.contact_id).filter(Boolean))];
      const observationIds = ((linksRes.data || []) as any[]).map(l => l.observation_id);
      const [contactsRes, observationsRes] = await Promise.all([
        contactIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('id, first_name, last_name, company_name, email, email_work, email_other, email_home').in('id', contactIds)
          : Promise.resolve({ data: [] }),
        observationIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('id, project_id, lot_id, contact_id, texte, statut, due_date, number, type, urgence').in('id', observationIds)
          : Promise.resolve({ data: [] }),
      ]);

      const allowed = buildDiffusionRecipients({
        lots, stakeholders, contacts: (contactsRes.data || []) as any[], observations: (observationsRes.data || []) as any[],
      });
      const chosen = allowed.filter(r => requestedIds.includes(r.contactId));
      const addressable = chosen.filter(r => r.email);
      const withoutEmail = chosen.filter(r => !r.email);
      if (addressable.length === 0) {
        return res.status(400).json({ error: 'Aucun destinataire sélectionné ne dispose d\'une adresse e-mail valable.' });
      }

      const smtpHost = settings.smtp_host || process.env.SMTP_HOST;
      const smtpPort = settings.smtp_port || process.env.SMTP_PORT || '587';
      const smtpUser = settings.smtp_user || process.env.SMTP_USER;
      const smtpPass = settings.smtp_pass || process.env.SMTP_PASS;
      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(500).json({ error: 'Configuration SMTP manquante : renseignez le serveur d\'envoi dans les réglages du cabinet.' });
      }
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort)),
        secure: String(smtpPort) === '465',
        auth: { user: smtpUser, pass: smtpPass },
      });

      const personal = settings.sender_option === 'personal';
      const from = personal ? req.user.email : settings.email;
      const replyTo = req.user.email || settings.email || undefined;
      const filename = safeFilename(file.originalname, `CR_${(report as any).report_number}.pdf`);
      const ctx = {
        reportNumber: (report as any).report_number,
        reportDate: (report as any).date,
        nextMeeting: (report as any).nextmeeting,
        projectName: project.name,
        projectCode: project.project_code,
        projectAddress: project.address,
        agencyName: settings.agency_name,
        signature: (profileRes.data as any)?.mail_signature,
      };

      const sent: { contact_id: string; name: string; email: string; observations: number }[] = [];
      const failed: { contact_id: string; name: string; email: string; error: string }[] = [];
      // Un message par destinataire, l'un après l'autre : chacun ne voit que SES observations
      // et aucune adresse des autres (un envoi groupé les dévoilerait).
      const send = async (r: DiffusionRecipient) => {
        const mail = buildDiffusionMail(r, ctx);
        try {
          await transporter.sendMail({
            from, replyTo, to: r.email,
            subject: mail.subject, text: mail.text, html: mail.html,
            attachments: [{ filename, content: file.buffer, contentType: 'application/pdf' }],
          });
          sent.push({ contact_id: r.contactId, name: r.name, email: r.email, observations: r.observations.length });
        } catch (err: any) {
          console.error('[POST /api/reports/:reportId/diffuse] envoi impossible', r.contactId, err?.message);
          failed.push({ contact_id: r.contactId, name: r.name, email: r.email, error: err?.message || 'Envoi impossible' });
        }
      };
      for (const r of addressable) await send(r);

      let statut = (report as any).statut;
      if (sent.length > 0) {
        const { error: updateError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'site_reports').update({ statut: 'diffuse' }).eq('id', reportId);
        if (updateError) console.error('[POST /api/reports/:reportId/diffuse] statut non enregistré', updateError);
        else statut = 'diffuse';
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Diffusion du compte rendu n° ${(report as any).report_number} à ${sent.map(s => s.name).join(', ')}`, project.name, projectId, 'project', 'Chantier');
      }

      const skipped = withoutEmail.map(r => ({ contact_id: r.contactId, name: r.name }));
      if (sent.length === 0) {
        return res.status(502).json({ error: `Aucun message n'a pu être envoyé : ${failed[0]?.error || 'envoi impossible'}`, sent, failed, skipped, statut });
      }
      res.json({ success: true, sent, failed, skipped, statut });
    } catch (error: any) {
      console.error('[POST /api/reports/:reportId/diffuse]', error);
      res.status(500).json({ error: 'La diffusion a échoué.' });
    }
  });
}
