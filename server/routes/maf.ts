// Phase 7 extraction — moved out of server.ts's "── MAF — Déclaration des
// activités professionnelles ──" section (professional liability insurance
// declaration, unrelated to invoicing despite reading `situations`/
// `detail_situations` for the cumulative-amount calculation). Fully
// self-contained: no dependency on any other route module.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

// Taux fixes MAF 2025 (‰, hors taxe d'assurance et fonds de solidarité)
const MAF_TAUX_FIXES: Record<string, number> = {
  violet: 0.3593,
  orange_clair: 1.3047,
  orange_fonce: 1.3047,
  bleu: 3.0065,
};

function computeMafAssiette(entry: any, project: any): number {
  const inter = entry.intercalaire ?? 'jaune';
  if (['violet', 'orange_clair', 'orange_fonce', 'bleu', 'rose', 'tabac', 'gris', 'puc'].includes(inter)) {
    return parseFloat(entry.honoraires_ht ?? 0);
  }
  if (inter === 'vert') {
    const surface = parseFloat(project?.surface_plancher ?? 0);
    const cat = (project?.categorie_projet ?? '').toLowerCase();
    const coutM2 = cat.includes('maison') ? 1714 : 1654;
    const M = coutM2 * surface;
    const T = parseFloat(project?.taux_mission ?? 30) / 100;
    const P = parseFloat(project?.part_interet ?? 100) / 100;
    return M * T * P;
  }
  const A = parseFloat(entry.montant_cumul_fin_annee ?? 0);
  const B = parseFloat(entry.montant_cumul_annee_precedente ?? 0);
  const M = A - B;
  const T = parseFloat(project?.taux_mission ?? 100) / 100;
  const P = parseFloat(project?.part_interet ?? 100) / 100;
  return M * T * P;
}

