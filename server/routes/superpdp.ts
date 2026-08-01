// Phase 7 extraction — moved out of server.ts's "─── SuperPDP Integration ───"
// section. SuperPDP is the Plateforme Agréée used for the cabinet's own
// honoraires invoices (Factur-X/EN16931) and, for private-market situations,
// to attach the état d'acompte MOE to the entreprise's own facture (Chorus
// Pro is reserved for marchés publics — see chorusPro.ts). Explicit
// `.eq('tenant_id', tenantId)` chains kept as-is rather than tenantScopedFrom,
// matching the other integration modules.
import type { Express } from 'express';
import { buildEnInvoiceData } from '../../src/lib/facturX';
import { computeEtatAcompte, buildEtatAcomptePdfBuffer } from '../etatAcompte';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const SUPERPDP_BASE = 'https://api.superpdp.tech';

async function superpdpToken(clientId: string, clientSecret: string): Promise<string> {
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  const r = await fetch(`${SUPERPDP_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`SuperPDP token error ${r.status}: ${await r.text()}`);
  const json = await r.json() as any;
  return json.access_token as string;
}

async function superpdpFetch(token: string, path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(opts.headers as any || {}) };
  const r = await fetch(`${SUPERPDP_BASE}${path}`, { ...opts, headers });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SuperPDP API error ${r.status}: ${body}`);
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return r.json();
  return r.text();
}

// Maps this route's local (loosely-typed, snake_case DB row) shapes onto the
// shared FacturXInvoiceData contract — see src/lib/facturX.ts for why this
// and the client-side XML export (InvoiceGenerator.tsx) now share one
// implementation instead of two that could silently drift apart.
function buildEnInvoice(invoice: any, items: any[], settings: any): any {
  const vatRate = invoice.vat_rate ?? 20;
  const amountHT = parseFloat(invoice.amount ?? 0);
  const taxAmount = parseFloat(invoice.tax_amount ?? amountHT * vatRate / 100);
  const totalTTC = parseFloat(invoice.total_amount ?? amountHT + taxAmount);

  return buildEnInvoiceData({
    invoiceNumber: invoice.invoice_number || invoice.id,
    invoiceType: invoice.invoice_type,
    issueDate: invoice.issue_date || new Date().toISOString().slice(0, 10),
    dueDate: invoice.due_date || undefined,
    currency: 'EUR',
    vatRate,
    description: invoice.description,
    // Totals stay authoritative from the invoice row (an acompte invoice
    // bills a percentage of a mission, not necessarily the sum of these
    // display line items) — computeFacturXTotals(items) is not used here.
    totals: { net: amountHT, vat: taxAmount, gross: totalTTC },
    items: items.map((item: any) => ({
      description: item.description || 'Prestation',
      quantity: parseFloat(item.quantity ?? 1),
      unitPrice: parseFloat(item.unit_price ?? 0),
      vatRate,
    })),
    seller: {
      name: invoice.seller_name || settings.agency_name || 'Architecte',
      address: invoice.seller_address || settings.address || '',
      siret: invoice.seller_siret || settings.siret || '',
      vatNumber: invoice.seller_vat_number || settings.vat_number || '',
      email: settings.email || '',
    },
    buyer: {
      name: invoice.client_name || invoice.mission_name || 'Client',
    },
  });
}

