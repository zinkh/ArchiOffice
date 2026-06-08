import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRobot, IconX, IconSend, IconChevronDown, IconAlertTriangle, IconPaperclip, IconFileSpreadsheet, IconFileText, IconFileTypeCsv, IconDownload, IconX as IconClose } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/lib/api';
import type { Agent, AgentMessage, AgentArtifact } from '../types.js';

// ── Context ──────────────────────────────────────────────────────────────────

interface AgentChatContextValue {
  openChat: (agentId?: string) => void;
  closeChat: () => void;
}

const AgentChatContext = createContext<AgentChatContextValue>({ openChat: () => {}, closeChat: () => {} });

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
          {artifact.type === 'excel' ? 'Fichier Excel' : artifact.type === 'csv' ? 'Fichier CSV' : 'Document Word'}
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

// ── Main provider + panel ─────────────────────────────────────────────────────

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeAgent: Agent | null = agents.find(a => a.id === activeAgentId) ?? null;

  useEffect(() => {
    apiFetch('/api/agents')
      .then((data: Agent[]) => {
        const active = data.filter(a => a.is_active);
        setAgents(active);
        if (!activeAgentId && active.length > 0) setActiveAgentId(active[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversation = useCallback(async (agentId: string) => {
    setLoadingHistory(true);
    setMessages([]);
    setErrorMsg(null);
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
      setTokenBalance(bal.balance);
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen && activeAgentId) loadConversation(activeAgentId);
  }, [isOpen, activeAgentId, loadConversation]);

  const openChat = useCallback((agentId?: string): void => {
    if (agentId) setActiveAgentId(agentId);
    setIsOpen(true);
  }, []);

  const closeChat = useCallback((): void => {
    setIsOpen(false);
    setAgentSelectorOpen(false);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || !activeAgentId || loading) return;
    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      conversation_id: '',
      tenant_id: '',
      role: 'user',
      content: input.trim() + (attachedDocs.length > 0 ? `\n\n📎 Documents joints : ${attachedDocs.map(d => d.name).join(', ')}` : ''),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const docsToSend = [...attachedDocs];
    setAttachedDocs([]);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/agents/${activeAgentId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: input.trim(), document_ids: docsToSend.map(d => d.id) }),
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
    } catch (e: any) {
      const errText: string = e?.message ?? t('agent_chat_error');
      if (errText.includes('Enterprise') || errText.includes('ENTERPRISE_REQUIRED')) {
        setErrorMsg('enterprise');
      } else if (errText.includes('token') || errText.includes('NO_TOKENS')) {
        setErrorMsg('tokens');
      } else {
        setErrorMsg(errText);
      }
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendMessage(); }
  };

  const resetConversation = async () => {
    if (!activeAgentId) return;
    await apiFetch(`/api/agents/${activeAgentId}/conversation`, { method: 'DELETE' });
    setMessages([]);
    setErrorMsg(null);
  };

  const switchAgent = (agentId: string): void => {
    setActiveAgentId(agentId);
    setAgentSelectorOpen(false);
  };

  return (
    <AgentChatContext.Provider value={{ openChat, closeChat }}>
      {children}

      {/* Floating trigger */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg font-medium text-[13px] transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--tblr-primary)', color: 'white' }}
        title={t('agents')}
      >
        <IconRobot size={18} />
        <span className="hidden sm:inline">{t('agents')}</span>
      </button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-20 right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden"
            style={{
              width: 'min(420px, calc(100vw - 24px))',
              height: 'min(640px, calc(100vh - 100px))',
              background: 'var(--tblr-surface)',
              border: '1px solid var(--tblr-border)',
            }}
          >
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
              <button onClick={closeChat} className="p-1 rounded hover:bg-[var(--tblr-surface-2)] transition-colors">
                <IconX size={16} style={{ color: 'var(--tblr-muted)' }} />
              </button>
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
                    💡 Joignez un document avec 📎 pour l'analyser
                  </p>
                </div>
              )}
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} agentColor={activeAgent?.avatar_color ?? '#206bc4'} />
              ))}
              {loading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: activeAgent?.avatar_color ?? '#206bc4' }}>
                    <IconRobot size={13} color="white" />
                  </div>
                  <div className="px-3 py-2 rounded-xl flex gap-1 items-center" style={{ background: 'var(--tblr-surface-2)' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--tblr-muted)', animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
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
              {tokenBalance !== null && (
                <div className="text-[10px] mb-1.5 text-right" style={{ color: 'var(--tblr-muted)' }}>
                  {tokenBalance.toLocaleString('fr-FR')} tokens restants
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
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
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
