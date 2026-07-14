import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconBell, IconBriefcase, IconFileInvoice, IconClipboardList,
  IconMessageCircle, IconHeart, IconSend, IconCheck, IconFilter,
  IconFileText, IconRefresh, IconX, IconLink, IconQuote, IconPaperclip,
  IconFile, IconDownload
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { TeamMemberLite, useMentionComposer, MentionDropdown, renderTextWithMentions, insertLinkInto, insertQuoteInto } from '../lib/mentions';

interface Attachment {
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
}

interface FeedComment extends Attachment {
  id: string;
  user_name: string;
  content: string;
  created_at: string;
  mentions_me?: boolean;
}

interface FeedItem extends Attachment {
  id: string;
  kind: 'activity' | 'post';
  user_name: string;
  user_id?: string;
  content?: string;
  action?: string;
  target?: string;
  target_id?: string;
  target_type?: string;
  category?: string;
  created_at: string;
  likes_count: number;
  liked: boolean;
  unread: boolean;
  mentions_me?: boolean;
  comments: FeedComment[];
  comments_count: number;
}

// Authenticated multipart POST — apiFetch forces a JSON Content-Type header
// whenever a body is present, which corrupts a FormData upload's boundary.
async function postForm<T>(url: string, form: FormData): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

type FilterKey = 'all' | 'projects' | 'invoices' | 'tenders' | 'messages' | 'unread';

const FILTERS: { key: FilterKey; label_key: string; category?: string; icon: React.ElementType; color: string }[] = [
  { key: 'all',      label_key: 'notif_filter_all',      icon: IconBell,           color: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'projects', label_key: 'notif_filter_projects',  category: 'Projets',      icon: IconBriefcase,      color: 'text-blue-600' },
  { key: 'invoices', label_key: 'notif_filter_invoices',  category: 'Factures',     icon: IconFileInvoice,    color: 'text-emerald-600' },
  { key: 'tenders',  label_key: 'notif_filter_tenders',   category: "Appels d'offres", icon: IconClipboardList, color: 'text-amber-600' },
  { key: 'messages', label_key: 'notif_filter_messages',  category: 'Messages',     icon: IconMessageCircle,  color: 'text-violet-600' },
  { key: 'unread',   label_key: 'notif_filter_unread',    icon: IconBell,           color: 'text-rose-600' },
];

const TYPE_ICONS: Record<string, React.ElementType> = {
  project: IconBriefcase,
  invoice: IconFileInvoice,
  tender: IconClipboardList,
  post: IconMessageCircle,
};

const CATEGORY_STYLES: Record<string, string> = {
  'Projets':           'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'Factures':          'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  "Appels d'offres":   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  'Messages':          'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR');
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];
  const color = colors[(name.charCodeAt(0) || 0) % colors.length];
  return (
    <div
      className={cn('rounded-full flex items-center justify-center text-white font-bold shrink-0', color)}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </div>
  );
}

function MentionBadge() {
  return (
    <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[9px] font-bold uppercase tracking-wide">
      @ Vous êtes mentionné(e)
    </span>
  );
}

function AttachmentView({ item }: { item: Attachment }) {
  if (!item.attachment_url) return null;
  if (item.attachment_type?.startsWith('image/')) {
    return (
      <a href={item.attachment_url} target="_blank" rel="noreferrer">
        <img src={item.attachment_url} alt={item.attachment_name || 'pièce jointe'} className="mt-1.5 rounded-lg max-w-full max-h-56" />
      </a>
    );
  }
  return (
    <a href={item.attachment_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs mt-1.5 text-blue-600 dark:text-blue-400 hover:underline w-fit">
      <IconFile size={13} /> {item.attachment_name || 'Pièce jointe'} <IconDownload size={12} />
    </a>
  );
}

function AttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-[11px] text-zinc-500 dark:text-zinc-400 w-fit">
      <IconFile size={12} /> {file.name}
      <button onClick={onRemove} className="hover:text-red-500 transition-colors"><IconX size={11} /></button>
    </div>
  );
}

