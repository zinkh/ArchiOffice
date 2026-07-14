import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IconPaperclip, IconLink, IconQuote, IconChevronDown, IconHeart, IconMessageCircle, IconSend, IconX, IconBriefcase, IconFileInvoice, IconFileText, IconClipboardList, IconUser, IconFile, IconFileDescription, IconUsers, IconFileCheck, IconChecklist, IconReceipt2, IconNotes, IconAlertTriangle, IconPlugConnected } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import { TeamMemberLite, useMentionComposer, MentionDropdown, renderTextWithMentions, insertLinkInto, insertQuoteInto } from '../lib/mentions';

interface FeedComment {
  id: string;
  user_name: string;
  content: string;
  created_at: string;
  mentions_me?: boolean;
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
  mentions_me?: boolean;
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
  'Contacts': 'text-pink-600 bg-pink-50 dark:bg-pink-900/20 dark:text-pink-400',
  'Documents': 'text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20 dark:text-cyan-400',
  'CCTP': 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400',
  'Devis': 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-400',
  'Réunions': 'text-teal-600 bg-teal-50 dark:bg-teal-900/20 dark:text-teal-400',
  'Ordres de service': 'text-lime-600 bg-lime-50 dark:bg-lime-900/20 dark:text-lime-400',
  'Tâches': 'text-sky-600 bg-sky-50 dark:bg-sky-900/20 dark:text-sky-400',
  'Situations/DPGF': 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/20 dark:text-fuchsia-400',
  'Notes de site': 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400',
  'Réserves/Observations': 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
  'Intégrations': 'text-slate-600 bg-slate-50 dark:bg-slate-900/20 dark:text-slate-400',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  project: IconBriefcase,
  invoice: IconFileInvoice,
  tender: IconClipboardList,
  post: IconFileText,
  contact: IconUser,
  document: IconFile,
  specification: IconClipboardList,
  proposal: IconFileDescription,
  meeting: IconUsers,
  ordre_de_service: IconFileCheck,
  task: IconChecklist,
  situation: IconReceipt2,
  dpgf: IconReceipt2,
  site_report: IconNotes,
  site_report_note: IconNotes,
  reserve: IconAlertTriangle,
  observation: IconAlertTriangle,
  integration: IconPlugConnected,
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

function MentionBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
      @ Vous êtes mentionné(e)
    </span>
  );
}

function CommentBox({ teamMembers, onSubmit }: { teamMembers: TeamMemberLite[]; onSubmit: (content: string) => void }) {
  const composer = useMentionComposer(teamMembers);

  const submit = () => {
    const content = composer.value.trim();
    if (!content) return;
    composer.setValue('');
    onSubmit(content);
  };

  return (
    <div className="flex-1 relative">
      <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: 'var(--tblr-surface-2)' }}>
        <input
          ref={composer.ref as React.RefObject<HTMLInputElement>}
          type="text"
          placeholder="Ajouter un commentaire... (@ pour mentionner)"
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: 'var(--tblr-text)' }}
          value={composer.value}
          onChange={composer.handleChange}
          onKeyDown={e => composer.handleKeyDown(e, submit)}
          onBlur={composer.handleBlur}
        />
        <button
          onClick={submit}
          disabled={!composer.value.trim()}
          className="disabled:opacity-30 transition-colors shrink-0"
          style={{ color: 'var(--tblr-primary)' }}
        >
          <IconSend size={13} />
        </button>
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

export default function ActivityFeed() {
  const { currentUser } = useUser();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showHiddenMenu, setShowHiddenMenu] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenMenuRef = useRef<HTMLDivElement>(null);
  const autoExpandedRef = useRef<Set<string>>(new Set());

  const authErrorCount = useRef(0);
  const composer = useMentionComposer(teamMembers);

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<TeamMemberLite[]>('/api/team').then(setTeamMembers).catch(() => {});
  }, [currentUser]);

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

  // Automatically open the comments of any item that mentions the current user,
  // once, so the mention is visible without an extra click.
  useEffect(() => {
    const toExpand = items.filter(i => i.mentions_me && !autoExpandedRef.current.has(i.id));
    if (toExpand.length === 0) return;
    setExpandedComments(prev => {
      const next = new Set(prev);
      toExpand.forEach(i => { next.add(i.id); autoExpandedRef.current.add(i.id); });
      return next;
    });
  }, [items]);

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
    const content = composer.value.trim();
    if (!content || isPosting) return;
    setIsPosting(true);
    composer.setValue('');
    try {
      const newItem = await apiFetch<FeedItem>('/api/feed/posts', {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      setItems(prev => [newItem, ...prev]);
    } catch (err) {
      console.error(err);
      composer.setValue(content);
    } finally {
      setIsPosting(false);
    }
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

  const handleComment = async (itemId: string, content: string) => {
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
      <div className="p-4 relative" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <textarea
            ref={composer.ref as React.RefObject<HTMLTextAreaElement>}
            placeholder="Partagez quelque chose. Utilisez @ pour mentionner des personnes."
            className="w-full bg-transparent px-4 pt-3 pb-1 outline-none text-sm resize-none"
            style={{ color: 'var(--tblr-text)' }}
            rows={2}
            value={composer.value}
            onChange={composer.handleChange}
            onKeyDown={e => composer.handleKeyDown(e, () => { if (e.ctrlKey || e.metaKey) handlePost(); })}
            onBlur={composer.handleBlur}
          />
          <div className="flex justify-between items-center px-4 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
            <div className="flex gap-3">
              <input type="file" ref={fileInputRef} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Joindre un fichier"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconPaperclip size={16} />
              </button>
              <button onClick={() => insertLinkInto(composer)} className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Insérer un lien"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconLink size={16} />
              </button>
              <button onClick={() => insertQuoteInto(composer)} className="transition-colors" style={{ color: 'var(--tblr-muted)' }} title="Citation"
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}>
                <IconQuote size={16} />
              </button>
            </div>
            <button
              onClick={handlePost}
              disabled={!composer.value.trim() || isPosting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              {isPosting ? '...' : 'Partagez'}
              <IconChevronDown size={14} />
            </button>
          </div>
        </div>
        <p className="text-[10px] mt-1.5 pl-1" style={{ color: 'var(--tblr-muted)' }}>Ctrl+Entrée pour publier</p>

        <MentionDropdown
          suggestions={composer.suggestions}
          activeIndex={composer.mentionIndex}
          top={composer.mentionTop}
          onHover={composer.setMentionIndex}
          onSelect={composer.selectMention}
          renderAvatar={name => <Avatar name={name} size={22} />}
        />
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
                    <div className="text-[13px] leading-relaxed" style={{ color: 'var(--tblr-text)' }}>
                      {renderTextWithMentions(item.content || '', teamMembers)}
                    </div>
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
                    {item.mentions_me && <MentionBadge />}
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
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>{c.user_name}</span>
                              {c.mentions_me && <MentionBadge />}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{renderTextWithMentions(c.content, teamMembers)}</div>
                          </div>
                        </div>
                      ))}
                      {item.kind === 'post' && (
                        <div className="flex gap-2 items-center">
                          <Avatar name={currentUser?.name || 'U'} size={24} />
                          <CommentBox teamMembers={teamMembers} onSubmit={content => handleComment(item.id, content)} />
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
