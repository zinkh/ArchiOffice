import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { Contribution, Publication } from '../../lib/knowledgeSharingView';
import { splitMasked } from '../../lib/knowledgeSharingView';

interface Props {
  documents: { id: string; name: string }[];
  contributions: Contribution[];
  publications: Publication[];
  publicationActive: boolean;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: (message: string) => void;
}

/**
 * Partage manuel, un document à la fois : l'extrait est préparé, relu et corrigé par
 * une personne, puis envoyé après trois confirmations. Reste disponible pour un
 * document hors des types du partage automatique.
 */
export function ManualShare({ documents, contributions, publications, publicationActive, busy, run, setNotice }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [currentId, setCurrentId] = useState('');
  const [text, setText] = useState('');
  const [confirmedAnonymity, setConfirmedAnonymity] = useState(false);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [confirmedExternal, setConfirmedExternal] = useState(false);

  const manual = contributions.filter(c => c.origin !== 'auto' && (c.status === 'draft' || c.status === 'reviewed'));
  const current = manual.find(c => c.id === currentId) || null;
  const published = !!current && publications.some(p => p.contribution_id === current.id);
  const open = (c: Contribution) => {
    setCurrentId(c.id); setText(c.sanitized_text);
    setConfirmedAnonymity(false); setConfirmedRights(false); setConfirmedExternal(false);
  };

  const draft = () => run(async () => {
    const row = await apiFetch<Contribution>('/api/knowledge-sharing/drafts', { method: 'POST', body: JSON.stringify({ document_id: selectedId }) });
    open(row);
  });
  const save = () => run(async () => {
    if (!current) return;
    const row = await apiFetch<Contribution>('/api/knowledge-sharing/drafts/' + current.id, { method: 'PUT', body: JSON.stringify({ sanitized_text: text }) });
    open(row);
  });
  const review = () => run(async () => {
    if (!current) return;
    await apiFetch('/api/knowledge-sharing/drafts/' + current.id + '/review', {
      method: 'POST', body: JSON.stringify({ confirmed_anonymity: confirmedAnonymity, confirmed_rights: confirmedRights }),
    });
  });
  const publish = () => run(async () => {
    if (!current || !confirmedExternal) return;
    const result = await apiFetch<{ published: boolean }>('/api/knowledge-sharing/contributions/' + current.id + '/publish', {
      method: 'POST', body: JSON.stringify({ confirmed_external_transfer: true }),
    });
    setConfirmedExternal(false);
    setNotice(result.published ? 'Extrait anonymisé envoyé à Mistral Libraries.' : 'Consentement retiré pendant l’envoi ; suppression distante en cours.');
  });

  return <details className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--tblr-border)' }}>
    <summary className="cursor-pointer font-medium">Partage manuel d’un document</summary>
    <div className="mt-3 space-y-3">
      <p style={{ color: 'var(--tblr-muted)' }}>Pour un document d’un autre type : vous relisez et corrigez vous-même l’extrait avant de l’envoyer.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Document à préparer" value={selectedId} onChange={e => setSelectedId(e.target.value)}
          className="flex-1 min-w-52 rounded border p-2 text-sm" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <option value="">Choisir un document existant</option>
          {documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={!selectedId || busy} onClick={() => void draft()}>Préparer un extrait</button>
      </div>
      {manual.length > 0 && <div className="flex flex-wrap gap-2 text-xs">
        {manual.map(c => <button type="button" key={c.id} className="btn btn-secondary" onClick={() => open(c)}>
          {documents.find(d => d.id === c.document_id)?.name || 'Document'} : {c.status === 'draft' ? 'à relire' : 'validé'}
        </button>)}
      </div>}
      {current && <div className="space-y-2">
        <p className="font-medium">Extrait préparé, à vérifier intégralement avant tout envoi</p>
        {current.warnings?.map((w, i) => <p key={i} className="text-xs" style={{ color: 'var(--tblr-warning)' }}>{w}</p>)}
        {current.status === 'draft'
          ? <textarea aria-label="Extrait technique anonymisé" rows={9} value={text} onChange={e => setText(e.target.value)}
              className="w-full rounded border p-2 text-sm font-mono" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }} />
          : <pre aria-label="Extrait technique anonymisé" className="whitespace-pre-wrap text-xs rounded border p-3 font-mono" style={{ borderColor: 'var(--tblr-border)' }}>
              {splitMasked(current.sanitized_text).map((s, i) => s.masked ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}
            </pre>}
        {current.status === 'draft' && <>
          <label className="flex gap-2"><input type="checkbox" checked={confirmedAnonymity} onChange={e => setConfirmedAnonymity(e.target.checked)} />
            J’ai relu l’extrait et contrôlé le risque de réidentification.</label>
          <label className="flex gap-2"><input type="checkbox" checked={confirmedRights} onChange={e => setConfirmedRights(e.target.checked)} />
            Je confirme disposer des droits et autorisations pour partager ce contenu.</label>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save()}>Enregistrer les corrections</button>
            <button type="button" className="btn btn-primary" onClick={() => void review()}
              disabled={busy || text !== current.sanitized_text || !confirmedAnonymity || !confirmedRights}>Valider pour l’envoi</button>
          </div>
        </>}
        {current.status === 'reviewed' && publicationActive && !published && <>
          <label className="flex gap-2"><input type="checkbox" checked={confirmedExternal} onChange={e => setConfirmedExternal(e.target.checked)} />
            Je confirme avoir vérifié que cet extrait ne contient aucune donnée client identifiable et j’autorise son transfert à Mistral Libraries.</label>
          <button type="button" className="btn btn-primary" disabled={busy || !confirmedExternal} onClick={() => void publish()}>Envoyer cet extrait à Mistral</button>
        </>}
      </div>}
    </div>
  </details>;
}
