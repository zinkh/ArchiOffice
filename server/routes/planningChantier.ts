// Planning de chantier (Gantt par lot, onglet DET) : table
// project_chantier_planning, supabase/migrate_chantier_planning.sql. Voir
// CLAUDE.md, « Planning de chantier ».
//
// - GET/PUT /api/projects/:projectId/planning-chantier : lecture et écriture du
//   planning (assaini par sanitizePlanning, jamais pris tel que reçu).
// - POST .../planning-chantier/generate : le modèle IA PROPOSE un planning à partir
//   des lots, des entreprises titulaires, des montants de marché, des durées déjà
//   connues et, au choix, de pièces de l'affaire (planning d'une entreprise, notice,
//   phasage du DCE). La route n'écrit jamais : l'écran montre la proposition,
//   l'architecte l'applique ou non, puis l'enregistre comme n'importe quelle saisie.
//   Facturé aux crédits IA du cabinet (réserve → exécute → règle, comme le CCTP).
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import {
  PLANNING_VIDE, estDateIso, planningDepuisReponse, sanitizePlanning, type LotPlanifiable,
} from '../../src/lib/planningChantier';
import { associerMarches, sourcesPourPlanning, texteSourceLot, type MarcheLigne } from '../planningSources';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'planning_generation'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
}

const MIGRATION_MISSING = 'Le planning de chantier n’est pas encore disponible sur cette instance (migration chantier_planning à appliquer).';
const MAX_DOCUMENTS = 6;
const MAX_SOURCE_CHARS = 40_000;
const MAX_INSTRUCTIONS_CHARS = 2_000;
const MAX_LOTS = 60;
// Un planning complet est un JSON de plusieurs milliers de jetons : le délai du chat ne suffit pas.
const GENERATION_TIMEOUT_MS = 270_000;

/** Table absente : instance dont la base n'a pas encore joué la migration. */
function isMissingTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || (/project_chantier_planning/.test(message) && /does not exist|schema cache/i.test(message));
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const PLANNING_SCHEMA = {
  type: 'object',
  properties: {
    taches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lot_numero: { type: 'string', description: 'Numéro du lot tel que fourni, ou « general » pour une tâche commune au chantier' },
          libelle: { type: 'string', description: 'Intitulé court de la phase d’intervention, ex. « Terrassements et fondations »' },
          semaine_debut: { type: 'integer', description: 'Semaine de début, 1 = semaine de démarrage du chantier' },
          duree_semaines: { type: 'integer', description: 'Durée en semaines entières (absent pour un jalon)' },
          jalon: { type: 'boolean', description: 'Vrai pour une échéance sans durée (hors d’eau, réception...)' },
        },
        required: ['lot_numero', 'libelle', 'semaine_debut'],
      },
    },
    hypotheses: { type: 'array', items: { type: 'string' }, description: 'Hypothèses retenues, à relire par l’architecte' },
  },
  required: ['taches'],
};

const SYSTEM_PROMPT = `Tu es un maître d'œuvre d'exécution (OPC) qui établit le planning d'un chantier de bâtiment en France.
À partir du DPGF et du CCTP de l'opération (quand ils sont fournis), des lots, des entreprises titulaires, des montants de marché et des pièces, propose un planning de travaux réaliste :
- quand un lot a un DPGF, ses chapitres sont la trame de ses phases d'intervention (une tâche par chapitre significatif, les petits chapitres regroupés), et les quantités et montants des ouvrages dimensionnent les durées ;
- les prescriptions du CCTP (délais de séchage ou de cure, mise en œuvre par phases, conditions d'accès, essais préalables, coordination avec d'autres lots) s'imposent à l'enchaînement et sont rappelées dans les hypothèses quand elles ont pesé ;
- quand l'opération compte plusieurs bâtiments ou phases, le planning les suit dans l'ordre indiqué ;
- l'enchaînement usuel d'un chantier (installation et préparation, gros œuvre, clos et couvert, second œuvre, lots techniques, finitions, essais, opérations préalables à la réception, réception) ;
- pour chaque lot demandé, de 2 à 6 phases d'intervention (approvisionnement et préparation, exécution par zone, finitions...) dont les durées sont proportionnées au montant du marché et au contenu du lot ;
- des recouvrements entre lots quand ils sont possibles sur un vrai chantier, et jamais deux interventions incompatibles au même endroit ;
- les durées déjà connues d'un marché ou d'un planning fourni sont reprises telles quelles, sans les contredire ;
- les semaines d'arrêt ou de congés ne sont comptées que si les pièces ou les consignes les mentionnent.
Tu ne fournis que des semaines (1 = semaine de démarrage), jamais de dates. N'invente ni lot ni entreprise : utilise uniquement les numéros de lot fournis, plus « general » pour les tâches communes. Rédige en français.`;

function parseJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function registerPlanningChantierRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents } = deps;

  async function projectInTenant(tenantId: string, projectId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('*').eq('id', projectId).maybeSingle();
    return (data as any) || null;
  }

  app.get('/api/projects/:projectId/planning-chantier', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await projectInTenant(tenantId, req.params.projectId))) return res.status(404).json({ error: 'Opération introuvable.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_chantier_planning')
        .select('data, updated_at').eq('project_id', req.params.projectId).maybeSingle();
      // Instance non migrée : un planning vide, pas une panne.
      if (error) return isMissingTable(error)
        ? res.json({ available: false, planning: PLANNING_VIDE, updated_at: null })
        : res.status(500).json({ error: 'Lecture impossible.' });
      // Entreprises titulaires par lot (marchés rapprochés des lots) : la fiche du lot n'en porte pas toujours.
      const entreprises: Record<string, string> = {};
      try {
        for (const l of (await chargerLots(tenantId, req.params.projectId, null)).lots) if (l.contact_name) entreprises[l.id] = l.contact_name;
      } catch { /* complément : jamais une raison de refuser la lecture */ }
      res.json({ available: true, planning: sanitizePlanning((data as any)?.data), updated_at: (data as any)?.updated_at ?? null, entreprises });
    } catch (error) {
      console.error('[GET /api/projects/:projectId/planning-chantier]', error);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  app.put('/api/projects/:projectId/planning-chantier', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await projectInTenant(tenantId, req.params.projectId))) return res.status(404).json({ error: 'Opération introuvable.' });
      const planning = sanitizePlanning(req.body);
      const updatedAt = new Date().toISOString();
      // project_id est la clé primaire et vient d'être vérifié dans le cabinet : le conflit ne peut viser qu'une ligne du cabinet.
      const { error } = await supabaseAdmin.from('project_chantier_planning').upsert(
        { project_id: req.params.projectId, tenant_id: tenantId, data: planning, updated_by: req.user.id, updated_at: updatedAt },
        { onConflict: 'project_id' },
      );
      if (error) return isMissingTable(error)
        ? res.status(503).json({ error: MIGRATION_MISSING })
        : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.json({ available: true, planning, updated_at: updatedAt });
    } catch (error) {
      console.error('[PUT /api/projects/:projectId/planning-chantier]', error);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  /** Lots de l'affaire avec ce qu'on sait d'eux : entreprise titulaire, montant, durée de marché. */
  async function chargerLots(tenantId: string, projectId: string, lotIds: Set<string> | null) {
    const { data: lotRows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_lots').select('*').eq('project_id', projectId);
    const lots = ((lotRows as any[]) || []).filter(l => !lotIds || lotIds.has(l.id));
    const contactIds = [...new Set(lots.map(l => l.contact_id).filter(Boolean))];
    const noms = new Map<string, string>();
    if (contactIds.length) {
      const { data: contacts } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('id, name').in('id', contactIds);
      for (const c of (contacts as any[]) || []) noms.set(c.id, c.name);
    }
    // Les marchés sont un complément : leur absence (instance non migrée) ne bloque pas la génération.
    const { data: marchesRows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
      .select('entreprise_nom, lot_numero, lot_titre, montant_ht, duree_mois, statut').eq('project_id', projectId);
    // Rapprochement par intitulé (le numéro d'un marché ne suit pas toujours celui du lot), voir planningSources.ts.
    const { parLot, sansLot } = associerMarches(
      lots.map(l => ({ id: l.id, lot_number: String(l.lot_number ?? ''), lot_title: String(l.lot_title ?? '') })),
      (marchesRows as MarcheLigne[]) || [],
    );
    return {
      sansLot,
      lots: lots.map(l => {
        const marche = parLot.get(l.id);
        const montant = marche?.montantHt || (Number(l.base_amount) || 0) + (Number(l.options_amount) || 0) + (Number(l.amendments_amount) || 0);
        return {
          id: l.id as string,
          lot_number: String(l.lot_number ?? ''),
          lot_title: String(l.lot_title ?? ''),
          contact_name: marche?.entreprises.join(' / ') || (l.contact_id ? noms.get(l.contact_id) : undefined) || l.contact_name || undefined,
          montant_ht: montant > 0 ? Math.round(montant) : null,
          duree_mois: marche?.dureeMois ?? null,
        };
      }),
    };
  }

  app.post('/api/projects/:projectId/planning-chantier/generate', aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const project = await projectInTenant(tenantId, projectId);
      if (!project) return res.status(404).json({ error: 'Opération introuvable.' });

      const dateDebut = req.body?.date_debut;
      if (!estDateIso(dateDebut)) return res.status(400).json({ error: 'Indiquez la date de démarrage des travaux.' });
      const dureeCible = Math.round(Number(req.body?.duree_cible_semaines));
      const instructions = str(req.body?.instructions, MAX_INSTRUCTIONS_CHARS);
      const lotIds = Array.isArray(req.body?.lot_ids) ? new Set<string>(req.body.lot_ids.filter((id: unknown) => typeof id === 'string')) : null;

      const { lots: tousLots, sansLot: marchesHorsLot } = await chargerLots(tenantId, projectId, lotIds);
      const lots = tousLots.slice(0, MAX_LOTS);
      if (!lots.length) return res.status(400).json({ error: 'Aucun lot à planifier : renseignez d’abord les lots de l’opération.' });

      // Le DPGF et le CCTP de l'opération sont le point de départ quand ils existent.
      // Meilleur effort : un document illisible ne bloque pas la génération.
      let sources = sourcesPourPlanning(null, []);
      if (req.body?.depuis_dpgf !== false) {
        const { data: ligneDpgf } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').select('data').eq('project_id', projectId).maybeSingle();
        try {
          const brut = (ligneDpgf as any)?.data;
          sources = sourcesPourPlanning(typeof brut === 'string' ? JSON.parse(brut) : brut, lots);
        } catch { /* document non lisible : génération sans lui */ }
      }
      const sourceDuLot = new Map(sources.lots.map(s => [s.lotId, s]));
      // Sans marché chiffré, le montant du DPGF dimensionne le lot.
      for (const l of lots) if (!l.montant_ht && sourceDuLot.get(l.id)?.montantHt) l.montant_ht = sourceDuLot.get(l.id)!.montantHt;

      // Seules les pièces de CETTE affaire : un identifiant étranger est écarté.
      const documentIds: string[] = Array.isArray(req.body?.document_ids)
        ? req.body.document_ids.filter((id: unknown) => typeof id === 'string').slice(0, MAX_DOCUMENTS)
        : [];
      const ignored: string[] = [];
      let pieces = '';
      let documentsRead = 0;
      if (documentIds.length) {
        const { data: docRows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('id, name, file_url, project_id').in('id', documentIds);
        const agents = await import('@zinkh/archioffice-agents/server');
        for (const doc of ((docRows as any[]) || []).filter(d => d.project_id === projectId)) {
          if (pieces.length >= MAX_SOURCE_CHARS) break;
          const text = await agents.extractKnowledgeDocText(supabaseAdmin, tenantId, doc).catch(() => null);
          if (!text) { ignored.push(doc.name); continue; }
          pieces += `\n\n--- ${doc.name} ---\n${text.slice(0, MAX_SOURCE_CHARS - pieces.length)}`;
          documentsRead++;
        }
      }

      const lignesLots = lots.map(l => {
        const entete = [
          `Lot ${l.lot_number} : ${l.lot_title}`,
          l.contact_name ? `entreprise ${l.contact_name}` : 'entreprise à désigner',
          l.montant_ht ? `marché ${l.montant_ht} € HT` : null,
          l.duree_mois ? `durée de marché ${l.duree_mois} mois` : null,
        ].filter(Boolean).join(' ; ');
        const detail = texteSourceLot(sourceDuLot.get(l.id));
        return detail ? `${entete}\n${detail}` : entete;
      });
      const prompt = `Opération : ${project.name || 'sans nom'}${project.address ? ` (${project.address})` : ''}.
Démarrage des travaux : semaine du ${dateDebut} (semaine 1).${dureeCible > 0 ? `\nDurée totale visée : environ ${dureeCible} semaines, réception comprise.` : ''}${sources.batiments.length ? `\nBâtiments, dans l'ordre du document : ${sources.batiments.join(', ')}.` : ''}${sources.phases.length ? `\nPhases de l'opération : ${sources.phases.join(', ')}.` : ''}${instructions ? `\nConsignes de l'architecte : ${instructions}` : ''}

Lots à planifier :
${lignesLots.join('\n')}${marchesHorsLot.length ? `\n\nMarchés sans lot (tâches générales du chantier) : ${marchesHorsLot.map(m => `${m.lot_titre || 'sans intitulé'}${m.entreprise_nom ? ` (${m.entreprise_nom})` : ''}${Number(m.montant_ht) > 0 ? `, ${Math.round(Number(m.montant_ht))} € HT` : ''}`).join(' ; ')}.` : ''}
${pieces ? `\nPièces de l'affaire (planning d'entreprise, notices, phasage) :${pieces}\n` : ''}
Réponds UNIQUEMENT avec un JSON valide (sans markdown) conforme à ce schéma :
${JSON.stringify(PLANNING_SCHEMA)}`;

      const { resolveLlmProvider, getTenantAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getTenantAiConfig(supabaseAdmin, tenantId));
      const reservedCents = await estimateReserveCents(provider.id, provider.model, Math.ceil((prompt.length + SYSTEM_PROMPT.length) / 4));
      if (!(await reserveAiCredit(tenantId, reservedCents))) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }
      let result;
      try {
        result = await provider.chat({ system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }], timeoutMs: GENERATION_TIMEOUT_MS });
      } catch (e) {
        await refundAiCredit(tenantId, reservedCents).catch(() => {});
        throw e;
      }
      await settleAiCredit({
        tenantId, userId: req.user.id, agentId: null, conversationId: null, endpointType: 'planning_generation',
        provider: provider.id, model: provider.model, reservedCents,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });

      const brut = parseJsonObject(result.text);
      const planifiables: LotPlanifiable[] = lots.map(({ id, lot_number, lot_title, contact_name }) => ({ id, lot_number, lot_title, contact_name }));
      const genere = planningDepuisReponse(brut, planifiables, dateDebut, randomUUID);
      if (!genere.taches.length) return res.status(502).json({ error: 'Réponse IA invalide : aucune tâche exploitable.' });
      res.json({
        ...genere, lot_ids: lots.map(l => l.id), documents_read: documentsRead, ignored,
        sources: { dpgf: sources.aDpgf, cctp: sources.aCctp },
      });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      console.error('[POST /api/projects/:projectId/planning-chantier/generate]', e?.message);
      Sentry.captureException(e, { tags: { feature: 'planning-chantier' } });
      res.status(500).json({ error: 'Échec de la génération du planning : ' + e.message });
    }
  });
}
