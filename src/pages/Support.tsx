import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { SignedImage } from '../components/SignedImage';
import { ARTICLES, FAQ_ITEMS, type Article } from '../lib/supportContent';
import {
  IconMessageCircle, IconPlus, IconLoader2, IconArrowLeft, IconSend,
  IconLock, IconPaperclip, IconX, IconFile, IconDownload, IconMail,
  IconBulb, IconFileText, IconHelpCircle, IconVideo, IconBuildingStore,
  IconChevronRight,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

interface Ticket {
  id: string; subject: string; status: string; created_at: string; last_message_at: string;
}
interface Message {
  id: string; author_type: 'tenant' | 'platform'; author_name: string | null; body: string;
  attachment_url?: string | null; attachment_name?: string | null; attachment_type?: string | null;
  created_at: string;
}
interface TicketDetail extends Ticket { messages: Message[] }

const STATUS_LABELS: Record<string, string> = { open: 'Ouvert', answered: 'Répondu', closed: 'Fermé' };
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  answered: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
  closed: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500',
};

const HELP_CARDS: { key: string; title: string; description: string; icon: React.ReactNode }[] = [
  { key: 'tips', title: 'Conseils et astuces', description: 'Conseils pour rationaliser vos calculs de frais, le visa des plans et le suivi de chantier.', icon: <IconBulb size={18} /> },
  { key: 'docs', title: "Documents d'aide", description: 'Prises en main pas à pas : projets, CCTP/DPGF, devis et factures.', icon: <IconFileText size={18} /> },
  { key: 'faq', title: 'Forum aux questions', description: "Questions fréquentes sur l'essai, la facturation, les crédits IA et vos données.", icon: <IconHelpCircle size={18} /> },
  { key: 'videos', title: "Vidéos d'aide", description: 'Tutoriels vidéo courts sur les fonctionnalités clés.', icon: <IconVideo size={18} /> },
  { key: 'guides', title: 'Guides pour les entreprises', description: 'Repères sur la décennale, la facturation BTP et le RGPD.', icon: <IconBuildingStore size={18} /> },
];

