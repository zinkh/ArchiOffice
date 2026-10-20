// Phase 7 extraction — moved out of server.ts's "Permits (PC / DP / AT)"
// section, part of the "suivi de chantier" cluster (see ordresDeService.ts).
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

function numberOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function textOrNull(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Mentions du panneau d'affichage (migrate_panneaux.sql) : seulement les champs
 * présents dans le corps, pour qu'un client plus ancien n'efface rien.
 */
export function panneauExtras(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body?.nature_projet !== undefined) out.nature_projet = textOrNull(body.nature_projet, 500);
  if (body?.mairie_nom !== undefined) out.mairie_nom = textOrNull(body.mairie_nom, 200);
  if (body?.mairie_adresse !== undefined) out.mairie_adresse = textOrNull(body.mairie_adresse, 300);
  if (body?.numero_decision !== undefined) out.numero_decision = textOrNull(body.numero_decision, 80);
  if (body?.superficie_terrain_m2 !== undefined) out.superficie_terrain_m2 = numberOrNull(body.superficie_terrain_m2);
  if (body?.surface_plancher_m2 !== undefined) out.surface_plancher_m2 = numberOrNull(body.surface_plancher_m2);
  if (body?.hauteur_m !== undefined) out.hauteur_m = numberOrNull(body.hauteur_m);
  if (body?.nombre_logements !== undefined) {
    const n = numberOrNull(body.nombre_logements);
    out.nombre_logements = n === null ? null : Math.round(n);
  }
  return out;
}

export function registerPermitRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/permits", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      let query = supabaseAdmin.from('permits').select('*').eq('tenant_id', tenantId);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch permits" }); }
  });

  app.post("/api/permits", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, type, reference, submission_date, decision_date, status, notes } = req.body;
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { data, error } = await supabaseAdmin.from('permits').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, type, reference: reference || null,
        submission_date: submission_date || null, decision_date: decision_date || null,
        status: status || 'en_instruction', notes: notes || null, created_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create permit" }); }
  });

  app.put("/api/permits/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { type, reference, submission_date, decision_date, status, notes } = req.body;
      const extras = panneauExtras(req.body);
      const { data, error } = await supabaseAdmin.from('permits').update({
        type, reference: reference || null, submission_date: submission_date || null,
        decision_date: decision_date || null, status, notes: notes || null, ...extras
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error && Object.keys(extras).length && MISSING_COLUMN_CODES.has((error as any).code)) {
        return res.status(503).json({ error: 'Les champs du panneau d’affichage ne sont pas encore créés sur cette instance (migration migrate_panneaux.sql).' });
      }
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update permit" }); }
  });

  app.delete("/api/permits/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('permits').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete permit" }); }
  });
}
