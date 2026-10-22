// Phase 7 extraction — moved out of server.ts's "OS Routes" section (ordres
// de service / work orders). First domain of the newly-scoped "suivi de
// chantier" cluster (site tracking: OS, Visas, Receptions, Reserves, GPA
// reserves, Permits, RFIs) — small, similar-shaped CRUD tables, previously
// left off every prior bilan's "remaining" list by oversight rather than
// deliberate deferral.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { dispatchWebhookEvent } from '../webhookDispatch';
import {
  attribuerNumeros, cleEntreprise, entreprisesDistinctes, formatNumeroOs, numeroHeriteOs, resumeNumeros, type NumeroEntreprise,
} from '../../src/lib/numerotationEntreprise';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

// Verrou par opération (un seul processus) : sérialise l'attribution du numéro d'OS.
const numberLocks = new Map<string, Promise<unknown>>();
async function withProjectLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = numberLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  numberLocks.set(key, tail);
  try { return await run; } finally { if (numberLocks.get(key) === tail) numberLocks.delete(key); }
}

/** Colonnes marche_ids / numeros_entreprises absentes (migration non jouée) : l'OS reste créé, avec son seul marché principal. */
const colonneManquante = (e: any): boolean => !!e && (e.code === '42703' || e.code === 'PGRST204' || /marche_ids|numeros_entreprises/.test(String(e.message || '')));

/** Marchés visés : marche_id d'abord, puis marche_ids, sans doublon. */
export function marcheIdsVises(marcheId: unknown, marcheIds: unknown): string[] {
  const out: string[] = [];
  for (const v of [marcheId, ...(Array.isArray(marcheIds) ? marcheIds : [])]) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 20);
}

/** Numéros que recevrait un OS adressé à ces marchés : un par entreprise, dans la suite de chacune. */
async function numerosPourMarches(supabaseAdmin: any, tenantId: string, projectId: string, marches: any[]): Promise<NumeroEntreprise[]> {
  const [{ data: osRows }, { data: marchesProjet }] = await Promise.all([
    supabaseAdmin.from('ordres_de_service').select('*').eq('tenant_id', tenantId).eq('project_id', projectId),
    supabaseAdmin.from('marches_entreprises').select('id, contact_id, entreprise_nom').eq('tenant_id', tenantId).eq('project_id', projectId),
  ]);
  const cles = new Map<string, string>(((marchesProjet || []) as any[]).map(m => [m.id, cleEntreprise(m)]));
  for (const m of marches) cles.set(m.id, cleEntreprise(m));
  const travaux = ((osRows || []) as any[]).filter(r => !r.type || r.type === 'travaux');
  return attribuerNumeros(travaux, entreprisesDistinctes(marches), id => cles.get(id), numeroHeriteOs);
}

/**
 * Prochain numéro d'OS. Avec des marchés : celui de chaque entreprise visée (« 003 », ou « 003 / 001 »
 * pour plusieurs). Sans marché : le plus grand numéro de l'affaire + 1 (ancien comportement).
 */
export async function prochainNumeroOs(supabaseAdmin: any, tenantId: string, projectId: string | undefined, marcheIds: string[] = []): Promise<string> {
  if (projectId && marcheIds.length) {
    const { data } = await supabaseAdmin.from('marches_entreprises').select('id, contact_id, entreprise_nom').in('id', marcheIds).eq('tenant_id', tenantId);
    const marches = marcheIds.map(id => ((data || []) as any[]).find(m => m.id === id)).filter(Boolean);
    if (marches.length) return resumeNumeros(await numerosPourMarches(supabaseAdmin, tenantId, projectId, marches), formatNumeroOs);
  }
  const query = supabaseAdmin.from('ordres_de_service').select('os_number, type').eq('tenant_id', tenantId);
  if (projectId) query.eq('project_id', projectId);
  const { data } = await query;
  const nums = ((data || []) as any[])
    .filter(r => !r.type || r.type === 'travaux')
    .map(r => parseInt(String(r.os_number), 10))
    .filter(n => Number.isFinite(n));
  return formatNumeroOs((nums.length ? Math.max(...nums) : 0) + 1);
}

