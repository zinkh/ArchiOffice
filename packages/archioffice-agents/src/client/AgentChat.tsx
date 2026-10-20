import { ChatRequestStatus, ConsultedAgentLinks, type AgentConsultation } from './ChatRequestStatus.js';
import { AttachedDocChips } from './AttachedDocChips.js';
import { uploadChatDocument } from './chatUpload.js';
import { useConversationReset } from './useConversationReset.js';
import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { projectIdFromPath, useOpenProjectTabs } from '@/src/lib/openProjectTabs';
import { motion, AnimatePresence } from 'motion/react';
import { IconRobot, IconX, IconSend, IconChevronDown, IconAlertTriangle, IconPaperclip, IconFileSpreadsheet, IconFileText, IconFileTypeCsv, IconFileTypePdf, IconDownload, IconX as IconClose, IconUpload, IconArrowsMaximize, IconArrowsMinimize, IconMicrophone, IconPlayerStopFilled, IconVolume, IconExternalLink, IconNote, IconPencil, IconBulb, IconCamera, IconFolderOpen, IconMessagePlus, IconArrowLeft } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/lib/api';
import { useEscapeKey } from '@/src/hooks/useEscapeKey';
import { formatCopilotSuggestion } from '@/src/lib/copilotSuggestions';
import { useDictation } from './useDictation.js';
import { useSpeech } from './useSpeech.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { markdownToPlainText } from './chatMarkdown.js';
import type { Speech } from './useSpeech.js';
import type { CopilotSuggestion, CopilotSuggestionRaw } from '@/src/lib/copilotSuggestions';
import type { Agent, AgentMessage, AgentArtifact } from '../types.js';

// ── Context ──────────────────────────────────────────────────────────────────

interface AgentChatContextValue {
  /**
   * Opens the chat panel. `draftMessage`, when given, prefills the input so
   * the user can review/edit an AI-suggested message before sending it —
   * callers should never use this to auto-send on the user's behalf.
   */
  openChat: (
    agentId?: string,
    draftMessage?: string,
    documents?: { id: string; name: string }[],
    projectId?: string,
  ) => void;
  closeChat: () => void;
  /** Re-fetches the proactive "next steps" suggestions shown on the floating badge. */
  refreshCopilotSuggestions: () => void;
}

const AgentChatContext = createContext<AgentChatContextValue>({ openChat: () => {}, closeChat: () => {}, refreshCopilotSuggestions: () => {} });

