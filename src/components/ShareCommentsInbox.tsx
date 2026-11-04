// Commentaires des confrères sur le CCTP et le DPGF, côté cabinet : lire, répondre,
// marquer comme traité. Un fil = un élément (lot, chapitre ou article) d'un partage.
// Réservé aux administrateurs et managers : le serveur répond 403 aux autres.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

interface Comment {
  id: string; shareId: string; guestEmail: string | null; resourceKind: 'cctp' | 'dpgf'; lotId: string;
  targetType: string; targetId: string; targetLabel: string | null; body: string;
  authorKind: 'guest' | 'cabinet'; authorName: string | null; createdAt: string | null; resolvedAt: string | null;
}
export interface InboxLot { id: string; lot_number: string | null; lot_title: string | null }

function threadsOf(comments: Comment[]): Comment[][] {
  const byKey = new Map<string, Comment[]>();
  for (const c of comments) {
    const key = [c.shareId, c.resourceKind, c.lotId, c.targetType, c.targetId].join('|');
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  const threads = [...byKey.values()].map(list => list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
  // À traiter d'abord, puis du plus récent au plus ancien.
  return threads.sort((a, b) => {
    const open = (t: Comment[]) => (t[0].resolvedAt ? 1 : 0);
    return open(a) - open(b) || String(b[b.length - 1].createdAt).localeCompare(String(a[a.length - 1].createdAt));
  });
}

function Thread({ projectId, thread, lots, onChanged }: {
  projectId: string; thread: Comment[]; lots: InboxLot[]; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const root = thread[0];
  const lot = lots.find(l => l.id === root.lotId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = !!root.resolvedAt;

  const reply = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/share-comments/${root.id}/reply`, { method: 'POST', body: JSON.stringify({ body: text }) });
      setText(''); setOpen(false); onChanged();
    } catch (e: any) { setError(e?.message || t('share_error')); }
    finally { setBusy(false); }
  };

  const toggle = async () => {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/share-comments/${root.id}`, { method: 'PUT', body: JSON.stringify({ resolved: !resolved }) });
      onChanged();
    } catch (e: any) { setError(e?.message || t('share_error')); }
    finally { setBusy(false); }
  };

  return (
    <li className={`px-4 py-3 space-y-2 ${resolved ? 'opacity-60' : ''}`} style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <div className="text-xs text-[var(--tblr-muted)]">
        <span className="font-semibold text-[var(--tblr-text)]">{root.guestEmail}</span>
        {` · ${root.resourceKind.toUpperCase()}`}
        {lot ? ` · ${[lot.lot_number, lot.lot_title].filter(Boolean).join(' ')}` : ''}
        {root.targetLabel ? ` · ${root.targetLabel}` : ''}
        {resolved ? ` · ${t('share_comment_resolved')}` : ''}
      </div>
      {thread.map(c => (
        <div key={c.id} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
          <div className="text-[var(--tblr-muted)]">
            {c.authorName || (c.authorKind === 'cabinet' ? t('shared_comment_cabinet') : c.guestEmail)}
            {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString('fr-FR')}` : ''}
          </div>
          <div className="text-[var(--tblr-text)] whitespace-pre-wrap">{c.body}</div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)]">
            {t('share_comment_reply')}
          </button>
        )}
        <button type="button" onClick={toggle} disabled={busy} className="px-3 py-1 text-xs font-medium rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] underline disabled:opacity-50">
          {resolved ? t('share_comment_reopen') : t('share_comment_resolve')}
        </button>
      </div>
      {open && (
        <form onSubmit={reply} className="space-y-1">
          <textarea
            required rows={2} maxLength={2000} value={text} onChange={e => setText(e.target.value)}
            placeholder={t('share_comment_placeholder')} aria-label={t('share_comment_placeholder')}
            className="w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <button type="submit" disabled={busy || !text.trim()} className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
            {t('share_comment_send')}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

export default function ShareCommentsInbox({ projectId, lots, refreshKey }: { projectId: string; lots: InboxLot[]; refreshKey?: number }) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<Comment[] | null>(null);

  const load = useCallback(() => {
    apiFetch<Comment[]>(`/api/projects/${projectId}/share-comments`).then(setComments).catch(() => setComments(null));
  }, [projectId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Rien à montrer tant qu'aucun confrère n'a commenté : le panneau de partage reste sobre.
  if (!comments || comments.length === 0) return null;
  const threads = threadsOf(comments);
  const pending = threads.filter(th => !th[0].resolvedAt).length;
  return (
    <div style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-[var(--tblr-text)]">{t('share_comments_title')}</span>
        {pending > 0 && (
          <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-text)] px-2 py-0.5 rounded-full">{pending}</span>
        )}
      </div>
      <ul>
        {threads.map(thread => (
          <Thread key={`${thread[0].id}-${thread.length}-${thread[0].resolvedAt ?? ''}`} projectId={projectId} thread={thread} lots={lots} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}
