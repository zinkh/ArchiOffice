import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconRobot, IconMessageCircle, IconPencil, IconPlus, IconCheck } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';
import { useAgentChat } from '../components/AgentChat';
import type { Agent } from '../types';

function AgentAvatar({ agent, size = 44 }: { agent: Agent; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{ width: size, height: size, background: agent.avatar_color, fontSize: size * 0.35 }}
    >
      {agent.avatar_initials}
    </div>
  );
}

function AgentCard({ agent, isAdmin, onActivate }: { agent: Agent; isAdmin: boolean; onActivate?: (id: string) => void }) {
  const { t } = useTranslation();
  const { openChat } = useAgentChat();
  const [activating, setActivating] = useState(false);

  const handleActivate = async () => {
    if (!onActivate) return;
    setActivating(true);
    await onActivate(agent.id);
    setActivating(false);
  };

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl border transition-shadow hover:shadow-md"
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate" style={{ color: 'var(--tblr-text)' }}>{agent.name}</div>
          <div className="text-[12px] truncate" style={{ color: 'var(--tblr-muted)' }}>{agent.role_title}</div>
          {agent.tone && (
            <div className="mt-1">
              <span
                className="inline-block text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: agent.avatar_color + '20', color: agent.avatar_color }}
              >
                {agent.tone.split(',')[0].trim()}
              </span>
            </div>
          )}
        </div>
        {isAdmin && agent.is_active && (
          <Link
            to={`/agents/${agent.id}/edit`}
            className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)] transition-colors"
            title="Configurer"
          >
            <IconPencil size={14} style={{ color: 'var(--tblr-muted)' }} />
          </Link>
        )}
      </div>

      {agent.directives && (
        <p className="text-[12px] line-clamp-2" style={{ color: 'var(--tblr-muted)' }}>
          {agent.directives.split('.')[0]}.
        </p>
      )}

      <div className="flex gap-2 mt-auto">
        {agent.is_active ? (
          <button
            onClick={() => openChat(agent.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: 'var(--tblr-primary)', color: 'white' }}
          >
            <IconMessageCircle size={14} />
            {t('agent_start_chat')}
          </button>
        ) : (
          <button
            onClick={handleActivate}
            disabled={activating || !isAdmin}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)', opacity: activating ? 0.7 : 1 }}
          >
            {activating ? (
              <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-muted) transparent transparent transparent' }} />
            ) : (
              <IconPlus size={14} />
            )}
            {t('agents_activate')}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Agents() {
  const { t } = useTranslation();
  const { profile } = useUser() as any;
  const isAdmin = profile?.system_role === 'admin';

  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Agent[]>([]);
  const [activeTab, setActiveTab] = useState<'team' | 'catalog'>('team');
  const [loading, setLoading] = useState(true);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [agentsData, templatesData] = await Promise.all([
        apiFetch('/api/agents').catch(() => []),
        apiFetch('/api/agent-templates').catch(() => []),
      ]);
      setMyAgents(agentsData as Agent[]);
      setTemplates(templatesData as Agent[]);

      apiFetch('/api/agents/token-balance').then((d: any) => setTokenBalance(d.balance)).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const activateTemplate = async (templateId: string) => {
    try {
      await apiFetch('/api/agents', { method: 'POST', body: JSON.stringify({ from_template_id: templateId }) });
      await fetchData();
    } catch {}
  };

  const activeSlugs = new Set(myAgents.map((a: Agent) => a.slug));
  const availableTemplates = templates.filter((t: Agent) => !activeSlugs.has(t.slug));

  const tabs = [
    { key: 'team' as const, label: t('agents_my_team'), count: myAgents.filter((a: Agent) => a.is_active).length },
    { key: 'catalog' as const, label: t('agents_catalog'), count: availableTemplates.length },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <IconRobot size={22} style={{ color: 'var(--tblr-primary)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('agents_page_title')}</h1>
          </div>
          <p className="text-[13px]" style={{ color: 'var(--tblr-muted)' }}>{t('agents_page_subtitle')}</p>
        </div>
        {tokenBalance !== null && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px]"
            style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
          >
            <IconCheck size={14} style={{ color: '#2fb344' }} />
            <span>{tokenBalance.toLocaleString('fr-FR')} tokens disponibles</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors"
            style={{
              borderColor: activeTab === tab.key ? 'var(--tblr-primary)' : 'transparent',
              color: activeTab === tab.key ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
            }}
          >
            {tab.label}
            <span
              className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
        </div>
      ) : (
        <>
          {activeTab === 'team' && (
            <>
              {myAgents.length === 0 ? (
                <div className="text-center py-16">
                  <IconRobot size={40} className="mx-auto mb-3" style={{ color: 'var(--tblr-muted)' }} />
                  <p className="font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Aucun agent activé</p>
                  <p className="text-[13px] mb-4" style={{ color: 'var(--tblr-muted)' }}>Activez des agents depuis le catalogue pour constituer votre équipe virtuelle.</p>
                  <button onClick={() => setActiveTab('catalog')} className="px-4 py-2 rounded-lg text-[13px] font-medium" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
                    Voir le catalogue
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {myAgents.map(agent => (
                    <AgentCard key={agent.id} agent={agent} isAdmin={isAdmin} />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'catalog' && (
            <>
              {availableTemplates.length === 0 ? (
                <div className="text-center py-16">
                  <IconCheck size={40} className="mx-auto mb-3" style={{ color: '#2fb344' }} />
                  <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>Tous les agents sont activés !</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {availableTemplates.map(template => (
                    <AgentCard
                      key={template.id}
                      agent={{ ...template, is_active: false }}
                      isAdmin={isAdmin}
                      onActivate={isAdmin ? activateTemplate : undefined}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
