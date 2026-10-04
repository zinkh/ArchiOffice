// Étude de faisabilité d'une proposition (volet repliable du détail d'une
// proposition, src/components/proposal/FeasibilityStudy.tsx). Même modèle que
// la note méthodologique d'un appel d'offres (server/routes/tenderMethodology.ts) :
// une ligne par rubrique dans proposal_feasibility_sections. Ces routes sont
// ouvertes à tous les plans ; seule la rédaction par l'IA est réservée au plan
// Enterprise (server/routes/proposalFeasibilityAi.ts).
//
// Trois routes de plus que la note méthodologique :
// - PUT .../order : réordonne les rubriques (glisser-déposer) ;
// - GET .../site-data : données publiques du terrain (PLU, risques,
//   monuments), pour les blocs « Insérer » de l'écran ;
// - GET /api/feasibility/map-tile : relais des tuiles WMTS de l'IGN, pour
//   composer les extraits de cartes dans un canvas. Une tuile chargée
//   directement depuis data.geopf.fr « salirait » le canvas (aucune garantie
//   d'en-tête CORS), ce qui interdirait d'en tirer l'image à enregistrer.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { mapTileLimiter } from '../rateLimit';
import { sanitizeIllustrations } from '../../src/lib/feasibilityBlocks';
import { FEASIBILITY_MAP_LAYERS, type FeasibilityMapLayerId } from '../../src/lib/feasibilityMap';
import type { FeasibilitySiteData } from '../../src/lib/feasibilityBlocks';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  loadSiteData: (address: string) => Promise<FeasibilitySiteData>;
}

const TABLE = 'proposal_feasibility_sections';
const MAX_TITLE = 200;
const MAX_CONTENT = 50_000;
const MAX_INSTRUCTIONS = 2_000;
const TILE_TIMEOUT_MS = 10_000;

/** Adresse du terrain d'une proposition, telle qu'on la géocode. */
export function proposalTerrainAddress(p: any): string {
  return [p?.adresse_terrain, p?.cp_ville_terrain].map(v => (v == null ? '' : String(v).trim())).filter(Boolean).join(', ');
}

function str(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').slice(0, max);
}

