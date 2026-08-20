import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import {
  IconArrowLeft, IconLoader2, IconUsers, IconBuildingSkyscraper,
  IconCoin, IconNotes, IconDeviceFloppy, IconHistory, IconReceipt,
  IconLogin, IconMessageCircle,
} from '@tabler/icons-react';
import { PLAN_LABELS, PlanSelect } from './AdminDashboard';

interface Member { id: string; name: string; email: string; role: string; system_role: string; created_at: string }
interface Project { id: string; name: string; status: string; created_at: string }
interface BillingEvent { id: string; event_type: string; plan_id: string | null; amount: number | null; status: string; created_at: string }
interface AuditEntry { id: string; actor_email: string | null; action: string; details: Record<string, unknown> | null; created_at: string }
interface SupportTicket { id: string; subject: string; status: string; last_message_at: string }

interface TenantDetail {
  id: string; slug: string; name: string; plan: string;
  trial_ends_at: string | null; created_at: string;
  ai_credit_balance_eur_cents?: number;
  internal_notes: string | null;
  user_count: number; project_count: number;
  owner_email: string | null; owner_name: string | null;
  members: Member[];
  recent_projects: Project[];
  billing_events: BillingEvent[];
  audit_log: AuditEntry[];
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'tenant.plan_changed': 'Changement de plan',
  'tenant.trial_extended': "Prolongation d'essai",
  'tenant.ai_credit_adjusted': 'Ajustement crédit IA',
  'tenant.notes_updated': 'Notes internes modifiées',
  'tenant.created': 'Cabinet créé',
  'tenant.deleted': 'Cabinet supprimé',
  'tenant.impersonated': 'Connexion en tant que…',
};

