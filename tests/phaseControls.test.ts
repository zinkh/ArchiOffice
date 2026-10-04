import { describe, it, expect } from 'vitest';
import { applicableRules, controlConfigSchema, evaluateControls, inferContext } from '../src/lib/phaseControls';
import defaults from '../server/config/phaseControls.json';

const config = () => controlConfigSchema.parse(defaults);
describe('phase control engine', () => {
  it('includes gates of skipped phases and does not run forward gates on a return', () => {
    expect(applicableRules(config(), 'ESQ', 'APD').map(r => r.id)).toContain('geotechnique');
    expect(applicableRules(config(), 'ESQ', 'APD').map(r => r.id)).toContain('notice');
    expect(applicableRules(config(), 'APD', 'ESQ')).toEqual([]);
  });
  it('keeps unknown conditions visible and excludes explicitly inapplicable controls', () => {
    const c = config();
    expect(evaluateControls(c, 'APS', 'APD', []).find(r => r.rule.id === 'securite')?.conditionUnknown).toBe(true);
    c.context.erp = false;
    expect(applicableRules(c, 'APS', 'APD').some(r => r.id === 'securite')).toBe(false);
    c.context.erp = true;
    expect(applicableRules(c, 'APS', 'APD').some(r => r.id === 'securite')).toBe(true);
  });
  it('supports any / all predicates', () => {
    const c = config(); c.rules[0].when = { any: ['erp', 'abf'], all: ['existing'] };
    c.context = { erp: false, abf: false, existing: true };
    expect(applicableRules(c, 'DIAG', 'ESQ').some(r => r.id === c.rules[0].id)).toBe(false);
    c.context.abf = true;
    expect(applicableRules(c, 'DIAG', 'ESQ').some(r => r.id === c.rules[0].id)).toBe(true);
  });
  it('detects documents without silently declaring a check done; excludes stale documents and partial words', () => {
    const c = config();
    const controls = evaluateControls(c, 'ESQ', 'APS', [
      { id: 'good', name: 'Étude de sol.pdf', phase: 'ESQ' },
      { id: 'stale', name: 'Étude de sol.pdf', doc_statut: 'perime' },
      { id: 'later', name: 'Étude de sol.pdf', phase: 'DET' },
    ]);
    const soil = controls.find(c => c.rule.id === 'geotechnique')!;
    expect(soil.candidates.map(d => d.id)).toEqual(['good']);
    expect(soil.group).toBe('verify');
    expect(evaluateControls(c, 'APD', 'PC', [{ id: 'false', name: 'structure.doc' }]).find(r => r.rule.id === 'ct')?.candidates).toEqual([]);
  });
  it('calculates calendar-day overdue from planned deadline and offset, never transition time', () => {
    const c = config(); c.phaseDeadlines.ESQ = '2026-09-30'; c.rules.find(r => r.id === 'geotechnique')!.dueOffsetDays = -2;
    const control = evaluateControls(c, 'ESQ', 'APS', [], [], new Date('2026-10-04T23:59:59Z'))[0];
    expect(control.dueDate).toBe('2026-09-28'); expect(control.overdueDays).toBe(6);
    expect(evaluateControls(config(), 'ESQ', 'APS', [])[0].dueDate).toBeNull();
  });
  it('requires a real justification for exemption and validates configuration dates / duplicate ids', () => {
    const c = config();
    expect(evaluateControls(c, 'ESQ', 'APS', [], [{ ruleId: 'geotechnique', status: 'not_required', justification: ' ', documentId: null, assigneeId: null }])[0].group).toBe('missing');
    expect(controlConfigSchema.safeParse({ ...c, phaseDeadlines: { ESQ: '2026-02-30' } }).success).toBe(false);
    expect(controlConfigSchema.safeParse({ ...c, rules: [c.rules[0], c.rules[0]] }).success).toBe(false);
  });
  it('infers only positive context from existing fields', () => {
    expect(inferContext({ type_projet: 'Réhabilitation', secteur_abf: 'Non', bet_structure: true })).toEqual({ existing: true, structure: true });
  });
});