function CommentBox({ teamMembers, onSubmit }: { teamMembers: TeamMemberLite[]; onSubmit: (content: string, file: File | null) => void }) {
  const composer = useMentionComposer(teamMembers);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const content = composer.value.trim();
    if (!content && !attachment) return;
    composer.setValue('');
    setAttachment(null);
    onSubmit(content, attachment);
  };

  return (
    <div className="flex-1 relative">
      <div className="bg-zinc-100 dark:bg-zinc-700/50 rounded-xl px-3 py-2 space-y-1">
        {attachment && <AttachmentChip file={attachment} onRemove={() => setAttachment(null)} />}
        <div className="flex items-center gap-2">
          <textarea
            ref={composer.ref as React.RefObject<HTMLTextAreaElement>}
            rows={1}
            placeholder="Répondre... (@ pour mentionner)"
            className="flex-1 bg-transparent text-xs outline-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 resize-none"
            value={composer.value}
            onChange={composer.handleChange}
            onKeyDown={e => composer.handleKeyDown(e, ke => { if (!ke.shiftKey) { ke.preventDefault(); submit(); } })}
            onBlur={composer.handleBlur}
          />
          <input type="file" ref={fileInputRef} className="hidden" onChange={e => setAttachment(e.target.files?.[0] || null)} />
          <button onClick={() => fileInputRef.current?.click()} className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0" title="Joindre un fichier">
            <IconPaperclip size={14} />
          </button>
          <button onClick={() => insertLinkInto(composer)} className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0" title="Insérer un lien">
            <IconLink size={14} />
          </button>
          <button onClick={() => insertQuoteInto(composer)} className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0" title="Citation">
            <IconQuote size={14} />
          </button>
          <button
            onClick={submit}
            disabled={!composer.value.trim() && !attachment}
            className="text-blue-500 disabled:opacity-30 hover:text-blue-600 transition-colors shrink-0"
          >
            <IconSend size={13} />
          </button>
        </div>
      </div>
      <MentionDropdown
        suggestions={composer.suggestions}
        activeIndex={composer.mentionIndex}
        top={composer.mentionTop}
        onHover={composer.setMentionIndex}
        onSelect={composer.selectMention}
        renderAvatar={name => <Avatar name={name} size={20} />}
      />
    </div>
  );
}

