// Journal de l'opération : notes datées, rattachées à une phase MOP, typées
// (changement de programme, dépassement de budget, décision du maître
// d'ouvrage, point d'attention, observation). Table project_phase_notes,
// supabase/migrate_project_phase_notes.sql. Voir CLAUDE.md, « Journal de
// l'opération ».
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import {
  PHASE_NOTE_KINDS, PHASE_NOTE_PHASES, PHASE_NOTE_MAX_CHARS,
  type PhaseNoteKind,
} from '../../src/lib/phaseJournal';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
}

/** Table absente : instance dont la base n'a pas encore joué la migration. */
function isMissingTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || (/project_phase_notes/.test(message) && /does not exist|schema cache/i.test(message));
}

const MIGRATION_MISSING = 'Le journal de l’opération n’est pas encore disponible sur cette instance (migration project_phase_notes à appliquer).';

function parseAmount(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Valide et normalise le corps d'une entrée ; `partial` pour une modification. */
export function validatePhaseNote(body: any, partial = false): { value?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  if (!partial || body.phase !== undefined) {
    if (!PHASE_NOTE_PHASES.includes(body.phase)) return { error: 'Phase inconnue.' };
    out.phase = body.phase;
  }
  if (!partial || body.kind !== undefined) {
    const kind = body.kind ?? 'observation';
    if (!PHASE_NOTE_KINDS.includes(kind)) return { error: 'Type de note inconnu.' };
    out.kind = kind;
  }
  if (!partial || body.body !== undefined) {
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) return { error: 'La note est vide.' };
    if (text.length > PHASE_NOTE_MAX_CHARS) return { error: `La note dépasse ${PHASE_NOTE_MAX_CHARS} caractères.` };
    out.body = text;
  }
  if (body.occurred_on !== undefined) {
    if (!isIsoDate(body.occurred_on)) return { error: 'Date invalide.' };
    out.occurred_on = body.occurred_on;
  }
  for (const field of ['budget_before', 'budget_after'] as const) {
    if (body[field] === undefined) continue;
    const amount = parseAmount(body[field]);
    if (amount === 'invalid') return { error: 'Montant invalide.' };
    out[field] = amount;
  }
  // Les montants n'ont de sens que pour un dépassement de budget.
  const kind = (out.kind ?? body.kind) as PhaseNoteKind | undefined;
  if (kind && kind !== 'budget') {
    out.budget_before = null;
    out.budget_after = null;
  }
  return { value: out };
}

export function registerProjectPhaseNotesRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName }: RouteDeps) {
  app.get('/api/projects/:id/phase-notes', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_notes')
        .select('*')
        .eq('project_id', req.params.id)
        .order('occurred_on', { ascending: false });
      if (error) {
        if (isMissingTable(error)) return res.json([]);
        throw error;
      }
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/phase-notes]', e);
      res.status(500).json({ error: 'Impossible de lire le journal de l’opération.' });
    }
  });

  app.post('/api/projects/:id/phase-notes', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { value, error: invalid } = validatePhaseNote(req.body || {});
      if (invalid) return res.status(400).json({ error: invalid });

      const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
        .select('id').eq('id', req.params.id).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const authorName = await getUserName(tenantId, req.user.id, req.user.email);
      const now = new Date().toISOString();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_notes')
        .insert({
          id: crypto.randomUUID(),
          project_id: req.params.id,
          occurred_on: now.slice(0, 10),
          ...value,
          author_id: req.user.id,
          author_name: authorName,
          created_at: now,
          updated_at: now,
        })
        .select().single();
      if (error) {
        if (isMissingTable(error)) return res.status(503).json({ error: MIGRATION_MISSING });
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/projects/:id/phase-notes]', e);
      res.status(500).json({ error: 'Impossible d’enregistrer la note.' });
    }
  });

  app.put('/api/phase-notes/:noteId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { value, error: invalid } = validatePhaseNote(req.body || {}, true);
      if (invalid) return res.status(400).json({ error: invalid });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_notes')
        .update({ ...value, updated_at: new Date().toISOString() })
        .eq('id', req.params.noteId)
        .select().maybeSingle();
      if (error) {
        if (isMissingTable(error)) return res.status(503).json({ error: MIGRATION_MISSING });
        throw error;
      }
      if (!data) return res.status(404).json({ error: 'Note introuvable.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/phase-notes/:noteId]', e);
      res.status(500).json({ error: 'Impossible de modifier la note.' });
    }
  });

  app.delete('/api/phase-notes/:noteId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_notes')
        .delete().eq('id', req.params.noteId);
      if (error) {
        if (isMissingTable(error)) return res.status(503).json({ error: MIGRATION_MISSING });
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/phase-notes/:noteId]', e);
      res.status(500).json({ error: 'Impossible de supprimer la note.' });
    }
  });
}
