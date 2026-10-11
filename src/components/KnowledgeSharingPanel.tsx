import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface CandidateDocument { id: string; name: string }
interface Contribution {
  id: string; document_id: string; status: 'draft' | 'reviewed';
  sanitized_text: string; warnings: string[]; created_at: string;
}
interface Publication {
  contribution_id: string; remote_document_id: string | null;
  state: string; deletion_requested_at: string | null; deleted_at: string | null;
}
interface State {
  opted_in: boolean; contributions: Contribution[]; publications: Publication[];
  publication_active: boolean;
}

export function KnowledgeSharingPanel({ documents }: { documents: CandidateDocument[] }) {
  const [state, setState] = useState<State | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [current, setCurrent] = useState<Contribution | null>(null);
  const [text, setText] = useState('');
  const [confirmedAnonymity, setConfirmedAnonymity] = useState(false);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [confirmedExternal, setConfirmedExternal] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mistralStatus, setMistralStatus] = useState('');

  const refresh = async () => {
    const data = await apiFetch<State>('/api/knowledge-sharing');
    setState(data);
    return data;
  };
  useEffect(() => {
    refresh().catch((e: any) => {
      if (e?.status === 403) setHidden(true); // réservé aux administrateurs
      else setError('Bibliothèque commune indisponible : ' + e.message);
    });
  }, []);
  if (hidden) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (e: any) { setError(e.message || 'Erreur'); }
    finally { setBusy(false); }
  };
  const checkMistral = async () => {
    setMistralStatus('Vérification en cours…');
    try {
      const result = await apiFetch<{ connected: boolean; configured: boolean }>('/api/knowledge-sharing/mistral/status');
      setMistralStatus(result.connected ? 'Liaison avec la bibliothèque Mistral opérationnelle.'
        : result.configured ? 'Bibliothèque Mistral inaccessible.' : 'Bibliothèque Mistral non configurée sur cette instance.');
    } catch { setMistralStatus('Connexion Mistral non disponible. Vérifiez la clé et les droits de la bibliothèque.'); }
  };
  const consent = async (enabled: boolean) => {
    if (!enabled && !window.confirm('Retirer l’autorisation et effacer tous les extraits préparés ?')) return;
    await run(async () => {
      const response = await apiFetch<{ pending_deletions?: number }>('/api/knowledge-sharing/consent', {
        method: 'PUT', body: JSON.stringify({ opted_in: enabled }),
      });
      if (!enabled) {
        setCurrent(null); setText('');
        setNotice(response.pending_deletions
          ? response.pending_deletions + ' suppression(s) distante(s) en attente de confirmation chez Mistral.'
          : 'Consentement retiré ; aucune suppression distante en attente.');
      } else setNotice('');
    });
  };
  const draft = async () => run(async () => {
    const row = await apiFetch<Contribution>('/api/knowledge-sharing/drafts', {
      method: 'POST', body: JSON.stringify({ document_id: selectedId }),
    });
    setCurrent(row); setText(row.sanitized_text);
    setConfirmedAnonymity(false); setConfirmedRights(false); setConfirmedExternal(false);
  });
  const save = async () => run(async () => {
    if (!current) return;
    const row = await apiFetch<Contribution>('/api/knowledge-sharing/drafts/' + current.id, {
      method: 'PUT', body: JSON.stringify({ sanitized_text: text }),
    });
    setCurrent(row); setText(row.sanitized_text);
    setConfirmedAnonymity(false); setConfirmedRights(false);
  });
  const review = async () => run(async () => {
    if (!current) return;
    const row = await apiFetch<Contribution>('/api/knowledge-sharing/drafts/' + current.id + '/review', {
      method: 'POST',
      body: JSON.stringify({ confirmed_anonymity: confirmedAnonymity, confirmed_rights: confirmedRights }),
    });
    setCurrent(row);
  });
  const publish = async () => run(async () => {
    if (!current || !confirmedExternal) return;
    const result = await apiFetch<{ published: boolean; deletion_pending?: boolean }>(
      '/api/knowledge-sharing/contributions/' + current.id + '/publish',
      { method: 'POST', body: JSON.stringify({ confirmed_external_transfer: true }) },
    );
    setConfirmedExternal(false);
    setNotice(result.published ? 'Extrait anonymisé envoyé à Mistral Libraries.'
      : 'Consentement retiré pendant l’envoi ; suppression distante en cours.');
  });
  const retryDeletions = async () => run(async () => {
    const result = await apiFetch<{ pending: number; reconciled_uploads: number; uncertain_uploads: number; abandoned_uploads?: number }>('/api/knowledge-sharing/mistral/reconcile', { method: 'POST' });
    setNotice((result.pending ? 'Des suppressions restent en attente. ' : '') +
      (result.uncertain_uploads ? result.uncertain_uploads + ' transfert(s) non confirmé(s) nécessitent une vérification. '
        : '') + (result.abandoned_uploads ? result.abandoned_uploads + ' envoi(s) abandonné(s) faute de document distant ; supprimez l’extrait pour le republier. ' : '') +
      result.reconciled_uploads + ' transfert(s) retrouvé(s) dans Mistral.');
  });
  const remove = async () => run(async () => {
    if (!current || !window.confirm('Supprimer cet extrait préparé ?')) return;
    await apiFetch('/api/knowledge-sharing/contributions/' + current.id, { method: 'DELETE' });
    setCurrent(null); setText('');
  });

  return <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}>
    <div>
      <h2 className="font-semibold">Mémoire technique collective — confidentialité</h2>
      <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
        Vos documents restent privés par défaut. Les originaux ne sont jamais envoyés. Chaque extrait nécessite une anonymisation, une relecture et une autorisation explicite avant transfert.
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => void checkMistral()} className="rounded border px-3 py-2 text-sm">Vérifier la bibliothèque Mistral</button>
      {mistralStatus && <span role="status">{mistralStatus}</span>}
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {state?.publications?.some(p => (p.state !== 'deleted' && p.deletion_requested_at) || p.state === 'uncertain') && <div className="text-sm border rounded p-2 space-y-2">
      <p>Des transferts ou suppressions distantes restent à confirmer. Le suivi est conservé pour éviter les doublons.</p>
      <button type="button" disabled={busy} onClick={() => void retryDeletions()}
        className="rounded border px-3 py-2">Vérifier les transferts et suppressions Mistral</button>
    </div>}
    {state && <>
      <label className="flex items-start gap-2 text-sm">
        <input aria-label="Autoriser la préparation de contributions anonymisées" type="checkbox"
          checked={state.opted_in} disabled={busy} onChange={e => void consent(e.target.checked)} />
        <span>J’autorise la préparation d’extraits techniques anonymisés pour la base commune (choix indépendant des CGU).</span>
      </label>
      {state.opted_in && <>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Document à préparer" value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="flex-1 min-w-52 rounded border p-2 text-sm">
            <option value="">Choisir un document existant</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="button" disabled={!selectedId || busy} onClick={() => void draft()}
            className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50">
            Préparer une version anonymisée
          </button>
        </div>
        {state.contributions.length > 0 && <div className="flex flex-wrap gap-2 text-xs">
          {state.contributions.map(c => <button type="button" key={c.id} onClick={() => {
            setCurrent(c); setText(c.sanitized_text); setConfirmedAnonymity(false); setConfirmedRights(false); setConfirmedExternal(false);
          }} className="rounded border px-2 py-1">
            {documents.find(d => d.id === c.document_id)?.name || 'Document'} : {c.status === 'draft' ? 'à relire' :
              state.publications?.find(p => p.contribution_id === c.id)?.state === 'published' ? 'publié chez Mistral' :
              state.publications?.some(p => p.contribution_id === c.id) ? 'transfert en cours / à vérifier' : 'validé (non publié)'}
          </button>)}
        </div>}
        {current && <div className="space-y-2">
          <p className="text-sm font-medium">Extrait préparé — à vérifier intégralement avant toute mutualisation</p>
          {current.warnings?.map((w, i) => <p key={i} className="text-xs text-amber-700">{w}</p>)}
          <textarea aria-label="Extrait technique anonymisé" rows={9} value={text}
            readOnly={current.status !== 'draft'} onChange={e => setText(e.target.value)}
            className="w-full rounded border p-2 text-sm font-mono" />
          {current.status === 'draft' && <>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmedAnonymity}
              onChange={e => setConfirmedAnonymity(e.target.checked)} />
              J’ai relu l’extrait et contrôlé le risque de réidentification.</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmedRights}
              onChange={e => setConfirmedRights(e.target.checked)} />
              Je confirme disposer des droits et autorisations pour partager ce contenu.</label>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => void save()} disabled={busy}
                className="rounded border px-3 py-2 text-sm">Enregistrer les corrections</button>
              <button type="button" onClick={() => void review()}
                disabled={busy || text !== current.sanitized_text || !confirmedAnonymity || !confirmedRights}
                className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50">
                Valider pour une future publication
              </button>
            </div>
          </>}
          {current.status === 'reviewed' && state.publication_active &&
            !state.publications?.some(p => p.contribution_id === current.id) && <>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={confirmedExternal} onChange={e => setConfirmedExternal(e.target.checked)} />
                Je confirme avoir vérifié que cet extrait ne contient aucune donnée client identifiable et j’autorise son transfert à Mistral Libraries.
              </label>
              <button type="button" disabled={busy || !confirmedExternal} onClick={() => void publish()}
                className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50">
                Publier cet extrait anonymisé vers Mistral
              </button>
            </>}
          <button type="button" onClick={() => void remove()} disabled={busy}
            className="rounded border border-red-400 text-red-700 px-3 py-2 text-sm">Supprimer cette contribution</button>
        </div>}
      </>}
    </>}
  </section>;
}
