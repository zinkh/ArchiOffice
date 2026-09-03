import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRobot, IconX, IconSend, IconChevronDown, IconAlertTriangle, IconPaperclip, IconFileSpreadsheet, IconFileText, IconFileTypeCsv, IconFileTypePdf, IconDownload, IconX as IconClose, IconUpload, IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/lib/api';
import { formatCopilotSuggestion } from '@/src/lib/copilotSuggestions';
import type { CopilotSuggestion, CopilotSuggestionRaw } from '@/src/lib/copilotSuggestions';
import type { Agent, AgentMessage, AgentArtifact } from '../types.js';

// ── Context ──────────────────────────────────────────────────────────────────

interface AgentChatContextValue {
  /**
   * Opens the chat panel. `draftMessage`, when given, prefills the input so
   * the user can review/edit an AI-suggested message before sending it —
   * callers should never use this to auto-send on the user's behalf.
   */
  openChat: (agentId?: string, draftMessage?: string) => void;
  closeChat: () => void;
  /** Re-fetches the proactive "next steps" suggestions shown on the floating badge. */
  refreshCopilotSuggestions: () => void;
}

const AgentChatContext = createContext<AgentChatContextValue>({ openChat: () => {}, closeChat: () => {}, refreshCopilotSuggestions: () => {} });

export function useAgentChat() {
  return useContext(AgentChatContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function AgentAvatar({ agent, size = 32 }: { agent: Agent; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full shrink-0 font-bold text-white"
      style={{ width: size, height: size, background: agent.avatar_color, fontSize: size * 0.35 }}
    >
      {agent.avatar_initials}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const icons: Record<string, React.ReactNode> = {
    excel: <IconFileSpreadsheet size={20} color="#217346" />,
    csv: <IconFileTypeCsv size={20} color="#217346" />,
    docx: <IconFileText size={20} color="#2b5797" />,
    pdf: <IconFileTypePdf size={20} color="#b02a2a" />,
  };

  const typeLabels: Record<string, string> = {
    excel: 'Fichier Excel',
    csv: 'Fichier CSV',
    docx: 'Document Word',
    pdf: 'Document PDF',
  };

  const download = () => {
    const bytes = Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl mt-2 border cursor-pointer hover:opacity-80 transition-opacity"
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
      onClick={download}
      title={`Télécharger ${artifact.filename}`}
    >
      {icons[artifact.type] ?? <IconFileText size={20} />}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{artifact.filename}</div>
        <div className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
          {typeLabels[artifact.type] ?? 'Document'}
        </div>
      </div>
      <IconDownload size={14} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />
    </div>
  );
}

function MessageBubble({ msg, agentColor }: { msg: AgentMessage & { artifact?: AgentArtifact }; agentColor: string }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5" style={{ background: agentColor }}>
          <IconRobot size={13} color="white" />
        </div>
      )}
      <div className="max-w-[82%]">
        <div
          className="px-3 py-2 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
          style={
            isUser
              ? { background: 'var(--tblr-primary)', color: 'white' }
              : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }
          }
        >
          {msg.content}
        </div>
        {msg.artifact && <ArtifactCard artifact={msg.artifact} />}
      </div>
    </div>
  );
}

// ── Document picker ───────────────────────────────────────────────────────────

interface DocMeta { id: string; name: string; phase?: string }