export type CreationOs = { ok: true; data: any; entreprise: string | null } | { ok: false; status: number; error: string };

/**
 * Crée un ordre de service (route POST et émission depuis une FTM validée). Valide les marchés
 * (cabinet, affaire, pas d'accord-cadre), résume entreprises et lots, et attribue le numéro de
 * CHAQUE entreprise visée, sous verrou par affaire.
 */
export async function creerOrdreDeService(supabaseAdmin: any, tenantId: string, b: any): Promise<CreationOs> {
  const {
    project_id, os_number, march_number, marche_id, title, date, description, lot, status, type,
    maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
    date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
    incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
  } = b || {};
  if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
    return { ok: false, status: 400, error: "Projet introuvable pour ce cabinet." };
  }
  // Un ordre de service s'adresse toujours à une ou plusieurs entreprises, chacune sur
  // un marché de travaux (marches_entreprises) — jamais un champ libre.
  const marcheIds = marcheIdsVises(marche_id, b?.marche_ids);
  if (marcheIds.length === 0) return { ok: false, status: 400, error: "Un ordre de service doit être rattaché à un marché de travaux." };
  const { data: marchesRows } = await supabaseAdmin.from('marches_entreprises')
    .select('id, project_id, type_marche, contact_id, entreprise_nom, lot_numero, lot_titre').in('id', marcheIds).eq('tenant_id', tenantId);
  const marches = marcheIds.map(mid => (marchesRows || []).find((m: any) => m.id === mid)).filter(Boolean) as any[];
  if (marches.length !== marcheIds.length) return { ok: false, status: 400, error: "Marché de travaux introuvable pour ce cabinet." };
  if (marches.some(m => m.type_marche === 'accord_cadre')) {
    return { ok: false, status: 400, error: "Un ordre de service vise un marché subséquent, pas l'accord-cadre lui-même." };
  }
  if (project_id && marches.some(m => m.project_id !== project_id)) {
    return { ok: false, status: 400, error: "Ce marché n'appartient pas au projet de l'ordre de service." };
  }
  // Plusieurs entreprises : le destinataire et le lot résument tous les marchés visés.
  const multi = marches.length > 1;
  const entrepriseFinale = multi ? marches.map(m => m.entreprise_nom).filter(Boolean).join(' ; ') : (entreprise || marches[0].entreprise_nom || null);
  const lotFinal = multi ? marches.map(m => [m.lot_numero, m.lot_titre].filter(Boolean).join(' ')).filter(Boolean).join(' ; ') : (lot || [marches[0].lot_numero, marches[0].lot_titre].filter(Boolean).join(' — ') || null);
  const typeOs = type || 'travaux';
  const id = crypto.randomUUID();
  const ligne: any = {
    id, tenant_id: tenantId, project_id, march_number, marche_id: marcheIds[0], title, date, description, lot: lotFinal,
    status: status || 'draft', type: typeOs,
    maitrise_oeuvre_adresse, entreprise: entrepriseFinale, origine_demande, montant_marche_ht, objet,
    date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
    incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
    date_emission: b?.date_emission, emetteur_os: b?.emetteur_os,
    destinataire_os: multi ? entrepriseFinale : b?.destinataire_os,
    delai_execution: b?.delai_execution, delai_unit: b?.delai_unit,
  };
  // Numérotation PAR ENTREPRISE (la suite de chacune), attribuée par le serveur sous verrou par
  // affaire : deux créations simultanées ne prennent plus le même numéro. Un avenant MOE garde le sien.
  const insere = await withProjectLock(`os:${tenantId}:${project_id || ''}`, async () => {
    let numeros: NumeroEntreprise[] = [];
    if (typeOs === 'travaux') {
      numeros = await numerosPourMarches(supabaseAdmin, tenantId, project_id || marches[0].project_id, marches);
      ligne.os_number = resumeNumeros(numeros, formatNumeroOs);
    } else {
      ligne.os_number = os_number;
    }
    let r = await supabaseAdmin.from('ordres_de_service').insert({ ...ligne, marche_ids: marcheIds, numeros_entreprises: numeros }).select().single();
    if (r.error && colonneManquante(r.error)) r = await supabaseAdmin.from('ordres_de_service').insert(ligne).select().single();
    return r;
  });
  if (insere.error) throw insere.error;
  return { ok: true, data: insere.data, entreprise: entrepriseFinale };
}

