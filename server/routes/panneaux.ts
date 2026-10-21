// Panneau de chantier (intervenants, lots, entreprises, logos) et panneau
// d'affichage du permis de construire : données résolues, réglages par affaire
// et génération du PDF. Voir server/panneaux/.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { depotReadLimiter, panneauxLimiter } from '../rateLimit';
import { listImageCandidates } from '../referencesDossier/data';
import { ChromiumUnavailableError, renderHtmlToPdf } from '../referencesDossier/render';
import { loadChantierPanel } from '../panneaux/chantierData';
import { buildChantierHtml } from '../panneaux/chantierTemplate';
import { logoDpi } from '../panneaux/logos';
import { chantierPublicUrl, verifyChantierToken } from '../panneaux/publicLink';
import {
  CHANTIER_FORMATS, PERMIS_FORMATS, isPanneauFormat, isRegulatorySize, pageSpec,
  type PanneauFormat, type PanneauOrientation,
} from '../panneaux/pageSpec';
import { loadPermisPanel } from '../panneaux/permisData';
import { buildPermisHtml } from '../panneaux/permisTemplate';
import type { PermisEtat } from '../panneaux/types';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MAX_HIDDEN = 300;
const KEY_RE = /^[A-Za-z0-9:_-]{1,80}$/;

function isMissingTable(error: any): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

function asOrientation(v: unknown): PanneauOrientation {
  return v === 'paysage' ? 'paysage' : 'portrait';
}

function asKeys(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && KEY_RE.test(x)).slice(0, MAX_HIDDEN) : [];
}

function asText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

function asIsoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Réglages enregistrés pour une affaire : liste blanche, jamais le corps brut. */
export function sanitizePanelSettings(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.format = isPanneauFormat(body?.format) && CHANTIER_FORMATS.includes(body.format) ? body.format : 'A0';
  out.orientation = asOrientation(body?.orientation);
  out.logos = body?.logos !== false;
  out.colorLogos = body?.colorLogos === true;
  out.qrCode = body?.qrCode !== false;
  out.hidden = asKeys(body?.hidden);
  out.hiddenLogos = asKeys(body?.hiddenLogos);
  out.imageId = asText(body?.imageId, 120);
  out.title = asText(body?.title, 200);
  out.startDate = asIsoDate(body?.startDate);
  out.durationText = asText(body?.durationText, 80);
  return out;
}

/** Adresse publique de l'application : APP_URL, à défaut l'hôte de la requête. */
function publicBase(req: any): string {
  const configured = (process.env.APP_URL || '').trim();
  return configured || `${req.protocol}://${req.get('host')}`;
}

function fileSlug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'panneau';
}

function sendPdf(res: any, pdf: Buffer, filename: string, warnings: string[], extra: Record<string, string> = {}) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Panneau-Warnings', encodeURIComponent(JSON.stringify(warnings.slice(0, 30))));
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.setHeader('Access-Control-Expose-Headers', ['X-Panneau-Warnings', 'Content-Disposition', ...Object.keys(extra)].join(', '));
  res.send(pdf);
}

