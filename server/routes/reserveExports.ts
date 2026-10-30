// Diffusion et export des réserves (OPR et GPA) : journal des exports et envoi par e-mail.
//
// - Les INTERVENANTS de l'opération reçoivent le rapport complet, chaque ENTREPRISE ses seules
//   réserves (src/lib/reserveDiffusion.ts, partagé avec l'écran).
// - Le client génère les PDF (plans, photos) et n'envoie JAMAIS d'adresse : le serveur rejoue la liste
//   des destinataires depuis l'opération et n'écrit qu'à l'adresse de la fiche du contact.
// - Un message par destinataire (personne ne voit l'adresse des autres), un appel par message : le
//   journal (`reserve_exports`) reçoit chaque envoi au fur et à mesure, son état se déduit des envois.
// - Transport : la boîte connectée par défaut de la personne, à défaut le SMTP du cabinet, comme la
//   diffusion d'un compte-rendu (server/routes/siteReportDiffusion.ts).
import type { Express } from 'express';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { sendEmailLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { handleDocumentUpload } from '../documentUpload';
import { resolveEmailSender } from '../emailSender';
import { sendViaAccount } from '../mailSend';
import { loadReserveContext, RESERVE_KINDS, RESERVE_TITLE, readKind, readLots, type ReserveKind } from '../reserveDiffusionContext';
import {
  buildReserveMail, statutDiffusion,
  type ExportSend, type ReserveRecipient,
} from '../../src/lib/reserveDiffusion';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const SMTP_TIMEOUT_MS = 15_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function registerReserveExportRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const loadContext = (tenantId: string, projectId: string, kind: ReserveKind, lots: string[] | null) =>
    loadReserveContext(supabaseAdmin, tenantId, projectId, kind, lots);

  const parseExport = (row: any) => ({ ...row, lots: Array.isArray(row.lots) ? row.lots : [], sends: Array.isArray(row.sends) ? row.sends : [] });

  // Journal d'une opération, du plus récent au plus ancien.
  app.get('/api/projects/:projectId/reserve-exports', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const kind = readKind(req.query.kind);
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_exports').select('*').eq('project_id', req.params.projectId);
      if (kind) query = query.eq('kind', kind);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
      // Instance non migrée : un journal vide plutôt qu'une erreur (le reste de l'écran fonctionne).
      if (error) return res.json([]);
      res.json((data || []).map(parseExport));
    } catch (e: any) {
      console.error('[GET reserve-exports]', e);
      res.status(500).json({ error: 'Journal illisible.' });
    }
  });

  // Destinataires d'un périmètre, rejoués depuis l'opération (jamais depuis le client).
  app.get('/api/projects/:projectId/reserve-exports/recipients', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const kind = readKind(req.query.kind);
      if (!kind) return res.status(400).json({ error: 'Type de réserves inconnu.' });
      const ctx = await loadContext(tenantId, req.params.projectId, kind, readLots(req.query.lots));
      if (!ctx) return res.status(404).json({ error: 'Opération introuvable.' });
      const strip = (r: ReserveRecipient) => ({ key: r.key, role: r.role, name: r.name, detail: r.detail, email: r.email, reserve_count: r.reserveIds.length });
      res.json({
        reserve_count: ctx.reserves.length,
        intervenants: ctx.recipients.intervenants.map(strip),
        entreprises: ctx.recipients.entreprises.map(strip),
      });
    } catch (e: any) {
      console.error('[GET reserve-exports/recipients]', e);
      res.status(500).json({ error: 'Destinataires illisibles.' });
    }
  });

  // Consigne un export : téléchargement (terminé) ou diffusion (les envois suivent un par un).
  app.post('/api/projects/:projectId/reserve-exports', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const kind = readKind(req.body?.kind);
      const channel = req.body?.channel === 'mail' ? 'mail' : req.body?.channel === 'telechargement' ? 'telechargement' : null;
      if (!kind || !channel) return res.status(400).json({ error: 'Export invalide.' });
      const lots = readLots(req.body?.lots);
      const ctx = await loadContext(tenantId, req.params.projectId, kind, lots);
      if (!ctx) return res.status(404).json({ error: 'Opération introuvable.' });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      const row = {
        id: randomUUID(), tenant_id: tenantId, project_id: req.params.projectId, kind,
        scope: lots ? 'lots' : 'all', lots: lots ?? [], reserve_count: ctx.reserves.length, channel,
        status: channel === 'mail' ? 'en_cours' : 'exporte', sends: [],
        note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : null,
        created_by: req.user.id, created_by_name: userName,
      };
      const { data, error } = await supabaseAdmin.from('reserve_exports').insert(row).select('*').single();
      if (error) {
        console.error('[POST reserve-exports]', error);
        return res.status(503).json({ error: "Le journal des exports n'est pas disponible : migration à appliquer." });
      }
      if (channel === 'telechargement') {
        logActivity(tenantId, req.user.id, userName, `Export PDF des ${RESERVE_TITLE[kind].toLowerCase()} (${ctx.reserves.length})`, ctx.project.name, req.params.projectId, 'project', 'Réserves/Observations');
      }
      res.status(201).json(parseExport(data));
    } catch (e: any) {
      console.error('[POST reserve-exports]', e);
      res.status(500).json({ error: "L'export n'a pas pu être consigné." });
    }
  });

  // Un message : le PDF d'UN destinataire. Appelé une fois par destinataire.
  app.post('/api/reserve-exports/:id/send', sendEmailLimiter, handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file?.buffer?.length) return res.status(400).json({ error: 'Le PDF est manquant.' });
      if (file.buffer.length > MAX_PDF_BYTES) return res.status(413).json({ error: 'Le PDF dépasse 20 Mo : réduisez le nombre de photos.' });
      if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: "Le fichier joint n'est pas un PDF." });

      const { data: exportRow } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_exports').select('*').eq('id', req.params.id).maybeSingle();
      if (!exportRow) return res.status(404).json({ error: 'Export introuvable.' });
      const entry = parseExport(exportRow);
      if (entry.channel !== 'mail') return res.status(400).json({ error: "Cet export n'est pas une diffusion." });
      const kind = entry.kind as ReserveKind;
      if (!RESERVE_KINDS.includes(kind)) return res.status(400).json({ error: 'Type de réserves inconnu.' });

      const ctx = await loadContext(tenantId, entry.project_id, kind, entry.scope === 'lots' ? entry.lots : null);
      if (!ctx) return res.status(404).json({ error: 'Opération introuvable.' });
      const key = String(req.body?.key ?? '');
      const recipient = [...ctx.recipients.intervenants, ...ctx.recipients.entreprises].find(r => r.key === key);
      if (!recipient) return res.status(400).json({ error: 'Destinataire inconnu de cette opération.' });

      const [settingsRes, profileRes, defaultAccountRes] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabaseAdmin.from('profiles').select('mail_signature').eq('id', req.user.id).maybeSingle(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').select('*').eq('user_id', req.user.id).eq('is_default', true).maybeSingle(),
      ]);
      const settings: any = settingsRes.data;
      if (!settings) return res.status(500).json({ error: 'Réglages du cabinet introuvables.' });
      const defaultAccount: any = defaultAccountRes.data;

      const record = async (send: ExportSend) => {
        // Un destinataire n'a qu'une ligne : un nouvel essai remplace la précédente.
        const sends = [...entry.sends.filter((s: ExportSend) => s.key !== send.key), send];
        await supabaseAdmin.from('reserve_exports').update({ sends, status: statutDiffusion(sends), updated_at: new Date().toISOString() })
          .eq('id', entry.id).eq('tenant_id', tenantId);
        return { sends, status: statutDiffusion(sends) };
      };
      const base = { key: recipient.key, role: recipient.role, name: recipient.name, email: recipient.email, reserve_count: recipient.reserveIds.length };

      if (!recipient.email) {
        const out = await record({ ...base, status: 'echec', sent_at: new Date().toISOString(), error: "Pas d'adresse e-mail valable sur la fiche." });
        return res.status(400).json({ error: "Ce destinataire n'a pas d'adresse e-mail valable.", ...out });
      }

      const smtpHost = settings.smtp_host || process.env.SMTP_HOST;
      const smtpPort = settings.smtp_port || process.env.SMTP_PORT || '587';
      const smtpUser = settings.smtp_user || process.env.SMTP_USER;
      const smtpPass = settings.smtp_pass || process.env.SMTP_PASS;
      const smtpConfigured = !!(smtpHost && smtpUser && smtpPass);
      if (!defaultAccount && !smtpConfigured) {
        return res.status(500).json({ error: "Aucun moyen d'envoi : connectez votre boîte mail dans la messagerie, ou renseignez le SMTP dans les réglages du cabinet." });
      }
      const transporter = smtpConfigured ? nodemailer.createTransport({
        host: smtpHost, port: parseInt(String(smtpPort)), secure: String(smtpPort) === '465', auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: 40_000,
      }) : null;
      const sender = await resolveEmailSender(supabaseAdmin, { tenantId, userId: req.user.id, settings });
      const replyTo = sender.replyTo || req.user.email || settings.email || undefined;

      const open = ctx.reserves.filter(r => recipient.reserveIds.includes(r.id) && !['Levée', 'Quitus Transmis'].includes(r.status)).length;
      const mail = buildReserveMail({
        role: recipient.role, recipientName: recipient.name, title: RESERVE_TITLE[kind], projectName: ctx.project.name,
        projectCode: ctx.project.project_code, projectAddress: ctx.project.address, agencyName: settings.agency_name,
        signature: (profileRes.data as any)?.mail_signature, note: entry.note, count: recipient.reserveIds.length, open,
      });
      const filename = `${RESERVE_TITLE[kind].replace(/\s+/g, '_')}_${(ctx.project.project_code || ctx.project.name || 'operation').replace(/[^\w-]+/g, '_')}${recipient.role === 'entreprise' ? `_${recipient.name.replace(/[^\w-]+/g, '_')}` : ''}.pdf`.slice(0, 120);
      const attachments = [{ filename, content: file.buffer, contentType: 'application/pdf' }];

      try {
        let viaAccount = false;
        if (defaultAccount) {
          try {
            await sendViaAccount(supabaseAdmin, defaultAccount, { to: recipient.email, subject: mail.subject, text: mail.text, html: mail.html, attachments });
            viaAccount = true;
          } catch (accountErr: any) {
            console.warn('[POST reserve-exports/send] envoi via la boîte connectée impossible', accountErr?.message);
            if (!transporter) throw accountErr;
          }
        }
        if (!viaAccount) {
          await transporter!.sendMail({ from: sender.from, replyTo, to: recipient.email, subject: mail.subject, text: mail.text, html: mail.html, attachments });
        }
      } catch (err: any) {
        console.error('[POST reserve-exports/send] envoi impossible', recipient.key, err?.message);
        const out = await record({ ...base, status: 'echec', sent_at: new Date().toISOString(), error: String(err?.message || 'Envoi impossible').slice(0, 300) });
        return res.status(502).json({ error: `Envoi impossible : ${err?.message || 'erreur'}`, ...out });
      }

      const out = await record({ ...base, status: 'envoye', sent_at: new Date().toISOString() });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Diffusion des ${RESERVE_TITLE[kind].toLowerCase()} à ${recipient.name}`, ctx.project.name, entry.project_id, 'project', 'Réserves/Observations');
      res.json({ success: true, ...out });
    } catch (e: any) {
      console.error('[POST reserve-exports/send]', e);
      res.status(500).json({ error: "L'envoi a échoué." });
    }
  });

  // Rappels hebdomadaires automatiques : réglage de l'opération pour un type de réserves.
  app.get('/api/projects/:projectId/reserve-reminders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const kind = readKind(req.query.kind);
      if (!kind) return res.status(400).json({ error: 'Type de réserves inconnu.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_reminder_settings')
        .select('enabled, interval_days, last_run_at').eq('project_id', req.params.projectId).eq('kind', kind).maybeSingle();
      // Instance non migrée : réglage indisponible, le reste de la fenêtre fonctionne.
      if (error) return res.json({ available: false, enabled: false, interval_days: 7, last_run_at: null });
      res.json({ available: true, enabled: !!(data as any)?.enabled, interval_days: (data as any)?.interval_days ?? 7, last_run_at: (data as any)?.last_run_at ?? null });
    } catch (e: any) {
      console.error('[GET reserve-reminders]', e);
      res.status(500).json({ error: 'Réglage illisible.' });
    }
  });

  app.put('/api/projects/:projectId/reserve-reminders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const kind = readKind(req.body?.kind);
      if (!kind || typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Réglage invalide.' });
      const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id').eq('id', req.params.projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Opération introuvable.' });
      const now = new Date().toISOString();
      const { data: existing, error: readError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_reminder_settings')
        .select('id').eq('project_id', req.params.projectId).eq('kind', kind).maybeSingle();
      if (readError) return res.status(503).json({ error: "Les rappels automatiques ne sont pas disponibles : migration à appliquer." });
      // Activer un rappel remet le compteur à zéro : le premier rappel part au prochain cycle, puis chaque semaine.
      const patch = { enabled: req.body.enabled, updated_by: req.user.id, updated_at: now, ...(req.body.enabled ? { last_run_at: null } : {}) };
      const { error } = existing
        ? await supabaseAdmin.from('reserve_reminder_settings').update(patch).eq('id', (existing as any).id).eq('tenant_id', tenantId)
        : await supabaseAdmin.from('reserve_reminder_settings').insert({ id: randomUUID(), tenant_id: tenantId, project_id: req.params.projectId, kind, ...patch });
      if (error) throw error;
      res.json({ available: true, enabled: req.body.enabled, interval_days: 7, last_run_at: null });
    } catch (e: any) {
      console.error('[PUT reserve-reminders]', e);
      res.status(500).json({ error: "Le réglage n'a pas pu être enregistré." });
    }
  });
}
