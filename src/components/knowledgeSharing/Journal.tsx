import { useState } from 'react';
import {
  type Contribution, type Publication, type Stage, dayOf, describeMasked, splitMasked, stageOf, summaryOf,
} from '../../lib/knowledgeSharingView';

const TONE_STYLE: Record<Stage['tone'], { background: string; color: string }> = {
  neutral: { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' },
  progress: { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-text)' },
  ok: { background: 'color-mix(in srgb, var(--tblr-success) 18%, transparent)', color: 'var(--tblr-text)' },
  warn: { background: 'color-mix(in srgb, var(--tblr-warning) 20%, transparent)', color: 'var(--tblr-text)' },
  done: { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' },
};

/** Le texte tel qu'il part, avec les passages masqués visibles comme tels. */
function SentText({ text }: { text: string }) {
  return <pre className="whitespace-pre-wrap text-xs rounded border p-3 max-h-80 overflow-auto font-mono" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
    aria-label="Texte exact transmis">
    {splitMasked(text).map((segment, i) => segment.masked
      ? <mark key={i} title={`Masqué : ${segment.label}`} className="px-1 rounded" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-text)' }}>{segment.text}</mark>
      : <span key={i}>{segment.text}</span>)}
  </pre>;
}

function Row({ c, publication, name, publicationActive, busy, onRemove }: {
  c: Contribution; publication: Publication | undefined; name: string; publicationActive: boolean; busy: boolean; onRemove: (c: Contribution) => void;
}) {
  const [open, setOpen] = useState(false);
  const stage = stageOf(c, publication, publicationActive);
  const when = dayOf(publication?.published_at || c.reviewed_at || c.created_at);
  const summary = summaryOf(c);
  const withheld = c.withheld || [];
  const sentOrReady = !!c.sanitized_text && stage.key !== 'removed';
  return <li className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--tblr-border)' }}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-sm break-words">{name}</p>
        {summary && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{summary}</p>}
      </div>
      <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1 shrink-0">
        <span className="inline-block rounded px-2 py-1 text-xs font-medium" style={TONE_STYLE[stage.tone]}>{stage.label}</span>
        {when && <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{when}</span>}
      </div>
    </div>
    <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{stage.detail}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? 'Masquer le détail' : 'Voir le détail'}
      </button>
      {stage.key !== 'removed' && stage.key !== 'removing' && <button type="button" className={publication ? 'btn btn-danger' : 'btn btn-secondary'} disabled={busy} onClick={() => onRemove(c)}
        aria-label={`Retirer et supprimer ${name}`}>
        {publication ? 'Retirer de la bibliothèque' : 'Supprimer'}
      </button>}
    </div>
    {open && <div className="space-y-3 pt-1">
      {c.analysis?.masked && <p className="text-sm"><strong>Masqué :</strong> {describeMasked(c.analysis.masked)}.</p>}
      {sentOrReady && <div className="space-y-1">
        <p className="text-sm font-medium">{publication?.state === 'published' ? 'Texte envoyé' : 'Texte qui sera envoyé'}</p>
        <SentText text={c.sanitized_text} />
      </div>}
      {withheld.length > 0 && <div className="space-y-1">
        <p className="text-sm font-medium">Retenu, non envoyé ({withheld.length} paragraphe{withheld.length > 1 ? 's' : ''})</p>
        <ul className="space-y-2">
          {withheld.map(w => <li key={w.index} className="rounded border p-2 text-xs" style={{ borderColor: 'var(--tblr-border)' }}>
            <p className="font-medium">{w.reasons.join(' ; ')}</p>
            <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--tblr-muted)' }}>{w.text.length > 400 ? w.text.slice(0, 400) + '…' : w.text}</p>
          </li>)}
        </ul>
      </div>}
      {c.warnings?.length > 0 && c.origin !== 'auto' && c.warnings.map((w, i) => <p key={i} className="text-xs">{w}</p>)}
    </div>}
  </li>;
}

export function Journal({ contributions, publications, nameOf, publicationActive, busy, onRemove }: {
  contributions: Contribution[]; publications: Publication[]; nameOf: (documentId: string) => string;
  publicationActive: boolean; busy: boolean; onRemove: (c: Contribution) => void;
}) {
  if (!contributions.length) {
    return <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>Aucun document analysé ou partagé pour l’instant. Ce journal listera chaque document traité, avec le texte exact qui part.</p>;
  }
  return <ul className="space-y-2" aria-label="Documents analysés et partagés">
    {contributions.map(c => <Row key={c.id} c={c} publication={publications.find(p => p.contribution_id === c.id)}
      name={nameOf(c.document_id)} publicationActive={publicationActive} busy={busy} onRemove={onRemove} />)}
  </ul>;
}