export function registerSuperpdpRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // GET /api/superpdp/status
  app.get('/api/superpdp/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret,superpdp_sandbox').eq('tenant_id', tenantId).single();
      const connected = !!(s as any)?.superpdp_client_id && !!(s as any)?.superpdp_client_secret;
      res.json({ connected, sandbox: (s as any)?.superpdp_sandbox ?? true });
    } catch (e: any) {
      console.error("[GET /api/superpdp/status]", e); res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/superpdp/disconnect
  app.delete('/api/superpdp/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({ superpdp_client_id: null, superpdp_client_secret: null }).eq('tenant_id', tenantId);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/superpdp/disconnect]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/superpdp/test — verify credentials by fetching company info
  app.post('/api/superpdp/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Configuration incomplète' });
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const company = await superpdpFetch(token, '/v1.beta/companies/me');
      res.json({ connected: true, company: company?.formal_name || company?.name || 'SuperPDP' });
    } catch (e: any) {
      console.error("[POST /api/superpdp/test]", e); res.status(400).json({ connected: false, error: e.message }); }
  });

  // POST /api/superpdp/send/:invoiceId — send one invoice to SuperPDP
  app.post('/api/superpdp/send/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;

      const [settingsRes, invoiceRes, itemsRes] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
      ]);
      const cfg = settingsRes.data as any;
      const invoice = invoiceRes.data as any;
      const items = itemsRes.data || [];

      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });
      if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const enInvoice = buildEnInvoice(invoice, items, cfg);

      // Convert en16931 JSON → CII XML
      const ciiXml = await superpdpFetch(token, '/v1.beta/invoices/convert?from=en16931&to=cii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/xml' },
        body: JSON.stringify(enInvoice),
      });

      // Send CII XML to SuperPDP
      const externalId = invoiceId.slice(0, 36);
      const sent = await superpdpFetch(token, `/v1.beta/invoices?external_id=${encodeURIComponent(externalId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: typeof ciiXml === 'string' ? ciiXml : JSON.stringify(ciiXml),
      });

      const superpdpId = sent?.id;
      const superpdpStatus = sent?.events?.[sent.events.length - 1]?.status_code || 'api:uploaded';
      await supabaseAdmin.from('invoices').update({ superpdp_id: superpdpId, superpdp_status: superpdpStatus }).eq('id', invoiceId);

      res.json({ success: true, superpdp_id: superpdpId, status: superpdpStatus });
    } catch (e: any) {
      console.error("[POST /api/superpdp/send/:invoiceId]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/events/:invoiceId — get lifecycle events for an invoice
  app.get('/api/superpdp/events/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });

      const { data: inv } = await supabaseAdmin.from('invoices').select('superpdp_id,superpdp_status').eq('id', invoiceId).eq('tenant_id', tenantId).single();
      const superpdpId = (inv as any)?.superpdp_id;
      if (!superpdpId) return res.status(404).json({ error: 'Facture non envoyée via SuperPDP' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const events = await superpdpFetch(token, `/v1.beta/invoice_events?invoice_id=${superpdpId}`);

      // Update local status with latest event
      const latest = events?.data?.[events.data.length - 1]?.status_code;
      if (latest) await supabaseAdmin.from('invoices').update({ superpdp_status: latest }).eq('id', invoiceId);

      res.json({ events: events?.data || [], latest_status: latest });
    } catch (e: any) {
      console.error("[GET /api/superpdp/events/:invoiceId]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/invoices — list all invoices from SuperPDP
  app.get('/api/superpdp/invoices', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const result = await superpdpFetch(token, '/v1.beta/invoices?direction=out&limit=100');
      res.json(result);
    } catch (e: any) {
      console.error("[GET /api/superpdp/invoices]", e); res.status(500).json({ error: e.message }); }
  });

  // ── Situations / factures de travaux — marchés privés ──────────────────────
  // Chorus Pro is reserved for marchés publics. For private markets, the same
  // workflow (retrouver la facture de l'entreprise, la lier, joindre l'état
  // d'acompte MOE en pièce jointe complémentaire) is offered via Super PDP,
  // the Plateforme Agréée déjà connectée par le cabinet pour ses honoraires.
  async function loadSituationForSuperpdp(tenantId: string, situationId: string) {
    const { data: sit } = await supabaseAdmin
      .from('situations')
      .select('*, marche:marches_entreprises(*)')
      .eq('id', situationId)
      .eq('tenant_id', tenantId)
      .single();
    if (!sit) return null;
    const marche = (sit as any).marche as any;
    const { data: detailsRaw } = await supabaseAdmin
      .from('detail_situations')
      .select('*, dpgf_item:dpgf_items(designation, prix_unitaire_ht, quantite_prevue, unite)')
      .eq('tenant_id', tenantId)
      .eq('situation_id', situationId);
    return { sit, marche, details: detailsRaw ?? [] };
  }

  // POST /api/superpdp/search-situation-facture/:situationId — find the
  // entreprise's facture already deposited on Super PDP for this marché
  app.post('/api/superpdp/search-situation-facture/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { buyer_siret } = req.body || {};

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single(),
        loadSituationForSuperpdp(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche } = loaded;
      if (!marche?.entreprise_siret) return res.status(400).json({ error: "Le SIRET de l'entreprise (marché lié) est obligatoire pour rechercher sa facture" });
      const finalBuyerSiret = buyer_siret || sit.buyer_siret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire est obligatoire pour la recherche' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const result = await superpdpFetch(token, `/v1.beta/invoices?supplier_siret=${encodeURIComponent(marche.entreprise_siret)}&buyer_siret=${encodeURIComponent(finalBuyerSiret)}&limit=20`);

      const factures = (result?.data || []).map((f: any) => ({
        identifiantFactureCPP: String(f.id),
        numeroFacture: f.en_invoice?.number || null,
        dateFacture: f.en_invoice?.issue_date || null,
        montantTtc: f.en_invoice?.totals?.total_with_vat ? Number(f.en_invoice.totals.total_with_vat) : null,
        statut: f.events?.[f.events.length - 1]?.status_code || null,
      }));

      res.json({ factures });
    } catch (e: any) {
      console.error('[SuperPDP search-situation-facture]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/superpdp/link-situation/:situationId — link this situation to
  // the entreprise's facture found on Super PDP (no new facture is created)
  app.post('/api/superpdp/link-situation/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { superpdp_id, statut, buyer_siret, buyer_service_code, engagement_number } = req.body || {};
      if (!superpdp_id) return res.status(400).json({ error: 'Identifiant de facture Super PDP manquant' });

      const { data: updated, error } = await supabaseAdmin.from('situations').update({
        superpdp_id: Number(superpdp_id),
        superpdp_status: statut || 'api:uploaded',
        buyer_siret: buyer_siret || null,
        buyer_service_code: buyer_service_code || null,
        engagement_number: engagement_number || null,
      }).eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error("[POST /api/superpdp/link-situation/:situationId]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/superpdp/attach-etat-acompte/:situationId — generate the état
  // d'acompte PDF and deposit it as a complementary attachment on the
  // entreprise's facture already linked on Super PDP
  app.post('/api/superpdp/attach-etat-acompte/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('agency_name,superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single(),
        loadSituationForSuperpdp(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche, details } = loaded;
      if (!sit.superpdp_id) return res.status(400).json({ error: "Recherchez et liez d'abord la facture de l'entreprise avant de joindre l'état d'acompte" });

      const pdfBuf = await buildEtatAcomptePdfBuffer(sit, marche, details, cfg.agency_name || '');
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      await superpdpFetch(token, `/v1.beta/invoices/${sit.superpdp_id}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `etat-acompte-${sit.numero_situation}.pdf`,
          content_base64: pdfBuf.toString('base64'),
          comment: `État d'acompte MOE n°${sit.numero_situation}${marche ? ` — ${marche.entreprise_nom}, lot ${marche.lot_numero}` : ''}`,
        }),
      });

      const { data: updated, error } = await supabaseAdmin.from('situations')
        .update({ etat_acompte_joint_at: new Date().toISOString() })
        .eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error('[SuperPDP attach-etat-acompte]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/superpdp/situation-status/:situationId — consult/refresh the
  // status of the linked entreprise facture
  app.get('/api/superpdp/situation-status/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });

      const { data: sit } = await supabaseAdmin.from('situations').select('superpdp_id,superpdp_status').eq('id', situationId).eq('tenant_id', tenantId).single();
      const superpdpId = (sit as any)?.superpdp_id;
      if (!superpdpId) return res.status(404).json({ error: 'Situation non liée à Super PDP' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const events = await superpdpFetch(token, `/v1.beta/invoice_events?invoice_id=${superpdpId}`);
      const latest = events?.data?.[events.data.length - 1]?.status_code;
      if (latest) await supabaseAdmin.from('situations').update({ superpdp_status: latest }).eq('id', situationId).eq('tenant_id', tenantId);

      res.json({ events: events?.data || [], latest_status: latest || (sit as any)?.superpdp_status });
    } catch (e: any) {
      console.error("[GET /api/superpdp/situation-status/:situationId]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/situations — list local situations linked to an entreprise facture on Super PDP
  app.get('/api/superpdp/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('situations')
        .select('*, marche:marches_entreprises(entreprise_nom,entreprise_siret,lot_numero,lot_titre,tva_rate,revision_active), projects(name)')
        .eq('tenant_id', tenantId)
        .not('superpdp_id', 'is', null)
        .order('date_situation', { ascending: false });
      if (error) throw error;
      const result = await Promise.all((data || []).map(async (s: any) => {
        const { data: details } = await supabaseAdmin.from('detail_situations').select('*').eq('tenant_id', tenantId).eq('situation_id', s.id);
        const net = computeEtatAcompte(s, s.marche, details ?? []);
        const project_name = s.projects?.name || null;
        const { projects: _p, ...rest } = s;
        return { ...rest, project_name, montant_ttc: net.net };
      }));
      res.json(result);
    } catch (e: any) {
      console.error("[GET /api/superpdp/situations]", e); res.status(500).json({ error: e.message }); }
  });
}