export default function Notifications() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const composer = useMentionComposer(teamMembers);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authErrorCount = useRef(0);
  const autoExpandedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<TeamMemberLite[]>('/api/team').then(setTeamMembers).catch(() => {});
  }, [currentUser]);

  const fetchItems = useCallback(async () => {
    try {
      const data = await apiFetch<FeedItem[]>('/api/feed');
      authErrorCount.current = 0;
      setItems(data);
    } catch (err: any) {
      if (!err?.message?.includes('401')) {
        console.error('Feed fetch failed:', err);
      } else {
        authErrorCount.current += 1;
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    authErrorCount.current = 0;
    fetchItems();
    const interval = setInterval(() => {
      if (authErrorCount.current < 3) fetchItems();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchItems, currentUser]);

  // Automatically open the comments of any item that mentions the current user
  useEffect(() => {
    const toExpand = items.filter(i => i.mentions_me && !autoExpandedRef.current.has(i.id));
    if (toExpand.length === 0) return;
    setExpandedComments(prev => {
      const next = new Set(prev);
      toExpand.forEach(i => { next.add(i.id); autoExpandedRef.current.add(i.id); });
      return next;
    });
  }, [items]);

  const markAllRead = async () => {
    setIsMarkingRead(true);
    try {
      await apiFetch('/api/notifications/mark-read', { method: 'POST' });
      setItems(prev => prev.map(i => ({ ...i, unread: false })));
    } catch (err) {
      console.error(err);
    } finally {
      setIsMarkingRead(false);
    }
  };

  const handleLike = async (item: FeedItem) => {
    const endpoint = item.kind === 'post'
      ? `/api/feed/posts/${item.id}/like`
      : `/api/feed/activities/${item.id}/like`;
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, liked: !i.liked, likes_count: i.liked ? i.likes_count - 1 : i.likes_count + 1 }
      : i
    ));
    try {
      await apiFetch(endpoint, { method: 'POST' });
    } catch {
      setItems(prev => prev.map(i => i.id === item.id
        ? { ...i, liked: item.liked, likes_count: item.likes_count }
        : i
      ));
    }
  };

  const handleComment = async (itemId: string, content: string, file: File | null) => {
    try {
      let comment: FeedComment;
      if (file) {
        const fd = new FormData();
        if (content) fd.append('content', content);
        fd.append('file', file);
        comment = await postForm<FeedComment>(`/api/feed/posts/${itemId}/comments`, fd);
      } else {
        comment = await apiFetch<FeedComment>(`/api/feed/posts/${itemId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ content })
        });
      }
      setItems(prev => prev.map(i => i.id === itemId
        ? { ...i, comments: [...i.comments, comment], comments_count: i.comments_count + 1 }
        : i
      ));
    } catch (err) {
      console.error(err);
    }
  };

  const handlePost = async () => {
    const content = composer.value.trim();
    if ((!content && !attachment) || isPosting) return;
    setIsPosting(true);
    composer.setValue('');
    const file = attachment;
    setAttachment(null);
    try {
      let item: FeedItem;
      if (file) {
        const fd = new FormData();
        if (content) fd.append('content', content);
        fd.append('file', file);
        item = await postForm<FeedItem>('/api/feed/posts', fd);
      } else {
        item = await apiFetch<FeedItem>('/api/feed/posts', {
          method: 'POST',
          body: JSON.stringify({ content })
        });
      }
      setItems(prev => [item, ...prev]);
    } catch (err) {
      console.error(err);
      setAttachment(file);
      composer.setValue(content);
    } finally {
      setIsPosting(false);
    }
  };

  const toggleComments = (id: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredItems = items.filter(item => {
    if (filter === 'unread') return item.unread;
    if (filter === 'all') return true;
    const f = FILTERS.find(f => f.key === filter);
    return item.category === f?.category;
  });

  const unreadCount = items.filter(i => i.unread).length;

  const categoryCount = (cat?: string) => {
    if (!cat) return items.length;
    return items.filter(i => i.category === cat).length;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl">
            <IconBell size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{t('notif_page_title')}</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-rose-500 font-medium">{unreadCount} non lu{unreadCount > 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchItems}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <IconRefresh size={18} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={isMarkingRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 rounded-xl transition-colors disabled:opacity-60"
            >
              <IconCheck size={15} />
              {t('notif_mark_all_read')}
            </button>
          )}
        </div>
      </div>

      {/* Compose box */}
      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm p-4 relative">
        <div className="flex gap-3">
          <Avatar name={currentUser?.name || 'U'} size={36} />
          <div className="flex-1">
            <textarea
              ref={composer.ref as React.RefObject<HTMLTextAreaElement>}
              rows={2}
              placeholder="Partagez quelque chose avec l'équipe... (@ pour mentionner, Ctrl+Entrée pour publier)"
              className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none text-zinc-900 dark:text-white placeholder:text-zinc-400 transition-all"
              value={composer.value}
              onChange={composer.handleChange}
              onKeyDown={e => composer.handleKeyDown(e, ke => { if (ke.ctrlKey || ke.metaKey) { ke.preventDefault(); handlePost(); } })}
              onBlur={composer.handleBlur}
            />
            {attachment && (
              <div className="mt-2">
                <AttachmentChip file={attachment} onRemove={() => setAttachment(null)} />
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <div className="flex gap-1">
                <input type="file" ref={fileInputRef} className="hidden" onChange={e => setAttachment(e.target.files?.[0] || null)} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  title="Joindre un fichier"
                >
                  <IconPaperclip size={15} />
                </button>
                <button
                  onClick={() => insertLinkInto(composer)}
                  className="p-1.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  title="Insérer un lien"
                >
                  <IconLink size={15} />
                </button>
                <button
                  onClick={() => insertQuoteInto(composer)}
                  className="p-1.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  title="Citation"
                >
                  <IconQuote size={15} />
                </button>
              </div>
              <button
                onClick={handlePost}
                disabled={(!composer.value.trim() && !attachment) || isPosting}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 shadow-sm"
              >
                <IconSend size={14} />
                {isPosting ? '...' : 'Publier'}
              </button>
            </div>
          </div>
        </div>
        <MentionDropdown
          suggestions={composer.suggestions}
          activeIndex={composer.mentionIndex}
          top={composer.mentionTop}
          onHover={composer.setMentionIndex}
          onSelect={composer.selectMention}
          renderAvatar={name => <Avatar name={name} size={22} />}
        />
      </div>

      {/* Filter tabs */}
      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-zinc-100 dark:border-zinc-700/50 scrollbar-none">
          {FILTERS.map(f => {
            const count = f.key === 'unread' ? unreadCount : f.key === 'all' ? items.length : categoryCount(f.category);
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all shrink-0",
                  isActive
                    ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
                    : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/30"
                )}
              >
                <f.icon size={15} className={isActive ? f.color : ''} />
                {t(f.label_key)}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                    isActive
                      ? f.key === 'unread'
                        ? "bg-rose-500 text-white"
                        : "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                      : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Feed items */}
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center text-zinc-400">
            <IconBell size={36} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">{t('notif_empty')}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            <AnimatePresence initial={false}>
              {filteredItems.map((item, idx) => {
                const isOpen = expandedComments.has(item.id);
                const CatIcon = TYPE_ICONS[item.target_type || (item.kind === 'post' ? 'post' : 'project')] || IconFileText;
                const catStyle = CATEGORY_STYLES[item.category || ''] || 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300';

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03, duration: 0.2 }}
                    className={cn(
                      "px-5 py-4 transition-colors",
                      item.unread ? "bg-blue-50/40 dark:bg-blue-900/10 hover:bg-blue-50/60 dark:hover:bg-blue-900/20" : "hover:bg-zinc-50/60 dark:hover:bg-zinc-700/20"
                    )}
                  >
                    <div className="flex gap-3.5">
                      {/* Unread indicator */}
                      <div className="flex flex-col items-center gap-1 pt-1">
                        <Avatar name={item.user_name || 'U'} size={36} />
                        {item.unread && (
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-0.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Content */}
                        {item.kind === 'activity' ? (
                          <p className="text-sm font-semibold text-zinc-900 dark:text-white leading-snug">
                            {item.action}
                          </p>
                        ) : (
                          <div className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
                            {renderTextWithMentions(item.content || '', teamMembers)}
                            <AttachmentView item={item} />
                          </div>
                        )}

                        {/* Metadata row */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <CatIcon size={12} className="shrink-0" />
                          <span>{t('notif_by')} <span className="font-semibold text-zinc-700 dark:text-zinc-300">{item.user_name}</span></span>
                          <span>·</span>
                          <span>{timeAgo(item.created_at)}</span>
                          {item.category && (
                            <>
                              <span>·</span>
                              <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", catStyle)}>
                                {item.category}
                              </span>
                            </>
                          )}
                          {item.unread && (
                            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-[9px] font-bold uppercase tracking-wide">
                              Nouveau
                            </span>
                          )}
                          {item.mentions_me && <MentionBadge />}
                        </div>

                        {/* Action bar */}
                        <div className="flex items-center gap-5 mt-2.5">
                          <button
                            onClick={() => toggleComments(item.id)}
                            className={cn(
                              "flex items-center gap-1.5 text-xs font-medium transition-colors",
                              isOpen ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
                            )}
                          >
                            <IconMessageCircle size={14} />
                            <span>Commentaire</span>
                            {item.comments_count > 0 && (
                              <span className="bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                                {item.comments_count}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => handleLike(item)}
                            className={cn(
                              "flex items-center gap-1.5 text-xs font-medium transition-colors",
                              item.liked ? "text-rose-500" : "text-zinc-400 hover:text-rose-500"
                            )}
                          >
                            <IconHeart size={14} className={item.liked ? "fill-current" : ''} />
                            <span>{item.likes_count > 0 ? item.likes_count : 'Aimer'}</span>
                          </button>
                        </div>

                        {/* Comments section */}
                        <AnimatePresence>
                          {isOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-3 space-y-2 overflow-hidden"
                            >
                              {item.comments.map(c => (
                                <div key={c.id} className="flex gap-2">
                                  <Avatar name={c.user_name || 'U'} size={26} />
                                  <div className="flex-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-xl px-3 py-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{c.user_name}</span>
                                      {c.mentions_me && <MentionBadge />}
                                    </div>
                                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{renderTextWithMentions(c.content, teamMembers)}</div>
                                    <AttachmentView item={c} />
                                    <p className="text-[10px] text-zinc-400 mt-1">{timeAgo(c.created_at)}</p>
                                  </div>
                                </div>
                              ))}
                              {item.comments.length === 0 && (
                                <p className="text-xs text-zinc-400 pl-1">Aucun commentaire. Soyez le premier !</p>
                              )}
                              {item.kind === 'post' && (
                                <div className="flex gap-2 items-center pt-1">
                                  <Avatar name={currentUser?.name || 'U'} size={26} />
                                  <CommentBox teamMembers={teamMembers} onSubmit={(content, file) => handleComment(item.id, content, file)} />
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
