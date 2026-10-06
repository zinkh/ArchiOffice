import { createHash } from 'node:crypto';
import defaults from './config/phaseControls.json';
import { CONTROL_PHASES, controlConfigSchema, evaluateControls, inferContext, type ControlConfig } from '../src/lib/phaseControls';
import { tenantScopedFrom } from './tenantScopedFrom';
import { selectAllPages } from './selectAllPages';
import { projectNoticeTitle } from '../src/lib/projectNotices';

export const defaultPhaseControls = controlConfigSchema.parse(defaults);
export class PhaseControlError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function missingProjectNoticesTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || (/project_notices/.test(message) && /does not exist|schema cache/i.test(message));
}

export async function loadPhaseControls(db: any, tenantId: string, projectId: string, to: string) {
  const scoped = (table: string) => tenantScopedFrom(db, tenantId, table);
  const { data: project, error: projectError } = await scoped('projects').select('*').eq('id', projectId).maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new PhaseControlError(404, 'Projet introuvable.');
  const [
    { data: current, error: historyError },
    { data: documents, error: documentsError },
    { data: milestones, error: milestonesError },
    { data: notices, error: noticesError },
  ] = await Promise.all([
    scoped('project_phase_history').select('*').eq('project_id', projectId).is('exited_at', null).maybeSingle(),
    selectAllPages(() => scoped('documents').select('id,name,description,doc_type,phase,doc_statut,validation_status').eq('project_id', projectId)),
    selectAllPages(() => scoped('milestones').select('id,title,due_date').eq('project_id', projectId)),
    scoped('project_notices').select('id,kind,phase,status,updated_at').eq('project_id', projectId),
  ]);
  if (historyError || documentsError || milestonesError) throw historyError || documentsError || milestonesError;
  if (noticesError && !missingProjectNoticesTable(noticesError)) throw noticesError;

  // Une notice rédigée dans l'onglet Études devient une preuve suggérée dans
  // la checklist de phase, au même titre qu'un fichier déposé. Ce n'est jamais
  // une validation automatique : evaluateControls() ne fait que la proposer à
  // l'architecte, qui conserve la décision « fait / à faire / non requis ».
  const noticeEvidence = (noticesError ? [] : (notices || []))
    .filter((notice: any) => notice.status === 'redige')
    .map((notice: any) => ({
      id: `notice:${notice.id}`,
      name: notice.kind === 'architectural' && notice.phase === 'APS'
        ? 'Notice sommaire — Notice architecturale — APS'
        : projectNoticeTitle(notice.kind, notice.phase),
      description: 'Notice rédigée dans l’onglet Études > Notices',
      doc_type: 'notice',
      phase: notice.phase,
      doc_statut: 'valide',
      validation_status: 'suggested',
    }));
  const evidenceDocuments = [...documents, ...noticeEvidence];
  const config: ControlConfig = controlConfigSchema.parse(project.phase_control_config ?? defaultPhaseControls);
  // Reuse an unambiguous existing phase milestone. Never guess from a
  // document timestamp, project end date or the date of the transition.
  for (const phase of CONTROL_PHASES) {
    if (config.phaseDeadlines[phase]) continue;
    const matches = milestones.filter(m => [phase, `FIN ${phase}`].includes(String(m.title).trim().toUpperCase()));
    if (matches.length !== 1) continue;
    const candidate = { ...config, phaseDeadlines: { ...config.phaseDeadlines, [phase]: matches[0].due_date } };
    if (controlConfigSchema.safeParse(candidate).success) config.phaseDeadlines[phase] = matches[0].due_date;
  }
  const context = { ...inferContext(project), ...config.context };
  const from = current?.phase ?? 'ESQ';
  const revision = createHash('sha256').update(JSON.stringify({ config, context, currentId: current?.id ?? null, to })).digest('hex');
  return { project, config, context, current, from, to, documents: evidenceDocuments, revision,
    expectedCurrentId: current?.id ?? null,
    controls: evaluateControls(config, from, to, evidenceDocuments, [], new Date(), context),
  };
}
