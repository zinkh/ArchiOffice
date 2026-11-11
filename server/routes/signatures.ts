import type { Express } from 'express';
import multer from 'multer';
import { isSuperAdmin } from '../superAdminAuth';
import { logAdminAction } from '../adminAudit';
import { encryptSecret } from '../secretsCrypto';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { withSignaturePage, firmaEnabled, resolveSignatureProvider, signatureContext, sendSignature, syncSignature, signatureDownload, type SignatureProvider } from '../signatures';
import { followUpDate } from '../../src/lib/proposalFollowUp';
interface Deps { supabaseAdmin: any; getTenantId: (id: string) => Promise<string>; requireTenantAdmin: (id: string) => Promise<string> }
export function registerSignatureRoutes(app: Express, { supabaseAdmin: db, getTenantId, requireTenantAdmin }: Deps) {
  const settings = async (tenantId: string) => {
    const { data, error } = await db.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    if (error) throw error; return data;
  };
  const load = async (tenantId: string, id: string) => {
    const { data, error } = await db.from('proposals').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error) throw error; return data;
  };
  const save = async (tenantId: string, id: string, patch: any) => {
    const { data, error } = await db.from('proposals').update(patch).eq('tenant_id', tenantId).eq('id', id).select().single();
    if (error) throw error; return data;
  };
  const adminOnly = async (req: any, res: any, next: any) => {
    try {
      if (!(await isSuperAdmin(db, req.user))) return res.status(403).json({ error: 'Accès réservé au superadmin.' });
      next();
    } catch { res.status(500).json({ error: 'Contrôle des droits indisponible.' }); }
  };
  app.get('/api/admin/signatures', adminOnly, async (_req: any, res: any) => {
    try { res.json({ firma_enabled: await firmaEnabled(db), firma_configured: !!process.env.FIRMA_API_KEY }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/admin/signatures', adminOnly, async (req: any, res: any) => {
    try {
      if (typeof req.body?.firma_enabled !== 'boolean') return res.status(400).json({ error: 'Activation invalide.' });
      if (req.body.firma_enabled && !process.env.FIRMA_API_KEY) return res.status(400).json({ error: 'Configurez FIRMA_API_KEY sur le serveur avant activation.' });
      encryptSecret('preflight');
      const { error } = await db.from('platform_settings').upsert({ key: 'firma_signature', value: { enabled: req.body.firma_enabled },
        updated_at: new Date().toISOString(), updated_by: req.user.id }, { onConflict: 'key' });
      if (error) throw error;
      await logAdminAction(db, req.user, 'signature.firma.configure', null, { enabled: req.body.firma_enabled });
      res.json({ firma_enabled: req.body.firma_enabled, firma_configured: !!process.env.FIRMA_API_KEY });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/signatures/status', async (req: any, res: any) => {
    try {
      const s = await settings(await getTenantId(req.user.id)); const enabled = await firmaEnabled(db);
      res.json({ provider: resolveSignatureProvider(enabled, s), firma_enabled: enabled, docuseal_connected: !!s?.docuseal_api_key,
        docuseal_region: s?.docuseal_region || 'eu', zoho_connected: !!s?.zoho_sign_refresh_token, tenant_provider: s?.signature_provider || null });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/signatures/config', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id); const p = req.body;
      if (!['docuseal', 'zoho', null].includes(p?.provider)) return res.status(400).json({ error: 'Fournisseur invalide.' });
      if (p.docuseal_region !== undefined && !['eu', 'com'].includes(p.docuseal_region)) return res.status(400).json({ error: 'Région DocuSeal invalide.' });
      if (p.docuseal_api_key !== undefined && (typeof p.docuseal_api_key !== 'string' || p.docuseal_api_key.length > 2000)) return res.status(400).json({ error: 'Clé DocuSeal invalide.' });
      const patch: any = { signature_provider: p.provider };
      if (p.docuseal_region) patch.docuseal_region = p.docuseal_region;
      if (p.docuseal_api_key?.trim()) patch.docuseal_api_key = encryptSecret(p.docuseal_api_key.trim());
      if (p.disconnect_docuseal === true) { patch.docuseal_api_key = null; if (p.provider === 'docuseal') patch.signature_provider = null; }
      const { data, error } = await db.from('settings').update(patch).eq('tenant_id', tenantId).select('tenant_id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'Enregistrez d’abord les paramètres du cabinet.' });
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });
  const middleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } }).single('file');
  const upload = (req: any, res: any, next: any) => middleware(req, res, (error: any) => error ? res.status(400).json({ error: 'PDF invalide ou supérieur à 20 Mo.' }) : next());
  app.post('/api/proposals/:id/signature', upload, async (req: any, res: any) => {
    let tenantId: string | undefined; let claimed = false; let externalId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id); const p = await load(tenantId, req.params.id);
      if (!p) return res.status(404).json({ error: 'Proposition introuvable.' });
      if (p.archived_at || !['Draft', 'Sent'].includes(p.status) || p.signature_request_id || p.signature_status) return res.status(409).json({ error: 'Signature déjà créée ou proposition clôturée.' });
      const email = String(req.body?.recipient_email || '').trim(); const name = String(req.body?.recipient_name || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 200) return res.status(400).json({ error: 'Nom et e-mail du signataire requis.' });
      if (!req.file?.buffer || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'Un PDF valide est requis.' });
      const s = await settings(tenantId); const provider = resolveSignatureProvider(await firmaEnabled(db), s);
      if (!provider) return res.status(409).json({ error: 'Activez un fournisseur de signature dans les paramètres.' });
      const bytes = await withSignaturePage(req.file.buffer, p.reference || p.title || '');
      const ctx = await signatureContext(db, tenantId, s, provider);
      const { data: lock, error } = await db.from('proposals').update({ signature_provider: provider, signature_status: 'creating',
        signature_recipient_email: email, signature_recipient_name: name,
        signature_provider_region: provider === 'docuseal' ? (s.docuseal_region || 'eu') : provider === 'zoho' ? (s.zoho_data_center || 'eu') : null,
      }).eq('tenant_id', tenantId).eq('id', p.id).eq('status', p.status).is('archived_at', null)
        .is('signature_status', null).is('signature_request_id', null).select().maybeSingle();
      if (error) throw error;
      if (!lock) return res.status(409).json({ error: 'Envoi déjà démarré. Actualisez le suivi.' });
      claimed = true;
      const status = await sendSignature(ctx, { bytes, email, name, title: ((p.reference || '') + ' ' + p.title).slice(0, 200) }, async id => {
        externalId = id; await save(tenantId!, p.id, { signature_request_id: id, signature_status: 'draft' });
      });
      const now = new Date().toISOString();
      res.json(await save(tenantId, p.id, { signature_status: status, signature_sent_at: now, status: 'Sent',
        sent_at: p.sent_at || now, next_follow_up_at: p.last_response_at ? null : followUpDate(now) }));
    } catch (e: any) {
      externalId ||= e.externalId;
      if (claimed && tenantId) await save(tenantId, req.params.id, { signature_status: 'unknown', ...(externalId ? { signature_request_id: externalId } : {}) }).catch(() => {});
      res.status(502).json({ error: claimed ? 'Envoi non confirmé. Actualisez le suivi et vérifiez le fournisseur avant toute nouvelle action.' : e.message });
    }
  });
  const existingContext = async (tenantId: string, p: any) => {
    if (!['firma', 'docuseal', 'zoho'].includes(p.signature_provider)) throw new Error('Fournisseur de la demande inconnu.');
    const s = await settings(tenantId);
    if (p.signature_provider === 'firma' && !s?.firma_workspace_api_key) throw new Error('Espace Firma du cabinet indisponible. Contactez le superadmin.');
    // Never reroute an existing envelope when the platform/agency default changes.
    return signatureContext(db, tenantId, { ...s, ...(p.signature_provider_region ? { docuseal_region: p.signature_provider_region, zoho_data_center: p.signature_provider_region } : {}) }, p.signature_provider as SignatureProvider);
  };
  app.post('/api/proposals/:id/signature/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id); const p = await load(tenantId, req.params.id);
      if (!p?.signature_request_id) return res.status(404).json({ error: 'Aucune demande liée. Vérifiez le fournisseur si l’envoi est incertain.' });
      const state = await syncSignature(await existingContext(tenantId, p), p.signature_request_id);
      const patch: any = { signature_status: state };
      if (state === 'completed') {
        patch.signature_completed_at = p.signature_completed_at || new Date().toISOString();
        patch.last_response_at = p.last_response_at || patch.signature_completed_at; patch.next_follow_up_at = null;
      } else if (state === 'inprogress' && !p.signature_sent_at) {
        const now = new Date().toISOString(); patch.signature_sent_at = now;
        if (p.status === 'Draft') { patch.status = 'Sent'; patch.sent_at = p.sent_at || now; patch.next_follow_up_at = followUpDate(now); }
      }
      res.json(await save(tenantId, p.id, patch));
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });
  app.get('/api/proposals/:id/signature/pdf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id); const p = await load(tenantId, req.params.id);
      if (!p?.signature_request_id || p.signature_status !== 'completed') return res.status(409).json({ error: 'Actualisez le suivi pour vérifier la signature.' });
      const ctx = await existingContext(tenantId, p); const target = await signatureDownload(ctx, p.signature_request_id);
      if (!target.direct) {
        const url = new URL(target.url);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Lien de téléchargement invalide.');
        // Return provider-generated temporary links instead of fetching arbitrary hosts server-side.
        return res.json({ url: url.toString() });
      }
      const response = await fetchWithTimeout(target.url, { headers: { Authorization: 'Zoho-oauthtoken ' + ctx.key } }, 30000);
      if (!response.ok) throw new Error('Téléchargement impossible.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Réponse PDF invalide.');
      res.type('application/pdf').set('Content-Disposition', 'attachment; filename="proposition-signee.pdf"').send(bytes);
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });
}
