import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IconPaperclip, IconLink, IconAlignLeft, IconChevronDown, IconHeart, IconMessageCircle, IconSend, IconX, IconBriefcase, IconFileInvoice, IconFileText, IconClipboardList } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';

interface FeedComment {
  id: string;
  user_name: string;
  content: string;
  created_at: string;
}

interface FeedItem {
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
  comments: FeedComment[];
  comments_count: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return new Date(dateStr).toLocaleDateString('fr-FR');
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const CATEGORY_COLORS: Record<string, string> = {
  'Projets': 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
  'Factures': 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  'Appels d\'offres': 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
  'Messages': 'text-violet-600 bg-violet-50 dark:bg-violet-900/20 dark:text-violet-400',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  project: IconBriefcase,
  invoice: IconFileInvoice,
  tender: IconClipboardList,
  post: IconFileText,
};

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      className={cn('rounded-full flex items-center justify-center text-white font-bold shrink-0', color)}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials(name)}
    </div>
  );
}

export default function ActivityFeed() {
  const { currentUser } = useUser();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [message, setMessage] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showHiddenMenu, setShowHiddenMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenMenuRef = useRef<HTMLDivElement>(null);

  const authErrorCount = useRef(0);

  const fetchFeed = useCallback(async () => {
    try {
      const data = await apiFetch<FeedItem[]>('/api/feed');
      authErrorCount.current = 0;
      setItems(data);
    } catch (err: any) {
      if (err?.message?.includes('401')) {
        authErrorCount.current += 1;
      } else {
        console.error('Feed fetch failed:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    authErrorCount.current = 0;
    fetchFeed();
    const interval = setInterval(() => {
      // Stop polling after 3 consecutive auth failures — session is gone
      if (authErrorCount.current < 3) fetchFeed();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchFeed, currentUser]);

  // Close hidden menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (hiddenMenuRef.current && !hiddenMenuRef.current.contains(e.target as Node)) {
        setShowHiddenMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePost = async () => {
    if (!message.trim() || isPosting) return;
    setIsPosting(true);
    const content = message.trim();
    setMessage('');
    try {
      const newItem = await apiFetch<FeedItem>('/api/feed/posts', {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      setItems(prev => [newItem, ...prev]);
    } catch (err) {
      console.error(err);
      setMessage(content);
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handlePost();
  };

  const handleLike = async (item: FeedItem) => {
    const endpoint = item.kind === 'post'
      ? `/api/feed/posts/${item.id}/like`
      : `/api/feed/activities/${item.id}/like`;
    // Optimistic update
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, liked: !i.liked, likes_count: i.liked ? i.likes_count - 1 : i.likes_count + 1 }
      : i
    ));
    try {
      await apiFetch(endpoint, { method: 'POST' });
    } catch {
      // Revert on error
      setItems(prev => prev.map(i => i.id === item.id
        ? { ...i, liked: item.liked, likes_count: item.likes_count }
        : i
      ));
    }
  };

  const handleComment = async (itemId: string) => {
    const content = commentDraft[itemId]?.trim();
    if (!content) return;
    setCommentDraft(d => ({ ...d, [itemId]: '' }));
    try {
      const comment = await apiFetch<FeedComment>(`/api/feed/posts/${itemId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      setItems(prev => prev.map(i => i.id === itemId
        ? { ...i, comments: [...i.comments, comment], comments_count: i.comments_count + 1 }
        : i
      ));
    } catch (err) {
      console.error(err);
    }
  };

  const toggleComments = (id: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleHiddenType = (type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const allCategories = [...new Set(items.map(i => i.category || (i.kind === 'post' ? 'Messages' : '')).filter(Boolean))];
  const visibleItems = items.filter(i => !hiddenTypes.has(i.category || (i.kind === 'post' ? 'Messages' : '')));

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      {/* Header */}
      <div className="flex justify-between items-center px-5 py-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--tblr-text)' }}>Flux d'activité</h2>
        <div className="relative" ref={hiddenMenuRef}>
          <button
            onClick={() => setShowHiddenMenu(v => !v)}
            className="text-xs flex items-center gap-1 transition-colors"
            style={{ color: 'var(--tblr-muted)' }}
          >
            {hiddenTypes.size > 0 && (
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--tblr-primary)' }} />
            )}
            Activités masquées
            <IconChevronDown size={13} />
          </button>
          {showHiddenMenu && (
            <div className="absolute right-0 top-8 rounded-lg shadow-lg z-20 p-2 min-w-[180px]" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
              {allCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleHiddenType(cat)}
                  className="flex items-center justify-between gap-2 w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{ color: hiddenTypes.has(cat) ? 'var(--tblr-muted)' : 'var(--tblr-text)' }}
                  onMouseEnter={e => { if (!hiddenTypes.has(cat)) e.currentTarget.style.background = 'var(--tblr-surface-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                >
                  {cat}
                  {hiddenTypes.has(cat) && <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>masqué</span>}
                </button>
              ))}
              {allCategories.length === 0 && <p className="text-xs px-3 py-2" style={{ color: 'var(--tblr-muted)' }}>Aucune catégorie</p>}
            </div>
          )}
        </div>
      </div>

      {/* Compose area */}
      <div className="p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <textarea
            ref={textareaRef}
            placeholder="Partagez quelque chose. Utilisez @ pour mentionner des personnes."
            className="w-full bg-transparent px-4 pt-3 pb-1 outline-none text-sm resize-none"
            style={{ color: 'var(--tblr-text)' }}
            rows={2}
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex justify-between items-center px-4 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
            <div className="flex gap-3">
              <input type="file" ref={fileInputRef} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Joindre un fichier"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconPaperclip size={16} />
              </button>
              <button className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Insérer un lien"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconLink size={16} />
              </button>
              <button className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Formater"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconAlignLeft size={16} />
              </button>
            </div>
            <button
              onClick={handlePost}
              disabled={!message.trim() || isPosting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              {isPosting ? '...' : 'Partagez'}
              <IconChevronDown size={14} />
            </button>
          </div>
        </div>
        <p className="text-[10px] mt-1.5 pl-1" style={{ color: 'var(--tblr-muted)' }}>Ctrl+Entrée pour publier</p>
      </div>

      {/* Feed */}
      <div className="max-h-[600px] overflow-y-auto">
        {visibleItems.length === 0 && (
          <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
            <IconMessageCircle size={32} className="mx-auto mb-2 opacity-30" />
            Aucune activité récente
          </div>
        )}
        {visibleItems.map(item => {
          const isCommentsOpen = expandedComments.has(item.id);
          const CategoryIcon = TYPE_ICONS[item.target_type || (item.kind === 'post' ? 'post' : 'project')] || IconFileText;
          const catColor = CATEGORY_COLORS[item.category || 'Messages'] || 'text-blue-600 bg-blue-50';

          return (
            <div key={item.id} className="px-5 py-4 transition-colors" style={{ borderBottom: '1px solid var(--tblr-border)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <div className="flex gap-3">
                <Avatar name={item.user_name || 'U'} size={34} />
                <div className="flex-1 min-w-0">
                  {item.kind === 'activity' ? (
                    <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--tblr-text)' }}>
                      {item.action}
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--tblr-text)' }}>{item.content}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                    <CategoryIcon size={12} className="shrink-0" />
                    <span>par <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{item.user_name}</span></span>
                    <span>·</span>
                    <span>{timeAgo(item.created_at)}</span>
                    {item.category && (
                      <>
                        <span>·</span>
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", catColor)}>
                          {item.category}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-2">
                    <button
                      onClick={() => toggleComments(item.id)}
                      className="flex items-center gap-1 text-xs transition-colors"
                      style={{ color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                    >
                      <IconMessageCircle size={13} />
                      Commentaire{item.comments_count > 0 ? ` (${item.comments_count})` : ''}
                    </button>
                    <button
                      onClick={() => handleLike(item)}
                      className="flex items-center gap-1 text-xs transition-colors"
                      style={{ color: item.liked ? '#e03131' : 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#e03131')}
                      onMouseLeave={e => (e.currentTarget.style.color = item.liked ? '#e03131' : 'var(--tblr-muted)')}
                    >
                      <IconHeart size={13} className={item.liked ? "fill-current" : ''} />
                      {item.likes_count > 0 ? item.likes_count : 'Aimer'}
                    </button>
                  </div>

                  {isCommentsOpen && (
                    <div className="mt-3 space-y-2">
                      {item.comments.map(c => (
                        <div key={c.id} className="flex gap-2">
                          <Avatar name={c.user_name || 'U'} size={24} />
                          <div className="flex-1 rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
                            <span className="text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>{c.user_name}</span>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{c.content}</p>
                          </div>
                        </div>
                      ))}
                      {item.kind === 'post' && (
                        <div className="flex gap-2 items-center">
                          <Avatar name={currentUser?.name || 'U'} size={24} />
                          <div className="flex-1 flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: 'var(--tblr-surface-2)' }}>
                            <input
                              type="text"
                              placeholder="Ajouter un commentaire..."
                              className="flex-1 bg-transparent text-xs outline-none"
                              style={{ color: 'var(--tblr-text)' }}
                              value={commentDraft[item.id] || ''}
                              onChange={e => setCommentDraft(d => ({ ...d, [item.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleComment(item.id)}
                            />
                            <button
                              onClick={() => handleComment(item.id)}
                              disabled={!commentDraft[item.id]?.trim()}
                              className="disabled:opacity-30 transition-colors"
                              style={{ color: 'var(--tblr-primary)' }}
                            >
                              <IconSend size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
