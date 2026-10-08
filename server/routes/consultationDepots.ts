// Espace de dépôt des offres, côté cabinet : réglages d'une consultation, liens
// d'invitation par entreprise, zone d'attente des remises et leur traitement.
// Le côté entreprise (public, par jeton) est dans consultationDepotPublic.ts.
//
// Règles de gating :
//   - créer un lien ou changer les réglages exige l'éligibilité complète (plan
//     Enterprise, marché privé, espace de stockage externe actif) ;
//   - traiter une remise (intégrer, rejeter, analyser) exige le plan Enterprise ;
//   - LIRE ce qui a déjà été reçu reste possible après un changement de plan ou
//     de stockage : des offres déposées ne deviennent pas illisibles.
//
// Plis scellés : tant que l'option est cochée et la date limite non atteinte, le
// cabinet voit qu'une remise existe mais ni son contenu ni son nom, ne peut ni
// l'ouvrir, ni l'intégrer, ni l'analyser (423), et ne peut pas lever le
// scellement ni avancer la date limite.
import crypto from 'crypto';
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { evaluerEligibilite, type DepsEligibilite } from '../consultationDepot/eligibility';
import { genererJeton, hacherJeton, lienDepot } from '../consultationDepot/tokens';
import { parseExternalRef } from '../externalStorage/externalRef';
import { getConnectionById } from '../externalStorage/externalConnection';
import { signExternalTicket } from '../externalStorage/externalTicket';
import { isValidEmail } from '../../src/lib/crDiffusion';
import { expirationLien, plisScelles, type ReglagesDepot } from '../../src/lib/consultationDepot';