export function registerOrdresDeServiceRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('ordres_de_service').select('*').eq('tenant_id', tenantId);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch OS" });
    }
  });

  app.post("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const r = await creerOrdreDeService(supabaseAdmin, tenantId, req.body);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      const { id, title, project_id, os_number } = r.data;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'ordre de service "${title || os_number}"`, title || os_number || '', id, 'ordre_de_service', 'Ordres de service');
      dispatchWebhookEvent(supabaseAdmin, tenantId, 'ordre_service.created', { id, project_id, title, os_number, entreprise: r.entreprise });
      res.status(201).json(r.data);
    } catch (e: any) {
      console.error("Error creating OS:", e);
      res.status(500).json({ error: "Failed to create OS", details: e.message });
    }
  });

  app.put("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        os_number, march_number, marche_id, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      } = req.body;
      const marcheIds = marcheIdsVises(marche_id, req.body?.marche_ids);
      if (marcheIds.length) {
        const { data: marchesRows } = await supabaseAdmin.from('marches_entreprises').select('id, type_marche').in('id', marcheIds).eq('tenant_id', tenantId);
        if ((marchesRows || []).length !== marcheIds.length) return res.status(400).json({ error: "Marché de travaux introuvable pour ce cabinet." });
        if ((marchesRows as any[]).some(m => m.type_marche === 'accord_cadre')) {
          return res.status(400).json({ error: "Un ordre de service vise un marché subséquent, pas l'accord-cadre lui-même." });
        }
      }
      const miseAJour: any = {
        os_number, march_number, marche_id: marcheIds[0] ?? marche_id, title, date, description, lot, status, type: type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      };
      const ecrire = (corps: any) => supabaseAdmin.from('ordres_de_service').update(corps).eq('id', id).eq('tenant_id', tenantId);
      let { error } = await ecrire(marcheIds.length > 1 || Array.isArray(req.body?.marche_ids) ? { ...miseAJour, marche_ids: marcheIds } : miseAJour);
      if (error && colonneManquante(error)) ({ error } = await ecrire(miseAJour));
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update OS" });
    }
  });

  app.delete("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'ordre de service "${label}"`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete OS" });
    }
  });

  // PATCH status transition for OS
  app.patch("/api/ordres_de_service/:id/status", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, date_ar, date_execution, notes_ar } = req.body;
      const validStatuses = ['draft', 'submitted', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const updateData: any = { status };
      if (status === 'submitted') updateData.date_emission = new Date().toISOString().split('T')[0];
      if (date_ar) updateData.date_ar = date_ar;
      if (date_execution) updateData.date_execution = date_execution;
      if (notes_ar) updateData.notes_ar = notes_ar;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const STATUS_LABELS: Record<string, string> = { draft: 'brouillon', submitted: 'soumis', approved: 'approuvé', rejected: 'rejeté' };
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ordre de service "${label}" marqué ${STATUS_LABELS[status] || status}`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET next OS number for a project
  app.get("/api/ordres_de_service/next-number", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const ids = String(req.query.marche_ids ?? '').split(',').map(x => x.trim()).filter(Boolean);
      res.json({ next: await prochainNumeroOs(supabaseAdmin, tenantId, project_id as string | undefined, ids) });
    } catch (e: any) {
      console.error("[GET /api/ordres_de_service/next-number]", e); res.status(500).json({ error: e.message }); }
  });
}