export function registerMafRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // GET /api/maf/v1/config
  app.get('/api/maf/v1/config', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings')
        .select('maf_enabled,maf_numero_adherent,maf_taux_contrat_permil,maf_declaration_year')
        .single();
      res.json(data ?? {});
    } catch (e: any) {
      console.error("[GET /api/maf/v1/config]", e); res.status(500).json({ error: e.message }); }
  });

  // PUT /api/maf/v1/config
  app.put('/api/maf/v1/config', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const allowed = ['maf_enabled', 'maf_numero_adherent', 'maf_taux_contrat_permil', 'maf_declaration_year'];
      const payload: any = {};
      for (const k of allowed) { if (k in req.body) payload[k] = req.body[k]; }
      await supabaseAdmin.from('settings').upsert({ ...payload, tenant_id: tenantId }, { onConflict: 'tenant_id' });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[PUT /api/maf/v1/config]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/entries?year=2025&intercalaire=jaune
  app.get('/api/maf/v1/entries', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;
      let q = tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .select('*, project:projects(id,name,client,categorie_projet,surface_plancher,type_projet,taux_mission,part_interet,doc_date,date_fin_reelle,date_depot_pc,num_permis_construire,sismicite,retrait_argiles,bet_structure,etude_sol,mission_bim,type_moa,nature_travaux_maf,budget,adresse_terrain,cp_ville_terrain,type_et_cat,cotraitants)')
        .eq('declaration_year', year)
        .order('created_at', { ascending: true });
      if (req.query.intercalaire) q = q.eq('intercalaire', req.query.intercalaire);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/maf/v1/entries]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/maf/v1/entries
  app.post('/api/maf/v1/entries', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .insert({ ...req.body })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[POST /api/maf/v1/entries]", e); res.status(500).json({ error: e.message }); }
  });

  // PUT /api/maf/v1/entries/:id
  app.put('/api/maf/v1/entries/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .update(req.body)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[PUT /api/maf/v1/entries/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/maf/v1/entries/:id
  app.delete('/api/maf/v1/entries/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .delete()
        .eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/maf/v1/entries/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/summary?year=2025
  app.get('/api/maf/v1/summary', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;

      const [{ data: cfg }, { data: entries }] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('maf_numero_adherent,maf_taux_contrat_permil').single(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
          .select('*, project:projects(id,name,categorie_projet,surface_plancher,taux_mission,part_interet)')
          .eq('declaration_year', year),
      ]);

      const tauxContrat = parseFloat((cfg as any)?.maf_taux_contrat_permil ?? 0);
      const intercalaires: Record<string, any> = {};
      let cotisationTotale = 0;

      for (const e of (entries ?? [])) {
        const inter = e.intercalaire;
        const tauxPermil = MAF_TAUX_FIXES[inter] ?? tauxContrat;
        const assiette = computeMafAssiette(e, (e as any).project);
        const cotisation = (assiette * tauxPermil) / 1000;
        cotisationTotale += cotisation;
        if (!intercalaires[inter]) {
          intercalaires[inter] = { entries: [], totalAssiette: 0, cotisationEstimee: 0, tauxPermil };
        }
        intercalaires[inter].entries.push({ ...e, assiette, cotisationEstimee: cotisation });
        intercalaires[inter].totalAssiette += assiette;
        intercalaires[inter].cotisationEstimee += cotisation;
      }

      res.json({
        year,
        numeroAdherent: (cfg as any)?.maf_numero_adherent ?? null,
        intercalaires,
        cotisationTotaleEstimee: cotisationTotale,
      });
    } catch (e: any) {
      console.error("[GET /api/maf/v1/summary]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/export-pdf?year=2025
  app.get('/api/maf/v1/export-pdf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;

      const [{ data: cfg }, { data: settingsData }, { data: entries }] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('maf_numero_adherent,maf_taux_contrat_permil,agency_name').single(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('agency_name').single(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
          .select('*, project:projects(id,name,categorie_projet,surface_plancher,taux_mission,part_interet,type_et_cat,client)')
          .eq('declaration_year', year),
      ]);

      const tauxContrat = parseFloat((cfg as any)?.maf_taux_contrat_permil ?? 0);
      const agencyName = (settingsData as any)?.agency_name ?? 'Cabinet';
      const numAdh = (cfg as any)?.maf_numero_adherent ?? '-';

      // Build PDF using jsPDF
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Cover page
      doc.setFillColor(220, 53, 69);
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Déclaration MAF', 14, 22);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Activités professionnelles ${year} — Cotisation avant le 31 mars ${year + 1}`, 14, 32);

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.text(`Cabinet : ${agencyName}`, 14, 52);
      doc.text(`N° adhérent MAF : ${numAdh}`, 14, 58);
      doc.text(`Année : ${year}`, 14, 64);

      // Summary table
      const summaryRows: any[] = [];
      let totalAssiette = 0;
      let totalCotis = 0;
      const LABELS: Record<string, string> = {
        jaune: 'Missions MOE (intercalaire jaune)',
        vert: 'Projet architectural PC (intercalaire vert)',
        ami: 'Accompagnement Maison Individuelle',
        grand_chantier: 'Grands Chantiers',
        violet: 'Missions sans travaux (intercalaire violet)',
        orange_clair: 'AMO / Relevés (intercalaire orange clair)',
        orange_fonce: 'Conventions spéciales (intercalaire orange foncé)',
        bleu: 'BIM Manager sans MOE (intercalaire bleu)',
        rose: 'Ouvrages non soumis (intercalaire rose)',
        tabac: 'Dossiers autorisation (intercalaire tabac)',
        gris: 'VIR / Vente immeuble (intercalaire gris)',
        puc: 'Police Unique de Chantier',
      };

      const grouped: Record<string, { assiette: number; cotis: number; count: number }> = {};
      for (const e of (entries ?? [])) {
        const inter = e.intercalaire;
        const tauxPermil = MAF_TAUX_FIXES[inter] ?? tauxContrat;
        const assiette = computeMafAssiette(e, (e as any).project);
        const cotis = (assiette * tauxPermil) / 1000;
        if (!grouped[inter]) grouped[inter] = { assiette: 0, cotis: 0, count: 0 };
        grouped[inter].assiette += assiette;
        grouped[inter].cotis += cotis;
        grouped[inter].count += 1;
        totalAssiette += assiette;
        totalCotis += cotis;
      }

      for (const [inter, vals] of Object.entries(grouped)) {
        summaryRows.push([
          LABELS[inter] ?? inter,
          vals.count.toString(),
          vals.assiette.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €',
          (MAF_TAUX_FIXES[inter] ?? tauxContrat).toFixed(4) + ' ‰',
          vals.cotis.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €',
        ]);
      }
      summaryRows.push([
        { content: 'TOTAL', styles: { fontStyle: 'bold' } },
        { content: '', styles: { fontStyle: 'bold' } },
        { content: totalAssiette.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', styles: { fontStyle: 'bold' } },
        { content: '', styles: { fontStyle: 'bold' } },
        { content: totalCotis.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', styles: { fontStyle: 'bold' } },
      ]);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Récapitulatif de la déclaration', 14, 76);

      autoTable(doc, {
        startY: 80,
        head: [['Intercalaire', 'Nb missions', 'Assiette', 'Taux (‰)', 'Cotisation estimée']],
        body: summaryRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [220, 53, 69], textColor: 255 },
        margin: { left: 14, right: 14 },
      });

      const buf = doc.output('arraybuffer');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="declaration-maf-${year}.pdf"`);
      res.send(Buffer.from(buf));
    } catch (e: any) {
      console.error("[GET /api/maf/v1/export-pdf]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/maf/v1/submit — Enterprise only (stub)
  app.post('/api/maf/v1/submit', async (req: any, res: any) => {
    res.status(501).json({
      error: 'not_implemented',
      message: 'L\'automatisation de la déclaration MAF est disponible avec le plan Enterprise. Contactez-nous pour en savoir plus.',
      doc: '/api/maf/v1/spec',
    });
  });

  // GET /api/maf/v1/situations-cumul — Calcul A depuis les situations de travaux
  app.get('/api/maf/v1/situations-cumul', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, year } = req.query as { project_id: string; year: string };
      if (!project_id || !year) return res.status(400).json({ error: 'project_id and year required' });
      const yearNum = parseInt(year);
      const endOfYear = `${yearNum}-12-31`;

      // Toutes les situations validées/payées jusqu'au 31/12 de l'année
      const { data: situations } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('id, numero_situation, date_situation, etat')
        .eq('project_id', project_id)
        .in('etat', ['Validée', 'Payée'])
        .lte('date_situation', endOfYear)
        .order('numero_situation', { ascending: true });

      let montantCumulFinAnnee = 0;
      let lastSituation: any = null;

      if (situations?.length) {
        // Agréger les montant_situation de tous les détails
        const ids = situations.map((s: any) => s.id);
        const { data: details } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
          .select('montant_situation')
          .in('situation_id', ids);
        montantCumulFinAnnee = details?.reduce((sum: number, d: any) => sum + (Number(d.montant_situation) || 0), 0) ?? 0;
        lastSituation = situations[situations.length - 1];
      }

      // B = montant_cumul_fin_annee déclaré pour l'année N-1 sur ce projet (intercalaires avec travaux)
      const { data: prevEntry } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .select('montant_cumul_fin_annee')
        .eq('project_id', project_id)
        .eq('declaration_year', yearNum - 1)
        .in('intercalaire', ['jaune', 'ami', 'grand_chantier'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const montantCumulAnneePrecedente = Number(prevEntry?.montant_cumul_fin_annee ?? 0);

      res.json({
        montantCumulFinAnnee,
        montantCumulAnneePrecedente,
        situationCount: situations?.length ?? 0,
        source: lastSituation ? {
          situationId: lastSituation.id,
          situationNumero: lastSituation.numero_situation,
          situationDate: lastSituation.date_situation,
        } : null,
      });
    } catch (e: any) {
      console.error("[GET /api/maf/v1/situations-cumul]", e); res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/maf/v1/entries/:id/statut — Changer le statut (brouillon ↔ declaree)
  app.patch('/api/maf/v1/entries/:id/statut', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { statut } = req.body as { statut: 'brouillon' | 'declaree' };
      if (!['brouillon', 'declaree'].includes(statut)) return res.status(400).json({ error: 'statut invalide' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .update({ statut, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    } catch (e: any) {
      console.error("[PATCH /api/maf/v1/entries/:id/statut]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/suivi — Toutes les années pour traçabilité pluriannuelle
  app.get('/api/maf/v1/suivi', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'maf_project_data')
        .select('*, project:projects(id, name, client, taux_mission, part_interet, categorie_projet, surface_plancher)')
        .order('declaration_year', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/maf/v1/suivi]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/spec — OpenAPI spec
  app.get('/api/maf/v1/spec', (_req: any, res: any) => {
    res.json({
      openapi: '3.0.0',
      info: { title: 'ArchiOffice MAF API', version: '1.0.0' },
      servers: [{ url: '/api/maf/v1' }],
      paths: {
        '/config': { get: {}, put: {} },
        '/entries': { get: {}, post: {} },
        '/entries/{id}': { put: {}, delete: {} },
        '/summary': { get: {} },
        '/export-pdf': { get: {} },
        '/submit': { post: { description: 'Enterprise only — soumet la déclaration à maf.fr' } },
      },
    });
  });
}
