// Rapports de diagnostic d'une opération de rénovation (onglet DIAG de la fiche
// affaire) : liste, création, enregistrement, suppression, et rédaction
// assistée par l'IA depuis l'éditeur de texte riche (commande « / »).
//
// L'IA lit la fiche de l'affaire, les pièces jointes et le rapport en cours
// (voir src/lib/diagReports.ts) ; sa réponse est renvoyée telle quelle au
// client, qui la soumet à validation avant de l'insérer. Même facturation que
// les notices : crédit réservé avant l'appel, réglé après, remboursé en cas
// d'échec.
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sanitizeRichHtml } from '../richHtml';
import { extractProjectDocuments } from './projectNotices';
import { projectNoticeFacts } from '../../src/lib/projectNotices';
import { htmlToPlainText } from '../../src/lib/richText';
import { buildDiagPrompt, isDiagAiMode } from '../../src/lib/diagReports';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'proposal_ai'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
}

const TABLE = 'diag_reports';
const MAX_TITLE = 200;
const MAX_REPORTS_PER_PROJECT = 50;
const MAX_INSTRUCTION = 2_000;
const MAX_SELECTION = 12_000;
const MAX_DOCUMENT = 20_000;
const MAX_OTHER_REPORTS = 8_000;
const MAX_RESULT = 30_000;

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value : '').slice(0, max);

async function projectForTenant(supabaseAdmin: any, tenantId: string, projectId: string) {
  const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
    .select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  return data;
}

export function registerDiagReportRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents } = deps;

  async function runModel(tenantId: string, userId: string, prompt: string) {
    const { resolveLlmProvider, getTenantAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
    const provider = resolveLlmProvider(await getTenantAiConfig(supabaseAdmin, tenantId));
    const reservedCents = await estimateReserveCents(provider.id, provider.model, Math.ceil(prompt.length / 4));
    if (!(await reserveAiCredit(tenantId, reservedCents))) return { noCredit: true as const };

    let result;
    try {
      result = await provider.chat({ messages: [{ role: 'user', content: prompt }] });
    } catch (error) {
      await refundAiCredit(tenantId, reservedCents).catch(() => {});
      throw error;
    }
    // Même compartiment de facturation que les autres rédactions documentaires.
    await settleAiCredit({
      tenantId, userId, agentId: null, conversationId: null, endpointType: 'proposal_ai',
      provider: provider.id, model: provider.model, reservedCents,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    });
    return { text: result.text };
  }

  app.get('/api/projects/:id/diag-reports', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await projectForTenant(supabaseAdmin, tenantId, req.params.id))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('*').eq('project_id', req.params.id).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      console.error('[GET diag reports]', error);
      res.status(500).json({ error: 'Impossible de lire les rapports de diagnostic.' });
    }
  });

  app.post('/api/projects/:id/diag-reports', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await projectForTenant(supabaseAdmin, tenantId, req.params.id))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const scoped = tenantScopedFrom(supabaseAdmin, tenantId, TABLE);
      const { data: existing, error: countError } = await scoped.select('id').eq('project_id', req.params.id);
      if (countError) throw countError;
      if ((existing?.length ?? 0) >= MAX_REPORTS_PER_PROJECT) return res.status(400).json({ error: 'Nombre maximal de rapports atteint pour cette affaire.' });

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).insert({
        id: crypto.randomUUID(),
        project_id: req.params.id,
        title: str(req.body?.title, MAX_TITLE).trim() || 'Diagnostic',
        content: sanitizeRichHtml(req.body?.content),
        created_by: req.user.id,
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (error: any) {
      console.error('[POST diag report]', error);
      res.status(500).json({ error: 'Impossible de créer le rapport.' });
    }
  });

  app.put('/api/projects/:id/diag-reports/:rid', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof req.body?.title === 'string') patch.title = str(req.body.title, MAX_TITLE).trim() || 'Diagnostic';
      if (typeof req.body?.content === 'string') patch.content = sanitizeRichHtml(req.body.content);

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE).update(patch)
        .eq('id', req.params.rid).eq('project_id', req.params.id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Rapport introuvable.' });
      res.json(data);
    } catch (error: any) {
      console.error('[PUT diag report]', error);
      res.status(500).json({ error: 'Impossible d’enregistrer le rapport.' });
    }
  });

  app.delete('/api/projects/:id/diag-reports/:rid', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .delete().eq('id', req.params.rid).eq('project_id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE diag report]', error);
      res.status(500).json({ error: 'Impossible de supprimer le rapport.' });
    }
  });

  // Rédaction assistée : renvoie le texte proposé, n'écrit rien en base.
  app.post('/api/projects/:id/diag-reports/ai-write', aiGenerationLimiter, async (req: any, res: any) => {
    let tenantId = '';
    try {
      tenantId = await getTenantId(req.user.id);
      const mode = req.body?.mode;
      if (!isDiagAiMode(mode)) return res.status(400).json({ error: 'Commande de rédaction inconnue.' });
      const selection = str(req.body?.selection, MAX_SELECTION);
      if (['rewrite', 'shorten', 'expand', 'fix'].includes(mode) && !selection.trim()) {
        return res.status(400).json({ error: 'Aucun texte à traiter.' });
      }
      const instruction = str(req.body?.instruction, MAX_INSTRUCTION);
      if (mode === 'write' && !instruction.trim()) return res.status(400).json({ error: 'Précisez ce qu’il faut écrire.' });

      const project = await projectForTenant(supabaseAdmin, tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const { data: reports } = await tenantScopedFrom(supabaseAdmin, tenantId, TABLE)
        .select('id, title, content').eq('project_id', req.params.id).order('created_at', { ascending: true });
      const currentId = typeof req.body?.reportId === 'string' ? req.body.reportId : '';
      const current = (reports || []).find((r: any) => r.id === currentId);
      const otherReports = (reports || [])
        .filter((r: any) => r.id !== currentId && String(r.content || '').trim())
        .map((r: any) => `### ${r.title}\n${htmlToPlainText(r.content)}`)
        .join('\n\n').slice(0, MAX_OTHER_REPORTS);

      const projectDocs = await extractProjectDocuments(supabaseAdmin, tenantId, req.params.id).catch(() => '');
      const prompt = buildDiagPrompt({
        mode, instruction, selection,
        document: str(req.body?.document, MAX_DOCUMENT),
        reportTitle: current?.title || str(req.body?.reportTitle, MAX_TITLE),
        facts: projectNoticeFacts(project),
        projectDocs, otherReports,
      });

      const out = await runModel(tenantId, req.user.id, prompt);
      if ('noCredit' in out) return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      res.json({ text: out.text.trim().slice(0, MAX_RESULT) });
    } catch (error: any) {
      if (error?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: error.message });
      console.error('[POST diag report AI]', error);
      Sentry.captureException(error, { tags: { feature: 'diag-report-ai' }, extra: { tenantId } });
      res.status(500).json({ error: 'Échec de la rédaction assistée.' });
    }
  });
}