const TICKET_STATUS_LABELS: Record<string, string> = { open: 'Ouvert', answered: 'Répondu', closed: 'Fermé' };

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4 space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TenantDetail>(`/api/admin/tenants/${id}`);
      setTenant(data);
      setNotes(data.internal_notes ?? '');
    } catch (e: any) {
      setError(e.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!id) return;
    apiFetch<SupportTicket[]>(`/api/admin/support/tickets?tenant_id=${id}`).then(setTickets).catch(() => {});
  }, [id]);

  async function handleImpersonate(memberId: string, memberEmail: string) {
    if (!id) return;
    if (!window.confirm(`Vous connecter en tant que ${memberEmail} ?\n\nCette action est enregistrée dans le journal d'audit.`)) return;
    setImpersonating(memberId);
    try {
      const res = await apiFetch<{ action_link: string }>(`/api/admin/tenants/${id}/impersonate`, {
        method: 'POST', body: JSON.stringify({ user_id: memberId }),
      });
      window.open(res.action_link, '_blank');
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Erreur lors de la connexion');
    } finally {
      setImpersonating(null);
    }
  }

  async function handleSaveNotes() {
    if (!id) return;
    setSavingNotes(true);
    try {
      await apiFetch(`/api/admin/tenants/${id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) });
    } catch (e: any) {
      alert(e.message ?? "Erreur lors de l'enregistrement des notes");
    } finally {
      setSavingNotes(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 size={24} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {error ?? 'Cabinet introuvable'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-sm hover:underline" style={{ color: 'var(--tblr-muted)' }}>
        <IconArrowLeft size={14} />
        Retour au back-office
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{tenant.name}</h1>
          <p className="text-sm mt-0.5 font-mono" style={{ color: 'var(--tblr-muted)' }}>{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          <PlanSelect tenantId={tenant.id} current={tenant.plan} onChange={plan => setTenant(t => t ? { ...t, plan } : t)} />
          <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Créé le {fmtDate(tenant.created_at)}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <p className="text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--tblr-muted)' }}><IconUsers size={13} />Utilisateurs</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--tblr-text)' }}>{tenant.user_count}</p>
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <p className="text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--tblr-muted)' }}><IconBuildingSkyscraper size={13} />Projets</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--tblr-text)' }}>{tenant.project_count}</p>
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <p className="text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--tblr-muted)' }}><IconCoin size={13} />Crédit IA</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--tblr-text)' }}>{((tenant.ai_credit_balance_eur_cents ?? 0) / 100).toFixed(2)} €</p>
        </div>
        <div className="rounded-lg border p-4" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Essai jusqu'au</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--tblr-text)' }}>{tenant.plan === 'trial' ? fmtDate(tenant.trial_ends_at) : '—'}</p>
        </div>
      </div>

      {tenant.owner_email && (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
          Administrateur : <span style={{ color: 'var(--tblr-text)' }}>{tenant.owner_name}</span> — <a href={`mailto:${tenant.owner_email}`} className="hover:underline" style={{ color: 'var(--tblr-primary)' }}>{tenant.owner_email}</a>
        </p>
      )}

      {/* Internal notes */}
      <Card title="Notes internes" icon={<IconNotes size={16} style={{ color: 'var(--tblr-primary)' }} />}>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Notes visibles uniquement par l'équipe ArchiOffice (contexte commercial, support, historique d'échanges…)"
          className="w-full p-2 rounded-lg text-sm resize-y"
          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        />
        <button
          onClick={handleSaveNotes}
          disabled={savingNotes}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold"
          style={{ background: 'var(--tblr-primary)', color: '#fff', opacity: savingNotes ? 0.7 : 1 }}
        >
          {savingNotes ? <IconLoader2 size={14} className="animate-spin" /> : <IconDeviceFloppy size={14} />}
          Enregistrer
        </button>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Members */}
        <Card title={`Membres (${tenant.members.length})`} icon={<IconUsers size={16} style={{ color: 'var(--tblr-primary)' }} />}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {tenant.members.length === 0 && (
                  <tr><td className="text-xs py-2" style={{ color: 'var(--tblr-muted)' }}>Aucun membre</td></tr>
                )}
                {tenant.members.map(m => (
                  <tr key={m.id} className="border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <td className="py-2 pr-2">
                      <p style={{ color: 'var(--tblr-text)' }}>{m.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{m.email}</p>
                    </td>
                    <td className="py-2 text-[11px] text-right" style={{ color: 'var(--tblr-muted)' }}>{m.role}{m.system_role === 'admin' ? ' · admin' : ''}</td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        onClick={() => handleImpersonate(m.id, m.email)}
                        disabled={impersonating === m.id}
                        title={`Se connecter en tant que ${m.email}`}
                        className="p-1 rounded hover:bg-[var(--tblr-surface-2)]"
                        style={{ color: 'var(--tblr-muted)' }}
                      >
                        {impersonating === m.id ? <IconLoader2 size={13} className="animate-spin" /> : <IconLogin size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent projects */}
        <Card title="Projets récents" icon={<IconBuildingSkyscraper size={16} style={{ color: 'var(--tblr-primary)' }} />}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {tenant.recent_projects.length === 0 && (
                  <tr><td className="text-xs py-2" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</td></tr>
                )}
                {tenant.recent_projects.map(p => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <td className="py-2 pr-2" style={{ color: 'var(--tblr-text)' }}>{p.name}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{p.status}</td>
                    <td className="py-2 text-[11px] text-right" style={{ color: 'var(--tblr-muted)' }}>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Billing history */}
        <Card title="Historique de paiement" icon={<IconReceipt size={16} style={{ color: 'var(--tblr-primary)' }} />}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {tenant.billing_events.length === 0 && (
                  <tr><td className="text-xs py-2" style={{ color: 'var(--tblr-muted)' }}>Aucun événement de paiement</td></tr>
                )}
                {tenant.billing_events.map(b => (
                  <tr key={b.id} className="border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <td className="py-2 pr-2" style={{ color: 'var(--tblr-text)' }}>
                      {b.event_type}{b.plan_id ? ` · ${PLAN_LABELS[b.plan_id] ?? b.plan_id}` : ''}
                    </td>
                    <td className="py-2 text-[11px] font-mono" style={{ color: 'var(--tblr-muted)' }}>
                      {b.amount != null ? `${(b.amount / 100).toFixed(2)} €` : '—'}
                    </td>
                    <td className="py-2 text-[11px]" style={{ color: b.status === 'paid' ? '#22c55e' : 'var(--tblr-muted)' }}>{b.status}</td>
                    <td className="py-2 text-[11px] text-right" style={{ color: 'var(--tblr-muted)' }}>{fmtDate(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Support tickets */}
        <Card title={`Tickets support (${tickets.length})`} icon={<IconMessageCircle size={16} style={{ color: 'var(--tblr-primary)' }} />}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {tickets.length === 0 && (
                  <tr><td className="text-xs py-2" style={{ color: 'var(--tblr-muted)' }}>Aucun ticket</td></tr>
                )}
                {tickets.map(tk => (
                  <tr key={tk.id} className="border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <td className="py-2 pr-2">
                      <Link to={`/admin/support?tenant_id=${tenant.id}`} className="hover:underline" style={{ color: 'var(--tblr-text)' }}>{tk.subject}</Link>
                    </td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{TICKET_STATUS_LABELS[tk.status] ?? tk.status}</td>
                    <td className="py-2 text-[11px] text-right" style={{ color: 'var(--tblr-muted)' }}>{fmtDate(tk.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Audit log */}
        <Card title="Journal d'activité admin" icon={<IconHistory size={16} style={{ color: 'var(--tblr-primary)' }} />}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <tbody>
                {tenant.audit_log.length === 0 && (
                  <tr><td className="text-xs py-2" style={{ color: 'var(--tblr-muted)' }}>Aucune action enregistrée</td></tr>
                )}
                {tenant.audit_log.map(a => (
                  <tr key={a.id} className="border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <td className="py-2 pr-2">
                      <p style={{ color: 'var(--tblr-text)' }}>{AUDIT_ACTION_LABELS[a.action] ?? a.action}</p>
                      <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{a.actor_email ?? 'système'}</p>
                    </td>
                    <td className="py-2 text-[11px] text-right" style={{ color: 'var(--tblr-muted)' }}>{fmtDateTime(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
