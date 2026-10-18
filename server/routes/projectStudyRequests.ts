// Historique des demandes envoyées depuis la fiche affaire (étude de sol, contrôle
// technique, CSPS). L'envoi part par le composeur de messagerie ; cette route ne
// fait que consigner ce qui a été confirmé comme envoyé, dans l'affaire.
//
// Rejouable : l'identifiant est fourni par le navigateur, un second POST avec le
// même identifiant rend l'existant au lieu d'un doublon.
import type { Express } from 'express';
import crypto from 'node:crypto';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export const STUDY_KINDS = ['geotechnique', 'controle_technique', 'csps'] as const;
export type StudyKind = typeof STUDY_KINDS[number];

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 20;
const MAX_STUDIES = 20;
const MAX_SUBJECT = 300;
const MAX_PAYLOAD_CHARS = 20000;
const MAX_LIST = 200;
const CATEGORY = 'Études';

// Instance dont la base n'a pas encore joué supabase/migrate_project_study_requests.sql :
// la lecture rend une liste vide, l'écriture un 503 explicite.
function isMissingTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/project_study_requests/.test(message) && /does not exist|schema cache/i.test(message));
}

const MIGRATION_MISSING = 'L\'historique des demandes n\'est pas encore disponible sur cette instance (migration project_study_requests à appliquer).';

const KIND_LABELS: Record<StudyKind, string> = {
  geotechnique: 'de sol',
  controle_technique: 'de contrôle technique',
  csps: 'CSPS',
};

interface StudyRequestInput {
  id?: unknown;
  kind?: unknown;
  subject?: unknown;
  recipients?: unknown;
  etudes?: unknown;
  payload?: unknown;
}

// Renvoie le motif du refus, ou null si la demande est recevable.
export function validateStudyRequest(body: StudyRequestInput): string | null {
  if (typeof body.kind !== 'string' || !(STUDY_KINDS as readonly string[]).includes(body.kind)) return 'Nature de demande inconnue.';
  if (body.id !== undefined && (typeof body.id !== 'string' || !ID_PATTERN.test(body.id))) return 'Identifiant invalide.';
  if (typeof body.subject !== 'string' || !body.subject.trim()) return 'L\'objet du message est requis.';
  if (body.subject.length > MAX_SUBJECT) return 'Objet trop long.';
  if (!Array.isArray(body.recipients) || body.recipients.length === 0) return 'Au moins un destinataire est requis.';
  if (body.recipients.length > MAX_RECIPIENTS) return 'Trop de destinataires.';
  if (body.recipients.some(r => typeof r !== 'string' || !EMAIL.test(r))) return 'Adresse e-mail invalide dans les destinataires.';
  if (!Array.isArray(body.etudes) || body.etudes.length === 0) return 'Au moins une étude ou mission est requise.';
  if (body.etudes.length > MAX_STUDIES || body.etudes.some(e => typeof e !== 'string' || e.length > 40)) return 'Liste d\'études invalide.';
  if (body.payload === undefined || body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload)) return 'Contenu de la demande invalide.';
  if (JSON.stringify(body.payload).length > MAX_PAYLOAD_CHARS) return 'Contenu de la demande trop volumineux.';
  return null;
}

export function registerProjectStudyRequestRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/projects/:projectId/study-requests', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
      const query = tenantScopedFrom(supabaseAdmin, tenantId, 'project_study_requests').select('*').eq('project_id', projectId);
      if (kind) query.eq('kind', kind);
      const { data, error } = await query.order('sent_at', { ascending: false }).limit(MAX_LIST);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      if (isMissingTable(e)) return res.json([]);
      console.error(e);
      res.status(500).json({ error: 'Failed to fetch study requests' });
    }
  });

  app.post('/api/projects/:projectId/study-requests', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const refusal = validateStudyRequest(req.body || {});
      if (refusal) return res.status(400).json({ error: refusal });

      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(404).json({ error: 'Affaire introuvable pour ce cabinet.' });
      }

      const b = req.body;
      const id = b.id || crypto.randomUUID();
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_study_requests').select('*').eq('id', id).maybeSingle();
      if (existing) return res.status(200).json(existing);

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_study_requests').insert({
        id,
        project_id: projectId,
        kind: b.kind,
        subject: b.subject.trim(),
        recipients: b.recipients,
        etudes: b.etudes,
        payload: b.payload,
        sent_by: req.user.id,
        sent_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Demande ${KIND_LABELS[b.kind as StudyKind]} envoyée`, b.subject.trim(), id, 'study_request', CATEGORY);
      res.status(201).json(data);
    } catch (e: any) {
      if (isMissingTable(e)) return res.status(503).json({ error: MIGRATION_MISSING });
      console.error(e);
      res.status(500).json({ error: 'Failed to record study request' });
    }
  });
}
