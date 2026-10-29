// Phase 7 extraction — moved out of server.ts's "Reserves" section, part of
// the "suivi de chantier" cluster (see ordresDeService.ts). Distinct from
// Observations (server/routes/observations.ts, lot 3) — reserves are
// tied to a réception (OPR) and auto-numbered per project.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { attachReservePhotos, deleteReservePhotos, normalizeReponse, isMissingReponseColumn } from '../reservePhotos';
import { dispatchWebhookEvent } from '../webhookDispatch';
import { NATURES_RESERVE, type NatureReserve } from '../../src/lib/oprPv';

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
const NATURE_NON_MIGREE = { error: "La nature des réserves n'est pas disponible : migration à appliquer.", code: 'RESERVE_NATURE_UNAVAILABLE' };

/** Nature d'une réserve d'OPR : absente (undefined), vidée (null) ou de vocabulaire fermé ; autre chose est refusé. */
function lireNature(v: unknown): { ok: true; valeur: NatureReserve | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, valeur: undefined };
  if (v === null || v === '') return { ok: true, valeur: null };
  return typeof v === 'string' && (NATURES_RESERVE as readonly string[]).includes(v) ? { ok: true, valeur: v as NatureReserve } : { ok: false };
}
export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  /** Retire les objets des photos d'une réserve supprimée (meilleur effort). */
  deleteFromStorage?: (bucket: string, fileUrl: string) => Promise<void>;
}

