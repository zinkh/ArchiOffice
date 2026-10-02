import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBulb, IconCheck, IconX, IconSettings } from '@tabler/icons-react';
import { apiFetch } from '@/src/lib/api';

interface SuggestionRow {
  id: string;
  agent_id: string;
  kind: 'correction' | 'missing_capability' | 'knowledge_note';
  title: string;
  content: string;
  suggested_capability: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  agent: { id: string; name: string; role_title: string } | null;
}

const KIND_LABELS: Record<SuggestionRow['kind'], string> = {
  correction: 'Correction à retenir',
  missing_capability: 'Capacité manquante',
  knowledge_note: 'Note pour la bibliothèque',
};

const cardStyle = { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' };

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// L'approbation ne retient QUE 'correction' et 'knowledge_note' comme mémoire
// (voir buildAgentContext) — une 'missing_capability' approuvée ne fait rien
// d'automatique côté agent : elle sert seulement à documenter que l'architecte
// a vu la demande et sait quelle capacité l'agent réclame. L'activer reste un
// geste volontaire depuis /agents/:id/edit, jamais déclenché par cet écran.
export default function AgentLearning() {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showReviewed, setShowReviewed] = useState(false);

  const load = useCallback(async () => {
    const rows = await apiFetch(showReviewed ? '/api/agent-learning-suggestions' : '/api/agent-learning-suggestions?status=pending').catch(() => []);
    setSuggestions(rows as SuggestionRow[]);
  }, [showReviewed]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const review = async (id: string, action: 'approve' | 'reject') => {
    setError('');
    try {
      await apiFetch(`/api/agent-learning-suggestions/${id}`, { method: 'PUT', body: JSON.stringify({ action }) });
      await load();
    } catch (e: any) {
      setError(e?.message || 'La validation a échoué.');
    }
  };

  const pending = suggestions.filter(s => s.status === 'pending');
  const reviewed = suggestions.filter(s => s.status !== 'pending');

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/agents" className="p-2 rounded-lg border" style={cardStyle} aria-label="Retour">
          <IconArrowLeft size={16} style={{ color: 'var(--tblr-text)' }} />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold text-[18px] flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
            <IconBulb size={18} /> {t('agent_learning_title')}
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_learning_subtitle')}</p>
        </div>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--tblr-muted)' }}>
          <input type="checkbox" checked={showReviewed} onChange={() => setShowReviewed(v => !v)} className="w-3.5 h-3.5 rounded" style={{ accentColor: 'var(--tblr-primary)' }} />
          {t('agent_learning_show_reviewed')}
        </label>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-[12px]" style={{ background: 'rgba(201,42,42,0.06)', border: '1px solid #ffc9c9', color: '#c92a2a' }}>{error}</div>
      )}

      <section className="p-5 rounded-xl border space-y-3" style={cardStyle}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>
          {t('agent_learning_pending')} ({pending.length})
        </h2>
        {pending.length === 0 && <p className="text-[13px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_learning_none')}</p>}
        <div className="space-y-2">
          {pending.map(s => (
            <div key={s.id} className="p-3 rounded-lg border" style={cardStyle}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--tblr-primary)' }}>{KIND_LABELS[s.kind]}</div>
                  <div className="text-[13px] font-medium mt-0.5" style={{ color: 'var(--tblr-text)' }}>{s.title}</div>
                  <p className="text-[12px] mt-1 whitespace-pre-wrap" style={{ color: 'var(--tblr-muted)' }}>{s.content}</p>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                    {s.agent ? `${s.agent.name} — ${s.agent.role_title}` : 'Agent inconnu'} · {formatDate(s.created_at)}
                  </div>
                  {s.kind === 'missing_capability' && s.suggested_capability && (
                    <Link
                      to={`/agents/${s.agent_id}/edit`}
                      className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-medium hover:underline"
                      style={{ color: 'var(--tblr-primary)' }}
                    >
                      <IconSettings size={12} /> {t('agent_learning_go_to_settings')} ({s.suggested_capability})
                    </Link>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => review(s.id, 'approve')} title={t('agent_learning_approve')} className="p-1.5 rounded border" style={cardStyle}>
                    <IconCheck size={14} style={{ color: '#2fb344' }} />
                  </button>
                  <button onClick={() => review(s.id, 'reject')} title={t('agent_learning_reject')} className="p-1.5 rounded border" style={cardStyle}>
                    <IconX size={14} style={{ color: '#c92a2a' }} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showReviewed && (
        <section className="p-5 rounded-xl border space-y-3" style={cardStyle}>
          <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_learning_reviewed')}</h2>
          {reviewed.length === 0 && <p className="text-[13px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_learning_none')}</p>}
          <div className="space-y-2">
            {reviewed.map(s => (
              <div key={s.id} className="p-3 rounded-lg border opacity-70" style={cardStyle}>
                <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>
                  {KIND_LABELS[s.kind]} · {s.status === 'approved' ? t('agent_learning_approved') : t('agent_learning_rejected')}
                </div>
                <div className="text-[13px] font-medium mt-0.5" style={{ color: 'var(--tblr-text)' }}>{s.title}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                  {s.agent ? s.agent.name : 'Agent inconnu'} · {formatDate(s.created_at)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
