import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import {
  IconUsers, IconBuildingSkyscraper, IconCreditCard,
  IconLoader2, IconRefresh, IconChevronDown, IconTrash,
  IconPlus, IconCalendar, IconMail, IconAlertTriangle, IconX,
  IconCircleCheck,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

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
  totalAiRevenue?: number; aiRevenueThisMonth?: number;
}

interface TenantRow {
  id: string; slug: string; name: string; plan: string;
  trial_ends_at: string | null; created_at: string;
  user_count: number; project_count: number;
  ai_credit_balance_eur_cents?: number;
  owner_email?: string | null;
  owner_name?: string | null;
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

// ─── Create Tenant Dialog ─────────────────────────────────────────────────────

interface CreateTenantResult { tenantId: string; slug: string; tempPassword: string }

function CreateTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (t: TenantRow) => void }) {
  const [form, setForm] = useState({ name: '', slug: '', adminEmail: '', adminName: '', plan: 'trial' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTenantResult | null>(null);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<CreateTenantResult>('/api/admin/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(res);
      onCreated({
        id: res.tenantId, slug: res.slug, name: form.name, plan: form.plan,
        trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
        user_count: 1, project_count: 0,
        owner_email: form.adminEmail, owner_name: form.adminName,
      });
    } catch (e: any) {
      setError(e.message || 'Erreur de création');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-md rounded-xl shadow-xl p-6 relative"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      >
        <button onClick={onClose} className="absolute top-4 right-4" style={{ color: 'var(--tblr-muted)' }}>
          <IconX size={18} />
        </button>
        <h2 className="text-base font-bold mb-4" style={{ color: 'var(--tblr-text)' }}>Nouveau cabinet</h2>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <IconCircleCheck size={18} />
              <span className="font-semibold text-sm">Cabinet créé avec succès</span>
            </div>
            <div className="rounded-lg p-3 text-sm font-mono" style={{ background: 'var(--tblr-surface-2)' }}>
              <p style={{ color: 'var(--tblr-muted)' }}>Email admin</p>
              <p className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{form.adminEmail}</p>
              <p className="mt-2" style={{ color: 'var(--tblr-muted)' }}>Mot de passe temporaire</p>
              <p className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{result.tempPassword}</p>
            </div>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
              Transmettez ces identifiants à l'administrateur du cabinet. Il pourra changer son mot de passe après connexion.
            </p>
            <button onClick={onClose} className="w-full py-2 rounded-lg text-sm font-semibold mt-2" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Nom du cabinet</label>
              <input
                required
                className="w-full p-2 rounded-lg text-sm"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
                placeholder="Cabinet Martin Architectes"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Slug (URL)</label>
              <input
                required
                className="w-full p-2 rounded-lg text-sm font-mono"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder="martin-architectes"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Prénom / Nom admin</label>
                <input
                  required
                  className="w-full p-2 rounded-lg text-sm"
                  style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={form.adminName}
                  onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))}
                  placeholder="Jean Martin"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Email admin</label>
                <input
                  required type="email"
                  className="w-full p-2 rounded-lg text-sm"
                  style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  value={form.adminEmail}
                  onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                  placeholder="jean@cabinet.fr"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Plan initial</label>
              <select
                className="w-full p-2 rounded-lg text-sm"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                value={form.plan}
                onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
              >
                {['trial', 'starter', 'pro', 'enterprise'].map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 mt-1"
              style={{ background: 'var(--tblr-primary)', color: '#fff', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <><IconLoader2 size={14} className="animate-spin" />Création...</> : 'Créer le cabinet'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Extend Trial Dialog ──────────────────────────────────────────────────────

function ExtendTrialDialog({ tenant, onClose, onExtended }: {
  tenant: TenantRow; onClose: () => void; onExtended: (newDate: string) => void;
}) {
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExtend() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; trial_ends_at: string }>(`/api/admin/tenants/${tenant.id}/trial`, {
        method: 'PATCH',
        body: JSON.stringify({ days }),
      });
      onExtended(res.trial_ends_at);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-sm rounded-xl shadow-xl p-6 relative"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      >
        <button onClick={onClose} className="absolute top-4 right-4" style={{ color: 'var(--tblr-muted)' }}>
          <IconX size={18} />
        </button>
        <h2 className="text-base font-bold mb-1" style={{ color: 'var(--tblr-text)' }}>Prolonger l'essai</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--tblr-muted)' }}>{tenant.name}</p>
        {error && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 mb-3">{error}</div>}
        <div className="flex items-center gap-3 mb-4">
          <input
            type="number" min={1} max={365}
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="w-24 p-2 rounded-lg text-sm text-center"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>jours supplémentaires</span>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            Annuler
          </button>
          <button
            onClick={handleExtend}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
            style={{ background: 'var(--tblr-primary)', color: '#fff', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <IconLoader2 size={14} className="animate-spin" /> : null}
            Prolonger
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────

function DeleteConfirmDialog({ tenant, onClose, onDeleted }: {
  tenant: TenantRow; onClose: () => void; onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/tenants/${tenant.id}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Erreur de suppression');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-sm rounded-xl shadow-xl p-6 relative"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      >
        <button onClick={onClose} className="absolute top-4 right-4" style={{ color: 'var(--tblr-muted)' }}>
          <IconX size={18} />
        </button>
        <div className="flex items-center gap-2 mb-3">
          <IconAlertTriangle size={20} className="text-red-500" />
          <h2 className="text-base font-bold text-red-600">Supprimer le cabinet</h2>
        </div>
        <p className="text-sm mb-1" style={{ color: 'var(--tblr-text)' }}>
          Cette action est <strong>irréversible</strong>. Toutes les données du cabinet <strong>{tenant.name}</strong> seront supprimées ({tenant.user_count} utilisateurs, {tenant.project_count} projets).
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--tblr-muted)' }}>
          Saisissez <strong>{tenant.slug}</strong> pour confirmer :
        </p>
        {error && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 mb-3">{error}</div>}
        <input
          className="w-full p-2 rounded-lg text-sm mb-4 font-mono"
          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder={tenant.slug}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            Annuler
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || confirm !== tenant.slug}
            className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
            style={{ background: '#ef4444', color: '#fff', opacity: (loading || confirm !== tenant.slug) ? 0.5 : 1 }}
          >
            {loading ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [extendTarget, setExtendTarget] = useState<TenantRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null);

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
    if (!currentUser) return;
    apiFetch<{ isAdmin: boolean }>('/api/admin/is-admin')
      .then(r => {
        setIsSuperAdmin(r.isAdmin);
        if (r.isAdmin) load();
        else navigate('/');
      })
      .catch(() => navigate('/'));
  }, [currentUser?.email]);

  function handlePlanChange(tenantId: string, plan: string) {
    setTenants((prev: TenantRow[]) => prev.map((t: TenantRow) => t.id === tenantId ? { ...t, plan } : t));
  }

  function handleTrialExtended(tenantId: string, newDate: string) {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, trial_ends_at: newDate, plan: 'trial' } : t));
  }

  function handleDeleted(tenantId: string) {
    setTenants(prev => prev.filter(t => t.id !== tenantId));
  }

  const filtered = tenants.filter((t: TenantRow) => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      (t.owner_email ?? '').toLowerCase().includes(q);
    const matchPlan = !filterPlan || t.plan === filterPlan;
    return matchSearch && matchPlan;
  });

  const now = Date.now();
  const expiringSoon = tenants.filter(t =>
    t.plan === 'trial' && t.trial_ends_at &&
    new Date(t.trial_ends_at).getTime() > now &&
    new Date(t.trial_ends_at).getTime() - now < 7 * 86_400_000
  ).length;

  if (isSuperAdmin === null) return null;

  return (
    <div className="space-y-6">
      {showCreate && (
        <CreateTenantDialog
          onClose={() => setShowCreate(false)}
          onCreated={t => { setTenants(prev => [t, ...prev]); setShowCreate(false); }}
        />
      )}
      {extendTarget && (
        <ExtendTrialDialog
          tenant={extendTarget}
          onClose={() => setExtendTarget(null)}
          onExtended={newDate => { handleTrialExtended(extendTarget.id, newDate); setExtendTarget(null); }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          tenant={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => handleDeleted(deleteTarget.id)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Super Admin</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--tblr-muted)' }}>Vue globale de tous les cabinets ArchiOffice</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-colors"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}
          >
            <IconPlus size={14} />
            Nouveau cabinet
          </button>
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
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard label="Cabinets" value={stats?.total ?? '—'} />
        <KpiCard label="Essai" value={stats?.trial ?? '—'} sub={`${stats?.expired ?? 0} expirés`} />
        <KpiCard label="Starter" value={stats?.starter ?? '—'} />
        <KpiCard label="Pro" value={stats?.pro ?? '—'} />
        <KpiCard label="Entreprise" value={stats?.enterprise ?? '—'} />
        <KpiCard label="Revenus totaux" value={stats ? `${stats.totalRevenue.toFixed(0)} €` : '—'} />
        <KpiCard label="Revenus IA total" value={stats?.totalAiRevenue != null ? `${(stats.totalAiRevenue / 100).toFixed(0)} €` : '—'} />
        <KpiCard label="Essais ↯ 7j" value={expiringSoon} sub={expiringSoon > 0 ? 'à prolonger' : 'aucun'} />
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
                {PLAN_LABELS[plan]} ({stats[plan as keyof Stats] as number})
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
            placeholder="Rechercher par nom, slug ou email…"
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
                  {['Cabinet', 'Admin', 'Plan', 'Utilisateurs', 'Projets', 'Crédits IA', 'Essai expire', 'Créé le', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-sm" style={{ color: 'var(--tblr-muted)' }}>
                      Aucun cabinet trouvé
                    </td>
                  </tr>
                )}
                {filtered.map((t: TenantRow) => {
                  const trialExpired = t.plan === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at).getTime() < now;
                  const trialDate = t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('fr-FR') : '—';
                  const expiringSoonRow = t.plan === 'trial' && t.trial_ends_at &&
                    new Date(t.trial_ends_at).getTime() > now &&
                    new Date(t.trial_ends_at).getTime() - now < 7 * 86_400_000;
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
                      <td className="px-4 py-3">
                        {t.owner_email ? (
                          <div>
                            <p className="text-[12px]" style={{ color: 'var(--tblr-text)' }}>{t.owner_name ?? '—'}</p>
                            <a
                              href={`mailto:${t.owner_email}`}
                              className="text-[11px] flex items-center gap-0.5 hover:underline"
                              style={{ color: 'var(--tblr-primary)' }}
                            >
                              <IconMail size={10} />
                              {t.owner_email}
                            </a>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--tblr-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PlanSelect tenantId={t.id} current={t.plan} onChange={plan => handlePlanChange(t.id, plan)} />
                      </td>
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
                      <td className="px-4 py-3 text-[12px] font-mono" style={{ color: 'var(--tblr-text)' }}>
                        {t.ai_credit_balance_eur_cents != null
                          ? `${(t.ai_credit_balance_eur_cents / 100).toFixed(2)} €`
                          : <span style={{ color: 'var(--tblr-muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {t.plan === 'trial' ? (
                          <span className={cn(
                            'text-[12px]',
                            trialExpired ? 'text-red-500 font-semibold' : expiringSoonRow ? 'text-amber-500 font-semibold' : ''
                          )} style={trialExpired || expiringSoonRow ? {} : { color: 'var(--tblr-muted)' }}>
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
                        <div className="flex items-center gap-1">
                          {t.plan === 'trial' && (
                            <button
                              onClick={() => setExtendTarget(t)}
                              title="Prolonger l'essai"
                              className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)] transition-colors"
                              style={{ color: 'var(--tblr-primary)' }}
                            >
                              <IconCalendar size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget(t)}
                            title="Supprimer ce cabinet"
                            className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-500"
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
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
