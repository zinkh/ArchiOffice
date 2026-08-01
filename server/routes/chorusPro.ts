// Phase 7 extraction — moved out of server.ts's "─── Chorus Pro Integration ───"
// section. Chorus Pro is the French government's mandatory B2G e-invoicing
// platform (facturation à destination des maîtrises d'ouvrage publiques).
// Access uses PISTE (OAuth2 client_credentials) plus a separate Chorus Pro
// "compte technique" sent via the cpro-account header (base64 of
// login:password). Explicit `.eq('tenant_id', tenantId)` chains kept as-is
// rather than tenantScopedFrom, matching the other integration modules.
import type { Express } from 'express';
import { computeEtatAcompte, buildEtatAcomptePdfBuffer } from '../etatAcompte';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

function chorusProUrls(sandbox: boolean) {
  return sandbox
    ? { oauth: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token', api: 'https://sandbox-api.aife.economie.gouv.fr' }
    : { oauth: 'https://oauth.aife.economie.gouv.fr/api/oauth/token', api: 'https://api.aife.economie.gouv.fr' };
}

async function chorusProToken(clientId: string, clientSecret: string, sandbox: boolean): Promise<string> {
  const { oauth } = chorusProUrls(sandbox);
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'openid' });
  const r = await fetch(oauth, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  if (!r.ok) throw new Error(`Chorus Pro (PISTE) — jeton OAuth2 refusé (${r.status}): ${await r.text()}`);
  const json = await r.json() as any;
  return json.access_token as string;
}

async function chorusProFetch(cfg: { token: string; login: string; password: string; sandbox: boolean }, path: string, body: any): Promise<any> {
  const { api } = chorusProUrls(cfg.sandbox);
  const cproAccount = Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64');
  const r = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'cpro-account': cproAccount,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {
    console.error("[chorusPro.ts] Unhandled error parsing Chorus Pro response"); json = { raw: text }; }
  if (!r.ok) throw new Error(`Chorus Pro API — erreur ${r.status}: ${json?.libelle || text}`);
  if (json && typeof json.codeRetour === 'number' && json.codeRetour !== 0) {
    throw new Error(`Chorus Pro API — code retour ${json.codeRetour}: ${json.libelle || 'erreur inconnue'}`);
  }
  return json;
}

function buildChorusProSubmission(invoice: any, items: any[], settings: any): any {
  const vatRate = invoice.vat_rate ?? 20;
  const amountHT = parseFloat(invoice.amount ?? 0);
  const taxAmount = parseFloat(invoice.tax_amount ?? amountHT * vatRate / 100);
  const totalTTC = parseFloat(invoice.total_amount ?? amountHT + taxAmount);
  const sellerSiret = invoice.seller_siret || settings.siret || '';

  const lignePosteDtoList = (items.length > 0 ? items : [{ description: invoice.description || "Honoraires d'architecture", quantity: 1, unit_price: amountHT, vat_rate: vatRate }])
    .map((item: any, idx: number) => ({
      numeroLigne: idx + 1,
      denomination: (item.description || 'Prestation').slice(0, 255),
      quantite: parseFloat(item.quantity ?? 1),
      montantUnitaireHT: parseFloat(item.unit_price ?? 0).toFixed(2),
      montantHTApresRemise: (parseFloat(item.quantity ?? 1) * parseFloat(item.unit_price ?? 0)).toFixed(2),
      tauxTva: parseFloat(item.vat_rate ?? vatRate),
    }));

  return {
    modeDepotSoumission: 'SAISIE_API',
    typeFacture: 'FACTURE',
    typeTva: 'TVA_SUR_DEBIT',
    dateFacture: invoice.issue_date || new Date().toISOString().slice(0, 10),
    dateEcheancePaiement: invoice.due_date || undefined,
    numeroFactureSaisie: invoice.invoice_number || invoice.id,
    devise: invoice.currency || 'EUR',
    fournisseur: { siret: sellerSiret },
    destinataire: { siret: invoice.buyer_siret },
    ...(invoice.engagement_number ? { numeroEngagementFacture: invoice.engagement_number } : {}),
    ...(invoice.buyer_service_code ? { codeServiceExecutant: invoice.buyer_service_code } : {}),
    montantHtTotal: amountHT.toFixed(2),
    montantTvaTotal: taxAmount.toFixed(2),
    montantTtcTotal: totalTTC.toFixed(2),
    ligneTvaDtoList: [{ montantBaseHtLigne: amountHT.toFixed(2), montantTvaLigne: taxAmount.toFixed(2), tauxTvaLigne: vatRate }],
    lignePosteDtoList,
  };
}