export function useAgentChat() {
  return useContext(AgentChatContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function AgentAvatar({ agent, size = 32 }: { agent: Agent; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full shrink-0 font-bold text-white"
      style={{ width: size, height: size, background: agent.avatar_color, fontSize: size * 0.35 }}
    >
      {agent.avatar_initials}
    </div>
  );
}

const ARTIFACT_ICONS: Record<string, React.ReactNode> = {
  excel: <IconFileSpreadsheet size={20} color="#217346" />,
  csv: <IconFileTypeCsv size={20} color="#217346" />,
  docx: <IconFileText size={20} color="#2b5797" />,
  pdf: <IconFileTypePdf size={20} color="#b02a2a" />,
};

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  excel: 'Fichier Excel',
  csv: 'Fichier CSV',
  docx: 'Document Word',
  pdf: 'Document PDF',
};

export function downloadArtifact(artifact: AgentArtifact): void {
  const bytes = Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Un clic ouvre l'aperçu (onPreview) quand la page qui l'affiche en propose
 * un — la page dédiée à deux volets, notamment — et télécharge directement
 * sinon, comme dans le panneau flottant où il n'y a pas d'endroit où
 * afficher un aperçu.
 */
export function ArtifactCard({ artifact, onPreview }: { artifact: AgentArtifact; onPreview?: (artifact: AgentArtifact) => void }) {
  const { t } = useTranslation();
  const action = t(onPreview ? 'agent_document_preview_named' : 'agent_document_download_named', { name: artifact.filename });
  return (
    <button
      type="button"
      aria-label={action}
      className="w-full min-h-11 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tblr-primary)] flex items-center gap-3 px-3 py-2.5 rounded-xl mt-2 border cursor-pointer hover:opacity-80 transition-opacity"
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
      onClick={() => (onPreview ? onPreview(artifact) : downloadArtifact(artifact))}
      title={action}
    >
      {ARTIFACT_ICONS[artifact.type] ?? <IconFileText size={20} />}
      <span className="block flex-1 min-w-0">
        <span className="block text-[12px] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{artifact.filename}</span>
        <span className="block text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
          {ARTIFACT_TYPE_LABELS[artifact.type] ?? 'Document'}
        </span>
      </span>
      {onPreview
        ? <IconArrowsMaximize size={14} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />
        : <IconDownload size={14} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />}
    </button>
  );
}

/** Arrivée d'un nouveau message : discrète, le chat servant plusieurs dizaines de fois par jour. */
const NEW_MESSAGE_SPRING = { type: 'spring', bounce: 0, visualDuration: 0.2 } as const;
const NEW_MESSAGE_WINDOW_MS = 4000;

// Feedback types
export type FeedbackKind = 'correction' | 'note' | 'improvement';


/**
 * Feedback Modal Component - allows users to provide structured feedback on agent responses
 * This enables the learning loop for agents to improve over time
 */
export function FeedbackModal({
  isOpen,
  onClose,
  onSubmit,
  kind,
  title,
  content,
  onTitleChange,
  onContentChange,
  submitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  kind: FeedbackKind;
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  useEscapeKey(isOpen && !submitting, onClose);

  // Labels for different feedback types
  const kindLabels: Record<FeedbackKind, string> = {
    correction: t('agent_feedback_correction'),
    note: t('agent_feedback_note'),
    improvement: t('agent_feedback_improvement'),
  };

  // Descriptions for each feedback type
  const kindDescriptions: Record<FeedbackKind, string> = {
    correction: t('agent_feedback_correction_desc'),
    note: t('agent_feedback_note_desc'),
    improvement: t('agent_feedback_improvement_desc'),
  };

  // Placeholders for title input
  const placeholders: Record<FeedbackKind, string> = {
    correction: t('agent_feedback_correction_placeholder'),
    note: t('agent_feedback_note_placeholder'),
    improvement: t('agent_feedback_improvement_placeholder'),
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-feedback-title"
        className="w-full max-w-md mx-4 rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 id="agent-feedback-title" className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>
                {kindLabels[kind]}
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>
                {kindDescriptions[kind]}
              </p>
            </div>
            <button 
              onClick={onClose} 
              className="p-1 rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors"
              title={t('close')}
              aria-label={t('close')}
            >
              <IconX size={18} style={{ color: 'var(--tblr-muted)' }} />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--tblr-text)' }}>
                {t('title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder={placeholders[kind]}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors focus:border-[var(--tblr-primary)]"
                style={{
                  background: 'var(--tblr-surface-2)',
                  borderColor: 'var(--tblr-border)',
                  color: 'var(--tblr-text)'
                }}
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--tblr-text)' }}>
                {t('details')}
              </label>
              <textarea
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                placeholder={t('agent_feedback_details_placeholder')}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none transition-colors focus:border-[var(--tblr-primary)]"
                style={{
                  background: 'var(--tblr-surface-2)',
                  borderColor: 'var(--tblr-border)',
                  color: 'var(--tblr-text)'
                }}
              />
            </div>
            
            <button
              onClick={onSubmit}
              disabled={!title.trim() || !content.trim() || submitting}
              className="w-full py-2.5 px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
              style={{ 
                background: 'var(--tblr-primary)', 
                color: 'white'
              }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t('sending')}
                </span>
              ) : (
                t('send_feedback')
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


export function MessageBubble({ msg, agentColor, speech, onPreviewArtifact, onFeedback }: {
  msg: AgentMessage & { artifact?: AgentArtifact; consulted?: AgentConsultation[] };
  agentColor: string;
  speech: Speech;
  onPreviewArtifact?: (artifact: AgentArtifact) => void;
  onFeedback?: (messageId: string, kind: FeedbackKind) => void;
}) {
  const { t } = useTranslation();
  const isUser = msg.role === 'user';
  // La lecture à voix haute ne sert que les réponses de l'agent : ce que
  // l'utilisateur a écrit, il vient de le formuler lui-même.
  const isSpeaking = !isUser && speech.activeId === msg.id;
  // Seul un message qui vient d'arriver glisse en place : l'historique
  // rechargé à l'ouverture d'une conversation s'affiche tel quel. Décidé une
  // fois, au montage, d'après l'âge du message.
  const [isNew] = useState(() => {
    const age = Date.now() - new Date(msg.created_at).getTime();
    return age >= 0 && age < NEW_MESSAGE_WINDOW_MS;
  });
  return (
    <motion.div
      className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      initial={isNew ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={NEW_MESSAGE_SPRING}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5" style={{ background: agentColor }}>
          <IconRobot size={13} color="white" />
        </div>
      )}
      <div className="max-w-[82%] group">
        <div
          className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed ${isUser ? 'whitespace-pre-wrap' : ''}`}
          style={
            isUser
              ? { background: 'var(--tblr-primary)', color: 'white' }
              : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }
          }
        >
          {isUser ? msg.content : <ChatMarkdown content={msg.content} />}
        </div>
        {msg.artifact && <ArtifactCard artifact={msg.artifact} onPreview={onPreviewArtifact} />}
        {!isUser && msg.content && (
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => speech.toggle(msg.id, markdownToPlainText(msg.content))}
              className="p-1 rounded transition-colors hover:bg-[var(--tblr-surface-2)] opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
              style={{ color: isSpeaking ? 'var(--tblr-primary)' : 'var(--tblr-muted)', opacity: isSpeaking ? 1 : undefined }}
              title={t('read_aloud')}
              aria-label={t('read_aloud')}
            >
              {isSpeaking && speech.status === 'loading' ? (
                <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
              ) : isSpeaking ? (
                <IconPlayerStopFilled size={14} />
              ) : (
                <IconVolume size={14} />
              )}
            </button>
            {onFeedback && (
              <>
                <button
                  onClick={() => onFeedback(msg.id, 'correction')}
                  className="p-1 rounded transition-colors hover:bg-[var(--tblr-surface-2)] opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
                  style={{ color: 'var(--tblr-muted)' }}
                  title={t('agent_feedback_correction')}
                  aria-label={t('agent_feedback_correction')}
                >
                  <IconPencil size={14} />
                </button>
                <button
                  onClick={() => onFeedback(msg.id, 'note')}
                  className="p-1 rounded transition-colors hover:bg-[var(--tblr-surface-2)] opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
                  style={{ color: 'var(--tblr-muted)' }}
                  title={t('agent_feedback_note')}
                  aria-label={t('agent_feedback_note')}
                >
                  <IconNote size={14} />
                </button>
                <button
                  onClick={() => onFeedback(msg.id, 'improvement')}
                  className="p-1 rounded transition-colors hover:bg-[var(--tblr-surface-2)] opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
                  style={{ color: 'var(--tblr-muted)' }}
                  title={t('agent_feedback_improvement')}
                  aria-label={t('agent_feedback_improvement')}
                >
                  <IconBulb size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Document picker ───────────────────────────────────────────────────────────

export interface DocMeta { id: string; name: string; phase?: string }

/** Raccorde une bribe dictée à ce qui est déjà dans la zone de saisie.
 *  La dictée complète le texte au lieu de le remplacer : on peut commencer au
 *  clavier, continuer à la voix, et reprendre au clavier. */
export function appendDictated(current: string, addition: string): string {
  const clean = addition.trim();
  if (!clean) return current;
  if (!current) return clean;
  return /\s$/.test(current) ? current + clean : `${current} ${clean}`;
}

const PICKER_ROW = 'w-full min-h-11 items-center gap-3 px-3 text-[0.8125rem] text-left hover:bg-[var(--tblr-surface-2)] transition-colors';
const UPLOAD_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ods,.odt,.csv,.txt';

/**
 * Trombone du chat : un petit menu plutôt qu'une simple liste. Sur téléphone il
 * n'y avait aucun moyen d'envoyer un fichier (seul le glisser-déposer existait,
 * et la liste ne montrait que des documents déjà dans la GED). Trois entrées :
 * prendre une photo (appareil, téléphone seulement), choisir un fichier, ou
 * reprendre un document du cabinet. Les pièces jointes s'affichent à part, par
 * AttachedDocChips.
 */
export function DocumentPicker({ attached, onAttach, onDetach, onUploading, onError }: {
  attached: DocMeta[];
  onAttach: (doc: DocMeta) => void;
  onDetach?: (id: string) => void;
  /** Nom du fichier en cours d'envoi, null une fois terminé. */
  onUploading?: (name: string | null) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'library'>('menu');
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const close = () => { setOpen(false); setView('menu'); };
  useEscapeKey(open, close);

  useEffect(() => {
    if (!open || view !== 'library') return;
    apiFetch('/api/documents?limit=30').then((d: any) => setDocs(d?.data ?? d ?? [])).catch(() => {});
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const uploadFiles = async (input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0) return;
    close();
    setBusy(true);
    try {
      for (const file of files) {
        onUploading?.(file.name);
        try { onAttach(await uploadChatDocument(file)); }
        catch { onError?.(t('agent_chat_upload_error') as string); }
      }
    } finally {
      setBusy(false);
      onUploading?.(null);
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={busy}
        className="relative inline-flex items-center justify-center w-11 h-11 rounded-lg transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-60"
        title={t('agent_document_attach') as string}
        aria-label={t('agent_document_attach')}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ color: attached.length > 0 ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}
      >
        {busy
          ? <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
          : <IconPaperclip size={20} />}
        {attached.length > 0 && !busy && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[0.6875rem] font-bold leading-none flex items-center justify-center text-white" style={{ background: 'var(--tblr-primary)' }}>
            {attached.length}
          </span>
        )}
      </button>
      <input ref={fileInputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" tabIndex={-1} onChange={e => uploadFiles(e.currentTarget)} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} onChange={e => uploadFiles(e.currentTarget)} />

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full mb-2 left-0 w-72 rounded-xl shadow-xl border overflow-hidden z-10"
            style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
          >
            {view === 'menu' ? (
              <>
                {/* L'appareil photo n'a de sens qu'au doigt : sur un poste de bureau, « capture » ouvre le sélecteur de fichiers. */}
                <button type="button" role="menuitem" onClick={() => cameraInputRef.current?.click()} className={`${PICKER_ROW} hidden pointer-coarse:flex`}>
                  <IconCamera size={18} style={{ color: 'var(--tblr-muted)' }} /> {t('agent_attach_photo')}
                </button>
                <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()} className={`${PICKER_ROW} flex`}>
                  <IconUpload size={18} style={{ color: 'var(--tblr-muted)' }} /> {t('agent_attach_file')}
                </button>
                <button type="button" role="menuitem" onClick={() => setView('library')} className={`${PICKER_ROW} flex`}>
                  <IconFolderOpen size={18} style={{ color: 'var(--tblr-muted)' }} /> {t('agent_attach_library')}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setView('menu')} className={`${PICKER_ROW} flex border-b font-semibold`} style={{ borderColor: 'var(--tblr-border)' }}>
                  <IconArrowLeft size={16} style={{ color: 'var(--tblr-muted)' }} /> {t('agent_attach_library')}
                </button>
                <div className="max-h-52 overflow-y-auto">
                  {docs.length === 0 && <p className="px-3 py-3 text-[0.75rem]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_attach_library_empty')}</p>}
                  {docs.map(doc => {
                    const isAttached = attached.some(a => a.id === doc.id);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => { if (isAttached) onDetach?.(doc.id); else onAttach(doc); close(); }}
                        className={`${PICKER_ROW} flex`}
                        style={{ color: isAttached ? 'var(--tblr-primary)' : 'var(--tblr-text)' }}
                      >
                        <IconFileText size={16} className="shrink-0" />
                        <span className="truncate flex-1">{doc.name}</span>
                        {doc.phase && <span className="text-[0.6875rem] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{doc.phase}</span>}
                        {isAttached && <span className="text-[0.6875rem] font-semibold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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

export function loadDraft(agentId: string): string {
  try {
    return localStorage.getItem(draftStorageKey(agentId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(agentId: string, value: string): void {
  try {
    if (value) localStorage.setItem(draftStorageKey(agentId), value);
    else localStorage.removeItem(draftStorageKey(agentId));
  } catch {
    // localStorage unavailable (private browsing, quota) — draft just won't persist.
  }
}

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // Affaire ouverte à l'écran : envoyée avec chaque message pour que l'agent
  // intervienne dessus par défaut (le serveur la revérifie dans le cabinet).
  const location = useLocation();
  const activeProjectId = projectIdFromPath(location.pathname);
  const onAgentChatPage = /^\/agents\/[^/]+\/chat$/.test(location.pathname);
  const activeProjectTab = useOpenProjectTabs().find(tab => tab.id === activeProjectId);
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<(AgentMessage & { artifact?: AgentArtifact; consulted?: AgentConsultation[] })[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [attachedDocs, setAttachedDocs] = useState<{ id: string; name: string }[]>([]);
  // Optional project context supplied by external entry points such as the
  // Android Web Share Target. On regular in-app opens, the route-derived
  // project remains authoritative.
  const [contextProjectId, setContextProjectId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [copilotSuggestions, setCopilotSuggestions] = useState<CopilotSuggestion[]>([]);
  // Les rappels restent repliés derrière une seule ligne d'alerte ; le choix
  // de les dérouler est mémorisé sur l'appareil.
  const [suggestionsOpen, setSuggestionsOpen] = useState(() => {
    try { return localStorage.getItem('agent_chat_suggestions_open') === '1'; } catch { return false; }
  });
  const setSuggestionsOpenRemembered = (open: boolean) => {
    setSuggestionsOpen(open);
    try { localStorage.setItem('agent_chat_suggestions_open', open ? '1' : '0'); } catch { /* stockage indisponible : sans conséquence */ }
  };
  // Feedback modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackMessageId, setFeedbackMessageId] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('note');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState(false);
  const dragCounterRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'user' | 'timeout' | null>(null);

  const activeAgent: Agent | null = agents.find(a => a.id === activeAgentId) ?? null;

  // Dictée vocale. Le texte reconnu se dépose dans la zone de saisie et s'y
  // arrête : c'est l'utilisateur qui relit et envoie. Voir useDictation.ts
  // pour les deux moteurs (reconnaissance du navigateur, ou enregistrement
  // transcrit par le serveur là où elle n'existe pas).
  const dictation = useDictation({
    language: i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR',
    agentId: activeAgentId,
    onTranscript: (text: string) => {
      setInput(prev => {
        const next = appendDictated(prev, text);
        if (activeAgentId) saveDraft(activeAgentId, next);
        return next;
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
  });

  // Synthèse vocale des réponses. Un bouton par message d'agent (voir
  // MessageBubble) ; voir useSpeech.ts pour les deux moteurs.
  const speech = useSpeech({
    language: i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR',
    agentId: activeAgentId,
  });
  // Le micro et le haut-parleur ne doivent jamais tourner ensemble : la voix
  // de l'agent serait captée par la dictée, et un enregistrement en cours
  // n'a pas à être couvert par une réponse qui se lit toute seule.
  useEffect(() => {
    if (dictation.status !== 'idle') speech.stop();
  }, [dictation.status, speech]);


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

  const openChat = useCallback((
    agentId?: string,
    draftMessage?: string,
    documents?: { id: string; name: string }[],
    projectId?: string,
  ): void => {
    if (agentId) {
      setActiveAgentId(agentId);
      if (!draftMessage) setInput(loadDraft(agentId));
    }
    if (draftMessage) setInput(draftMessage);
    if (documents?.length) {
      setAttachedDocs(prev => {
        const byId = new Map(prev.map(doc => [doc.id, doc]));
        documents.forEach(doc => byId.set(doc.id, doc));
        return Array.from(byId.values());
      });
    }
    setContextProjectId(projectId || null);
    setIsOpen(true);
    if (draftMessage) setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const closeChat = useCallback((): void => {
    setIsOpen(false);
    setAgentSelectorOpen(false);
    setExpanded(false);
    setContextProjectId(null);
    // Une réponse ne continue pas à se lire derrière un panneau refermé.
    speech.stop();
  }, [speech]);

  const sendMessage = async () => {
    if (!input.trim() || !activeAgentId || loading || loadingHistory || resetBusy) return;
    // Le micro ne reste pas ouvert par-dessus un envoi : la suite de la
    // dictée arriverait dans une zone que l'on vient de vider. Une lecture en
    // cours n'a pas non plus sa place pendant qu'une nouvelle réponse arrive.
    if (dictation.status !== 'idle') dictation.stop();
    speech.stop();
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
        body: JSON.stringify({
          message: rawInput,
          document_ids: docsToSend.map(d => d.id),
          active_project_id: contextProjectId ?? activeProjectId ?? undefined,
        }),
        signal: controller.signal,
      });
      const assistantMsg: AgentMessage & { artifact?: AgentArtifact; consulted?: AgentConsultation[] } = {
        id: crypto.randomUUID(),
        conversation_id: '',
        tenant_id: '',
        role: 'assistant',
        content: res.reply,
        artifact: res.artifact,
        consulted: res.consulted,
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
      const doc = await uploadChatDocument(file);
      setAttachedDocs(prev => prev.some(d => d.id === doc.id) ? prev : [...prev, doc]);
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

  const { resetConversation, resetBusy, clearing, resetDialog } = useConversationReset(activeAgentId, loading || loadingHistory, () => {
    speech.stop();
    setMessages([]);
    setErrorMsg(null);
    setAttachedDocs([]);
  }, setErrorMsg);

  // Le message de confirmation disparaît seul
  useEffect(() => {
    if (!feedbackNotice) return;
    const timer = setTimeout(() => setFeedbackNotice(false), 6000);
    return () => clearTimeout(timer);
  }, [feedbackNotice]);

  // Feedback handlers
  const handleFeedback = useCallback((messageId: string, kind: FeedbackKind) => {
    setFeedbackMessageId(messageId);
    setFeedbackKind(kind);
    setFeedbackTitle('');
    setFeedbackContent('');
    setFeedbackModalOpen(true);
  }, []);

  const submitFeedback = async () => {
    if (!feedbackMessageId || !feedbackTitle.trim() || !feedbackContent.trim() || !activeAgentId) return;
    setFeedbackSubmitting(true);
    try {
      await apiFetch('/api/agent-learning-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          as_agent_id: activeAgentId,
          kind: feedbackKind,
          title: feedbackTitle.trim(),
          content: feedbackContent.trim(),
        }),
      });
      setFeedbackModalOpen(false);
      setFeedbackMessageId(null);
      setFeedbackTitle('');
      setFeedbackContent('');
      setFeedbackNotice(true);
    } catch (e: any) {
      console.error('Feedback submission failed:', e);
      setErrorMsg(e?.message || t('agent_feedback_error'));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const closeFeedbackModal = () => {
    setFeedbackModalOpen(false);
    setFeedbackMessageId(null);
    setFeedbackTitle('');
    setFeedbackContent('');
  };

  const switchAgent = (agentId: string): void => {
    speech.stop();
    setActiveAgentId(agentId);
    setAgentSelectorOpen(false);
    setAttachedDocs([]);
    setInput(loadDraft(agentId));
  };

  return (
    <AgentChatContext.Provider value={{ openChat, closeChat, refreshCopilotSuggestions: loadCopilotSuggestions }}>
      {resetDialog}
      {children}

      {/* Floating trigger — desktop only : sur mobile, l'icône Agents de la
          pastille de raccourcis (MobileShortcutBar, src/App.tsx) rouvre ce
          même panneau via useAgentChat() plutôt que de dupliquer ce bouton. */}
      {/* Masqué sur la page de chat plein écran : posé en bas à droite, il recouvrait le bouton d'envoi. */}
      {!onAgentChatPage && (
        <button
          onClick={() => setIsOpen(o => !o)}
          className="hidden md:flex fixed bottom-6 right-6 z-40 items-center gap-2 px-4 py-2.5 rounded-full shadow-lg font-medium text-[13px] transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'var(--tblr-primary)', color: 'white' }}
          title={copilotSuggestions.length > 0 ? t('agent_chat_suggestions_badge', { count: copilotSuggestions.length }) : t('agents')}
        >
          <IconRobot size={18} />
          <span className="hidden sm:inline">{t('agents')}</span>
          {copilotSuggestions.length > 0 && (
            <span
              className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[0.6875rem] font-bold"
              style={{ background: '#e03131', color: 'white', minWidth: 18, height: 18, padding: '0 4px' }}
            >
              {copilotSuggestions.length}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, transform: 'translateX(40px)' }}
            animate={{ opacity: 1, transform: 'translateX(0px)' }}
            exit={{ opacity: 0, transform: 'translateX(40px)' }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="fixed right-3 md:right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden"
            style={expanded ? {
              bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
              width: 'min(900px, calc(100vw - 24px))',
              height: 'min(88dvh, calc(100dvh - 112px - env(safe-area-inset-bottom, 0px)))',
              background: 'var(--tblr-surface)',
              border: '1px solid var(--tblr-border)',
            } : {
              // Sur mobile, ce panneau s'ouvre depuis la pastille de
              // raccourcis flottante en bas d'écran (MobileShortcutBar) et
              // non plus depuis un bouton juste en dessous : il lui faut
              // une marge basse plus généreuse pour ne pas la recouvrir
              // (pastille de 60 px à 14 px du bas : 88 px de marge).
              bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
              width: 'min(420px, calc(100vw - 24px))',
              height: 'min(640px, calc(100dvh - 112px - env(safe-area-inset-bottom, 0px)))',
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
              className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
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
                <div className="text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                  {[
                    activeAgent?.role_title,
                    tokenBalance !== null ? t('agent_chat_credits', { amount: (tokenBalance / 100).toFixed(2) }) : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {/* « Nouvelle discussion » supprime la conversation en cours, après confirmation. */}
              <button
                type="button"
                onClick={resetConversation}
                disabled={loading || loadingHistory || resetBusy}
                className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-2 rounded-lg text-[0.75rem] font-medium hover:bg-[var(--tblr-surface-2)] disabled:opacity-50 disabled:cursor-wait transition-colors"
                style={{ color: 'var(--tblr-text)' }}
              >
                <IconMessagePlus size={18} style={{ color: 'var(--tblr-primary)' }} />
                {t(clearing ? 'agent_chat_clearing' : 'agent_chat_clear')}
              </button>
              {/* Dédié au poste de bureau : sur téléphone le panneau occupe déjà la largeur de l'écran. */}
              {activeAgent && (
                <button
                  onClick={() => { closeChat(); navigate(`/agents/${activeAgent.id}/chat`); }}
                  className="hidden md:inline-flex items-center justify-center min-h-9 min-w-9 rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors"
                  title={t('agent_chat_open_page') as string}
                  aria-label={t('agent_chat_open_page')}
                >
                  <IconExternalLink size={16} style={{ color: 'var(--tblr-muted)' }} />
                </button>
              )}
              <button
                onClick={() => setExpanded(e => !e)}
                className="hidden md:inline-flex items-center justify-center min-h-9 min-w-9 rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors"
                title={(expanded ? t('agent_chat_collapse') : t('agent_chat_expand')) as string}
                aria-label={(expanded ? t('agent_chat_collapse') : t('agent_chat_expand')) as string}
              >
                {expanded
                  ? <IconArrowsMinimize size={16} style={{ color: 'var(--tblr-muted)' }} />
                  : <IconArrowsMaximize size={16} style={{ color: 'var(--tblr-muted)' }} />}
              </button>
              <button onClick={closeChat} aria-label={t('close')} className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg hover:bg-[var(--tblr-surface-2)] transition-colors">
                <IconX size={18} style={{ color: 'var(--tblr-muted)' }} />
              </button>
            </div>

            {/* Standing AI-content disclosure (EU AI Act, art. 50) — kept
                short and always visible rather than repeated per message,
                since every reply and tool action in this panel is AI-generated. */}
            <div
              className="px-4 py-1.5 text-[0.6875rem] text-center border-b shrink-0"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
            >
              {t('agent_chat_ai_disclaimer')}
            </div>

            {/* Affaire ouverte à l'écran : cible par défaut des demandes à l'agent. */}
            {activeProjectId && (
              <div
                className="px-4 py-1.5 text-[12px] border-b shrink-0 truncate"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                title="Les demandes de cette conversation portent sur cette affaire, sauf si vous en nommez une autre."
              >
                <span style={{ color: 'var(--tblr-muted)' }}>Affaire active : </span>
                <span className="font-semibold">{[activeProjectTab?.code, activeProjectTab?.name].filter(Boolean).join(' ') || 'affaire ouverte'}</span>
              </div>
            )}

            {/* Agent selector dropdown */}
            <AnimatePresence>
              {agentSelectorOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute top-[60px] left-0 right-0 z-10 border-b shadow-sm"
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
            {copilotSuggestions.length > 0 && (
              <div className="border-b shrink-0" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                {/* Une seule ligne d'alerte ; la flèche déroule les rappels. */}
                <button
                  type="button"
                  onClick={() => setSuggestionsOpenRemembered(!suggestionsOpen)}
                  aria-expanded={suggestionsOpen}
                  aria-controls="agent-chat-suggestions"
                  className="w-full min-h-11 flex items-center gap-2.5 px-4 text-left text-[0.75rem] font-medium"
                  style={{ color: 'var(--tblr-text)' }}
                >
                  <IconAlertTriangle size={16} className="shrink-0" style={{ color: copilotSuggestions.some(s => s.tone === 'danger') ? 'var(--tblr-danger)' : 'var(--tblr-warning)' }} />
                  <span className="flex-1 truncate">{t('agent_chat_suggestions_count', { count: copilotSuggestions.length })}</span>
                  <IconChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${suggestionsOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--tblr-muted)' }} />
                </button>
                <AnimatePresence initial={false}>
                  {suggestionsOpen && (
                    <motion.div
                      id="agent-chat-suggestions"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                      className="overflow-hidden"
                    >
                      <ul className="px-3 pb-3 space-y-2 max-h-[40dvh] overflow-y-auto">
                        {copilotSuggestions.map(s => (
                          <li
                            key={s.id}
                            className="flex items-start gap-2 p-2 rounded-lg border"
                            style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
                          >
                            <IconAlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: s.tone === 'danger' ? 'var(--tblr-danger)' : 'var(--tblr-warning)' }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[0.75rem]" style={{ color: 'var(--tblr-text)' }}>{s.text}</p>
                              <button
                                onClick={() => { setInput(s.draft); setSuggestionsOpenRemembered(false); setTimeout(() => textareaRef.current?.focus(), 50); }}
                                className="mt-1 min-h-8 text-[0.75rem] font-semibold hover:underline"
                                style={{ color: 'var(--tblr-primary)' }}
                              >
                                {t('ai_draft_reminder_btn')}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                  <p className="text-[0.75rem] text-center px-6" style={{ color: 'var(--tblr-muted)' }}>
                    {t('agent_chat_empty_hint')}
                  </p>
                </div>
              )}
              {messages.map(msg => (
                <React.Fragment key={msg.id}>
                  <MessageBubble msg={msg} agentColor={activeAgent?.avatar_color ?? '#206bc4'} speech={speech} onFeedback={activeAgent?.learning_enabled ? handleFeedback : undefined} />
                  <ConsultedAgentLinks agents={msg.consulted} onOpen={switchAgent} disabled={loading || resetBusy} />
                </React.Fragment>
              ))}
              {loading && <ChatRequestStatus onStop={cancelRequest} />}
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
              {feedbackNotice && (
                <div role="status" className="mx-2 p-3 rounded-lg border text-[12px] flex items-center justify-between gap-2" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
                  <span>{t('agent_feedback_sent')}</span>
                  <button onClick={() => setFeedbackNotice(false)} aria-label={t('close')} className="p-0.5 rounded hover:bg-[var(--tblr-surface)]">
                    <IconX size={12} />
                  </button>
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
              {/* Ce que la reconnaissance entend en ce moment, pas encore
                  arrêté : affiché à part, en gris, pour qu'on voie que la
                  machine suit sans que ces mots provisoires se mêlent au
                  texte que l'on relira avant d'envoyer. */}
              {(dictation.status !== 'idle' || dictation.interim) && (
                <div className="flex items-center gap-2 text-[11px] mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                  {dictation.status === 'transcribing' ? (
                    <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
                  ) : (
                    <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: '#c92a2a' }} />
                  )}
                  <span className="truncate">
                    {dictation.interim || t(dictation.status === 'transcribing' ? 'agent_voice_transcribing' : 'agent_voice_listening')}
                  </span>
                </div>
              )}
              {dictation.error && (
                <div className="text-[11px] mb-1.5" style={{ color: '#c92a2a' }}>
                  {dictation.error === 'permission' ? t('agent_voice_error_permission')
                    : dictation.error === 'tokens' ? t('agent_tokens_exhausted')
                    : dictation.error === 'engine' ? t('agent_voice_error_engine')
                    : dictation.error}
                </div>
              )}
              {speech.error && (
                <div className="text-[11px] mb-1.5" style={{ color: '#c92a2a' }}>
                  {speech.error === 'tokens' ? t('agent_tokens_exhausted')
                    : speech.error === 'enterprise' ? t('enterprise_required')
                    : t('agent_speech_error')}
                </div>
              )}
              <AttachedDocChips attached={attachedDocs} onDetach={id => setAttachedDocs(prev => prev.filter(d => d.id !== id))} />
              <div className="flex gap-1 items-end">
                <DocumentPicker
                  attached={attachedDocs}
                  onAttach={doc => setAttachedDocs(prev => prev.some(d => d.id === doc.id) ? prev : [...prev, doc])}
                  onDetach={id => setAttachedDocs(prev => prev.filter(d => d.id !== id))}
                  onUploading={setUploadingFile}
                  onError={setErrorMsg}
                />
                {/* Rien à afficher sur un poste qui ne sait ni reconnaître ni
                    enregistrer : un bouton inerte vaut moins que pas de
                    bouton. */}
                {dictation.supported && (
                  <button
                    onClick={dictation.toggle}
                    disabled={loading || dictation.status === 'transcribing'}
                    className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-40"
                    title={t(dictation.status === 'listening' ? 'agent_voice_stop' : 'agent_voice_start')}
                    aria-label={t(dictation.status === 'listening' ? 'agent_voice_stop' : 'agent_voice_start')}
                    aria-pressed={dictation.status === 'listening'}
                    style={{ color: dictation.status === 'listening' ? '#c92a2a' : 'var(--tblr-muted)' }}
                  >
                    {dictation.status === 'listening'
                      ? <IconPlayerStopFilled size={18} />
                      : <IconMicrophone size={20} />}
                  </button>
                )}
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
                  aria-label={t('agent_chat_message_label')}
                  className="flex-1 min-w-0 resize-none rounded-lg px-3 py-[9px] text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] border transition-colors"
                  style={{
                    background: 'var(--tblr-surface-2)',
                    borderColor: 'var(--tblr-border)',
                    color: 'var(--tblr-text)',
                    minHeight: 44,
                    maxHeight: 100,
                  }}
                  onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
                  }}
                  disabled={loading || resetBusy}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading || loadingHistory || resetBusy}
                  className="w-11 h-11 shrink-0 rounded-lg transition-colors flex items-center justify-center"
                  style={{ background: 'var(--tblr-primary)', color: 'white', opacity: !input.trim() || loading || loadingHistory || resetBusy ? 0.5 : 1 }}
                  title={`${t('agent_chat_send')} (Ctrl+Entrée)`}
                  aria-label={t('agent_chat_send')}
                >
                  <IconSend size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Feedback Modal */}
      <AnimatePresence>
        {feedbackModalOpen && (
          <FeedbackModal
            isOpen={feedbackModalOpen}
            onClose={closeFeedbackModal}
            onSubmit={submitFeedback}
            kind={feedbackKind}
            title={feedbackTitle}
            content={feedbackContent}
            onTitleChange={setFeedbackTitle}
            onContentChange={setFeedbackContent}
            submitting={feedbackSubmitting}
          />
        )}
      </AnimatePresence>
    </AgentChatContext.Provider>
  );
}