export function registerProposalFeasibilityRoutes(app: Express, { supabaseAdmin, getTenantId, loadSiteData }: RouteDeps) {
  app.get("/api/proposals/:id/feasibility", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).select('*')
        .eq('proposal_id', req.params.id).order('sort_order', { ascending: true });
      if (error) throw error;
      res.json((data || []).map((s: any) => ({ ...s, illustrations: sanitizeIllustrations(s.illustrations) })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de la lecture de l'étude de faisabilité." }); }
  });

  app.post("/api/proposals/:id/feasibility", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const proposalId = req.params.id;
      if (!(await assertTenantEntity(supabaseAdmin, 'proposals', proposalId, tenantId))) {
        return res.status(404).json({ error: "Proposition introuvable pour ce cabinet." });
      }
      const title = str(req.body?.title, MAX_TITLE).trim();
      if (!title) return res.status(400).json({ error: "Le titre de la rubrique est requis." });
      const content = str(req.body?.content, MAX_CONTENT);
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).select('id').eq('proposal_id', proposalId);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert({
        id: crypto.randomUUID(), proposal_id: proposalId, title, content,
        instructions: str(req.body?.instructions, MAX_INSTRUCTIONS),
        illustrations: [],
        status: content.trim() ? 'redige' : 'a_rediger',
        sort_order: Number.isInteger(req.body?.sort_order) ? req.body.sort_order : (existing || []).length,
      }).select().single();
      if (error) throw error;
      res.status(201).json({ ...data, illustrations: [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de la création de la rubrique." }); }
  });

  // Réordonne : reçoit les ids dans leur nouvel ordre. Un id étranger à la
  // proposition est ignoré, jamais renuméroté.
  app.put("/api/proposals/:id/feasibility/order", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ids: unknown = req.body?.ids;
      if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) return res.status(400).json({ error: "Liste d'identifiants invalide." });
      const { data: rows } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).select('id').eq('proposal_id', req.params.id);
      const known = new Set((rows || []).map((r: any) => r.id));
      const ordered = (ids as string[]).filter(id => known.has(id));
      for (let i = 0; i < ordered.length; i++) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).update({ sort_order: i }).eq('id', ordered[i]);
        if (error) throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec du classement des rubriques." }); }
  });

  app.put("/api/proposals/:id/feasibility/:sectionId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: proposalId, sectionId } = req.params;
      const { data: current } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).select('id')
        .eq('id', sectionId).eq('proposal_id', proposalId).maybeSingle();
      if (!current) return res.status(404).json({ error: "Rubrique introuvable." });

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (req.body?.title !== undefined) {
        const title = str(req.body.title, MAX_TITLE).trim();
        if (!title) return res.status(400).json({ error: "Le titre de la rubrique est requis." });
        patch.title = title;
      }
      if (req.body?.content !== undefined) {
        patch.content = str(req.body.content, MAX_CONTENT);
        patch.status = String(patch.content).trim() ? 'redige' : 'a_rediger';
      }
      if (req.body?.instructions !== undefined) patch.instructions = str(req.body.instructions, MAX_INSTRUCTIONS);
      if (req.body?.illustrations !== undefined) patch.illustrations = sanitizeIllustrations(req.body.illustrations);

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).update(patch).eq('id', sectionId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de l'enregistrement de la rubrique." }); }
  });

  // Les images des cartes restent dans les documents de la proposition : on
  // ne supprime que la rubrique, l'architecte peut retirer les images depuis
  // l'écran (chaque retrait d'illustration supprime son document).
  app.delete("/api/proposals/:id/feasibility/:sectionId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: proposalId, sectionId } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).delete().eq('id', sectionId).eq('proposal_id', proposalId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de la suppression de la rubrique." }); }
  });

  app.get("/api/proposals/:id/feasibility-site-data", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: proposal } = await tenantScopedFrom(supabaseAdmin, tenantId, 'proposals')
        .select('id, adresse_terrain, cp_ville_terrain').eq('id', req.params.id).maybeSingle();
      if (!proposal) return res.status(404).json({ error: "Proposition introuvable." });
      const address = proposalTerrainAddress(proposal);
      if (!address) return res.status(400).json({ error: "Renseignez d'abord l'adresse du terrain de la proposition." });
      res.json(await loadSiteData(address));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de la lecture des données du site." }); }
  });

  app.get("/api/feasibility/map-tile", mapTileLimiter, async (req: any, res: any) => {
    try {
      const layerId = String(req.query.layer || '') as FeasibilityMapLayerId;
      const layer = FEASIBILITY_MAP_LAYERS[layerId];
      const z = Number(req.query.z), x = Number(req.query.x), y = Number(req.query.y);
      if (!layer) return res.status(400).json({ error: 'Couche inconnue.' });
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > layer.maxZoom) return res.status(400).json({ error: 'Tuile invalide.' });
      const max = 2 ** z;
      if (x < 0 || y < 0 || x >= max || y >= max) return res.status(400).json({ error: 'Tuile hors emprise.' });

      const url = 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
        + `&LAYER=${layer.wmtsLayer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${encodeURIComponent(layer.format)}`
        + `&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
      const upstream = await fetchWithTimeout(url, {}, TILE_TIMEOUT_MS);
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: `Tuile indisponible (${upstream.status}).` });
      const contentType = upstream.headers.get('content-type') || layer.format;
      if (!contentType.startsWith('image/')) return res.status(502).json({ error: 'Réponse inattendue du service IGN.' });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(buffer);
    } catch (e: any) {
      res.status(e?.name === 'AbortError' ? 504 : 502).json({ error: 'Service cartographique IGN indisponible.' });
    }
  });
}
