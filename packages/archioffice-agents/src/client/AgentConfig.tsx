import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconRobot, IconChevronDown, IconAlertTriangle } from '@tabler/icons-react';
import { apiFetch } from '@/src/lib/api';
import type { Agent, AgentContextScope, AgentActionScope } from '../types.js';
import { AGENT_RESOURCES } from '../types.js';

const AVATAR_COLORS = ['#206bc4', '#2fb344', '#f76707', '#ae3ec9', '#1098ad', '#e8590c'];

const SCOPES: { key: AgentContextScope; label: string }[] = [
  { key: 'projects',  label: 'Projets' },
  { key: 'meetings',  label: 'Réunions & Agenda' },
  { key: 'contacts',  label: 'Contacts' },
  { key: 'documents', label: 'Documents' },
  { key: 'tasks',     label: 'Tâches' },
  { key: 'firm_knowledge', label: 'Historique du cabinet (durées de phase, prix, CCTP de référence)' },
];

// One toggle per resource grants that resource's full create/update/delete
// surface — the same surface a human has in that section of the app.
const ALL_ACTION_KEYS: AgentActionScope[] = AGENT_RESOURCES.map(r => r.key);

export default function AgentConfig() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [avatarInitials, setAvatarInitials] = useState('');
  const [avatarColor, setAvatarColor] = useState('#206bc4');
  const [tone, setTone] = useState('');
  const [directives, setDirectives] = useState('');
  const [contextScopes, setContextScopes] = useState<AgentContextScope[]>([]);
  const [actionScopes, setActionScopes] = useState<AgentActionScope[]>([]);
  const [webFetchEnabled, setWebFetchEnabled] = useState(false);
  const [systemPromptOverride, setSystemPromptOverride] = useState('');

  useEffect(() => {
    apiFetch(`/api/agents`)
      .then((agents: Agent[]) => {
        const found = agents.find(a => a.id === id);
        if (!found) { navigate('/agents'); return; }
        setAgent(found);
        setName(found.name);
        setRoleTitle(found.role_title);
        setAvatarInitials(found.avatar_initials);
        setAvatarColor(found.avatar_color);
        setTone(found.tone ?? '');
        setDirectives(found.directives ?? '');
        setContextScopes(found.context_scopes as AgentContextScope[]);
        setActionScopes((found.action_scopes ?? []) as AgentActionScope[]);
        setWebFetchEnabled(!!found.web_fetch_enabled);
        setSystemPromptOverride(found.system_prompt_override ?? '');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const toggleScope = (scope: AgentContextScope) => {
    setContextScopes((prev: AgentContextScope[]) =>
      prev.includes(scope) ? prev.filter((s: AgentContextScope) => s !== scope) : [...prev, scope]
    );
  };

  const toggleActionScope = (scope: AgentActionScope) => {
    setActionScopes((prev: AgentActionScope[]) =>
      prev.includes(scope) ? prev.filter((s: AgentActionScope) => s !== scope) : [...prev, scope]
    );
  };

  const allActionsSelected = ALL_ACTION_KEYS.every(k => actionScopes.includes(k));
  const toggleAllActionScopes = () => {
    setActionScopes(allActionsSelected ? [] : [...ALL_ACTION_KEYS]);
  };

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await apiFetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name, role_title: roleTitle, avatar_initials: avatarInitials,
          avatar_color: avatarColor, tone, directives,
          context_scopes: contextScopes,
          action_scopes: actionScopes,
          web_fetch_enabled: webFetchEnabled,
          system_prompt_override: systemPromptOverride || null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const handleDeactivate = async () => {
    if (!agent || !confirm(`Désactiver ${agent.name} ?`)) return;
    await apiFetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
    navigate('/agents');
  };

  const handleResetConversations = async () => {
    if (!agent || !confirm('Réinitialiser toutes les conversations de cet agent ?')) return;
    await apiFetch(`/api/agents/${agent.id}/conversation`, { method: 'DELETE' });
    alert('Conversations réinitialisées.');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/agents')} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)] transition-colors">
          <IconArrowLeft size={18} style={{ color: 'var(--tblr-muted)' }} />
        </button>
        <div className="flex items-center gap-2">
          <IconRobot size={20} style={{ color: 'var(--tblr-primary)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_title')}</h1>
        </div>
      </div>

      {/* Identity */}
      <section className="p-5 rounded-xl border space-y-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_identity')}</h2>

        {/* Avatar preview + color */}
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center rounded-full font-bold text-white"
            style={{ width: 52, height: 52, background: avatarColor, fontSize: 18 }}
          >
            {avatarInitials || '?'}
          </div>
          <div className="flex gap-2">
            {AVATAR_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                className="w-7 h-7 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: avatarColor === c ? 'var(--tblr-text)' : 'transparent' }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Nom</label>
            <input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="w-full px-3 py-1.5 rounded-lg border text-[13px] outline-none" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }} />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Initiales</label>
            <input value={avatarInitials} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAvatarInitials(e.target.value.slice(0, 3).toUpperCase())} maxLength={3} className="w-full px-3 py-1.5 rounded-lg border text-[13px] outline-none" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }} />
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Titre du rôle</label>
          <input value={roleTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleTitle(e.target.value)} className="w-full px-3 py-1.5 rounded-lg border text-[13px] outline-none" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }} />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Ton</label>
          <input value={tone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTone(e.target.value)} placeholder="Ex : Professionnel, organisé, accueillant" className="w-full px-3 py-1.5 rounded-lg border text-[13px] outline-none" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }} />
        </div>
      </section>

      {/* Directives */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_directives')}</h2>
        <textarea
          value={directives}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDirectives(e.target.value)}
          rows={5}
          placeholder="Ex : Vérifier toujours la disponibilité avant de confirmer un rendez-vous."
          className="w-full px-3 py-2 rounded-lg border text-[13px] outline-none resize-none"
          style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        />
      </section>

      {/* Scopes */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_scopes')}</h2>
        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
          « Historique du cabinet » ajoute des données agrégées (durées, prix, extraits de CCTP) à chaque message — n'active que pour les agents qui en ont vraiment besoin.
        </p>
        <div className="space-y-2">
          {SCOPES.map(scope => (
            <label key={scope.key} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={contextScopes.includes(scope.key)}
                onChange={() => toggleScope(scope.key)}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--tblr-primary)' }}
              />
              <span className="text-[13px]" style={{ color: 'var(--tblr-text)' }}>{scope.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Actions — write permissions */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_actions')}</h2>
          <button
            onClick={toggleAllActionScopes}
            className="text-[12px] font-medium hover:underline shrink-0"
            style={{ color: 'var(--tblr-primary)' }}
          >
            {allActionsSelected ? t('agent_config_actions_clear_all') : t('agent_config_actions_select_all')}
          </button>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_config_actions_hint')}</p>
        <div className="space-y-2">
          {AGENT_RESOURCES.map(scope => (
            <label key={scope.key} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={actionScopes.includes(scope.key)}
                onChange={() => toggleActionScope(scope.key)}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--tblr-primary)' }}
              />
              <span className="text-[13px]" style={{ color: 'var(--tblr-text)' }}>{scope.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Web access — high-risk capability, off by default */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: '#ffc9c9' }}>
        <h2 className="font-semibold text-[14px]" style={{ color: '#c92a2a' }}>{t('agent_config_web_fetch')}</h2>
        <div className="flex items-start gap-2.5 p-3 rounded-lg" style={{ background: 'rgba(201,42,42,0.06)', border: '1px solid #ffc9c9' }}>
          <IconAlertTriangle size={18} style={{ color: '#c92a2a', flexShrink: 0, marginTop: 1 }} />
          <p className="text-[12px] leading-snug" style={{ color: '#c92a2a' }}>{t('agent_config_web_fetch_warning')}</p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={webFetchEnabled}
            onChange={() => setWebFetchEnabled((v: boolean) => !v)}
            className="w-4 h-4 rounded"
            style={{ accentColor: '#c92a2a' }}
          />
          <span className="text-[13px] font-medium" style={{ color: 'var(--tblr-text)' }}>{t('agent_config_web_fetch_toggle')}</span>
        </label>
      </section>

      {/* Advanced prompt */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <button
          onClick={() => setShowAdvanced((o: boolean) => !o)}
          className="flex items-center gap-2 font-semibold text-[14px] w-full"
          style={{ color: 'var(--tblr-text)' }}
        >
          <IconChevronDown size={14} className={`transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
          {t('agent_config_prompt')}
        </button>
        {showAdvanced && (
          <>
            <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_config_prompt_hint')}</p>
            <textarea
              value={systemPromptOverride}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPromptOverride(e.target.value)}
              rows={8}
              placeholder="Laisser vide pour utiliser le prompt auto-généré…"
              className="w-full px-3 py-2 rounded-lg border text-[12px] font-mono outline-none resize-none"
              style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            />
          </>
        )}
      </section>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-lg font-medium text-[14px] transition-colors"
        style={{ background: 'var(--tblr-primary)', color: 'white', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Enregistrement…' : saved ? '✓ Enregistré' : t('agent_config_save')}
      </button>

      {/* Danger zone */}
      <section className="p-5 rounded-xl border space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: '#ffc9c9' }}>
        <h2 className="font-semibold text-[14px]" style={{ color: '#c92a2a' }}>{t('agent_config_danger')}</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleResetConversations}
            className="px-4 py-2 rounded-lg border text-[13px] transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            style={{ borderColor: '#ffc9c9', color: '#c92a2a' }}
          >
            {t('agent_config_reset_conv')}
          </button>
          <button
            onClick={handleDeactivate}
            className="px-4 py-2 rounded-lg border text-[13px] transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            style={{ borderColor: '#ffc9c9', color: '#c92a2a' }}
          >
            {t('agent_config_deactivate')}
          </button>
        </div>
      </section>
    </div>
  );
}
