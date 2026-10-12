// Mission queue, handoff trace, and explicit human approval of task proposals.
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Agent { id: string; name: string; is_active: boolean }
interface MissionPreferences { enabled: boolean; capture_mail: boolean; capture_mail_review: boolean }
interface MissionTask { title: string; description: string; priority: string; due_date: string | null; evidence: string }
interface Mission {
  id: string; status: string; instruction: string; source_type: string;
  coordinator_agent_id: string; delegate_agent_id: string | null;
  created_at: string; result_text: string | null; task_proposal: MissionTask | null;
  error_message: string | null; created_task_id: string | null;
}
interface MissionEvent { id: string; kind: string; detail: string; created_at: string }
interface MissionReference {
  source: 'cabinet'|'mutualized'; document_name: string; version?: number;
  chunk_id?: string; section_title?: string|null; page_number?: number|null;
  excerpt?: string; remote_document_id?: string; source_url?: string|null;
}
interface MissionDetail extends Mission {
  events: MissionEvent[];
  rag_references?: MissionReference[];
  specialist_rag_references?: MissionReference[];
}

const STATUS: Record<string, string> = {
  queued: 'En attente', running: 'Analyse en cours', delegated: 'Transmis au spécialiste',
  review: 'À valider', applying: 'Création de la tâche en cours',
  completed: 'Terminée', failed: 'Échec', cancelled: 'Annulée',
};