export function registerReserveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, deleteFromStorage }: RouteDeps) {
  app.get("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('reserves').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      // Chaque réserve porte ses photos (`photos: []` à défaut) : la liste, la
      // fiche et l'export PDF les lisent sans un appel par réserve.
      res.json(await attachReservePhotos(supabaseAdmin, tenantId, 'opr', data || []));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch reserves" }); }
  });

  app.post("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description } = req.body;
      const nature = lireNature(req.body.nature);
      if (!nature.ok) return res.status(400).json({ error: "Nature de réserve inconnue." });
      // Rejouer la même création après une coupure réseau (file de synchro
      // hors-ligne) ne doit ni créer une seconde réserve, ni consommer un
      // second numéro dans la séquence du projet.
      if (bodyId) {
        const { data: existing } = await supabaseAdmin.from('reserves').select('*').eq('id', bodyId).eq('tenant_id', tenantId).maybeSingle();
        if (existing) return res.status(200).json({ ...(existing as any), photos: (await attachReservePhotos(supabaseAdmin, tenantId, 'opr', [existing as any]))[0]?.photos || [] });
      }
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (reception_id && !(await assertTenantEntity(supabaseAdmin, 'receptions', reception_id, tenantId))) {
        return res.status(400).json({ error: "Réception introuvable pour ce cabinet." });
      }
      if (plan_id && !(await assertTenantEntity(supabaseAdmin, 'plans', plan_id, tenantId))) {
        return res.status(400).json({ error: "Plan introuvable pour ce cabinet." });
      }
      // Get the next number for this project
      const { data: lastRow } = await supabaseAdmin.from('reserves').select('number').eq('tenant_id', tenantId).eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
      const nextNumber = ((lastRow as any)?.number || 0) + 1;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('reserves').insert({
        id, tenant_id: tenantId, project_id, reception_id, title, batiment, local,
        status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber,
        description: description || null,
        ...(nature.valeur ? { nature: nature.valeur } : {}),
      }).select().single();
      if (error && nature.valeur && MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NATURE_NON_MIGREE);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réserve N° ${nextNumber} "${title}"`, title || '', id, 'reserve', 'Réserves/Observations');
      res.json({ ...(data as any), photos: [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reserve" }); }
  });

  app.delete("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: reserve } = await supabaseAdmin.from('reserves').select('title, number').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('reserves').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      await deleteReservePhotos(supabaseAdmin, tenantId, 'opr', req.params.id, deleteFromStorage);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réserve N° ${(reserve as any)?.number} "${(reserve as any)?.title || ''}"`, (reserve as any)?.title || '', req.params.id, 'reserve', 'Réserves/Observations');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reserve" }); }
  });

  app.put("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description, reponse } = req.body;
      const nature = lireNature(req.body.nature);
      if (!nature.ok) return res.status(400).json({ error: "Nature de réserve inconnue." });
      if (plan_id && !(await assertTenantEntity(supabaseAdmin, 'plans', plan_id, tenantId))) {
        return res.status(400).json({ error: "Plan introuvable pour ce cabinet." });
      }
      const { data: existingReserve } = await supabaseAdmin.from('reserves').select('status, project_id, number')
        .eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const update: Record<string, unknown> = { title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description: description ?? null };
      // La réponse de suivi n'est écrite que si le corps la porte : un client qui ne la connaît
      // pas (agent, ancien écran) ne doit pas l'effacer.
      if (reponse !== undefined) update.reponse = normalizeReponse(reponse);
      // La nature non plus : un écran qui ne la connaît pas ne l'efface pas.
      if (nature.valeur !== undefined) update.nature = nature.valeur;
      const { error } = await supabaseAdmin.from('reserves').update(update).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error && nature.valeur !== undefined && MISSING_COLUMN_CODES.has(error.code) && /nature/i.test(String(error.message || ''))) return res.status(503).json(NATURE_NON_MIGREE);
      if (isMissingReponseColumn(error)) return res.status(503).json({ error: "Le suivi des réserves n'est pas disponible : migration à appliquer." });
      if (error) throw error;
      const wasClosed = existingReserve && ['Levée', 'Quitus Transmis'].includes((existingReserve as any).status);
      if (!wasClosed && status && ['Levée', 'Quitus Transmis'].includes(status)) {
        dispatchWebhookEvent(supabaseAdmin, tenantId, 'reserve.resolved', {
          id: req.params.id, title, status, project_id: (existingReserve as any)?.project_id ?? null, number: (existingReserve as any)?.number ?? null,
        });
      }
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description: description ?? null, ...(reponse !== undefined ? { reponse: normalizeReponse(reponse) } : {}) });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reserve" }); }
  });

  // Transforme une réserve d'OPR en réserve de garantie de parfait achèvement. La réserve garde son
  // identifiant (les photos, rangées sous cet identifiant, n'ont qu'à changer de jeu), reçoit le
  // numéro suivant de la série GPA de l'affaire et quitte la liste des réserves AOR. La nature
  // (propre aux cerfas d'OPR) n'a pas d'équivalent en GPA et n'est pas reprise.
  app.post("/api/reserves/:id/to-gpa", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: source } = await supabaseAdmin.from('reserves').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!source) return res.status(404).json({ error: "Réserve introuvable." });
      const r = source as any;
      const { data: dejaGpa } = await supabaseAdmin.from('gpa_reserves').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (dejaGpa) return res.status(409).json({ error: "Cette réserve est déjà une réserve GPA." });

      const { data: lastRow } = await supabaseAdmin.from('gpa_reserves').select('number').eq('tenant_id', tenantId).eq('project_id', r.project_id).order('number', { ascending: false }).limit(1).single();
      const number = ((lastRow as any)?.number || 0) + 1;
      const row: Record<string, unknown> = {
        id, tenant_id: tenantId, project_id: r.project_id, reception_id: r.reception_id ?? null, title: r.title,
        batiment: r.batiment, local: r.local, status: r.status || 'A faire', lots: r.lots, entreprises: r.entreprises,
        created_at: r.created_at, due_date: r.due_date, plan_id: r.plan_id, x: r.x, y: r.y, number,
        description: r.description ?? null,
      };
      if (r.reponse) row.reponse = r.reponse;
      const { data: created, error } = await supabaseAdmin.from('gpa_reserves').insert(row).select().single();
      if (error && isMissingReponseColumn(error)) return res.status(503).json({ error: "Le suivi des réserves n'est pas disponible : migration à appliquer." });
      if (error) throw error;

      // Les photos suivent la réserve : seule leur appartenance change, les objets restent en place.
      try {
        const { error: photoError } = await supabaseAdmin.from('reserve_photos').update({ reserve_kind: 'gpa' })
          .eq('tenant_id', tenantId).eq('reserve_kind', 'opr').eq('reserve_id', id);
        // Table absente (instance non migrée) : il n'y a pas de photos à déplacer.
        if (photoError && (photoError as any).code !== '42P01') throw photoError;
      } catch (photoError) {
        await supabaseAdmin.from('gpa_reserves').delete().eq('id', id).eq('tenant_id', tenantId);
        throw photoError;
      }
      const { error: deleteError } = await supabaseAdmin.from('reserves').delete().eq('id', id).eq('tenant_id', tenantId);
      if (deleteError) {
        // Retour arrière complet : la réserve ne doit exister qu'à un seul endroit.
        await supabaseAdmin.from('reserve_photos').update({ reserve_kind: 'opr' }).eq('tenant_id', tenantId).eq('reserve_kind', 'gpa').eq('reserve_id', id);
        await supabaseAdmin.from('gpa_reserves').delete().eq('id', id).eq('tenant_id', tenantId);
        throw deleteError;
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Réserve N° ${r.number} "${r.title || ''}" transformée en réserve GPA N° ${number}`, r.title || '', id, 'gpa_reserve', 'Réserves GPA');
      const [withPhotos] = await attachReservePhotos(supabaseAdmin, tenantId, 'gpa', [created as any]);
      res.json(withPhotos);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to convert reserve to GPA" }); }
  });

  // Ne change que la nature d'une réserve (le PUT d'une réserve réécrit tous ses champs).
  app.put("/api/reserves/:id/nature", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const nature = lireNature(req.body?.nature);
      if (!nature.ok || nature.valeur === undefined) return res.status(400).json({ error: "Nature de réserve inconnue." });
      const { data: existante } = await supabaseAdmin.from('reserves').select('id').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!existante) return res.status(404).json({ error: "Réserve introuvable." });
      const { error } = await supabaseAdmin.from('reserves').update({ nature: nature.valeur }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error && MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NATURE_NON_MIGREE);
      if (error) throw error;
      res.json({ id: req.params.id, nature: nature.valeur });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reserve nature" }); }
  });
}
