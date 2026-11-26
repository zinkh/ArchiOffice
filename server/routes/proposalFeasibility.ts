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
import { mapTileLimiter, photoUrlLimiter } from '../rateLimit';
import { resolvePublicUrl } from '../ssrfGuard';
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
const PHOTO_URL_TIMEOUT_MS = 15_000;
const PHOTO_URL_MAX_BYTES = 25 * 1024 * 1024;
const PHOTO_URL_MAX_REDIRECTS = 3;

class PhotoUrlError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Télécharge une image publique par son lien. Chaque adresse (y compris celles des
 * redirections, suivies à la main) est validée par le garde SSRF : jamais de réseau
 * interne. Taille plafonnée, type image/* exigé.
 */
export async function downloadPublicImage(rawUrl: string): Promise<{ buffer: Buffer; contentType: string; name: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= PHOTO_URL_MAX_REDIRECTS; hop++) {
    const { url } = await resolvePublicUrl(current);
    const upstream = await fetchWithTimeout(url.toString(), { redirect: 'manual', headers: { Accept: 'image/*' } }, PHOTO_URL_TIMEOUT_MS);
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) throw new PhotoUrlError(502, 'Redirection invalide.');
      current = new URL(location, url).toString();
      continue;
    }
    if (!upstream.ok) throw new PhotoUrlError(502, `Le site a répondu ${upstream.status}.`);
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new PhotoUrlError(415, "Ce lien ne pointe pas vers une image.");
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > PHOTO_URL_MAX_BYTES) throw new PhotoUrlError(413, 'Image trop volumineuse.');
    const reader = upstream.body?.getReader();
    if (!reader) throw new PhotoUrlError(502, 'Réponse vide.');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PHOTO_URL_MAX_BYTES) { await reader.cancel(); throw new PhotoUrlError(413, 'Image trop volumineuse.'); }
      chunks.push(Buffer.from(value));
    }
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return { buffer: Buffer.concat(chunks), contentType, name: last.slice(0, 120) || 'photo' };
  }
  throw new PhotoUrlError(502, 'Trop de redirections.');
}

/** Adresse du terrain d'une proposition, telle qu'on la géocode. */
export function proposalTerrainAddress(p: any): string {
  return [p?.adresse_terrain, p?.cp_ville_terrain].map(v => (v == null ? '' : String(v).trim())).filter(Boolean).join(', ');
}

function str(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').slice(0, max);
}

/** Indice (4 caractères au plus) et date AAAA-MM-JJ valide ; vide vaut « non renseigné ». */
export function sanitizeFeasibilityMeta(body: any): { indice: string | null; issueDate: string | null } | null {
  const indice = typeof body?.indice === 'string' ? body.indice.trim() : '';
  const date = typeof body?.issueDate === 'string' ? body.issueDate.trim() : '';
  if (indice.length > 4) return null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)))) return null;
  return { indice: indice || null, issueDate: date || null };
}

export function registerProposalFeasibilityRoutes(app: Express, { supabaseAdmin, getTenantId, loadSiteData }: RouteDeps) {
  app.put("/api/proposals/:id/feasibility-meta", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const meta = sanitizeFeasibilityMeta(req.body);
      if (!meta) return res.status(400).json({ error: "Indice (4 caractères au plus) ou date de diffusion invalide." });
      if (!(await assertTenantEntity(supabaseAdmin, 'proposals', req.params.id, tenantId))) {
        return res.status(404).json({ error: "Proposition introuvable." });
      }
      const { error } = await supabaseAdmin.from('proposals')
        .update({ feasibility_indice: meta.indice, feasibility_issue_date: meta.issueDate })
        .eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ feasibility_indice: meta.indice, feasibility_issue_date: meta.issueDate });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Échec de l'enregistrement de l'indice." }); }
  });

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

  // Photo par lien : l'image est relayée au navigateur (aucune garantie CORS côté site
  // d'origine), qui la réduit en JPEG puis la dépose comme n'importe quelle photo.
  app.get("/api/feasibility/photo-from-url", photoUrlLimiter, async (req: any, res: any) => {
    try {
      const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
      if (!raw || raw.length > 2000) return res.status(400).json({ error: 'Lien requis.' });
      const { buffer, contentType, name } = await downloadPublicImage(raw);
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Photo-Name', encodeURIComponent(name));
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buffer);
    } catch (e: any) {
      const status = e?.name === 'AbortError' ? 504 : (Number.isInteger(e?.status) ? e.status : 502);
      res.status(status).json({ error: status === 504 ? 'Le site ne répond pas.' : (e?.message || "Image impossible à récupérer.") });
    }
  });

  app.get("/api/feasibility/map-tile",mapTileLimiter, async (req: any, res: any) => {
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