function chorusProCfgComplete(cfg: any): boolean {
  return !!(cfg?.chorus_pro_piste_client_id && cfg?.chorus_pro_piste_client_secret && cfg?.chorus_pro_technical_login && cfg?.chorus_pro_technical_password);
}

export function registerChorusProRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // GET /api/chorus-pro/status
  app.get('/api/chorus-pro/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      res.json({ connected: chorusProCfgComplete(cfg), sandbox: cfg?.chorus_pro_sandbox ?? true });
    } catch (e: any) {
      console.error("[GET /api/chorus-pro/status]", e); res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/chorus-pro/disconnect
  app.delete('/api/chorus-pro/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        chorus_pro_piste_client_id: null, chorus_pro_piste_client_secret: null,
        chorus_pro_technical_login: null, chorus_pro_technical_password: null,
      }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Chorus Pro', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/chorus-pro/disconnect]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/chorus-pro/test — verify both credential layers: the PISTE OAuth2
  // client (token request) AND the Chorus Pro compte technique (cpro-account
  // header), by looking up the tenant's own SIRET in the structures directory.
  app.post('/api/chorus-pro/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings')
        .select('siret,chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ connected: false, error: 'Configuration incomplète' });
      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      if (cfg.siret) {
        await chorusProFetch(
          { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
          '/cpro/structures/v1/rechercher/siret',
          { siret: cfg.siret },
        );
      }
      res.json({ connected: true, sandbox });
    } catch (e: any) {
      console.error("[POST /api/chorus-pro/test]", e); res.status(400).json({ connected: false, error: e.message }); }
  });

  // POST /api/chorus-pro/send/:invoiceId — submit one invoice to Chorus Pro
  app.post('/api/chorus-pro/send/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { buyer_siret, buyer_service_code, engagement_number } = req.body || {};

      const [settingsRes, invoiceRes, itemsRes] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
      ]);
      const cfg = settingsRes.data as any;
      let invoice = invoiceRes.data as any;
      const items = itemsRes.data || [];

      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });

      // Fall back to the SIRET already captured on the linked project (Factur-X fields)
      // so it doesn't need to be re-entered when it's already known there.
      let projectSiret: string | null = null;
      if (!buyer_siret && !invoice.buyer_siret && invoice.project_id) {
        const { data: project } = await supabaseAdmin.from('projects').select('client_siret').eq('id', invoice.project_id).eq('tenant_id', tenantId).single();
        projectSiret = (project as any)?.client_siret || null;
      }

      const finalBuyerSiret = buyer_siret || invoice.buyer_siret || projectSiret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire (structure publique) est obligatoire' });

      // Persist the B2G fields for reuse on the next submission of this invoice
      const { data: updated, error: updateErr } = await supabaseAdmin.from('invoices').update({
        buyer_siret: finalBuyerSiret,
        buyer_service_code: buyer_service_code ?? invoice.buyer_service_code ?? null,
        engagement_number: engagement_number ?? invoice.engagement_number ?? null,
      }).eq('id', invoiceId).eq('tenant_id', tenantId).select('*').single();
      if (updateErr) throw updateErr;
      invoice = updated;

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const payload = buildChorusProSubmission(invoice, items, cfg);

      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/soumettre',
        payload,
      );

      const chorusProId = result?.identifiantFactureCPP ? String(result.identifiantFactureCPP) : (result?.numeroFluxDepot ? String(result.numeroFluxDepot) : null);
      const chorusProStatus = 'DEPOSEE';
      await supabaseAdmin.from('invoices').update({ chorus_pro_id: chorusProId, chorus_pro_status: chorusProStatus }).eq('id', invoiceId).eq('tenant_id', tenantId);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Envoi de la facture N° ${invoice.invoice_number || invoiceId.slice(0, 8)} sur Chorus Pro`, '', invoiceId, 'integration', 'Intégrations');
      res.json({ success: true, chorus_pro_id: chorusProId, status: chorusProStatus });
    } catch (e: any) {
      console.error('[Chorus Pro send]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/chorus-pro/status/:invoiceId — consult/refresh the status of a submitted invoice
  app.get('/api/chorus-pro/status/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });

      const { data: inv } = await supabaseAdmin.from('invoices').select('chorus_pro_id,chorus_pro_status').eq('id', invoiceId).eq('tenant_id', tenantId).single();
      const chorusProId = (inv as any)?.chorus_pro_id;
      if (!chorusProId) return res.status(404).json({ error: "Facture non envoyée à Chorus Pro" });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/consulter/historique_statut',
        { identifiantFactureCPP: chorusProId },
      );

      const historique = result?.listeHistoriqueStatutVo || result?.listeStatuts || [];
      const latest = historique.length > 0 ? (historique[historique.length - 1]?.statut || historique[historique.length - 1]?.libelleStatut) : null;
      if (latest) await supabaseAdmin.from('invoices').update({ chorus_pro_status: latest }).eq('id', invoiceId).eq('tenant_id', tenantId);

      res.json({ history: historique, latest_status: latest || (inv as any)?.chorus_pro_status });
    } catch (e: any) {
      console.error("[GET /api/chorus-pro/status/:invoiceId]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/chorus-pro/invoices — list local invoices already submitted to Chorus Pro
  app.get('/api/chorus-pro/invoices', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('invoices')
        .select('*, projects(name)')
        .eq('tenant_id', tenantId)
        .not('chorus_pro_id', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map((inv: any) => {
        const project_name = inv.projects?.name || null;
        const { projects: _p, ...rest } = inv;
        return { ...rest, project_name };
      });
      res.json(result);
    } catch (e: any) {
      console.error("[GET /api/chorus-pro/invoices]", e); res.status(500).json({ error: e.message }); }
  });

  // ── Situations / factures de travaux ────────────────────────────────────────
  // As MOE (maîtrise d'œuvre), ArchiOffice never submits a new facture for a
  // situation de travaux — the entreprise already deposited its own facture on
  // Chorus Pro under its own compte. Per Chorus Pro's official guidance for
  // MOE ("Gérer les factures de travaux sur Chorus Pro pour les MOE"), the
  // MOE's job is to (1) retrieve that facture, (2) accept/rectify the décompte
  // mensuel (already computed by this module), and (3) attach its état
  // d'acompte to the facture as a pièce jointe complémentaire, with its visa.
  async function loadSituationForChorusPro(tenantId: string, situationId: string) {
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

  // POST /api/chorus-pro/search-situation-facture/:situationId — find the
  // entreprise's facture already deposited on Chorus Pro for this marché
  app.post('/api/chorus-pro/search-situation-facture/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { buyer_siret } = req.body || {};

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        loadSituationForChorusPro(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche } = loaded;
      if (!marche?.entreprise_siret) return res.status(400).json({ error: "Le SIRET de l'entreprise (marché lié) est obligatoire pour rechercher sa facture" });
      const finalBuyerSiret = buyer_siret || sit.buyer_siret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire (structure publique) est obligatoire pour la recherche' });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/rechercher/recipiendaire',
        { siretRecipiendaire: finalBuyerSiret, critereRecherche: { siretFournisseur: marche.entreprise_siret } },
      );

      const factures = (result?.listeFactures || result?.factures || []).map((f: any) => ({
        identifiantFactureCPP: f.identifiantFactureCPP ? String(f.identifiantFactureCPP) : String(f.id ?? ''),
        numeroFacture: f.numeroFactureSaisie || f.numeroFacture || null,
        dateFacture: f.dateFacture || f.dateDepot || null,
        montantTtc: f.montantTtcTotal ?? f.montantTTC ?? null,
        statut: f.statut || f.libelleStatut || null,
      }));

      res.json({ factures });
    } catch (e: any) {
      console.error('[Chorus Pro search-situation-facture]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/chorus-pro/link-situation/:situationId — link this situation to
  // the entreprise's facture found on Chorus Pro (no new facture is created)
  app.post('/api/chorus-pro/link-situation/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { chorus_pro_id, buyer_siret, buyer_service_code, engagement_number, statut } = req.body || {};
      if (!chorus_pro_id) return res.status(400).json({ error: 'Identifiant de facture Chorus Pro manquant' });

      const { data: updated, error } = await supabaseAdmin.from('situations').update({
        chorus_pro_id: String(chorus_pro_id),
        chorus_pro_status: statut || 'LIEE',
        buyer_siret: buyer_siret || null,
        buyer_service_code: buyer_service_code || null,
        engagement_number: engagement_number || null,
      }).eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error("[POST /api/chorus-pro/link-situation/:situationId]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/chorus-pro/attach-etat-acompte/:situationId — generate the état
  // d'acompte PDF and deposit it as a pièce jointe complémentaire on the
  // entreprise's facture already linked on Chorus Pro
  app.post('/api/chorus-pro/attach-etat-acompte/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        loadSituationForChorusPro(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche, details } = loaded;
      if (!sit.chorus_pro_id) return res.status(400).json({ error: "Recherchez et liez d'abord la facture de l'entreprise avant de joindre l'état d'acompte" });

      const pdfBuf = await buildEtatAcomptePdfBuffer(sit, marche, details, cfg.agency_name || '');
      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/pieceJointeComplementaire/v1/deposer',
        {
          identifiantFactureCPP: sit.chorus_pro_id,
          nomPieceJointe: `etat-acompte-${sit.numero_situation}.pdf`.slice(0, 50),
          contenuPieceJointe: pdfBuf.toString('base64'),
          commentaire: `État d'acompte MOE n°${sit.numero_situation}${marche ? ` — ${marche.entreprise_nom}, lot ${marche.lot_numero}` : ''}`,
        },
      );

      const { data: updated, error } = await supabaseAdmin.from('situations')
        .update({ etat_acompte_joint_at: new Date().toISOString() })
        .eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error('[Chorus Pro attach-etat-acompte]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/chorus-pro/situation-status/:situationId — consult/refresh the
  // status of the linked entreprise facture (not a facture we deposited)
  app.get('/api/chorus-pro/situation-status/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });

      const { data: sit } = await supabaseAdmin.from('situations').select('chorus_pro_id,chorus_pro_status').eq('id', situationId).eq('tenant_id', tenantId).single();
      const chorusProId = (sit as any)?.chorus_pro_id;
      if (!chorusProId) return res.status(404).json({ error: 'Situation non envoyée à Chorus Pro' });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/consulter/historique_statut',
        { identifiantFactureCPP: chorusProId },
      );

      const historique = result?.listeHistoriqueStatutVo || result?.listeStatuts || [];
      const latest = historique.length > 0 ? (historique[historique.length - 1]?.statut || historique[historique.length - 1]?.libelleStatut) : null;
      if (latest) await supabaseAdmin.from('situations').update({ chorus_pro_status: latest }).eq('id', situationId).eq('tenant_id', tenantId);

      res.json({ history: historique, latest_status: latest || (sit as any)?.chorus_pro_status });
    } catch (e: any) {
      console.error("[GET /api/chorus-pro/situation-status/:situationId]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/chorus-pro/situations — list local situations linked to an entreprise facture on Chorus Pro
  app.get('/api/chorus-pro/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('situations')
        .select('*, marche:marches_entreprises(entreprise_nom,entreprise_siret,lot_numero,lot_titre,tva_rate,revision_active), projects(name)')
        .eq('tenant_id', tenantId)
        .not('chorus_pro_id', 'is', null)
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
      console.error("[GET /api/chorus-pro/situations]", e); res.status(500).json({ error: e.message }); }
  });
}