export function registerPanneauxRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // ── Panneau de chantier ────────────────────────────────────────────────

  // Intervenants, lots et entreprises détectés + réglages enregistrés (sans les octets des logos).
  app.get('/api/projects/:projectId/panneau-chantier', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const data = await loadChantierPanel(supabaseAdmin, tenantId, projectId, { withImage: false });
      if (!data) return res.status(404).json({ error: 'Affaire introuvable.' });
      const { data: row, error } = await supabaseAdmin.from('project_site_panels').select('settings').eq('tenant_id', tenantId).eq('project_id', projectId).maybeSingle();
      if (error && !isMissingTable(error)) throw error;
      const candidates = await listImageCandidates(supabaseAdmin, tenantId, 'project', projectId);
      const slim = <T extends { logo: unknown }>(r: T) => { const { logo, ...rest } = r as any; return { ...rest, hasLogo: !!logo }; };
      res.json({
        projectName: data.projectName,
        facts: data.facts,
        maitriseOuvrage: data.maitriseOuvrage.map(slim),
        maitriseOeuvre: data.maitriseOeuvre.map(slim),
        lots: data.lots.map(slim),
        candidates,
        settings: row?.settings ?? null,
        settingsAvailable: !isMissingTable(error),
        warnings: data.warnings,
      });
    } catch (e: any) {
      console.error('[GET /api/projects/:id/panneau-chantier]', e);
      res.status(500).json({ error: 'Impossible de préparer le panneau de chantier.' });
    }
  });

  // Mémorise les réglages du panneau de cette affaire.
  app.put('/api/projects/:projectId/panneau-chantier', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const settings = sanitizePanelSettings(req.body);
      const existing = await supabaseAdmin.from('project_site_panels').select('id').eq('tenant_id', tenantId).eq('project_id', projectId).maybeSingle();
      if (existing.error) {
        if (isMissingTable(existing.error)) return res.status(503).json({ error: 'La table des réglages de panneau n’est pas encore créée sur cette instance (migration migrate_panneaux.sql).' });
        throw existing.error;
      }
      const row = { tenant_id: tenantId, project_id: projectId, settings, updated_at: new Date().toISOString() };
      const { data, error } = existing.data
        ? await supabaseAdmin.from('project_site_panels').update(row).eq('id', existing.data.id).eq('tenant_id', tenantId).select().single()
        : await supabaseAdmin.from('project_site_panels').insert({ id: crypto.randomUUID(), ...row }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/projects/:id/panneau-chantier]', e);
      res.status(500).json({ error: 'Impossible d’enregistrer les réglages du panneau.' });
    }
  });

  app.post('/api/projects/:projectId/panneau-chantier/pdf', panneauxLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const s = sanitizePanelSettings(req.body) as any;
      const page = pageSpec(s.format as PanneauFormat, s.orientation);
      const data = await loadChantierPanel(supabaseAdmin, tenantId, projectId, { imageId: s.imageId, startDate: s.startDate, durationText: s.durationText });
      if (!data) return res.status(404).json({ error: 'Affaire introuvable.' });
      const hidden = new Set<string>(s.hidden);
      const hiddenLogos = new Set<string>(s.hiddenLogos);
      const html = buildChantierHtml(data, { page, logos: s.logos, colorLogos: s.colorLogos, hidden, hiddenLogos, title: s.title, qrUrl: s.qrCode ? chantierPublicUrl(publicBase(req), projectId) : null });
      const { pdf, overflow } = await renderHtmlToPdf(html, { width: `${page.widthMm}mm`, height: `${page.heightMm}mm` });

      const warnings = [...data.warnings];
      if (s.qrCode) warnings.push('Le QR code renvoie à la liste des entreprises titulaires des lots : les sous-traitants, que la réglementation inclut, n’y figurent pas encore.');
      if (overflow) warnings.push('Le contenu dépasse la page : masquez des lignes ou choisissez un format plus grand, le bas du panneau est rogné.');
      // Définition à l'impression : une image ou un logo trop petit sera flou.
      const imageWidthMm = (page.orientation === 'portrait' ? 450 : 400) * page.zoom;
      if (data.image?.widthPx) {
        const dpi = Math.round(data.image.widthPx / (imageWidthMm / 25.4));
        if (dpi < 100) warnings.push(`Perspective de définition faible (environ ${dpi} dpi à cette taille) : l’impression sera floue de près.`);
      }
      if (s.logos) {
        const lotsShown = data.lots.filter(l => !hidden.has(l.key) && !hiddenLogos.has(l.key) && l.logo);
        for (const l of lotsShown) {
          const dpi = logoDpi(l.logo!, 22 * page.zoom);
          if (dpi !== null && dpi < 100) warnings.push(`Logo de « ${l.company} » de faible définition (environ ${dpi} dpi).`);
        }
      }
      sendPdf(res, pdf, `Panneau-chantier-${fileSlug(data.projectName)}-${page.format}-${page.orientation}.pdf`, warnings);
    } catch (e: any) {
      if (e instanceof ChromiumUnavailableError) return res.status(503).json({ error: e.message });
      console.error('[POST /api/projects/:id/panneau-chantier/pdf]', e);
      res.status(500).json({ error: 'Impossible de générer le panneau de chantier.' });
    }
  });

  // Liste publique des entreprises, cible du QR code : sans compte, le jeton (HMAC de l'affaire) en est la clé.
  app.get('/api/public/chantier/:token', depotReadLimiter, async (req: any, res: any) => {
    try {
      const projectId = verifyChantierToken(req.params.token);
      const notFound = () => res.status(404).json({ error: 'Liste introuvable.' });
      if (!projectId) return notFound();
      const { data: project, error } = await supabaseAdmin.from('projects').select('tenant_id').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!project?.tenant_id) return notFound();
      const data = await loadChantierPanel(supabaseAdmin, project.tenant_id, projectId, { withImage: false, withLogos: false });
      if (!data) return notFound();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        operation: data.projectName,
        adresse: data.facts.find(f => f.label === 'Adresse du chantier')?.value ?? null,
        permis: data.facts.find(f => f.label === 'Permis de construire')?.value ?? null,
        architecte: data.agency.name,
        entreprises: data.lots.filter(l => l.company).map(l => ({ lot: l.number, intitule: l.title, nom: l.company, adresse: l.address })),
      });
    } catch (e: any) {
      console.error('[GET /api/public/chantier/:token]', e);
      res.status(500).json({ error: 'Liste momentanément indisponible.' });
    }
  });

  // ── Panneau d'affichage du permis ──────────────────────────────────────

  app.get('/api/permits/:id/panneau', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const loaded = await loadPermisPanel(supabaseAdmin, tenantId, req.params.id);
      if ('error' in loaded) {
        return loaded.error === 'unsupported_type'
          ? res.status(400).json({ error: 'Le panneau d’affichage n’est prévu que pour un permis de construire ou une déclaration préalable.' })
          : res.status(404).json({ error: 'Permis introuvable.' });
      }
      const { agency, ...data } = loaded.data;
      res.json({ ...data, status: loaded.status, formats: PERMIS_FORMATS.map(f => ({ format: f, regulatory: isRegulatorySize(f) })) });
    } catch (e: any) {
      console.error('[GET /api/permits/:id/panneau]', e);
      res.status(500).json({ error: 'Impossible de préparer le panneau du permis.' });
    }
  });

  app.post('/api/permits/:id/panneau/pdf', panneauxLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const format: PanneauFormat = isPanneauFormat(req.body?.format) && PERMIS_FORMATS.includes(req.body.format) ? req.body.format : 'A0';
      const orientation = asOrientation(req.body?.orientation);
      const wanted: PermisEtat | null = req.body?.etat === 'definitif' ? 'definitif' : req.body?.etat === 'brouillon' ? 'brouillon' : null;
      const loaded = await loadPermisPanel(supabaseAdmin, tenantId, req.params.id, wanted);
      if ('error' in loaded) {
        return loaded.error === 'unsupported_type'
          ? res.status(400).json({ error: 'Le panneau d’affichage n’est prévu que pour un permis de construire ou une déclaration préalable.' })
          : res.status(404).json({ error: 'Permis introuvable.' });
      }
      const { data } = loaded;
      if (data.etat === 'definitif') {
        if (loaded.status === 'refuse') return res.status(409).json({ error: 'Le permis est refusé : aucun panneau définitif ne peut être généré.' });
        if (data.missingRequired.length) {
          return res.status(400).json({ error: 'Champs obligatoires manquants pour la version définitive.', missing: data.missingRequired });
        }
      }
      const page = pageSpec(format, orientation);
      const { pdf, overflow } = await renderHtmlToPdf(buildPermisHtml(data, page), { width: `${page.widthMm}mm`, height: `${page.heightMm}mm` });
      const warnings = [...data.warnings];
      if (overflow) warnings.push('Le contenu dépasse la page : réduisez les textes ou choisissez un format plus grand.');
      if (!isRegulatorySize(format)) warnings.push('Format non réglementaire (les deux côtés doivent dépasser 80 cm) : aperçu pour validation uniquement.');
      sendPdf(res, pdf, `Panneau-permis-${fileSlug(data.numero ?? 'sans-numero')}-${data.etat}-${page.format}.pdf`, warnings, {
        'X-Panneau-Etat': data.etat,
        'X-Panneau-Regulatory': String(isRegulatorySize(format)),
      });
    } catch (e: any) {
      if (e instanceof ChromiumUnavailableError) return res.status(503).json({ error: e.message });
      console.error('[POST /api/permits/:id/panneau/pdf]', e);
      res.status(500).json({ error: 'Impossible de générer le panneau du permis.' });
    }
  });
}
