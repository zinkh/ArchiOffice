import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconSend, IconPaperclip, IconPlus, IconX, IconSearch, IconUsersGroup,
  IconArrowLeft, IconFile, IconDownload, IconMessageCircle, IconLogout, IconCheck,
  IconLink, IconQuote
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { renderTextWithMentions, insertLinkInto, insertQuoteInto } from '../lib/mentions';

interface Participant {
  id: string;
  name: string;
  avatar?: string;
}

interface Conversation {
  id: string;
  is_group: boolean;
  name: string;
  avatar?: string | null;
  participants: Participant[];
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
}

interface TeamMemberLite {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

function initials(name: string) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR');
}

function Avatar({ name, avatar, size = 40, isGroup = false }: { name: string; avatar?: string | null; size?: number; isGroup?: boolean }) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];
  const color = colors[(name.charCodeAt(0) || 0) % colors.length];
  return (
    <div
      className={cn('rounded-full flex items-center justify-center text-white font-bold shrink-0 overflow-hidden', color)}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover" /> : isGroup ? <IconUsersGroup size={size * 0.5} /> : initials(name)}
    </div>
  );
}

function NewConversationModal({ teamMembers, onClose, onCreated }: {
  teamMembers: TeamMemberLite[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const filtered = teamMembers.filter(m => m.name?.toLowerCase().includes(search.toLowerCase()));
  const isGroup = selected.size > 1;

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (selected.size === 0) return;
    setIsCreating(true);
    try {
      const { id } = await apiFetch<{ id: string }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ participant_ids: [...selected], is_group: isGroup, name: isGroup ? groupName : undefined })
      });
      onCreated(id);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Nouvelle conversation</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <IconX size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3 shrink-0">
          <div className="relative">
            <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
              placeholder="Rechercher une personne..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {isGroup && (
            <input
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
              placeholder="Nom du groupe"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.map(m => (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
            >
              <Avatar name={m.name} avatar={m.avatar} size={32} />
              <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200 truncate">{m.name}</span>
              {selected.has(m.id) && <IconCheck size={16} className="text-blue-600 shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-zinc-400 text-center py-6">Aucun résultat.</p>}
        </div>
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={create}
            disabled={selected.size === 0 || isCreating || (isGroup && !groupName.trim())}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40"
          >
            {isCreating ? '...' : isGroup ? 'Créer le groupe' : 'Démarrer la conversation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Messages() {
  const { currentUser } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('c'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);
  const [showMobileList, setShowMobileList] = useState(!searchParams.get('c'));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const knownMessageIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<TeamMemberLite[]>('/api/team').then(list => setTeamMembers(list.filter(m => m.id !== currentUser.id))).catch(() => {});
  }, [currentUser]);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>('/api/conversations');
      setConversations(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchConversations();
    const interval = setInterval(fetchConversations, 20000);
    return () => clearInterval(interval);
  }, [fetchConversations, currentUser]);

  const openConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    setSearchParams({ c: id });
    setShowMobileList(false);
    try {
      const data = await apiFetch<Message[]>(`/api/conversations/${id}/messages`);
      knownMessageIds.current = new Set(data.map(m => m.id));
      setMessages(data);
      await apiFetch(`/api/conversations/${id}/read`, { method: 'POST' });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
    } catch (err) {
      console.error(err);
    }
  }, [setSearchParams]);

  useEffect(() => {
    const c = searchParams.get('c');
    if (c && c !== selectedId) openConversation(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime: live message delivery across every conversation the user is in
  useEffect(() => {
    const ids = conversations.map(c => c.id);
    if (ids.length === 0) return;

    const channel = supabase
      .channel('messages-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=in.(${ids.join(',')})` }, (payload: any) => {
        const msg: Message = payload.new;
        if (msg.conversation_id === selectedId) {
          setMessages(prev => {
            if (knownMessageIds.current.has(msg.id)) return prev;
            knownMessageIds.current.add(msg.id);
            return [...prev, msg];
          });
          if (msg.sender_id !== currentUser?.id) {
            apiFetch(`/api/conversations/${msg.conversation_id}/read`, { method: 'POST' }).catch(() => {});
          }
        }
        setConversations(prev => prev.map(c => c.id === msg.conversation_id
          ? {
              ...c,
              last_message: msg.content || (msg.attachment_name ? `📎 ${msg.attachment_name}` : null),
              last_message_at: msg.created_at,
              unread_count: (msg.conversation_id === selectedId || msg.sender_id === currentUser?.id) ? c.unread_count : c.unread_count + 1,
            }
          : c
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversations.map(c => c.id).join(','), selectedId, currentUser?.id]);

  const selectedConversation = conversations.find(c => c.id === selectedId) || null;

  const send = async () => {
    if (!selectedId || (!draft.trim() && !attachment) || isSending) return;
    setIsSending(true);
    const content = draft.trim();
    const file = attachment;
    setDraft('');
    setAttachment(null);
    try {
      let newMessage: Message;
      if (file) {
        const fd = new FormData();
        if (content) fd.append('content', content);
        fd.append('file', file);
        const token = await getAccessToken();
        const res = await fetch(`/api/conversations/${selectedId}/messages`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        newMessage = await res.json();
      } else {
        newMessage = await apiFetch<Message>(`/api/conversations/${selectedId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content })
        });
      }
      knownMessageIds.current.add(newMessage.id);
      setMessages(prev => [...prev, newMessage]);
      setConversations(prev => prev.map(c => c.id === selectedId
        ? { ...c, last_message: newMessage.content || (newMessage.attachment_name ? `📎 ${newMessage.attachment_name}` : null), last_message_at: newMessage.created_at }
        : c
      ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()));
    } catch (err) {
      console.error(err);
      setDraft(content);
      setAttachment(file);
    } finally {
      setIsSending(false);
    }
  };

  const leaveConversation = async () => {
    if (!selectedId || !currentUser) return;
    if (!window.confirm('Quitter ce groupe ?')) return;
    try {
      await apiFetch(`/api/conversations/${selectedId}/participants/${currentUser.id}`, { method: 'DELETE' });
      setConversations(prev => prev.filter(c => c.id !== selectedId));
      setSelectedId(null);
      setSearchParams({});
      setShowMobileList(true);
    } catch (err) { console.error(err); }
  };

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <div className="h-[calc(100vh-8rem)] flex bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
      {/* Conversation list */}
      <div className={cn(
        "w-full sm:w-80 border-r border-zinc-100 dark:border-zinc-700/50 flex flex-col shrink-0",
        !showMobileList && "hidden sm:flex"
      )}>
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-700/50 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <IconMessageCircle size={18} className="text-blue-600 dark:text-blue-400" />
            Messages
            {totalUnread > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{totalUnread}</span>}
          </h2>
          <button
            onClick={() => setShowNewConversation(true)}
            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            title="Nouvelle conversation"
          >
            <IconPlus size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <div className="p-8 text-center text-zinc-400">
              <IconMessageCircle size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Aucune conversation.</p>
            </div>
          )}
          {conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => openConversation(conv.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-zinc-50 dark:border-zinc-700/30",
                conv.id === selectedId ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-700/30"
              )}
            >
              <Avatar name={conv.name} avatar={conv.avatar} isGroup={conv.is_group} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-sm truncate", conv.unread_count > 0 ? "font-bold text-zinc-900 dark:text-white" : "font-medium text-zinc-700 dark:text-zinc-300")}>
                    {conv.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0">{timeAgo(conv.last_message_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{conv.last_message || 'Aucun message'}</span>
                  {conv.unread_count > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white shrink-0">{conv.unread_count}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className={cn("flex-1 flex flex-col min-w-0", showMobileList && "hidden sm:flex")}>
        {!selectedConversation ? (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            <div className="text-center">
              <IconMessageCircle size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">Sélectionnez une conversation</p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-700/50 flex items-center gap-3">
              <button onClick={() => setShowMobileList(true)} className="sm:hidden text-zinc-400 hover:text-zinc-600">
                <IconArrowLeft size={18} />
              </button>
              <Avatar name={selectedConversation.name} avatar={selectedConversation.avatar} isGroup={selectedConversation.is_group} size={34} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{selectedConversation.name}</p>
                {selectedConversation.is_group && (
                  <p className="text-[11px] text-zinc-400 truncate">{selectedConversation.participants.map(p => p.name).join(', ')}</p>
                )}
              </div>
              {selectedConversation.is_group && (
                <button onClick={leaveConversation} className="text-zinc-400 hover:text-red-500 transition-colors" title="Quitter le groupe">
                  <IconLogout size={16} />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(msg => {
                const isMine = msg.sender_id === currentUser?.id;
                return (
                  <div key={msg.id} className={cn("flex gap-2", isMine ? "flex-row-reverse" : "flex-row")}>
                    <Avatar name={msg.sender_name || 'U'} size={26} />
                    <div
                      className={cn("max-w-[70%] rounded-2xl px-3 py-2", isMine ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200")}
                      style={isMine ? ({ '--tblr-primary': '#ffffff', '--tblr-border': 'rgba(255,255,255,0.5)' } as React.CSSProperties) : undefined}
                    >
                      {!isMine && selectedConversation.is_group && (
                        <p className="text-[10px] font-bold opacity-70 mb-0.5">{msg.sender_name}</p>
                      )}
                      {msg.content && <div className="text-sm">{renderTextWithMentions(msg.content, [])}</div>}
                      {msg.attachment_url && (
                        msg.attachment_type?.startsWith('image/') ? (
                          <a href={msg.attachment_url} target="_blank" rel="noreferrer">
                            <img src={msg.attachment_url} alt={msg.attachment_name || 'pièce jointe'} className="mt-1 rounded-lg max-w-full max-h-48" />
                          </a>
                        ) : (
                          <a href={msg.attachment_url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-1.5 text-xs mt-1 hover:underline", isMine ? "text-white" : "text-blue-600 dark:text-blue-400")}>
                            <IconFile size={13} /> {msg.attachment_name} <IconDownload size={12} />
                          </a>
                        )
                      )}
                      <p className={cn("text-[9px] mt-1", isMine ? "text-blue-100" : "text-zinc-400")}>{timeAgo(msg.created_at)}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-zinc-100 dark:border-zinc-700/50">
              {attachment && (
                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-xs text-zinc-600 dark:text-zinc-300 w-fit">
                  <IconFile size={13} /> {attachment.name}
                  <button onClick={() => setAttachment(null)} className="text-zinc-400 hover:text-red-500"><IconX size={12} /></button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input type="file" ref={fileInputRef} className="hidden" onChange={e => setAttachment(e.target.files?.[0] || null)} />
                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-zinc-400 hover:text-blue-600 transition-colors shrink-0" title="Joindre un fichier">
                  <IconPaperclip size={18} />
                </button>
                <button onClick={() => insertLinkInto({ value: draft, setValue: setDraft, ref: messageInputRef })} className="p-2 text-zinc-400 hover:text-blue-600 transition-colors shrink-0" title="Insérer un lien">
                  <IconLink size={18} />
                </button>
                <button onClick={() => insertQuoteInto({ value: draft, setValue: setDraft, ref: messageInputRef })} className="p-2 text-zinc-400 hover:text-blue-600 transition-colors shrink-0" title="Citation">
                  <IconQuote size={18} />
                </button>
                <textarea
                  ref={messageInputRef}
                  rows={1}
                  className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white resize-none"
                  placeholder="Écrire un message..."
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button
                  onClick={send}
                  disabled={(!draft.trim() && !attachment) || isSending}
                  className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40 shrink-0"
                >
                  <IconSend size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showNewConversation && (
        <NewConversationModal
          teamMembers={teamMembers}
          onClose={() => setShowNewConversation(false)}
          onCreated={(id) => { setShowNewConversation(false); fetchConversations().then(() => openConversation(id)); }}
        />
      )}
    </div>
  );
}
