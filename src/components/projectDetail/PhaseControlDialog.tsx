import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONTROL_PHASES, CONTEXT_FLAGS, CONTROL_STATUSES, evaluateControls, type ControlAnswer, type ControlConfig, type ControlRule, type EvidenceDocument } from '../../lib/phaseControls';
import { DialogShell, inputClass, boutonPrincipal, boutonSecondaire } from './situations/DialogShell';

interface Preview {
  from: string; to: string; revision: string; expectedCurrentId: string | null;
  config: ControlConfig; context: ControlConfig['context']; documents: EvidenceDocument[];
}
export function PhaseControlDialog({ projectId, phase, members, canConfigure, onClose, onComplete }: {
  projectId: string; phase: string; members: { id: string; name: string }[];
  canConfigure: boolean; onClose: () => void; onComplete: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [config, setConfig] = useState<ControlConfig | null>(null);
  const [answers, setAnswers] = useState<ControlAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  async function load() {
    const response = await fetch(`/api/projects/${projectId}/phase-controls?to=${encodeURIComponent(phase)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('pc_error'));
    setPreview(data); setConfig(data.config); setAnswers([]);
  }
  useEffect(() => { setBusy(true); load().catch(e => setError(e.message)).finally(() => setBusy(false)); }, [projectId, phase]);
  const dirty = !!preview && JSON.stringify(config) !== JSON.stringify(preview.config);
  const controls = useMemo(() => preview ? evaluateControls(preview.config, preview.from, phase, preview.documents, answers, new Date(), preview.context) : [], [preview, phase, answers]);
  const unresolved = controls.filter(c => c.group !== 'compliant');
  const blocking = unresolved.some(c => c.rule.severity === 'blocking');
  const needsTasks = unresolved.some(c => c.rule.required);
  const missingDate = unresolved.some(c => c.rule.required && !c.dueDate);
  const missingReason = controls.some(c => c.answer.status === 'not_required' && !c.answer.justification.trim());
  function answer(ruleId: string, patch: Partial<ControlAnswer>) {
    const original = controls.find(c => c.rule.id === ruleId)!.answer;
    setAnswers(prev => [...prev.filter(a => a.ruleId !== ruleId), { ...original, ...patch }]);
  }
  async function saveConfig() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/phase-controls/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('pc_error'));
      await load(); setEditing(false);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function submit() {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/phase`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase, revision: preview.revision, expectedCurrentId: preview.expectedCurrentId, answers: controls.map(c => c.answer), createTasks: needsTasks }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('pc_error'));
      onComplete();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  function updateRule(index: number, patch: Partial<ControlRule>) {
    setConfig(c => c && { ...c, rules: c.rules.map((r, i) => i === index ? { ...r, ...patch } : r) });
  }
  const memberOptions = <><option value="">{t('pc_unassigned')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</>;
  return <DialogShell open wide title={t('pc_title')} subtitle={`${preview?.from ?? '…'} → ${phase}`} onClose={onClose} busy={busy} footer={<>
    <button className={boutonSecondaire} disabled={busy} onClick={onClose}>{t('pc_cancel')}</button>
    <button className={boutonSecondaire} disabled={busy} onClick={() => { setBusy(true); setError(''); load().catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{t('pc_reload')}</button>
    <button className={boutonPrincipal} disabled={busy || !preview || dirty || blocking || missingReason || missingDate} onClick={submit}>{t(needsTasks ? 'pc_tasks_continue' : 'pc_continue')}</button>
  </>}>
    {error && <p role="alert" className="text-red-600 mb-3">{error}</p>}
    {preview && <>
      <p className="mb-3 text-sm">{t('pc_summary', { compliant: controls.filter(c => c.group === 'compliant').length, verify: controls.filter(c => c.group === 'verify').length, missing: controls.filter(c => c.group === 'missing').length })}</p>
      <p className="text-sm text-[var(--tblr-muted)] mb-4">{t('pc_evidence_hint')}</p>
      {blocking && <p role="alert" className="text-red-600">{t('pc_blocked')}</p>}
      {missingDate && <p role="alert" className="text-amber-700">{t('pc_missing_date')}</p>}
      {controls.map(c => <fieldset key={c.rule.id} disabled={busy} className="border border-[var(--tblr-border)] rounded-lg p-3 my-3 space-y-2">
        <legend className="px-1 font-semibold">{c.rule.title}</legend>
        <p className="text-xs text-[var(--tblr-muted)]">{c.rule.from} → {c.rule.to} · {t(`pc_${c.rule.severity}`)} · {t(c.rule.required ? 'pc_required' : 'pc_optional')} · {c.dueDate ? t('pc_due', { date: c.dueDate, days: c.overdueDays }) : t('pc_no_date')}</p>
        {c.conditionUnknown && <p className="text-sm text-amber-700">{t('pc_unknown_condition')}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">{t('pc_status')}<select className={inputClass} value={c.answer.status} onChange={e => answer(c.rule.id, { status: e.target.value as ControlAnswer['status'] })}>{CONTROL_STATUSES.map(s => <option key={s} value={s}>{t(`pc_${s}`)}</option>)}</select></label>
          <label className="text-sm">{t('pc_assignee')}<select className={inputClass} value={c.answer.assigneeId ?? ''} onChange={e => answer(c.rule.id, { assigneeId: e.target.value || null })}>{memberOptions}</select></label>
          <label className="text-sm sm:col-span-2">{t('pc_evidence')}<select className={inputClass} value={c.answer.documentId ?? ''} onChange={e => answer(c.rule.id, { documentId: e.target.value || null })}>
            <option value="">{t('pc_no_evidence')}</option>
            {c.candidates.length > 0 && <optgroup label={t('pc_suggested')}>{c.candidates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
            <optgroup label={t('pc_other_documents')}>{preview.documents.filter(d => !c.candidates.some(candidate => candidate.id === d.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
          </select></label>
          <label className="text-sm sm:col-span-2">{t(c.answer.status === 'not_required' ? 'pc_reason_required' : 'pc_comment')}<textarea className={inputClass} maxLength={2000} required={c.answer.status === 'not_required'} value={c.answer.justification} onChange={e => answer(c.rule.id, { justification: e.target.value })} /></label>
        </div>
      </fieldset>)}
      {!controls.length && <p>{t('pc_empty')}</p>}
      {canConfigure && config && <div className="border-t border-[var(--tblr-border)] pt-3 mt-4">
        <button className={boutonSecondaire} disabled={busy} onClick={() => setEditing(!editing)}>{t('pc_configure')}</button>
        {editing && <fieldset disabled={busy} className="mt-3 space-y-4">
          <p className="text-sm">{t('pc_config_hint')}</p>
          <div className="grid sm:grid-cols-3 gap-3">{CONTEXT_FLAGS.map(flag => <label key={flag} className="text-sm">{t(`pc_context_${flag}`)}<select className={inputClass} value={config.context[flag] === undefined ? '' : String(config.context[flag])} onChange={e => setConfig({ ...config, context: { ...config.context, [flag]: e.target.value === '' ? undefined : e.target.value === 'true' } })}><option value="">{t('pc_unknown')}</option><option value="true">{t('pc_yes')}</option><option value="false">{t('pc_no')}</option></select></label>)}</div>
          <div className="grid sm:grid-cols-3 gap-3">{CONTROL_PHASES.map(p => <label key={p} className="text-sm">{t('pc_phase_deadline', { phase: p })}<input type="date" className={inputClass} value={config.phaseDeadlines[p] ?? ''} onChange={e => setConfig({ ...config, phaseDeadlines: { ...config.phaseDeadlines, [p]: e.target.value || undefined } })} /></label>)}</div>
          <details><summary className="cursor-pointer font-semibold">{t('pc_rules')}</summary>
            {config.rules.map((rule, index) => <fieldset key={rule.id} className="my-3 p-3 border border-[var(--tblr-border)] rounded space-y-2">
              <label className="text-sm">{t('pc_rule_title')}<input className={inputClass} maxLength={300} value={rule.title} onChange={e => updateRule(index, { title: e.target.value })} /></label>
              <div className="grid sm:grid-cols-3 gap-2">
                {(['from', 'to'] as const).map(key => <label key={key} className="text-sm">{t(`pc_${key}`)}<select className={inputClass} value={rule[key]} onChange={e => updateRule(index, { [key]: e.target.value })}>{CONTROL_PHASES.map(p => <option key={p}>{p}</option>)}</select></label>)}
                <label className="text-sm">{t('pc_severity')}<select className={inputClass} value={rule.severity} onChange={e => updateRule(index, { severity: e.target.value as ControlRule['severity'] })}>{['informational', 'important', 'blocking'].map(s => <option key={s} value={s}>{t(`pc_${s}`)}</option>)}</select></label>
                <label className="text-sm">{t('pc_default_assignee')}<select className={inputClass} value={rule.defaultAssigneeId ?? ''} onChange={e => updateRule(index, { defaultAssigneeId: e.target.value || null })}>{memberOptions}</select></label>
                <label className="text-sm">{t('pc_offset')}<input className={inputClass} type="number" min={-3650} max={0} value={rule.dueOffsetDays} onChange={e => updateRule(index, { dueOffsetDays: Number(e.target.value) })} /></label>
                <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={rule.required} onChange={e => updateRule(index, { required: e.target.checked })} />{t('pc_required')}</label>
              </div>
              <label className="text-sm block">{t('pc_terms')}<input className={inputClass} value={rule.evidenceTerms.join(', ')} onChange={e => updateRule(index, { evidenceTerms: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
              {(['all', 'any'] as const).map(mode => <div key={mode} className="flex flex-wrap gap-3 text-sm"><span>{t(`pc_when_${mode}`)}</span>{CONTEXT_FLAGS.map(flag => <label key={flag}><input type="checkbox" checked={rule.when?.[mode].includes(flag) ?? false} onChange={e => { const when = rule.when ?? { all: [], any: [] }; updateRule(index, { when: { ...when, [mode]: e.target.checked ? [...when[mode], flag] : when[mode].filter(f => f !== flag) } }); }} /> {t(`pc_context_${flag}`)}</label>)}</div>)}
              <button className={boutonSecondaire} onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>{t('pc_remove_rule')}</button>
            </fieldset>)}
            <button className={boutonSecondaire} onClick={() => setConfig({ ...config, rules: [...config.rules, { id: crypto.randomUUID(), title: t('pc_new_rule'), from: 'ESQ', to: 'APS', severity: 'important', required: true, evidenceTerms: [], defaultAssigneeId: null, dueOffsetDays: 0 }] })}>{t('pc_add_rule')}</button>
          </details>
          <button className={boutonPrincipal} disabled={!dirty} onClick={saveConfig}>{t('pc_save_config')}</button>
        </fieldset>}
      </div>}
    </>}
  </DialogShell>;
}
