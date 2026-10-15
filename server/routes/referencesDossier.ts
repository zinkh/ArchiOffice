// Dossier de références (candidatures aux marchés publics) : fiches de
// référence (métadonnées + images retenues), images candidates et génération du
// PDF. Voir server/referencesDossier/.
import type { Express } from 'express';
import { Jimp, JimpMime } from 'jimp';
import { assertTenantEntity } from '../assertTenantEntity';
import { referencesDossierLimiter } from '../rateLimit';
import { loadAgency, listImageCandidates, resolveReferences } from '../referencesDossier/data';
import type { ReferenceSelection, ReferenceSource } from '../referencesDossier/data';
import { buildDossierHtml } from '../referencesDossier/template';
import { ChromiumUnavailableError, renderPdf } from '../referencesDossier/render';
import type { DossierOrientation } from '../referencesDossier/types';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MAX_REFERENCES = 60;
const SHEET_TEXT_FIELDS = ['nature', 'city', 'department', 'labels', 'maitre_oeuvre', 'mission', 'phase', 'amount_text'] as const;

function asSource(value: unknown): ReferenceSource | null {
  return value === 'project' || value === 'manual' ? value : null;
}

function sourceTable(source: ReferenceSource): 'projects' | 'custom_references' {
  return source === 'project' ? 'projects' : 'custom_references';
}

function parseSelections(raw: unknown): ReferenceSelection[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REFERENCES) return null;
  const out: ReferenceSelection[] = [];
  for (const item of raw) {
    const source = asSource(item?.source);
    if (!source || typeof item?.id !== 'string' || !item.id) return null;
    out.push({
      source,
      id: item.id,
      imageIds: Array.isArray(item.imageIds) ? item.imageIds.filter((x: unknown): x is string => typeof x === 'string').slice(0, 6) : undefined,
      primaryImageId: typeof item.primaryImageId === 'string' ? item.primaryImageId : null,
      programOverride: typeof item.programOverride === 'string' ? item.programOverride.slice(0, 4000) : null,
    });
  }
  return out;
}

