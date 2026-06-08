import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import {
  IconUsers, IconBuildingSkyscraper, IconCreditCard,
  IconLoader2, IconRefresh, IconChevronDown,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

const SUPER_ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL as string | undefined;

const PLAN_LABELS: Record<string, string> = {
  trial: 'Essai', starter: 'Starter', pro: 'Pro', enterprise: 'Entreprise',
};

const PLAN_COLORS: Record<string, string> = {
  trial:      'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  starter:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  pro:        'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  enterprise: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

interface Stats {
  total: number; trial: number; starter: number; pro: number;
  enterprise: number; expired: number; totalRevenue: number;
}

interface TenantRow {
  id: string; slug: string; name: string; plan: string;
  trial_ends_at: string | null; created_at: string;
  user_count: number; project_count: number;
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-1"
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
    >
      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{sub}</p>}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded text-[11px] font-semibold', PLAN_COLORS[plan] ?? PLAN_COLORS.trial)}>
      {PLAN_LABELS[plan] ?? plan}
    </span>
  );
}

function PlanSelect({ tenantId, current, onChange }: { tenantId: string; current: string; onChange: (plan: string) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const plan = e.target.value;
    setLoading(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      onChange(plan);
    } catch {
      alert('Erreur lors du changement de plan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative inline-flex items-center">
      {loading
        ? <IconLoader2 size={14} className="animate-spin text-blue-500" />
        : (
          <>
            <select
              value={current}
              onChange={handleChange}
              className="appearance-none text-[12px] rounded border pl-2 pr-6 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              {['trial', 'starter', 'pro', 'enterprise'].map(p => (
                <option key={p} value={p}>{PLAN_LABELS[p]}</option>
              ))}
            </select>
            <IconChevronDown size={11} className="absolute right-1.5 pointer-events-none" style={{ color: 'var(--tblr-muted)' }} />
          </>
        )
      }
    </div>
  );
}

export default function AdminDashboard() {
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');

  const isSuperAdmin = SUPER_ADMIN_EMAIL && currentUser?.email === SUPER_ADMIN_EMAIL;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, tenantsRes] = await Promise.all([
        apiFetch<{ stats: Stats }>('/api/admin/stats'),
        apiFetch<TenantRow[]>('/api/admin/tenants'),
      ]);
      setStats(statsRes.stats);
      setTenants(tenantsRes);
    } catch (e: any) {
      setError(e.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) { navigate('/'); return; }
    load();
  }, [isSuperAdmin, load, navigate]);

  function handlePlanChange(tenantId: string, plan: string) {
    setTenants((prev: TenantRow[]) => prev.map((t: TenantRow) => t.id === tenantId ? { ...t, plan } : t));
  }

  const filtered = tenants.filter((t: TenantRow) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase());
    const matchPlan = !filterPlan || t.plan === filterPlan;
    return matchSearch && matchPlan;
  });

  const now = Date.now();

  if (!isSuperAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Super Admin</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--tblr-muted)' }}>Vue globale de tous les cabinets ArchiOffice</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
        >
          <IconRefresh size={14} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Cabinets" value={stats?.total ?? '—'} />
        <KpiCard label="Essai" value={stats?.trial ?? '—'} sub={`${stats?.expired ?? 0} expirés`} />
        <KpiCard label="Starter" value={stats?.starter ?? '—'} />
        <KpiCard label="Pro" value={stats?.pro ?? '—'} />
        <KpiCard label="Entreprise" value={stats?.enterprise ?? '—'} />
        <KpiCard
          label="Revenus totaux"
          value={stats ? `${stats.totalRevenue.toFixed(0)} €` : '—'}
        />
      </div>

      {/* Plan distribution bar */}
      {stats && stats.total > 0 && (
        <div
          className="rounded-lg border p-4"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>
            Répartition des plans
          </p>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
            {(['trial', 'starter', 'pro', 'enterprise'] as const).map(plan => {
              const count = stats[plan];
              const pct = (count / stats.total) * 100;
              if (!count) return null;
              const bg = { trial: 'bg-zinc-400', starter: 'bg-blue-500', pro: 'bg-violet-500', enterprise: 'bg-amber-500' }[plan];
              return <div key={plan} className={cn('h-full', bg)} style={{ width: `${pct}%` }} title={`${PLAN_LABELS[plan]}: ${count}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {(['trial', 'starter', 'pro', 'enterprise'] as const).map((plan: string) => (
              <span key={plan} className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                <span className={cn('w-2 h-2 rounded-sm inline-block', { trial: 'bg-zinc-400', starter: 'bg-blue-500', pro: 'bg-violet-500', enterprise: 'bg-amber-500' }[plan])} />
                {PLAN_LABELS[plan]} ({stats[plan]})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tenants table */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
      >
        {/* Table toolbar */}
        <div className="flex flex-col sm:flex-row gap-2 p-3 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
          <input
            type="text"
            placeholder="Rechercher un cabinet…"
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="flex-1 text-sm rounded border px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <select
            value={filterPlan}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilterPlan(e.target.value)}
            className="text-sm rounded border px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            <option value="">Tous les plans</option>
            {['trial', 'starter', 'pro', 'enterprise'].map(p => (
              <option key={p} value={p}>{PLAN_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <IconLoader2 size={24} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                  {['Cabinet', 'Plan', 'Utilisateurs', 'Projets', 'Essai expire', 'Créé le', 'Changer plan'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--tblr-muted)' }}>
                      Aucun cabinet trouvé
                    </td>
                  </tr>
                )}
                {filtered.map((t: TenantRow) => {
                  const trialExpired = t.plan === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at).getTime() < now;
                  const trialDate = t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('fr-FR') : '—';
                  return (
                    <tr
                      key={t.id}
                      className="border-b transition-colors hover:bg-[var(--tblr-surface-2)]"
                      style={{ borderColor: 'var(--tblr-border)' }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>{t.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t.slug}</p>
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={t.plan} /></td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1" style={{ color: 'var(--tblr-text)' }}>
                          <IconUsers size={13} style={{ color: 'var(--tblr-muted)' }} />{t.user_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1" style={{ color: 'var(--tblr-text)' }}>
                          <IconBuildingSkyscraper size={13} style={{ color: 'var(--tblr-muted)' }} />{t.project_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.plan === 'trial' ? (
                          <span className={cn('text-[12px]', trialExpired ? 'text-red-500 font-semibold' : '')} style={trialExpired ? {} : { color: 'var(--tblr-muted)' }}>
                            {trialExpired ? `Expiré (${trialDate})` : trialDate}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--tblr-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
                        {new Date(t.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-4 py-3">
                        <PlanSelect tenantId={t.id} current={t.plan} onChange={plan => handlePlanChange(t.id, plan)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table footer */}
        {!loading && (
          <div className="px-4 py-2 border-t text-[11px]" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            <IconCreditCard size={11} className="inline mr-1" />
            {filtered.length} cabinet{filtered.length !== 1 ? 's' : ''} affiché{filtered.length !== 1 ? 's' : ''}
            {tenants.length !== filtered.length && ` sur ${tenants.length}`}
          </div>
        )}
      </div>
    </div>
  );
}