export interface RouteDeps extends DepsEligibilite {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MAX_CONSIGNES = 4000;
const MAX_NOM = 200;

const message423 = 'Les plis sont scellés jusqu’à la date limite de remise.';

export function registerConsultationDepotRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, getTenantPlan } = deps;

  async function reglagesDe(tenantId: string, projectId: string): Promise<(ReglagesDepot & { id?: string }) | null> {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_settings')
      .select('*').eq('project_id', projectId).maybeSingle();
    return (data as any) || null;
  }

  /** Plan Enterprise requis pour traiter une remise. Répond lui-même et rend false sinon. */
  async function exigerPlan(tenantId: string, res: any): Promise<boolean> {
    const { plan } = await getTenantPlan(tenantId);
    if (plan === 'enterprise') return true;
    res.status(403).json({ error: "L'espace de dépôt des offres est réservé au plan Enterprise.", code: 'plan_requis' });
    return false;
  }

  async function projetDuCabinet(tenantId: string, projectId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
      .select('id').eq('id', projectId).maybeSingle();
    return !!data;
  }

  // ── Éligibilité ────────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/depot/eligibility', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const e = await evaluerEligibilite(deps, tenantId, req.params.projectId);
      if (e.eligible) {
        return res.json({
          eligible: true,
          stockage: { provider: e.connection.provider, nom: e.connection.display_name || null },
        });
      }
      res.json({ eligible: false, code: e.code, message: e.message });
    } catch (err: any) {
      console.error('[GET depot/eligibility]', err?.message);
      res.status(500).json({ error: "Impossible de vérifier l'éligibilité." });
    }
  });

  // ── Réglages ───────────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/depot/settings', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await projetDuCabinet(tenantId, req.params.projectId))) return res.status(404).json({ error: 'Opération introuvable.' });
      const r = await reglagesDe(tenantId, req.params.projectId);
      res.json({
        deadline_at: r?.deadline_at || null,
        sealed: !!r?.sealed,
        instructions: r?.instructions || '',
        published_document_ids: Array.isArray(r?.published_document_ids) ? r!.published_document_ids : [],
        plis_scelles_actifs: plisScelles(r),
      });
    } catch (err: any) {
      console.error('[GET depot/settings]', err?.message);
      res.status(500).json({ error: 'Lecture des réglages impossible.' });
    }
  });

  app.put('/api/projects/:projectId/depot/settings', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      const e = await evaluerEligibilite(deps, tenantId, projectId);
      if (!e.eligible) return res.status(e.code === 'projet_introuvable' ? 404 : 403).json({ error: e.message, code: e.code });

      const body = req.body || {};
      const actuel = await reglagesDe(tenantId, projectId);

      let deadline: string | null = null;
      if (body.deadline_at !== null && body.deadline_at !== undefined && body.deadline_at !== '') {
        const d = new Date(body.deadline_at);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Date limite invalide.' });
        deadline = d.toISOString();
      }
      const sealed = body.sealed === true;
      if (sealed && !deadline) {
        return res.status(400).json({ error: 'Des plis scellés demandent une date limite : sans elle ils ne pourraient jamais être ouverts.' });
      }

      // Tant que les plis sont scellés, ni le scellement ni la date limite ne
      // peuvent être raccourcis : ce serait ouvrir les plis avant l'heure.
      if (plisScelles(actuel)) {
        if (!sealed) return res.status(409).json({ error: message423 });
        if (deadline && actuel!.deadline_at && new Date(deadline) < new Date(actuel!.deadline_at)) {
          return res.status(409).json({ error: 'Les plis étant scellés, la date limite ne peut qu’être repoussée.' });
        }
      }

      const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0, MAX_CONSIGNES) : '';

      // Seules des pièces de CETTE affaire, de CE cabinet, peuvent être publiées.
      const demandes: string[] = Array.isArray(body.published_document_ids)
        ? [...new Set<string>(body.published_document_ids.filter((v: unknown): v is string => typeof v === 'string'))].slice(0, 100)
        : [];
      let publiees: string[] = [];
      if (demandes.length) {
        const { data } = await supabaseAdmin.from('documents').select('id')
          .eq('tenant_id', tenantId).eq('project_id', projectId).in('id', demandes);
        publiees = ((data as any[]) || []).map(d => d.id);
      }

      const payload = {
        deadline_at: deadline, sealed, instructions: instructions || null,
        published_document_ids: publiees, updated_at: new Date().toISOString(),
      };
      if (actuel?.id) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_settings').update(payload).eq('id', actuel.id);
        if (error) throw error;
      } else {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_settings')
          .insert({ id: crypto.randomUUID(), project_id: projectId, ...payload });
        if (error) throw error;
      }

      // Un lien ne s'éteint jamais avant la remise : on repousse l'échéance des
      // liens actifs quand la date limite recule, sans jamais la raccourcir.
      const nouvelle = expirationLien(deadline);
      const { data: liens } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_invites')
        .select('id, expires_at, revoked_at').eq('project_id', projectId);
      for (const l of (liens as any[]) || []) {
        if (l.revoked_at || new Date(l.expires_at) >= nouvelle) continue;
        await supabaseAdmin.from('consultation_depot_invites').update({ expires_at: nouvelle.toISOString() }).eq('id', l.id);
      }

      res.json({ ...payload, plis_scelles_actifs: plisScelles(payload) });
    } catch (err: any) {
      console.error('[PUT depot/settings]', err?.message);
      res.status(500).json({ error: "Les réglages n'ont pas pu être enregistrés." });
    }
  });

  // ── Invitations ────────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/depot/invites', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_invites')
        .select('id, entreprise_id, entreprise_nom, email, lots_ids, expires_at, revoked_at, last_opened_at, created_at')
        .eq('project_id', req.params.projectId).order('created_at', { ascending: false });
      // Liste blanche explicite : le haché du jeton ne sort jamais, quelle que
      // soit la requête SQL.
      res.json(((data as any[]) || []).map(l => ({
        id: l.id, entreprise_id: l.entreprise_id, entreprise_nom: l.entreprise_nom, email: l.email,
        lots_ids: l.lots_ids, expires_at: l.expires_at, revoked_at: l.revoked_at,
        last_opened_at: l.last_opened_at, created_at: l.created_at,
      })));
    } catch (err: any) {
      console.error('[GET depot/invites]', err?.message);
      res.status(500).json({ error: 'Lecture des liens impossible.' });
    }
  });

  // Le jeton clair n'est rendu qu'ICI, une seule fois : la base n'en garde que
  // le haché. « Renvoyer le lien » crée donc un nouveau lien et révoque l'ancien.
  app.post('/api/projects/:projectId/depot/invites', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      const e = await evaluerEligibilite(deps, tenantId, projectId);
      if (!e.eligible) return res.status(e.code === 'projet_introuvable' ? 404 : 403).json({ error: e.message, code: e.code });

      const b = req.body || {};
      const entrepriseId = typeof b.entreprise_id === 'string' ? b.entreprise_id.trim().slice(0, 64) : '';
      const nom = typeof b.entreprise_nom === 'string' ? b.entreprise_nom.trim().slice(0, MAX_NOM) : '';
      if (!entrepriseId || !nom) return res.status(400).json({ error: "Désignez l'entreprise à inviter." });

      const email = isValidEmail(b.email) ? String(b.email).trim() : null;

      let contactId: string | null = null;
      if (typeof b.contact_id === 'string' && b.contact_id) {
        const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('id').eq('id', b.contact_id).maybeSingle();
        if (!data) return res.status(400).json({ error: 'Contact introuvable pour ce cabinet.' });
        contactId = b.contact_id;
      }

      // Seuls les lots de l'affaire sont retenus : un identifiant étranger est ignoré.
      const demandes: string[] = Array.isArray(b.lots_ids) ? b.lots_ids.filter((v: unknown): v is string => typeof v === 'string').slice(0, 100) : [];
      let lotsIds: string[] = [];
      if (demandes.length) {
        const { data } = await supabaseAdmin.from('project_lots').select('id')
          .eq('tenant_id', tenantId).eq('project_id', projectId).in('id', demandes);
        lotsIds = ((data as any[]) || []).map(l => l.id);
      }

      const maintenant = new Date().toISOString();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_invites')
        .update({ revoked_at: maintenant }).eq('project_id', projectId).eq('entreprise_id', entrepriseId).is('revoked_at', null);

      const reglages = await reglagesDe(tenantId, projectId);
      const jeton = genererJeton();
      const id = crypto.randomUUID();
      const expiresAt = expirationLien(reglages?.deadline_at).toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_invites').insert({
        id, project_id: projectId, entreprise_id: entrepriseId, entreprise_nom: nom, contact_id: contactId,
        email, lots_ids: lotsIds, token_hash: hacherJeton(jeton), expires_at: expiresAt, created_by: req.user.id,
      });
      if (error) throw error;

      res.status(201).json({ id, url: lienDepot(jeton), expires_at: expiresAt, deadline_at: reglages?.deadline_at || null });
    } catch (err: any) {
      console.error('[POST depot/invites]', err?.message);
      res.status(500).json({ error: "Le lien n'a pas pu être créé." });
    }
  });

  app.delete('/api/projects/:projectId/depot/invites/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depot_invites')
        .update({ revoked_at: new Date().toISOString() }).eq('id', req.params.id).eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[DELETE depot/invites]', err?.message);
      res.status(500).json({ error: "Le lien n'a pas pu être révoqué." });
    }
  });

  // ── Remises reçues ─────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/depots', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      const reglages = await reglagesDe(tenantId, projectId);
      const scelle = plisScelles(reglages);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depots')
        .select('*').eq('project_id', projectId).order('received_at', { ascending: false });

      const depots = ((data as any[]) || []).map(d => {
        const base = {
          id: d.id, invite_id: d.invite_id, entreprise_id: d.entreprise_id, entreprise_nom: d.entreprise_nom,
          lot_id: d.lot_id, kind: d.kind, version: d.version, status: d.status,
          hors_delai: !!d.hors_delai, received_at: d.received_at, reviewed_at: d.reviewed_at,
        };
        // Pli scellé : l'existence se voit, jamais le contenu ni le nom du fichier.
        if (scelle) return { ...base, scelle: true };
        return {
          ...base, scelle: false, file_name: d.file_name, mime_type: d.mime_type,
          size_bytes: d.size_bytes, sha256: d.sha256, payload: d.payload, note: d.note,
        };
      });
      res.json({ scelle, deadline_at: reglages?.deadline_at || null, depots });
    } catch (err: any) {
      console.error('[GET depots]', err?.message);
      res.status(500).json({ error: 'Lecture des remises impossible.' });
    }
  });

  /** La remise du cabinet, ou une réponse d'erreur déjà envoyée. */
  async function chargerDepot(req: any, res: any, tenantId: string, options: { contenu: boolean }) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depots').select('*').eq('id', req.params.id).maybeSingle();
    if (!data) { res.status(404).json({ error: 'Remise introuvable.' }); return null; }
    if (options.contenu) {
      const reglages = await reglagesDe(tenantId, (data as any).project_id);
      if (plisScelles(reglages)) { res.status(423).json({ error: message423, code: 'plis_scelles' }); return null; }
    }
    return data as any;
  }

  // URL d'ouverture d'un fichier déposé : jeton signé, aucun lien public créé
  // chez le fournisseur (même mécanique que les documents du cabinet).
  app.get('/api/depots/:id/url', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const depot = await chargerDepot(req, res, tenantId, { contenu: true });
      if (!depot) return;
      if (!depot.file_url) return res.status(400).json({ error: "Cette remise n'a pas de fichier (saisie en ligne)." });
      const ref = parseExternalRef(depot.file_url);
      const connexion = ref && await getConnectionById(supabaseAdmin, tenantId, ref.connectionId);
      if (!ref || !connexion) return res.status(404).json({ error: "Le fichier n'est plus accessible depuis l'espace de stockage du cabinet." });
      const ticket = signExternalTicket({ t: tenantId, c: ref.connectionId, e: ref.externalId, n: depot.file_name || ref.fileName });
      res.json({ url: `/api/storage/external/${encodeURIComponent(ticket)}` });
    } catch (err: any) {
      console.error('[GET depots/:id/url]', err?.message);
      res.status(500).json({ error: 'Ouverture impossible.' });
    }
  });

  const traiter = (statut: 'integre' | 'rejete') => async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await exigerPlan(tenantId, res))) return;
      const depot = await chargerDepot(req, res, tenantId, { contenu: true });
      if (!depot) return;
      if (depot.status !== 'recu') return res.status(409).json({ error: 'Cette remise a déjà été traitée.' });
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : null;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'consultation_depots')
        .update({ status: statut, reviewed_at: new Date().toISOString(), reviewed_by: req.user.id, ...(note ? { note } : {}) })
        .eq('id', depot.id);
      if (error) throw error;
      res.json({ ok: true, status: statut });
    } catch (err: any) {
      console.error(`[POST depots/:id/${statut}]`, err?.message);
      res.status(500).json({ error: "Le traitement de la remise a échoué." });
    }
  };
  // L'intégration à l'offre se fait dans le navigateur (le document de la
  // consultation est enregistré par ACTModule) ; la route ne fait que le constater.
  app.post('/api/depots/:id/integrer', traiter('integre'));
  app.post('/api/depots/:id/rejeter', traiter('rejete'));
}