export function AgentMissionsCard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [source, setSource] = useState('');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [preferences, setPreferences] = useState<MissionPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceProof,setSourceProof] = useState<string>('');

  async function refresh() {
    const [agentsList, list, settings] = await Promise.all([
      apiFetch<Agent[]>('/api/agents'),
      apiFetch<{ missions: Mission[]; processing_enabled: boolean }>('/api/agent-missions'),
      apiFetch<MissionPreferences>('/api/agent-missions/settings'),
    ]);
    const active = agentsList.filter(a => a.is_active);
    setAgents(active);
    setAgentId(prev => prev || active[0]?.id || '');
    setMissions(list.missions);
    setEnabled(list.processing_enabled);
    setPreferences(settings);
  }
  useEffect(() => { void refresh().catch(e => setError(e.message || 'Lecture impossible')); }, []);

  async function togglePreference(key: keyof MissionPreferences, value: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<MissionPreferences>('/api/agent-missions/settings', {
        method: 'PATCH', body: JSON.stringify({ [key]: value }),
      });
      setPreferences(result);
      setEnabled(result.enabled);
      setNotice('Préférences du cabinet enregistrées.');
    } catch (e: any) { setError(e.message || 'Impossible de modifier le réglage.'); }
    finally { setBusy(false); }
  }
  async function choose(id: string) {
    try {
      setError(''); setSourceProof('');
      setDetail(await apiFetch<MissionDetail>('/api/agent-missions/' + encodeURIComponent(id)));
    } catch (e: any) { setError(e.message || 'Lecture impossible'); }
  }
  async function verifySource(ref: MissionReference) {
    if(!ref.source_url)return;
    setError('');setSourceProof('');
    try {
      const current=await apiFetch<{document_name:string;version:number;excerpt:string;section_title:string|null}>(ref.source_url);
      setSourceProof(`Source vérifiée : ${current.document_name} v${current.version}${current.section_title?' — '+current.section_title:''}\n\n${current.excerpt}`);
    }catch(e:any){setError(e.message||'Cette source est indisponible ou remplacée par une autre version.');}
  }
  async function create() {
    if (!agentId || !source.trim() || !instruction.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch<{ mission: Mission; created: boolean }>('/api/agent-missions', {
        method: 'POST', body: JSON.stringify({
          agent_id: agentId, source_type: 'manual', source_excerpt: source, instruction,
        }),
      });
      setSource(''); setInstruction('');
      setNotice('Mission enregistrée : ' + STATUS[response.mission.status]);
      await refresh(); await choose(response.mission.id);
    } catch (e: any) { setError(e.message || 'Création impossible'); }
    finally { setBusy(false); }
  }
  async function action(kind: 'approve-task' | 'cancel' | 'retry') {
    if (!detail) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch('/api/agent-missions/' + encodeURIComponent(detail.id) + '/' + kind, { method: 'POST' });
      setNotice(kind === 'approve-task' ? 'Tâche créée après votre validation.' : kind === 'cancel' ? 'Mission annulée.' : 'Mission relancée.');
      const id = detail.id;
      await refresh(); await choose(id);
    } catch (e: any) { setError(e.message || 'Action impossible'); }
    finally { setBusy(false); }
  }
  const inputStyle = { background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' };
  return (
    <section className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Missions des agents IA</h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
          Une mission conserve sa source, les étapes entre agents et une proposition de tâche. Seule votre validation crée la tâche.
        </p>
        {!enabled && <p className="mt-2 text-xs" style={{ color: 'var(--tblr-warning)' }}>
          L'autonomie est désactivée pour ce cabinet. Les missions existantes sont conservées et mises en attente.
        </p>}
      </div>
      {preferences && <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
        <h3 className="text-sm font-semibold">Autonomie du cabinet</h3>
        {([
          { key: 'enabled', label: 'Activer le traitement autonome des missions', detail: 'Actif par défaut. Les agents analysent les sources sans agir à votre place.' },
          { key: 'capture_mail', label: 'Analyser les emails transférés à un agent', detail: 'Désactivé par défaut. Requiert une boîte de réception configurée.' },
          { key: 'capture_mail_review', label: 'Créer des missions depuis les revues de mails', detail: 'Désactivé par défaut. Ne modifie pas la programmation des revues existantes.' },
        ] as const).map(item => <label key={item.key} className="flex items-start gap-3 cursor-pointer text-xs">
          <input type="checkbox" className="mt-0.5" checked={preferences[item.key]} disabled={busy}
            onChange={e => void togglePreference(item.key, e.target.checked)} />
          <span><span className="font-medium">{item.label}</span>
            <span className="block mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{item.detail}</span></span>
        </label>)}
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
          Aucune tâche n'est créée sans votre validation. L'analyse d'un document déposé nécessite toujours votre accord explicite.
        </p>
      </div>}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
      {notice && <p role="status" className="text-xs">{notice}</p>}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs" htmlFor="mission-agent">Agent coordinateur</label>
          <select id="mission-agent" value={agentId} onChange={e => setAgentId(e.target.value)}
            className="rounded-lg p-2 text-sm" style={inputStyle}>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <label className="block text-xs" htmlFor="mission-instruction">Consigne</label>
        <input id="mission-instruction" value={instruction} onChange={e => setInstruction(e.target.value)}
          placeholder="Identifier les suites à donner" className="w-full rounded-lg p-2 text-sm" style={inputStyle} maxLength={1000} />
        <label className="block text-xs" htmlFor="mission-source">Texte source (extrait de mail ou document)</label>
        <textarea id="mission-source" rows={3} value={source} onChange={e => setSource(e.target.value)}
          placeholder="Collez ici le passage à analyser…" className="w-full rounded-lg p-2 text-sm"
          style={inputStyle} maxLength={12000} />
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || !enabled || !agentId || !source.trim() || !instruction.trim()}
            onClick={() => void create()} className="rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            style={inputStyle}>Créer une mission</button>
          <button type="button" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}
            className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>Actualiser</button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 max-h-80 overflow-y-auto" aria-label="Missions">
          {missions.map(m => <button key={m.id} type="button" onClick={() => void choose(m.id)}
            className="text-left block rounded-lg p-2 w-full text-sm"
            style={{ ...inputStyle, borderColor: detail?.id === m.id ? 'var(--tblr-primary)' : 'var(--tblr-border)' }}>
            <span className="font-medium">{m.instruction}</span>
            <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>
              {STATUS[m.status] || m.status} · {new Date(m.created_at).toLocaleString('fr-FR')}
            </span>
          </button>)}
          {missions.length === 0 && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Aucune mission enregistrée.</p>}
        </div>
        {detail && <div className="space-y-2 rounded-lg p-3" style={inputStyle}>
          <strong className="text-sm">{STATUS[detail.status] || detail.status}</strong>
          {detail.result_text && <p className="text-xs whitespace-pre-wrap">{detail.result_text}</p>}
          {detail.error_message && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{detail.error_message}</p>}
          {detail.task_proposal && <div className="space-y-1">
            <h3 className="text-sm font-semibold">Tâche proposée : {detail.task_proposal.title}</h3>
            <p className="text-xs whitespace-pre-wrap">{detail.task_proposal.description}</p>
            <p className="text-xs">Source : « {detail.task_proposal.evidence} »</p>
            <p className="text-xs">Priorité : {detail.task_proposal.priority} · Échéance : {detail.task_proposal.due_date || 'non précisée'}</p>
          </div>}
          {([...(detail.rag_references||[]),...(detail.specialist_rag_references||[])]).length>0 && <div className="space-y-1">
            <h3 className="text-xs font-bold">Références documentaires consultées</h3>
            {([...(detail.rag_references||[]),...(detail.specialist_rag_references||[])]).map((ref,i)=><div key={i} className="text-xs rounded p-2" style={{background:'var(--tblr-surface-2)'}}>
              <div className="font-medium">
                {ref.document_name}{ref.version!=null?` · version ${ref.version}`:''}
                {ref.page_number?` · page ${ref.page_number}`:''}
                {ref.section_title?` · ${ref.section_title}`:''}
              </div>
              <p className="whitespace-pre-wrap mt-1">{ref.excerpt}</p>
              {ref.source_url&&<button type="button" onClick={()=>void verifySource(ref)}
                className="underline mt-1">Vérifier la version et le passage</button>}
            </div>)}
            {sourceProof&&<p role="status" className="text-xs whitespace-pre-wrap rounded p-2"
              style={{border:'1px solid var(--tblr-border)'}}>{sourceProof}</p>}
          </div>}
          <div className="flex flex-wrap gap-2">
            {detail.status === 'review' && <button disabled={busy} onClick={() => void action('approve-task')}
              className="rounded-lg px-2 py-1 text-xs" style={inputStyle}>Valider et créer la tâche</button>}
            {detail.status === 'failed' && <button disabled={busy} onClick={() => void action('retry')}
              className="rounded-lg px-2 py-1 text-xs" style={inputStyle}>Réessayer</button>}
            {['queued', 'running', 'delegated', 'review', 'failed'].includes(detail.status) &&
              <button disabled={busy} onClick={() => void action('cancel')}
                className="rounded-lg px-2 py-1 text-xs" style={inputStyle}>Annuler</button>}
          </div>
          <h3 className="text-xs font-bold">Journal des passages de relais</h3>
          <ol className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {detail.events.map(event => <li key={event.id}>
              {new Date(event.created_at).toLocaleString('fr-FR')} — {event.kind}
              {event.detail && <span className="block pl-2 whitespace-pre-wrap">{event.detail}</span>}
            </li>)}
          </ol>
        </div>}
      </div>
    </section>
  );
}
