import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { SignedImage } from '../components/SignedImage';
import {
  IconMessageCircle, IconLoader2, IconArrowLeft, IconSend, IconLock, IconLockOpen,
  IconPaperclip, IconX, IconFile, IconDownload,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

interface Ticket {
  id: string; tenant_id: string; tenant_name: string | null; subject: string; status: string;
  created_by_name: string | null; created_at: string; last_message_at: string;
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

function Bubble({ msg }: { msg: Message }) {
  const isPlatform = msg.author_type === 'platform';
  return (
    <div className={cn('flex', isPlatform ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[80%] rounded-xl px-3 py-2 text-sm',
        isPlatform ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
      )}>
        <p className="text-[11px] opacity-70 mb-0.5">{msg.author_name || (isPlatform ? 'Support ArchiOffice' : 'Cabinet')}</p>
        {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
        {msg.attachment_url && (
          msg.attachment_type?.startsWith('image/') ? (
            <button type="button" onClick={() => openSignedUrl(msg.attachment_url!)} className="block">
              <SignedImage src={msg.attachment_url} alt={msg.attachment_name || 'pièce jointe'} className="mt-1 rounded-lg max-w-full max-h-48" />
            </button>
          ) : (
            <button type="button" onClick={() => openSignedUrl(msg.attachment_url!)} className={cn('flex items-center gap-1.5 text-xs mt-1 hover:underline', isPlatform ? 'text-white' : 'text-blue-600 dark:text-blue-400')}>
              <IconFile size={13} /> {msg.attachment_name} <IconDownload size={12} />
            </button>
          )
        )}
        <p className="text-[10px] opacity-60 mt-1">{new Date(msg.created_at).toLocaleString('fr-FR')}</p>
      </div>
    </div>
  );
}

export default function AdminSupport() {
  const [searchParams] = useSearchParams();
  const tenantFilter = searchParams.get('tenant_id');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const qs = tenantFilter ? `?tenant_id=${tenantFilter}` : '';
      setTickets(await apiFetch<Ticket[]>(`/api/admin/support/tickets${qs}`));
    } finally {
      setLoading(false);
    }
  }, [tenantFilter]);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await apiFetch<TicketDetail>(`/api/admin/support/tickets/${id}`));
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  async function handleReply() {
    if (!activeId || (!reply.trim() && !replyAttachment)) return;
    setSending(true);
    try {
      if (replyAttachment) {
        const fd = new FormData();
        if (reply.trim()) fd.append('body', reply);
        fd.append('file', replyAttachment);
        const token = await getAccessToken();
        const res = await fetch(`/api/admin/support/tickets/${activeId}/messages`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Erreur lors de l'envoi");
      } else {
        await apiFetch(`/api/admin/support/tickets/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      }
      setReply(''); setReplyAttachment(null);
      await loadDetail(activeId);
      await loadTickets();
    } catch (e: any) {
      alert(e.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  }

  async function handleToggleStatus() {
    if (!activeId || !detail) return;
    const nextStatus = detail.status === 'closed' ? 'open' : 'closed';
    await apiFetch(`/api/admin/support/tickets/${activeId}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    await loadDetail(activeId);
    await loadTickets();
  }

  if (activeId && detail) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => { setActiveId(null); setDetail(null); }} className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--tblr-muted)' }}>
          <IconArrowLeft size={14} /> Retour aux tickets
        </button>
        <div className="rounded-lg border p-6 space-y-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{detail.subject}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                <Link to={`/admin/tenants/${detail.tenant_id}`} className="hover:underline">{detail.tenant_name || detail.tenant_id}</Link>
                {' — '}{detail.created_by_name || 'Cabinet'}
              </p>
              <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[detail.status])}>{STATUS_LABELS[detail.status] || detail.status}</span>
            </div>
            <button onClick={handleToggleStatus} className="text-xs flex items-center gap-1" style={{ color: 'var(--tblr-muted)' }}>
              {detail.status === 'closed' ? <><IconLockOpen size={12} /> Rouvrir</> : <><IconLock size={12} /> Fermer</>}
            </button>
          </div>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto py-2">
            {detail.messages.map(m => <Bubble key={m.id} msg={m} />)}
          </div>
          <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--tblr-border)' }}>
            {replyAttachment && (
              <div className="flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 w-fit" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                <IconFile size={13} /> {replyAttachment.name}
                <button onClick={() => setReplyAttachment(null)} className="hover:text-red-500"><IconX size={12} /></button>
              </div>
            )}
            <div className="flex gap-2">
              <input type="file" ref={replyFileRef} className="hidden" onChange={e => setReplyAttachment(e.target.files?.[0] || null)} />
              <button onClick={() => replyFileRef.current?.click()} className="p-2 hover:text-blue-600 transition-colors flex-shrink-0" style={{ color: 'var(--tblr-muted)' }} title="Joindre un fichier">
                <IconPaperclip size={18} />
              </button>
              <textarea
                value={reply} onChange={e => setReply(e.target.value)} rows={2}
                placeholder="Votre réponse…"
                className="flex-1 p-2 rounded-lg text-sm resize-none"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
              <button
                onClick={handleReply}
                disabled={sending || (!reply.trim() && !replyAttachment)}
                className="px-3 rounded-lg text-white disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--tblr-primary)' }}
              >
                {sending ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Support</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
          {tenantFilter ? 'Tickets de ce cabinet' : 'Tous les tickets, tous cabinets confondus'}
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-12"><IconLoader2 size={22} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} /></div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12" style={{ color: 'var(--tblr-muted)' }}>
            <IconMessageCircle size={28} />
            <p className="text-sm">Aucun ticket</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
            {tickets.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-[var(--tblr-surface-2)]"
              >
                <div>
                  <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>{t.subject}</p>
                  <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                    {t.tenant_name || t.tenant_id} — {new Date(t.last_message_at).toLocaleDateString('fr-FR')}
                  </p>
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