function Bubble({ msg }: { msg: Message }) {
  const isTeam = msg.author_type === 'platform';
  return (
    <div className={cn('flex', isTeam ? 'justify-start' : 'justify-end')}>
      <div className={cn(
        'max-w-[80%] rounded-xl px-3 py-2 text-sm',
        isTeam ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'bg-blue-600 text-white'
      )}>
        <p className="text-[11px] opacity-70 mb-0.5">{isTeam ? (msg.author_name || 'Support ArchiOffice') : (msg.author_name || 'Vous')}</p>
        {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
        {msg.attachment_url && (
          msg.attachment_type?.startsWith('image/') ? (
            <button type="button" onClick={() => openSignedUrl(msg.attachment_url!)} className="block">
              <SignedImage src={msg.attachment_url} alt={msg.attachment_name || 'pièce jointe'} className="mt-1 rounded-lg max-w-full max-h-48" />
            </button>
          ) : (
            <button type="button" onClick={() => openSignedUrl(msg.attachment_url!)} className={cn('flex items-center gap-1.5 text-xs mt-1 hover:underline', isTeam ? 'text-blue-600 dark:text-blue-400' : 'text-white')}>
              <IconFile size={13} /> {msg.attachment_name} <IconDownload size={12} />
            </button>
          )
        )}
        <p className="text-[10px] opacity-60 mt-1">{new Date(msg.created_at).toLocaleString('fr-FR')}</p>
      </div>
    </div>
  );
}

function ArticleView({ article, onBack }: { article: Article; onBack: () => void }) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
        <IconArrowLeft size={14} /> Retour à l'aide
      </button>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{article.title}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{article.intro}</p>
        </div>
        {article.sections.map((s, i) => (
          <div key={i}>
            {s.heading && <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-2">{s.heading}</h2>}
            <ul className="space-y-1.5">
              {s.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-zinc-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqView({ onBack }: { onBack: () => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
        <IconArrowLeft size={14} /> Retour à l'aide
      </button>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">Forum aux questions</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Les questions les plus fréquentes des cabinets qui utilisent ArchiOffice.</p>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="py-3">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between text-left text-sm font-medium text-zinc-900 dark:text-white"
              >
                {item.question}
                <IconChevronRight size={14} className={cn('flex-shrink-0 transition-transform', openIdx === i && 'rotate-90')} />
              </button>
              {openIdx === i && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">{item.answer}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HelpHome({ onNavigate, onNewTicket, onViewTickets }: { onNavigate: (key: string) => void; onNewTicket: () => void; onViewTickets: () => void }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Aide et support</p>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white mt-1">Besoin d'aide ?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-md">
          Consultez nos guides ci-dessous, ou contactez directement l'équipe ArchiOffice.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={onNewTicket} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">
            <IconPlus size={14} /> Créer un ticket
          </button>
          <a href="mailto:contact@archioffice.fr" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800">
            <IconMail size={14} /> Envoyez-nous un email
          </a>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Liens d'aide rapide</p>
          <button onClick={onViewTickets} className="text-xs text-zinc-400 hover:text-blue-600 hover:underline">Voir mes tickets</button>
        </div>
        <div className="space-y-2">
          {HELP_CARDS.map(c => (
            <button
              key={c.key}
              onClick={() => onNavigate(c.key)}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            >
              <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">{c.icon}</span>
              <span className="flex-1">
                <span className="block font-medium text-sm text-zinc-900 dark:text-white">{c.title}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{c.description}</span>
              </span>
              <IconChevronRight size={16} className="text-zinc-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Support() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [view, setView] = useState<'help' | 'faq' | 'article' | 'list' | 'new'>('help');
  const [articleKey, setArticleKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const replyFileRef = useRef<HTMLInputElement>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      setTickets(await apiFetch<Ticket[]>('/api/support/tickets'));
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await apiFetch<TicketDetail>(`/api/support/tickets/${id}`));
  }, []);

  useEffect(() => { if (view === 'list') loadTickets(); }, [view, loadTickets]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  function goHelp() { setArticleKey(null); setView('help'); }
  function goNewTicket() { setView('new'); }
  function goList() { setView('list'); }

  function handleCardClick(key: string) {
    if (key === 'faq') { setView('faq'); return; }
    setArticleKey(key);
    setView('article');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      let ticket: Ticket;
      if (newAttachment) {
        const fd = new FormData();
        fd.append('subject', newSubject);
        fd.append('message', newMessage);
        fd.append('file', newAttachment);
        const token = await getAccessToken();
        const res = await fetch('/api/support/tickets', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Erreur lors de la création du ticket');
        ticket = await res.json();
      } else {
        ticket = await apiFetch<Ticket>('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: newSubject, message: newMessage }) });
      }
      setNewSubject(''); setNewMessage(''); setNewAttachment(null);
      setActiveId(ticket.id);
    } catch (e: any) {
      alert(e.message || 'Erreur lors de la création du ticket');
    } finally {
      setCreating(false);
    }
  }

  async function handleReply() {
    if (!activeId || (!reply.trim() && !replyAttachment)) return;
    setSending(true);
    try {
      if (replyAttachment) {
        const fd = new FormData();
        if (reply.trim()) fd.append('body', reply);
        fd.append('file', replyAttachment);
        const token = await getAccessToken();
        const res = await fetch(`/api/support/tickets/${activeId}/messages`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Erreur lors de l'envoi");
      } else {
        await apiFetch(`/api/support/tickets/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      }
      setReply(''); setReplyAttachment(null);
      await loadDetail(activeId);
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
  }

  if (activeId && detail) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => { setActiveId(null); setDetail(null); goList(); }} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
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
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              {replyAttachment && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-2 py-1 w-fit">
                  <IconFile size={13} /> {replyAttachment.name}
                  <button onClick={() => setReplyAttachment(null)} className="text-zinc-400 hover:text-red-500"><IconX size={12} /></button>
                </div>
              )}
              <div className="flex gap-2">
                <input type="file" ref={replyFileRef} className="hidden" onChange={e => setReplyAttachment(e.target.files?.[0] || null)} />
                <button onClick={() => replyFileRef.current?.click()} className="p-2 text-zinc-400 hover:text-blue-600 transition-colors flex-shrink-0" title="Joindre un fichier">
                  <IconPaperclip size={18} />
                </button>
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  rows={2}
                  placeholder="Votre réponse…"
                  className="flex-1 p-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white resize-none"
                />
                <button
                  onClick={handleReply}
                  disabled={sending || (!reply.trim() && !replyAttachment)}
                  className="px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                >
                  {sending ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === 'help') {
    return <HelpHome onNavigate={handleCardClick} onNewTicket={goNewTicket} onViewTickets={goList} />;
  }

  if (view === 'faq') {
    return <FaqView onBack={goHelp} />;
  }

  if (view === 'article') {
    const article = ARTICLES.find(a => a.key === articleKey);
    if (article) return <ArticleView article={article} onBack={goHelp} />;
    goHelp();
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={goHelp} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:underline mb-1">
            <IconArrowLeft size={14} /> Retour à l'aide
          </button>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{view === 'new' ? 'Nouveau ticket' : 'Mes tickets'}</h1>
        </div>
        {view === 'list' && (
          <button
            onClick={goNewTicket}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
          >
            <IconPlus size={14} /> Nouveau ticket
          </button>
        )}
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
              rows={4} value={newMessage} onChange={e => setNewMessage(e.target.value)}
              className="w-full p-2 rounded-lg text-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white resize-y"
              placeholder="Décrivez votre problème ou votre question…"
            />
          </div>
          {newAttachment && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-2 py-1 w-fit">
              <IconFile size={13} /> {newAttachment.name}
              <button type="button" onClick={() => setNewAttachment(null)} className="text-zinc-400 hover:text-red-500"><IconX size={12} /></button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input type="file" ref={newFileRef} className="hidden" onChange={e => setNewAttachment(e.target.files?.[0] || null)} />
            <button type="button" onClick={() => newFileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-blue-600">
              <IconPaperclip size={14} /> Joindre un fichier
            </button>
            <button type="submit" disabled={creating || !newSubject.trim() || (!newMessage.trim() && !newAttachment)} className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {creating ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}

      {view === 'list' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          {loadingTickets ? (
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
      )}
    </div>
  );
}
