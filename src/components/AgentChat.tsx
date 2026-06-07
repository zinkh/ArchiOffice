import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRobot, IconX, IconSend, IconChevronDown, IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import type { Agent, AgentMessage } from '../types';

// ── Context ──────────────────────────────────────────────────────────────────

interface AgentChatContextValue {
  openChat: (agentId?: string) => void;
  closeChat: () => void;
}

const AgentChatContext = createContext<AgentChatContextValue>({ openChat: () => {}, closeChat: () => {} });

export function useAgentChat() {
  return useContext(AgentChatContext);
}

// ── Avatar helper ─────────────────────────────────────────────────────────────

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

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, agentColor }: { msg: AgentMessage; agentColor: string }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5"
          style={{ background: agentColor }}
        >
          <IconRobot size={13} color="white" />
        </div>
      )}
      <div
        className="max-w-[80%] px-3 py-2 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
        style={
          isUser
            ? { background: 'var(--tblr-primary)', color: 'white' }
            : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }
        }
      >
        {msg.content}
      </div>
    </div>
  );
}

// ── Main provider + panel ─────────────────────────────────────────────────────

export function AgentChatProvider({ children }: { children: React.ReactNode; }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeAgent: Agent | null = agents.find((a: Agent) => a.id === activeAgentId) ?? null;

  useEffect(() => {
    apiFetch('/api/agents')
      .then((data: Agent[]) => {
        const active = data.filter((a: Agent) => a.is_active);
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
      content: input.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages((prev: AgentMessage[]) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/agents/${activeAgentId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: userMsg.content }),
      });
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        conversation_id: '',
        tenant_id: '',
        role: 'assistant',
        content: res.reply,
        created_at: new Date().toISOString(),
      };
      setMessages((prev: AgentMessage[]) => [...prev, assistantMsg]);
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
      setMessages((prev: AgentMessage[]) => prev.filter((m: AgentMessage) => m.id !== userMsg.id));
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
        onClick={() => setIsOpen((o: boolean) => !o)}
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
              width: 'min(400px, calc(100vw - 24px))',
              height: 'min(600px, calc(100vh - 100px))',
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
                    onClick={() => setAgentSelectorOpen((o: boolean) => !o)}
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
