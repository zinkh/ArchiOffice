// Page dédiée à la conversation avec un agent — /agents/:id/chat.
//
// Le panneau flottant (AgentChat.tsx) reste l'accès rapide depuis n'importe
// quelle page ; celle-ci est la destination quand on vient du catalogue pour
// travailler vraiment avec un agent, avec assez de place pour lire un
// document produit sans quitter la conversation. Elle se scinde en deux
// UNIQUEMENT quand un artefact existe : tant qu'aucun document n'a été
// produit, la conversation garde toute la largeur, comme le reste de
// l'application le fait déjà pour l'écran plein (voir ProjectDetail.tsx et
// isFullBleedRoute dans App.tsx, dont cette page reprend le même principe de
// mise en page en colonnes avec défilement propre à chacune).
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft, IconRobot, IconChevronDown, IconAlertTriangle, IconSend, IconDownload,
  IconFileSpreadsheet, IconFileText, IconFileTypeCsv, IconFileTypePdf, IconX, IconMicrophone,
  IconPlayerStopFilled, IconRefresh,
} from '@tabler/icons-react';
import { apiFetch } from '@/src/lib/api';
import {
  AgentAvatar, MessageBubble, DocumentPicker, downloadArtifact, ARTIFACT_TYPE_LABELS,
  loadDraft, saveDraft, appendDictated,
} from './AgentChat.js';
import type { DocMeta } from './AgentChat.js';
import { useDictation } from './useDictation.js';
import { useSpeech } from './useSpeech.js';
import type { Agent, AgentMessage, AgentArtifact } from '../types.js';

const ARTIFACT_ICONS: Record<string, React.ReactNode> = {
  excel: <IconFileSpreadsheet size={40} color="#217346" />,
  csv: <IconFileTypeCsv size={40} color="#217346" />,
  docx: <IconFileText size={40} color="#2b5797" />,
  pdf: <IconFileTypePdf size={40} color="#b02a2a" />,
};

/** Décode un artefact CSV (toujours produit avec chaque champ entre
 *  guillemets, voir server/artifacts.ts::rowsToCsv) en tableau de lignes. */
function parseCsvPreview(base64: string): string[][] {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  return text
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.slice(1, -1).split('","').map(cell => cell.replace(/""/g, '"')));
}