function DocumentPicker({ attached, onAttach, onDetach }: {
  attached: DocMeta[];
  onAttach: (doc: DocMeta) => void;
  onDetach: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch('/api/documents?limit=30').then((d: any) => setDocs(d?.data ?? d ?? [])).catch(() => {});
  }, [open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-lg transition-colors hover:bg-[var(--tblr-surface-2)]"
        title="Joindre un document"
        style={{ color: attached.length > 0 ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}
      >
        <IconPaperclip size={15} />
        {attached.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: 'var(--tblr-primary)' }}>
            {attached.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full mb-2 left-0 w-72 rounded-xl shadow-xl border overflow-hidden z-10"
            style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
          >
            <div className="px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              Documents disponibles
            </div>
            <div className="max-h-48 overflow-y-auto">
              {docs.length === 0 && <p className="px-3 py-2 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>Aucun document.</p>}
              {docs.map(doc => {
                const isAttached = attached.some(a => a.id === doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => { isAttached ? onDetach(doc.id) : onAttach(doc); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left hover:bg-[var(--tblr-surface-2)] transition-colors"
                    style={{ color: isAttached ? 'var(--tblr-primary)' : 'var(--tblr-text)' }}
                  >
                    <IconFileText size={13} />
                    <span className="truncate flex-1">{doc.name}</span>
                    {doc.phase && <span className="text-[10px] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{doc.phase}</span>}
                    {isAttached && <span className="text-[10px] font-semibold" style={{ color: 'var(--tblr-primary)' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attached chips */}
      {attached.length > 0 && (
        <div className="absolute bottom-full mb-2 left-8 flex flex-wrap gap-1" style={{ display: open ? 'none' : 'flex' }}>
          {attached.map(doc => (
            <div key={doc.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
              <IconFileText size={10} />
              <span className="max-w-[100px] truncate">{doc.name}</span>
              <button onClick={() => onDetach(doc.id)} className="hover:opacity-70">
                <IconClose size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Draft persistence ────────────────────────────────────────────────────────
// Keeps an in-progress message in localStorage (per agent) so it survives a
// hung/failed request, an accidental panel close, or a page reload — the
// user should never have to retype a request because the agent stalled.

function draftStorageKey(agentId: string): string {
  return `agent_chat_draft_${agentId}`;
}

function loadDraft(agentId: string): string {
  try {
    return localStorage.getItem(draftStorageKey(agentId)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(agentId: string, value: string): void {
  try {
    if (value) localStorage.setItem(draftStorageKey(agentId), value);
    else localStorage.removeItem(draftStorageKey(agentId));
  } catch {
    // localStorage unavailable (private browsing, quota) — draft just won't persist.
  }
}

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<(AgentMessage & { artifact?: AgentArtifact })[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [attachedDocs, setAttachedDocs] = useState<{ id: string; name: string }[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [copilotSuggestions, setCopilotSuggestions] = useState<CopilotSuggestion[]>([]);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const dragCounterRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'user' | 'timeout' | null>(null);

  const activeAgent: Agent | null = agents.find(a => a.id === activeAgentId) ?? null;

  // Surfaces "still working" feedback while a request is in flight, instead of
  // leaving the user staring at bouncing dots with no sense of progress.
  useEffect(() => {
    if (!loading) { setElapsedSec(0); return; }
    const start = Date.now();
    const id = setInterval(() => setElapsedSec(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const loadingLabel = elapsedSec < 6
    ? t('agent_chat_thinking')
    : elapsedSec < 18
      ? t('agent_chat_thinking_slow')
      : t('agent_chat_thinking_long');

  useEffect(() => {
    apiFetch('/api/agents')
      .then((data: Agent[]) => {
        const active = data.filter(a => a.is_active);
        setAgents(active);
        if (!activeAgentId && active.length > 0) setActiveAgentId(active[0].id);
      })
      .catch(() => {});
  }, []);

  // Proactive "next steps" suggestions surfaced on the floating badge —
  // rule-based, computed on demand (no polling), same engine as the
  // Dashboard's "Suggestions IA" widget. Silently no-ops without a tenant.
  const loadCopilotSuggestions = useCallback(() => {
    apiFetch('/api/copilot/suggestions')
      .then((data: CopilotSuggestionRaw[]) => setCopilotSuggestions((data || []).map(raw => formatCopilotSuggestion(raw, t))))
      .catch(() => {});
  }, [t]);

  useEffect(() => {
    loadCopilotSuggestions();
  }, [loadCopilotSuggestions]);

  // Dismissing the suggestions banner only hides it for the current viewing
  // — reopening the panel later re-surfaces it if the underlying alerts
  // (overdue milestones, unpaid invoices...) are still there.
  useEffect(() => {
    if (isOpen) setSuggestionsDismissed(false);
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversation = useCallback(async (agentId: string) => {
    setLoadingHistory(true);
    setMessages([]);
    setErrorMsg(null);
    // Restore a message left over from a failed/hung send (or the panel
    // simply being closed mid-draft) — but never clobber something the
    // user is actively typing (e.g. a suggestion draft just prefilled).
    setInput(prev => prev || loadDraft(agentId));
    try {
      const data = await apiFetch(`/api/agents/${agentId}/conversation`);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
    try {
      const bal = await apiFetch('/api/agents/token-balance');
      setTokenBalance(bal.balance_eur_cents ?? bal.balance ?? null);
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen && activeAgentId) loadConversation(activeAgentId);
  }, [isOpen, activeAgentId, loadConversation]);

  const openChat = useCallback((agentId?: string, draftMessage?: string): void => {
    if (agentId) {
      setActiveAgentId(agentId);
      if (!draftMessage) setInput(loadDraft(agentId));
    }
    if (draftMessage) setInput(draftMessage);
    setIsOpen(true);
    if (draftMessage) setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const closeChat = useCallback((): void => {
    setIsOpen(false);
    setAgentSelectorOpen(false);
    setExpanded(false);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || !activeAgentId || loading) return;
    const agentId = activeAgentId;
    const rawInput = input.trim();
    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      conversation_id: '',
      tenant_id: '',
      role: 'user',
      content: rawInput + (attachedDocs.length > 0 ? `\n\n📎 Documents joints : ${attachedDocs.map(d => d.name).join(', ')}` : ''),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const docsToSend = [...attachedDocs];
    setAttachedDocs([]);
    setLoading(true);
    setErrorMsg(null);
    // Keep the draft in storage while the request is in flight (rather than
    // clearing it immediately) — if the tab crashes or reloads during a hang,
    // the message is still recoverable when the panel reopens.

    const controller = new AbortController();
    abortControllerRef.current = controller;
    abortReasonRef.current = null;
    // Safety net so a hung Gemini call (or dropped connection) doesn't leave
    // the user staring at the "thinking" indicator forever — the server's own
    // per-call timeout (routes.ts's AGENT_CHAT_TIMEOUT_MS, 100s) is meant to
    // fire first with an explicit message. That budget wraps each individual
    // Gemini call — a multi-round function-calling exchange chains several,
    // so the total request can legitimately run well past 100s even with no
    // single round anywhere near stuck. This backstop needs enough margin
    // above that for those to still surface the server's own message instead
    // of racing it.
    const hardTimeout = setTimeout(() => {
      abortReasonRef.current = 'timeout';
      controller.abort();
    }, 130000);

    try {
      const res = await apiFetch(`/api/agents/${activeAgentId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: rawInput, document_ids: docsToSend.map(d => d.id) }),
        signal: controller.signal,
      });
      const assistantMsg: AgentMessage & { artifact?: AgentArtifact } = {
        id: crypto.randomUUID(),
        conversation_id: '',
        tenant_id: '',
        role: 'assistant',
        content: res.reply,
        artifact: res.artifact,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (res.remaining_balance !== undefined) setTokenBalance(res.remaining_balance);
      saveDraft(agentId, '');
    } catch (e: any) {
      const errText: string = e?.message ?? t('agent_chat_error');
      if (e?.name === 'AbortError') {
        setErrorMsg(abortReasonRef.current === 'user' ? t('agent_chat_cancelled') : t('agent_chat_timeout'));
      } else if (e?.status === 504 || errText.includes('AGENT_TIMEOUT')) {
        setErrorMsg(t('agent_chat_timeout'));
      } else if (errText.includes('Enterprise') || errText.includes('ENTERPRISE_REQUIRED')) {
        setErrorMsg('enterprise');
      } else if (errText.includes('token') || errText.includes('NO_TOKENS')) {
        setErrorMsg('tokens');
      } else {
        setErrorMsg(errText);
      }
      // Whatever failed — timeout, cancel, or a real error — the request is
      // reset, not lost: put the message and its attachments back so the
      // user can just hit send again instead of retyping everything.
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      setInput(rawInput);
      setAttachedDocs(docsToSend);
      saveDraft(agentId, rawInput);
    } finally {
      clearTimeout(hardTimeout);
      abortControllerRef.current = null;
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const cancelRequest = () => {
    abortReasonRef.current = 'user';
    abortControllerRef.current?.abort();
  };

  // Uploads a new file straight from the chat (drag-and-drop or otherwise)
  // and attaches the resulting document, instead of requiring it to already
  // exist in the Documents module before it can be picked.
  const uploadAndAttach = async (file: File) => {
    setUploadingFile(file.name);
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name);
      form.append('category', 'Assistant IA');
      const res = await fetch('/api/documents', { method: 'POST', body: form });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAttachedDocs(prev => prev.some(d => d.id === data.id) ? prev : [...prev, { id: data.id, name: file.name }]);
    } catch {
      setErrorMsg(t('agent_chat_upload_error'));
    } finally {
      setUploadingFile(null);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(uploadAndAttach);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendMessage(); }
  };

  const resetConversation = async () => {
    if (!activeAgentId) return;
    try {
      await apiFetch(`/api/agents/${activeAgentId}/conversation`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to reset conversation:', e);
    }
    setMessages([]);
    setErrorMsg(null);
    // A fresh conversation shouldn't carry over documents attached to the
    // previous one — otherwise they linger as "already attached" and the
    // picker/drop zone looks like it can't add anything new.
    setAttachedDocs([]);
  };

  const switchAgent = (agentId: string): void => {
    setActiveAgentId(agentId);
    setAgentSelectorOpen(false);
    setAttachedDocs([]);
    setInput(loadDraft(agentId));
  };

  return (
    <AgentChatContext.Provider value={{ openChat, closeChat, refreshCopilotSuggestions: loadCopilotSuggestions }}>
      {children}

      {/* Floating trigger */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg font-medium text-[13px] transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--tblr-primary)', color: 'white' }}
        title={copilotSuggestions.length > 0 ? t('agent_chat_suggestions_badge', { count: copilotSuggestions.length }) : t('agents')}
      >
        <IconRobot size={18} />
        <span className="hidden sm:inline">{t('agents')}</span>
        {copilotSuggestions.length > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: '#e03131', color: 'white', minWidth: 18, height: 18, padding: '0 4px' }}
          >
            {copilotSuggestions.length}
          </span>
        )}
      </button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-20 right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden transition-[width,height] duration-200"
            style={expanded ? {
              width: 'min(900px, calc(100vw - 24px))',
              height: 'min(88vh, calc(100vh - 40px))',
              background: 'var(--tblr-surface)',
              border: '1px solid var(--tblr-border)',
            } : {
              width: 'min(420px, calc(100vw - 24px))',
              height: 'min(640px, calc(100vh - 100px))',
              background: 'var(--tblr-surface)',
              border: '1px solid var(--tblr-border)',
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Drag-and-drop overlay */}
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 pointer-events-none border-2 border-dashed rounded-xl"
                  style={{ background: 'var(--tblr-primary-lt)', borderColor: 'var(--tblr-primary)' }}
                >
                  <IconUpload size={28} style={{ color: 'var(--tblr-primary)' }} />
                  <p className="text-[13px] font-semibold px-4 text-center" style={{ color: 'var(--tblr-primary)' }}>
                    {t('agent_chat_drop_hint')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
            >
              {activeAgent && <AgentAvatar agent={activeAgent} size={32} />}
              <div className="flex-1 min-w-0">
                {agents.length > 1 ? (
                  <button
                    onClick={() => setAgentSelectorOpen(o => !o)}
                    className="flex items-center gap-1 font-semibold text-[14px] hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--tblr-text)' }}
                  >
                    <span className="truncate">{activeAgent?.name ?? '—'}</span>
                    <IconChevronDown size={14} />
                  </button>
                ) : (
                  <div className="font-semibold text-[14px] truncate" style={{ color: 'var(--tblr-text)' }}>
                    {activeAgent?.name ?? t('agents')}
                  </div>
                )}
                <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                  {activeAgent ? activeAgent.role_title : ''}
                </div>
              </div>
              <button
                onClick={() => setExpanded(e => !e)}
                className="p-1 rounded hover:bg-[var(--tblr-surface-2)] transition-colors"
                title={(expanded ? t('agent_chat_collapse') : t('agent_chat_expand')) as string}
              >
                {expanded
                  ? <IconArrowsMinimize size={16} style={{ color: 'var(--tblr-muted)' }} />
                  : <IconArrowsMaximize size={16} style={{ color: 'var(--tblr-muted)' }} />}
              </button>
              <button onClick={closeChat} className="p-1 rounded hover:bg-[var(--tblr-surface-2)] transition-colors">
                <IconX size={16} style={{ color: 'var(--tblr-muted)' }} />
              </button>
            </div>

            {/* Standing AI-content disclosure (EU AI Act, art. 50) — kept
                short and always visible rather than repeated per message,
                since every reply and tool action in this panel is AI-generated. */}
            <div
              className="px-4 py-1.5 text-[10px] text-center border-b shrink-0"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
            >
              {t('agent_chat_ai_disclaimer')}
            </div>

            {/* Agent selector dropdown */}
            <AnimatePresence>
              {agentSelectorOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute top-[58px] left-0 right-0 z-10 border-b shadow-sm"
                  style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
                >
                  {agents.map(a => (
                    <button
                      key={a.id}
                      onClick={() => switchAgent(a.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-[var(--tblr-surface-2)] transition-colors text-left"
                      style={{ color: a.id === activeAgentId ? 'var(--tblr-primary)' : 'var(--tblr-text)' }}
                    >
                      <AgentAvatar agent={a} size={24} />
                      <div>
                        <div className="font-medium">{a.name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{a.role_title}</div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Proactive suggestions — passive only: clicking prefills the
                draft below, the user still has to review and send it. */}
            {copilotSuggestions.length > 0 && !suggestionsDismissed && (
              <div className="border-b px-4 py-3 space-y-2 shrink-0" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>
                    {t('dashboard_ai_suggestions')}
                  </div>
                  <button
                    onClick={() => setSuggestionsDismissed(true)}
                    className="p-0.5 rounded hover:bg-[var(--tblr-surface)] transition-colors"
                    title={t('agent_chat_dismiss_suggestions') as string}
                  >
                    <IconX size={12} style={{ color: 'var(--tblr-muted)' }} />
                  </button>
                </div>
                {copilotSuggestions.map(s => (
                  <div
                    key={s.id}
                    className="flex items-start gap-2 p-2 rounded-lg"
                    style={{
                      background: s.tone === 'danger' ? '#fff5f5' : '#fff4e6',
                      border: `1px solid ${s.tone === 'danger' ? '#ffc9c9' : '#ffd8a8'}`,
                    }}
                  >
                    <IconAlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: s.tone === 'danger' ? '#c92a2a' : '#e67700' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px]" style={{ color: 'var(--tblr-text)' }}>{s.text}</p>
                      <button
                        onClick={() => { setInput(s.draft); setTimeout(() => textareaRef.current?.focus(), 50); }}
                        className="mt-1 text-[11px] font-semibold hover:underline"
                        style={{ color: 'var(--tblr-primary)' }}
                      >
                        {t('ai_draft_reminder_btn')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {loadingHistory && (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
                </div>
              )}
              {!loadingHistory && messages.length === 0 && !errorMsg && (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                  {activeAgent && <AgentAvatar agent={activeAgent} size={48} />}
                  <p className="text-[13px] text-center" style={{ color: 'var(--tblr-muted)' }}>{t('agent_chat_empty')}</p>
                  <p className="text-[11px] text-center" style={{ color: 'var(--tblr-muted)' }}>
                    💡 Joignez un document avec 📎, ou glissez-déposez-le ici
                  </p>
                </div>
              )}
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} agentColor={activeAgent?.avatar_color ?? '#206bc4'} />
              ))}
              {loading && (
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2 justify-start">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: activeAgent?.avatar_color ?? '#206bc4' }}>
                      <IconRobot size={13} color="white" />
                    </div>
                    <div className="px-3 py-2 rounded-xl flex flex-col gap-1" style={{ background: 'var(--tblr-surface-2)' }}>
                      <div className="flex gap-1 items-center">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--tblr-muted)', animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{loadingLabel}</div>
                    </div>
                  </div>
                  {elapsedSec >= 8 && (
                    <button
                      onClick={cancelRequest}
                      className="self-start ml-8 text-[11px] hover:underline"
                      style={{ color: 'var(--tblr-muted)' }}
                    >
                      {t('agent_chat_cancel')}
                    </button>
                  )}
                </div>
              )}
              {errorMsg === 'enterprise' && (
                <div className="mx-2 p-3 rounded-lg border text-[12px]" style={{ background: '#fff4e6', borderColor: '#ffd8a8', color: '#f76707' }}>
                  <div className="flex items-center gap-2 font-semibold mb-1"><IconAlertTriangle size={14} /> {t('enterprise_required')}</div>
                  <p>{t('enterprise_required_desc')}</p>
                </div>
              )}
              {errorMsg === 'tokens' && (
                <div className="mx-2 p-3 rounded-lg border text-[12px]" style={{ background: '#fff4e6', borderColor: '#ffd8a8', color: '#f76707' }}>
                  <div className="flex items-center gap-2 font-semibold mb-1"><IconAlertTriangle size={14} /> {t('agent_tokens_exhausted')}</div>
                  <a href="/billing" className="underline font-medium">{t('agent_tokens_recharge')}</a>
                </div>
              )}
              {errorMsg && errorMsg !== 'enterprise' && errorMsg !== 'tokens' && (
                <div className="mx-2 p-3 rounded-lg border text-[12px]" style={{ background: '#fff5f5', borderColor: '#ffc9c9', color: '#c92a2a' }}>
                  {errorMsg}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--tblr-border)' }}>
              {uploadingFile && (
                <div className="flex items-center gap-2 text-[11px] mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                  <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
                  {t('agent_chat_uploading', { name: uploadingFile })}
                </div>
              )}
              {tokenBalance !== null && (
                <div className="text-[10px] mb-1.5 text-right" style={{ color: 'var(--tblr-muted)' }}>
                  {(tokenBalance / 100).toFixed(2)} € de crédits IA restants
                </div>
              )}
              <div className="flex gap-2 items-end">
                <DocumentPicker
                  attached={attachedDocs}
                  onAttach={doc => setAttachedDocs(prev => prev.some(d => d.id === doc.id) ? prev : [...prev, doc])}
                  onDetach={id => setAttachedDocs(prev => prev.filter(d => d.id !== id))}
                />
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    const value = e.target.value;
                    setInput(value);
                    if (activeAgentId) saveDraft(activeAgentId, value);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('agent_chat_placeholder')}
                  className="flex-1 resize-none rounded-lg px-3 py-2 text-[13px] outline-none border transition-colors"
                  style={{
                    background: 'var(--tblr-surface-2)',
                    borderColor: 'var(--tblr-border)',
                    color: 'var(--tblr-text)',
                    minHeight: 36,
                    maxHeight: 100,
                  }}
                  onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
                  }}
                  disabled={loading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="p-2 rounded-lg transition-colors flex items-center justify-center"
                  style={{ background: 'var(--tblr-primary)', color: 'white', opacity: !input.trim() || loading ? 0.5 : 1 }}
                  title={`${t('agent_chat_send')} (Ctrl+Entrée)`}
                >
                  <IconSend size={16} />
                </button>
              </div>
              <button
                onClick={resetConversation}
                className="text-[11px] mt-1.5 hover:underline"
                style={{ color: 'var(--tblr-muted)' }}
              >
                {t('agent_chat_new')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AgentChatContext.Provider>
  );
}