export function registerReferencesDossierRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // Fiche enregistrée + images proposables d'une référence.
  app.get('/api/references/dossier/sheet/:source/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const source = asSource(req.params.source);
      if (!source) return res.status(400).json({ error: 'source invalide' });
      if (!(await assertTenantEntity(supabaseAdmin, sourceTable(source), req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Référence introuvable.' });
      }
      const { data: sheet, error } = await supabaseAdmin.from('reference_sheets').select('*').eq('tenant_id', tenantId)
        .eq(source === 'project' ? 'project_id' : 'custom_reference_id', req.params.id).maybeSingle();
      const missingTable = !!error && (error.code === '42P01' || error.code === 'PGRST205');
      if (error && !missingTable) throw error;
      const candidates = await listImageCandidates(supabaseAdmin, tenantId, source, req.params.id);
      // Valeurs par défaut (affaire + déductions) : l'écran les montre en filigrane et préremplit le programme.
      const agency = await loadAgency(supabaseAdmin, tenantId);
      const { references } = await resolveReferences(supabaseAdmin, tenantId, agency, [{ source, id: req.params.id, skipImages: true }]);
      res.json({ sheet: sheet ?? null, candidates, resolved: references[0] ?? null, sheetsAvailable: !missingTable });
    } catch (e: any) {
      console.error('[GET /api/references/dossier/sheet]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Enregistre les métadonnées propres au dossier (ville, labels, mission...) et les images retenues.
  app.put('/api/references/dossier/sheet/:source/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const source = asSource(req.params.source);
      if (!source) return res.status(400).json({ error: 'source invalide' });
      if (!(await assertTenantEntity(supabaseAdmin, sourceTable(source), req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Référence introuvable.' });
      }
      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        project_id: source === 'project' ? req.params.id : null,
        custom_reference_id: source === 'manual' ? req.params.id : null,
        updated_at: new Date().toISOString(),
      };
      for (const f of SHEET_TEXT_FIELDS) {
        const v = req.body?.[f];
        row[f] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;
      }
      // Seules des images de CETTE référence sont retenues.
      const allowed = new Set((await listImageCandidates(supabaseAdmin, tenantId, source, req.params.id)).map(c => c.id));
      const wanted: string[] = Array.isArray(req.body?.imageIds) ? req.body.imageIds.filter((x: unknown) => typeof x === 'string') : [];
      const primary = typeof req.body?.primaryImageId === 'string' ? req.body.primaryImageId : wanted[0];
      row.images = wanted.filter(id => allowed.has(id)).slice(0, 6).map(id => ({ id, is_primary: id === primary }));

      const existing = await supabaseAdmin.from('reference_sheets').select('id').eq('tenant_id', tenantId)
        .eq(source === 'project' ? 'project_id' : 'custom_reference_id', req.params.id).maybeSingle();
      if (existing.error) {
        if (existing.error.code === '42P01' || existing.error.code === 'PGRST205') {
          return res.status(503).json({ error: 'La table des fiches de référence n’est pas encore créée sur cette instance (migration migrate_reference_sheets.sql).' });
        }
        throw existing.error;
      }
      const { data, error } = existing.data
        ? await supabaseAdmin.from('reference_sheets').update(row).eq('id', existing.data.id).eq('tenant_id', tenantId).select().single()
        : await supabaseAdmin.from('reference_sheets').insert({ id: crypto.randomUUID(), ...row }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/references/dossier/sheet]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vignette d'une image candidate (pour l'écran de sélection), après contrôle d'appartenance.
  app.get('/api/references/dossier/image/:source/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const source = asSource(req.params.source);
      const imageId = typeof req.query.image === 'string' ? req.query.image : '';
      if (!source || !imageId) return res.status(400).json({ error: 'paramètres invalides' });
      const allowed = new Set((await listImageCandidates(supabaseAdmin, tenantId, source, req.params.id)).map(c => c.id));
      if (!allowed.has(imageId)) return res.status(404).json({ error: 'Image introuvable pour cette référence.' });
      const { references } = await resolveReferences(
        supabaseAdmin, tenantId,
        { name: '', acronym: '', manager: null, address: null, phone: null, email: null, siret: null, oaNumber: null, vatNumber: null, logoDataUrl: null },
        [{ source, id: req.params.id, imageIds: [imageId] }],
      );
      const dataUrl = references[0]?.images[0]?.dataUrl;
      if (!dataUrl) return res.status(404).json({ error: 'Image illisible.' });
      const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const thumb = await Jimp.read(buf);
      thumb.scaleToFit({ w: 480, h: 480 });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(await thumb.getBuffer(JimpMime.jpeg, { quality: 78 }));
    } catch (e: any) {
      console.error('[GET /api/references/dossier/image]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Génération du PDF.
  app.post('/api/references/dossier/pdf', referencesDossierLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const selections = parseSelections(req.body?.selections);
      if (!selections) return res.status(400).json({ error: `Sélection invalide (1 à ${MAX_REFERENCES} références).` });
      const orientation: DossierOrientation = req.body?.orientation === 'portrait' ? 'portrait' : 'landscape';
      for (const sel of selections) {
        if (!(await assertTenantEntity(supabaseAdmin, sourceTable(sel.source), sel.id, tenantId))) {
          return res.status(400).json({ error: 'Référence introuvable pour ce cabinet.' });
        }
      }
      const agency = await loadAgency(supabaseAdmin, tenantId, typeof req.body?.manager === 'string' ? req.body.manager : null);
      const { references, warnings } = await resolveReferences(supabaseAdmin, tenantId, agency, selections);
      if (references.length === 0) return res.status(400).json({ error: 'Aucune référence exploitable.' });
      const html = buildDossierHtml({
        agency, references, orientation,
        includeCover: req.body?.includeCover !== false,
        includeList: req.body?.includeList !== false,
      });
      const pdf = await renderPdf(html, orientation);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="references.pdf"');
      res.setHeader('X-Dossier-Warnings', encodeURIComponent(JSON.stringify(warnings.slice(0, 20))));
      res.setHeader('Access-Control-Expose-Headers', 'X-Dossier-Warnings, Content-Disposition');
      res.send(pdf);
    } catch (e: any) {
      if (e instanceof ChromiumUnavailableError) return res.status(503).json({ error: e.message });
      console.error('[POST /api/references/dossier/pdf]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