function ArtifactPanel({ artifact, onClose }: { artifact: AgentArtifact; onClose: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (artifact.type !== 'pdf') { setPdfUrl(null); return; }
    const bytes = Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);

  const csvRows = useMemo(() => (artifact.type === 'csv' ? parseCsvPreview(artifact.data) : null), [artifact]);

  return (
    <div className="flex flex-col h-full lg:min-h-0" style={{ background: 'var(--tblr-surface)' }}>
      <div
        className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--tblr-border)' }}
      >
        {ARTIFACT_ICONS[artifact.type] ? (
          <span style={{ display: 'flex' }}>{ARTIFACT_ICONS[artifact.type]}</span>
        ) : null}
        <div className="flex-1 min-w-0 ml-1">
          <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{artifact.filename}</div>
          <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{ARTIFACT_TYPE_LABELS[artifact.type] ?? 'Document'}</div>
        </div>
        <button
          onClick={() => downloadArtifact(artifact)}
          className="p-1.5 rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors"
          title="Télécharger"
        >
          <IconDownload size={16} style={{ color: 'var(--tblr-muted)' }} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors"
          title="Fermer l'aperçu"
        >
          <IconX size={16} style={{ color: 'var(--tblr-muted)' }} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {artifact.type === 'pdf' && pdfUrl && (
          <iframe src={pdfUrl} title={artifact.filename} className="w-full h-full border-0" />
        )}
        {artifact.type === 'csv' && csvRows && (
          <table className="w-full text-[12px] border-collapse">
            <tbody>
              {csvRows.map((row, i) => (
                <tr key={i} className={i === 0 ? 'font-semibold' : ''} style={i > 0 && i % 2 === 0 ? { background: 'var(--tblr-surface-2)' } : undefined}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-2 py-1 border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(artifact.type === 'docx' || artifact.type === 'excel') && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            {ARTIFACT_ICONS[artifact.type]}
            <p className="text-[13px] font-medium" style={{ color: 'var(--tblr-text)' }}>{artifact.filename}</p>
            <p className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
              Aperçu non disponible pour ce format — téléchargez le fichier pour l'ouvrir.
            </p>
            <button
              onClick={() => downloadArtifact(artifact)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium"
              style={{ background: 'var(--tblr-primary)', color: 'white' }}
            >
              <IconDownload size={15} /> Télécharger
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentChatPage() {
  const { id: agentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [messages, setMessages] = useState<(AgentMessage & { artifact?: AgentArtifact })[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [attachedDocs, setAttachedDocs] = useState<DocMeta[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<AgentArtifact | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeAgent: Agent | null = agents.find(a => a.id === agentId) ?? null;

  const dictation = useDictation({
    language: i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR',
    agentId: agentId ?? null,
    onTranscript: (text: string) => {
      setInput(prev => {
        const next = appendDictated(prev, text);
        if (agentId) saveDraft(agentId, next);
        return next;
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
  });
  const speech = useSpeech({ language: i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR', agentId: agentId ?? null });
  useEffect(() => { if (dictation.status !== 'idle') speech.stop(); }, [dictation.status, speech]);

  useEffect(() => {
    apiFetch('/api/agents')
      .then((data: Agent[]) => setAgents(data.filter(a => a.is_active)))
      .catch(() => {});
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingHistory(true);
    setMessages([]);
    setSelectedArtifact(null);
    setErrorMsg(null);
    setInput(loadDraft(id));
    try {
      const data = await apiFetch(`/api/agents/${id}/conversation`);
      const msgs: (AgentMessage & { artifact?: AgentArtifact })[] = data.messages || [];
      setMessages(msgs);
      // Rouvrir la page sur le dernier document produit plutôt que de
      // forcer l'utilisateur à remonter toute la conversation pour le
      // retrouver — c'est justement ce que la page à deux volets sert à
      // garder sous les yeux.
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].artifact) { setSelectedArtifact(msgs[i].artifact!); break; }
      }
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

  useEffect(() => { if (agentId) loadConversation(agentId); }, [agentId, loadConversation]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const sendMessage = async () => {
    if (!input.trim() || !agentId || loading) return;
    if (dictation.status !== 'idle') dictation.stop();
    speech.stop();
    const rawInput = input.trim();
    const userMsg: AgentMessage = {
      id: crypto.randomUUID(), conversation_id: '', tenant_id: '', role: 'user',
      content: rawInput + (attachedDocs.length > 0 ? `\n\n📎 Documents joints : ${attachedDocs.map(d => d.name).join(', ')}` : ''),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const docsToSend = [...attachedDocs];
    setAttachedDocs([]);
    setLoading(true);
    setErrorMsg(null);

    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 130000);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: rawInput, document_ids: docsToSend.map(d => d.id) }),
        signal: controller.signal,
      });
      const assistantMsg: AgentMessage & { artifact?: AgentArtifact } = {
        id: crypto.randomUUID(), conversation_id: '', tenant_id: '', role: 'assistant',
        content: res.reply, artifact: res.artifact, created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (res.artifact) setSelectedArtifact(res.artifact);
      if (res.remaining_balance !== undefined) setTokenBalance(res.remaining_balance);
      saveDraft(agentId, '');
    } catch (e: any) {
      const errText: string = e?.message ?? t('agent_chat_error');
      if (e?.name === 'AbortError') setErrorMsg(t('agent_chat_timeout'));
      else if (errText.includes('token') || errText.includes('NO_TOKENS')) setErrorMsg('tokens');
      else setErrorMsg(errText);
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      setInput(rawInput);
      setAttachedDocs(docsToSend);
      saveDraft(agentId, rawInput);
    } finally {
      clearTimeout(hardTimeout);
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const resetConversation = async () => {
    if (!agentId) return;
    speech.stop();
    try { await apiFetch(`/api/agents/${agentId}/conversation`, { method: 'DELETE' }); } catch {}
    setMessages([]);
    setSelectedArtifact(null);
    setErrorMsg(null);
    setAttachedDocs([]);
  };

  const switchAgent = (id: string) => {
    speech.stop();
    setAgentSelectorOpen(false);
    navigate(`/agents/${id}/chat`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendMessage(); }
  };

  if (!agentId) return null;

  return (
    <div className="flex flex-col lg:h-full">
      {/* Topbar — même traitement que ProjectDetail.tsx (bouton retour, identité, actions) */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <Link
          to="/agents"
          className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)] shrink-0"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
          title={t('agents') as string}
        >
          <IconArrowLeft size={18} />
        </Link>
        {activeAgent && <AgentAvatar agent={activeAgent} size={32} />}
        <div className="flex-1 min-w-0 relative">
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
          <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{activeAgent?.role_title ?? ''}</div>

          {agentSelectorOpen && (
            <div
              className="absolute top-full mt-1 left-0 w-64 z-10 border rounded-xl shadow-lg overflow-hidden"
              style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
            >
              {agents.map(a => (
                <button
                  key={a.id}
                  onClick={() => switchAgent(a.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-[var(--tblr-surface-2)] transition-colors text-left"
                  style={{ color: a.id === agentId ? 'var(--tblr-primary)' : 'var(--tblr-text)' }}
                >
                  <AgentAvatar agent={a} size={24} />
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{a.role_title}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {tokenBalance !== null && (
          <div className="hidden sm:block text-[11px] shrink-0" style={{ color: 'var(--tblr-muted)' }}>
            {(tokenBalance / 100).toFixed(2)} € de crédits IA restants
          </div>
        )}
        <button
          onClick={resetConversation}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] shrink-0 hover:bg-[var(--tblr-surface-2)] transition-colors"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
        >
          <IconRefresh size={13} /> {t('agent_chat_new')}
        </button>
      </div>

      {/* Standing AI-content disclosure, comme dans le panneau flottant. */}
      <div
        className="shrink-0 px-4 py-1.5 text-[10px] text-center border-b"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
      >
        {t('agent_chat_ai_disclaimer')}
      </div>

      {/* Corps : scindé en deux SEULEMENT quand un artefact est sélectionné. */}
      <div className={`flex-1 lg:min-h-0 flex flex-col ${selectedArtifact ? 'lg:flex-row' : ''} lg:overflow-hidden`}>
        <div className={`flex flex-col lg:min-h-0 ${selectedArtifact ? 'lg:w-1/2 lg:border-r' : 'flex-1'}`} style={selectedArtifact ? { borderColor: 'var(--tblr-border)' } : undefined}>
          <div className="flex-1 lg:min-h-0 overflow-y-auto px-4 py-3 space-y-3">
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
              <MessageBubble
                key={msg.id}
                msg={msg}
                agentColor={activeAgent?.avatar_color ?? '#206bc4'}
                speech={speech}
                onPreviewArtifact={setSelectedArtifact}
              />
            ))}
            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: activeAgent?.avatar_color ?? '#206bc4' }}>
                  <IconRobot size={13} color="white" />
                </div>
                <div className="px-3 py-2 rounded-xl flex gap-1 items-center" style={{ background: 'var(--tblr-surface-2)' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--tblr-muted)', animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
            {errorMsg === 'tokens' ? (
              <div className="mx-2 p-3 rounded-lg border text-[12px]" style={{ background: '#fff4e6', borderColor: '#ffd8a8', color: '#f76707' }}>
                <div className="flex items-center gap-2 font-semibold mb-1"><IconAlertTriangle size={14} /> {t('agent_tokens_exhausted')}</div>
                <Link to="/billing" className="underline font-medium">{t('agent_tokens_recharge')}</Link>
              </div>
            ) : errorMsg ? (
              <div className="mx-2 p-3 rounded-lg border text-[12px]" style={{ background: '#fff5f5', borderColor: '#ffc9c9', color: '#c92a2a' }}>
                {errorMsg}
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {/* Footer de saisie */}
          <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--tblr-border)' }}>
            {(dictation.status !== 'idle' || dictation.interim) && (
              <div className="flex items-center gap-2 text-[11px] mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: '#c92a2a' }} />
                <span className="truncate">{dictation.interim || t(dictation.status === 'transcribing' ? 'agent_voice_transcribing' : 'agent_voice_listening')}</span>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <DocumentPicker
                attached={attachedDocs}
                onAttach={doc => setAttachedDocs(prev => prev.some(d => d.id === doc.id) ? prev : [...prev, doc])}
                onDetach={id => setAttachedDocs(prev => prev.filter(d => d.id !== id))}
              />
              {dictation.supported && (
                <button
                  onClick={dictation.toggle}
                  disabled={loading || dictation.status === 'transcribing'}
                  className="p-1.5 rounded-lg transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-40"
                  title={t(dictation.status === 'listening' ? 'agent_voice_stop' : 'agent_voice_start') as string}
                  style={{ color: dictation.status === 'listening' ? '#c92a2a' : 'var(--tblr-muted)' }}
                >
                  {dictation.status === 'listening' ? <IconPlayerStopFilled size={15} /> : <IconMicrophone size={15} />}
                </button>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => { setInput(e.target.value); if (agentId) saveDraft(agentId, e.target.value); }}
                onKeyDown={handleKeyDown}
                placeholder={t('agent_chat_placeholder') as string}
                className="flex-1 resize-none rounded-lg px-3 py-2 text-[13px] outline-none border transition-colors"
                style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', minHeight: 36, maxHeight: 140 }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
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
          </div>
        </div>

        {selectedArtifact && (
          <div className="lg:w-1/2 lg:min-h-0" style={{ height: '50vh' }}>
            <div className="h-full lg:h-full">
              <ArtifactPanel artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
