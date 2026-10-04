import { z } from 'zod';

export const CONTROL_PHASES = ['DIAG', 'ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'] as const;
export const CONTEXT_FLAGS = ['erp', 'existing', 'abf', 'structure', 'sps', 'ct'] as const;
export const CONTROL_STATUSES = ['done', 'todo', 'not_required', 'unchecked'] as const;
const phase = z.enum(CONTROL_PHASES);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Date invalide');
const identifier = z.string().min(1).max(160);
export const controlRuleSchema = z.object({
  id: identifier, title: z.string().min(1).max(300), from: phase, to: phase,
  severity: z.enum(['informational', 'important', 'blocking']), required: z.boolean(),
  when: z.object({ all: z.array(z.enum(CONTEXT_FLAGS)).max(6).default([]), any: z.array(z.enum(CONTEXT_FLAGS)).max(6).default([]) }).strict().optional(),
  evidenceTerms: z.array(z.string().min(2).max(80)).max(20).default([]),
  defaultAssigneeId: identifier.nullable().default(null),
  dueOffsetDays: z.number().int().min(-3650).max(0).default(0),
}).strict().refine(r => CONTROL_PHASES.indexOf(r.from) < CONTROL_PHASES.indexOf(r.to), 'Ordre des phases invalide');
export const controlConfigSchema = z.object({
  version: z.literal(1), rules: z.array(controlRuleSchema).max(200),
  context: z.object(Object.fromEntries(CONTEXT_FLAGS.map(f => [f, z.boolean().optional()])) as Record<typeof CONTEXT_FLAGS[number], z.ZodOptional<z.ZodBoolean>>).strict().default({}),
  phaseDeadlines: z.partialRecord(phase, date).default({}),
}).strict().refine(c => new Set(c.rules.map(r => r.id)).size === c.rules.length, 'Identifiants de contrôles dupliqués');
export const answerSchema = z.object({
  ruleId: identifier, status: z.enum(CONTROL_STATUSES),
  justification: z.string().max(2000).default(''),
  documentId: identifier.nullable().default(null),
  assigneeId: identifier.nullable().default(null),
}).strict();
export const transitionSchema = z.object({
  phase, expectedCurrentId: identifier.nullable(), revision: z.string().length(64),
  answers: z.array(answerSchema).max(200), createTasks: z.boolean().default(false),
}).strict();
export type ControlRule = z.infer<typeof controlRuleSchema>;
export type ControlConfig = z.infer<typeof controlConfigSchema>;
export type ControlAnswer = z.infer<typeof answerSchema>;
export interface EvidenceDocument { id: string; name: string; description?: string; doc_type?: string; phase?: string; doc_statut?: string; validation_status?: string }
export interface EvaluatedControl {
  rule: ControlRule; answer: ControlAnswer; conditionUnknown: boolean;
  dueDate: string | null; overdueDays: number | null;
  candidates: EvidenceDocument[]; group: 'compliant' | 'verify' | 'missing';
}
export function normalizeEvidence(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function inferContext(project: Record<string, unknown>): ControlConfig['context'] {
  const out: ControlConfig['context'] = {};
  if (project.type_et_cat || Number(project.surface_erp) > 0) out.erp = true;
  if (project.bet_structure === true || project.bet_structure === 1) out.structure = true;
  if (typeof project.secteur_abf === 'string' && /^(oui|true|1)$/i.test(project.secteur_abf.trim())) out.abf = true;
  if (typeof project.type_projet === 'string' && /rehabilitation|renovation|existant/.test(normalizeEvidence(project.type_projet))) out.existing = true;
  return out;
}
export function applicableRules(config: ControlConfig, from: string, to: string, context = config.context) {
  const start = CONTROL_PHASES.indexOf(from as any), end = CONTROL_PHASES.indexOf(to as any);
  if (start < 0 || end <= start) return [];
  // A jump over a phase must include its gates rather than bypass them.
  return config.rules.filter(rule => {
    const target = CONTROL_PHASES.indexOf(rule.to);
    if (target <= start || target > end) return false;
    if (rule.when?.all.some(flag => context[flag] === false)) return false;
    if (rule.when?.any.length && rule.when.any.every(flag => context[flag] === false)) return false;
    return true;
  });
}
export function evaluateControls(config: ControlConfig, from: string, to: string, documents: EvidenceDocument[], answers: ControlAnswer[] = [], now = new Date(), context = config.context): EvaluatedControl[] {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return applicableRules(config, from, to, context).map(rule => {
    const answer = answers.find(a => a.ruleId === rule.id) ?? { ruleId: rule.id, status: 'unchecked' as const, justification: '', documentId: null, assigneeId: rule.defaultAssigneeId };
    const base = config.phaseDeadlines[rule.from];
    const dueTime = base ? Date.parse(`${base}T00:00:00Z`) + rule.dueOffsetDays * 86400000 : null;
    const flags = [...(rule.when?.all ?? []), ...(rule.when?.any ?? [])];
    const candidates = documents.filter(doc => {
      if (doc.doc_statut === 'perime' || doc.validation_status === 'rejected') return false;
      if (doc.phase && !['Général', rule.from, rule.to].includes(doc.phase)) return false;
      const haystack = ` ${normalizeEvidence([doc.name, doc.description, doc.doc_type].filter(Boolean).join(' '))} `;
      return rule.evidenceTerms.some(term => haystack.includes(` ${normalizeEvidence(term)} `));
    });
    const compliant = answer.status === 'done' || (answer.status === 'not_required' && !!answer.justification.trim());
    return { rule, answer, conditionUnknown: flags.some(f => context[f] === undefined),
      dueDate: dueTime === null ? null : new Date(dueTime).toISOString().slice(0, 10),
      overdueDays: dueTime === null ? null : Math.max(0, Math.floor((today - dueTime) / 86400000)),
      candidates, group: compliant ? 'compliant' : answer.status === 'unchecked' ? 'verify' : 'missing' };
  });
}
