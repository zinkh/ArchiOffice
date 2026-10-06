import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import {
  ARCHITECTURAL_NOTICE_PHASES,
  isProjectNoticeKind,
  isProjectNoticePhase,
  projectNoticeFacts,
  projectNoticeOutline,
  projectNoticeTitle,
  type ProjectNoticeKind,
} from '../../src/lib/projectNotices';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'proposal_ai'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
}

const TABLE = 'project_notices';
const MAX_CONTENT = 60_000;
const MAX_INSTRUCTIONS = 4_000;
const MAX_DOC_CHARS = 24_000;
const MAX_PREVIOUS_NOTICE_CHARS = 14_000;

function str(value: unknown, max: number): string {
  return (typeof value === 'string' ? value : '').slice(0, max);
}

function validateNoticeParams(kind: unknown, phase: unknown): { kind: ProjectNoticeKind; phase: string } | null {
  if (!isProjectNoticeKind(kind) || !isProjectNoticePhase(phase)) return null;
  if (kind === 'architectural' && !(ARCHITECTURAL_NOTICE_PHASES as readonly string[]).includes(phase)) return null;
  // Les deux notices réglementaires sont aujourd'hui portées par le dossier PC.
  // Le champ phase reste en base pour permettre une évolution ultérieure sans migration.
  if (kind !== 'architectural' && phase !== 'PC') return null;
  return { kind, phase };
}

async function projectForTenant(supabaseAdmin: any, tenantId: string, projectId: string) {
  const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
    .select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  return data;
}

async function extractProjectDocuments(supabaseAdmin: any, tenantId: string, projectId: string): Promise<string> {
  const { data: docs, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
    .select('name, file_url, mime_type').eq('project_id', projectId);
  if (error) throw error;
  if (!docs?.length) return '';

  const { extractKnowledgeDocText } = await import('@zinkh/archioffice-agents/server');
  let combined = '';
  for (const doc of docs) {
    if (combined.length >= MAX_DOC_CHARS) break;
    if (doc.mime_type?.startsWith('image/')) continue;
    const text = await extractKnowledgeDocText(supabaseAdmin, tenantId, doc as any).catch(() => null);
    if (!text) continue;
    combined += `\n\n--- ${doc.name || 'Pièce du projet'} ---\n${text.slice(0, MAX_DOC_CHARS - combined.length)}`;
  }
  return combined;
}

async function writeNotice(
  supabaseAdmin: any,
  tenantId: string,
  projectId: string,
  kind: ProjectNoticeKind,
  phase: string,
  patch: Record<string, unknown>,
) {
  const scoped = tenantScopedFrom(supabaseAdmin, tenantId, TABLE);
  const { data: current, error: readError } = await scoped.select('id')
    .eq('project_id', projectId).eq('kind', kind).eq('phase', phase).maybeSingle();
  if (readError) throw readError;

  if (current) {
    const { data, error } = await scoped.update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', current.id).select().single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await scoped.insert({
    id: crypto.randomUUID(),
    project_id: projectId,
    kind,
    phase,
    content: '',
    instructions: '',
    status: 'a_rediger',
    ...patch,
  }).select().single();
  if (error) throw error;
  return data;
}

