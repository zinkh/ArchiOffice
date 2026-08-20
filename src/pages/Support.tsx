import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import {
  IconMessageCircle, IconPlus, IconLoader2, IconArrowLeft, IconSend,
  IconLock,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

interface Ticket {
  id: string; subject: string; status: string; created_at: string; last_message_at: string;
}
interface Message {
  id: string; author_type: 'tenant' | 'platform'; author_name: string | null; body: string; created_at: string;
}
interface TicketDetail extends Ticket { messages: Message[] }

const STATUS_LABELS: Record<string, string> = { open: 'Ouvert', answered: 'Répondu', closed: 'Fermé' };
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  answered: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
  closed: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500',
};

function Bubble({ msg }: { msg: Message }) {
  const isTeam = msg.author_type === 'platform';
  return (
    <div className={cn('flex', isTeam ? 'justify-start' : 'justify-end')}>
      <div className={cn(
        'max-w-[80%] rounded-xl px-3 py-2 text-sm',
        isTeam ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'bg-blue-600 text-white'
      )}>
        <p className="text-[11px] opacity-70 mb-0.5">{isTeam ? (msg.author_name || 'Support ArchiOffice') : (msg.author_name || 'Vous')}</p>
        <p className="whitespace-pre-wrap">{msg.body}</p>
        <p className="text-[10px] opacity-60 mt-1">{new Date(msg.created_at).toLocaleString('fr-FR')}</p>
      </div>
    </div>
  );
}

export default function Support() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'new'>('list');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      setTickets(await apiFetch<Ticket[]>('/api/support/tickets'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await apiFetch<TicketDetail>(`/api/support/tickets/${id}`));
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const ticket = await apiFetch<Ticket>('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject: newSubject, message: newMessage }),
      });
      setNewSubject(''); setNewMessage(''); setView('list');
      await loadTickets();
      setActiveId(ticket.id);
    } catch (e: any) {
      alert(e.message || 'Erreur lors de la création du ticket');
    } finally {
      setCreating(false);
    }
  }

  async function handleReply() {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/support/tickets/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      setReply('');
      await loadDetail(activeId);
      await loadTickets();
    } catch (e: any) {
      alert(e.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    if (!activeId || !window.confirm('Fermer ce ticket ?')) return;
    await apiFetch(`/api/support/tickets/${activeId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) });
    await loadDetail(activeId);
    await loadTickets();
  }

  if (activeId && detail) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => { setActiveId(null); setDetail(null); }} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
          <IconArrowLeft size={14} /> Retour aux tickets
        </button>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{detail.subject}</h1>
              <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[detail.status])}>{STATUS_LABELS[detail.status] || detail.status}</span>
            </div>
            {detail.status !== 'closed' && (
              <button onClick={handleClose} className="text-xs text-zinc-400 hover:text-red-500 flex items-center gap-1">
                <IconLock size={12} /> Fermer le ticket
              </button>
            )}
          </div>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto py-2">
            {detail.messages.map(m => <Bubble key={m.id} msg={m} />)}
          </div>
          {detail.status !== 'closed' && (
            <div className="flex gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                rows={2}
                placeholder="Votre réponse…"
                className="flex-1 p-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white resize-none"
              />
              <button
                onClick={handleReply}
                disabled={sending || !reply.trim()}
                className="px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center justify-center"
              >
                {sending ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} />}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Support</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Une question, un problème ? Contactez l'équipe ArchiOffice.</p>
        </div>
        <button
          onClick={() => setView(view === 'new' ? 'list' : 'new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
        >
          <IconPlus size={14} /> Nouveau ticket
        </button>
      </div>

      {view === 'new' && (
        <form onSubmit={handleCreate} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Sujet</label>
            <input
              required value={newSubject} onChange={e => setNewSubject(e.target.value)}
              className="w-full p-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white"
              placeholder="Résumé de votre demande"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Message</label>
            <textarea
              required rows={4} value={newMessage} onChange={e => setNewMessage(e.target.value)}
              className="w-full p-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white resize-y"
              placeholder="Décrivez votre problème ou votre question…"
            />
          </div>
          <button type="submit" disabled={creating} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {creating ? 'Envoi…' : 'Envoyer'}
          </button>
        </form>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {loading ? (
          <div className="flex items-center justify-center py-12"><IconLoader2 size={22} className="animate-spin text-zinc-400" /></div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
            <IconMessageCircle size={28} />
            <p className="text-sm">Aucun ticket pour le moment</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tickets.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-white">{t.subject}</p>
                  <p className="text-[11px] text-zinc-400">Dernier échange le {new Date(t.last_message_at).toLocaleDateString('fr-FR')}</p>
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_COLORS[t.status])}>{STATUS_LABELS[t.status] || t.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