export function registerProjectNoticeRoutes(app: Express, deps: RouteDeps) {
  const {
    supabaseAdmin, getTenantId, getTenantPlan,
    reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents,
  } = deps;

  async function runModel(tenantId: string, userId: string, prompt: string) {
    const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
    const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));
    const reservedCents = await estimateReserveCents(provider.id, provider.model, Math.ceil(prompt.length / 4));
    if (!(await reserveAiCredit(tenantId, reservedCents))) return { noCredit: true as const };

    let result;
    try {
      result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
    } catch (error) {
      await refundAiCredit(tenantId, reservedCents).catch(() => {});
      throw error;
    }

    // Les notices partagent le même compartiment de facturation que les autres
    // rédactions documentaires de proposition ; cela évite d'élargir le schéma
    // ai_usage pour une simple nouvelle surface éditoriale.
    await settleAiCredit({
      tenantId, userId, agentId: null, conversationId: null, endpointType: 'proposal_ai',
      provider: provider.id, model: provider.model, reservedCents,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    });
    return { text: result.text };
  }

  app.get('/api/projects/:id/notices', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const project = await projectForTenant(supabaseAdmin, tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('*').eq('project_id', req.params.id).order('kind', { ascending: true }).order('phase', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      console.error('[GET project notices]', error);
      res.status(500).json({ error: 'Impossible de lire les notices de l’opération.' });
    }
  });

  app.put('/api/projects/:id/notices/:kind/:phase', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const params = validateNoticeParams(req.params.kind, req.params.phase);
      if (!params) return res.status(400).json({ error: 'Type ou phase de notice invalide.' });
      const project = await projectForTenant(supabaseAdmin, tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const content = str(req.body?.content, MAX_CONTENT);
      const instructions = str(req.body?.instructions, MAX_INSTRUCTIONS);
      const row = await writeNotice(
        supabaseAdmin, tenantId, req.params.id, params.kind, params.phase,
        { content, instructions, status: content.trim() ? 'redige' : 'a_rediger' },
      );
      res.json(row);
    } catch (error: any) {
      console.error('[PUT project notice]', error);
      res.status(500).json({ error: 'Impossible d’enregistrer la notice.' });
    }
  });

  app.post('/api/projects/:id/notices/:kind/:phase/generate-ai', aiGenerationLimiter, async (req: any, res: any) => {
    let tenantId = '';
    try {
      tenantId = await getTenantId(req.user.id);
      const params = validateNoticeParams(req.params.kind, req.params.phase);
      if (!params) return res.status(400).json({ error: 'Type ou phase de notice invalide.' });

      const { plan } = await getTenantPlan(tenantId);
      if (plan !== 'enterprise') {
        return res.status(403).json({ error: 'La rédaction assistée des notices est réservée au plan Enterprise.' });
      }

      const project = await projectForTenant(supabaseAdmin, tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const { data: current } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('content, instructions').eq('project_id', req.params.id)
        .eq('kind', params.kind).eq('phase', params.phase).maybeSingle();

      const instructions = str(req.body?.instructions ?? current?.instructions, MAX_INSTRUCTIONS);
      const existingContent = str(current?.content, MAX_CONTENT);

      const { data: notes } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_notes')
        .select('kind, body, occurred_on').eq('project_id', req.params.id)
        .eq('phase', params.phase).order('occurred_on', { ascending: true });
      const phaseJournal = (notes || [])
        .map((n: any) => `- ${n.occurred_on || ''} [${n.kind || 'observation'}] ${n.body || ''}`.trim())
        .join('\n');

      let previousNotice = '';
      if (params.kind === 'architectural') {
        const phases = ARCHITECTURAL_NOTICE_PHASES as readonly string[];
        const index = phases.indexOf(params.phase);
        if (index > 0) {
          const previousPhases = phases.slice(0, index).reverse();
          const { data: previousRows } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
            .select('phase, content').eq('project_id', req.params.id).eq('kind', 'architectural');
          const prior = previousPhases
            .map(phase => (previousRows || []).find((row: any) => row.phase === phase && row.content?.trim()))
            .find(Boolean);
          if (prior) previousNotice = `Notice architecturale ${prior.phase} :\n${String(prior.content).slice(0, MAX_PREVIOUS_NOTICE_CHARS)}`;
        }
      }

      const projectDocs = await extractProjectDocuments(supabaseAdmin, tenantId, req.params.id).catch(() => '');
      const facts = projectNoticeFacts(project);
      const outline = projectNoticeOutline(params.kind, params.phase).map((title, i) => `${i + 1}. ${title}`).join('\n');
      const title = projectNoticeTitle(params.kind, params.phase);
      const erpInputs = project.erp_calcul ? JSON.stringify(project.erp_calcul).slice(0, 4000) : '';

      const regulatoryGuard = params.kind === 'architectural'
        ? 'La notice décrit le projet au niveau de précision réel de la phase. Ne transforme pas une intention en solution définitivement arrêtée si les données ne le permettent pas.'
        : `Il s'agit d'un brouillon réglementaire destiné à être vérifié par le maître d'œuvre avant dépôt. N'invente jamais de catégorie ERP, type ERP, effectif, largeur, distance, nombre de dégagements, degré coupe-feu, classement de réaction au feu, équipement SSI, article de règlement, seuil ni dérogation. Tu peux rappeler un principe général seulement s'il est formulé sans faux chiffre ni fausse référence. Toute donnée réglementaire nécessaire mais absente doit être explicitement marquée « à vérifier » ou « à confirmer ».`;

      const prompt = `Tu es l'assistant de rédaction d'un cabinet d'architecture français.
Tu dois produire : ${title}.
Phase de l'opération : ${params.phase}.

TRAME À SUIVRE :
${outline}

DONNÉES FACTUELLES DE L'AFFAIRE :
${facts || 'Aucune donnée factuelle exploitable n’est encore renseignée.'}
${erpInputs ? `\nSAISIES DU CALCUL D'EFFECTIF ERP :\n${erpInputs}` : ''}
${phaseJournal ? `\nJOURNAL DE LA PHASE ${params.phase} :\n${phaseJournal}` : ''}
${previousNotice ? `\nNOTICE DE LA PHASE PRÉCÉDENTE, À FAIRE ÉVOLUER SANS LA RECOPIER MÉCANIQUEMENT :\n${previousNotice}` : ''}
${projectDocs.trim() ? `\nEXTRAITS DES PIÈCES JOINTES À L'AFFAIRE :\n${projectDocs}` : ''}
${existingContent.trim() ? `\nTEXTE DÉJÀ SAISI, À AMÉLIORER ET COMPLÉTER :\n${existingContent}` : ''}
${instructions.trim() ? `\nCONSIGNE DE L'ARCHITECTE :\n${instructions}` : ''}

RÈGLES IMPÉRATIVES :
- Rédige en français professionnel, précis, sobre et directement exploitable.
- Respecte la trame, avec des titres numérotés en texte brut puis des paragraphes. Pas de markdown.
- N'invente aucune surface, quantité, servitude, prescription PLU, caractéristique constructive ni décision qui ne figure pas dans les données.
- Quand une information manque, indique clairement « à préciser », « à confirmer » ou « à vérifier » selon le cas.
- Ne cite aucun texte, article ou norme avec un numéro si cette référence n'est pas fournie dans les pièces.
- ${regulatoryGuard}
- Ne prétends jamais que le projet est « conforme » de manière générale : décris les dispositions connues et les vérifications restant à mener.
- Ne mets ni préambule conversationnel ni conclusion sur ton rôle d'IA : rends uniquement la notice.`;

      const out = await runModel(tenantId, req.user.id, prompt);
      if ('noCredit' in out) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      const generated = out.text.trim().slice(0, MAX_CONTENT);
      const row = await writeNotice(
        supabaseAdmin, tenantId, req.params.id, params.kind, params.phase,
        {
          content: generated,
          instructions,
          status: generated ? 'redige' : 'a_rediger',
          generated_at: new Date().toISOString(),
        },
      );
      res.json(row);
    } catch (error: any) {
      if (error?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: error.message });
      console.error('[POST project notice AI]', error);
      Sentry.captureException(error, { tags: { feature: 'project-notice-ai' }, extra: { tenantId } });
      res.status(500).json({ error: 'Échec de la rédaction assistée de la notice.' });
    }
  });
}
