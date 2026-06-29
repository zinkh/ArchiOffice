import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconCloudUpload, IconRefresh, IconLoader2, IconCircleCheck, IconX, IconClock, IconFileInvoice, IconAlertTriangle } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import { useTranslation } from 'react-i18next';

interface PdpInvoice {
  id: number;
  external_id?: string;
  direction: 'in' | 'out';
  created_at: string;
  events: Array<{ id: number; status_code: string; created_at: string }>;
  en_invoice?: {
    number?: string;
    issue_date?: string;
    totals?: { total_with_vat?: string };
    buyer?: { name?: string };
    seller?: { name?: string };
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  'api:uploaded':   { label: 'Reçu',        color: '#1971c2', bg: '#e7f5ff', border: '#a5d8ff', icon: <IconCloudUpload size={13} /> },
  'api:validated':  { label: 'Validé',       color: '#1971c2', bg: '#e7f5ff', border: '#a5d8ff', icon: <IconCircleCheck size={13} /> },
  'api:sent':       { label: 'Transmis',     color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'api:rejected':   { label: 'Rejeté',       color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconX size={13} /> },
  'api:invalid':    { label: 'Invalide',     color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconX size={13} /> },
  'api:received':   { label: 'Reçu (PDP)',   color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:200':  { label: 'Déposé',      color: '#1971c2', bg: '#e7f5ff', border: '#a5d8ff', icon: <IconCloudUpload size={13} /> },
  'fr:201':  { label: 'Envoyé',      color: '#1971c2', bg: '#e7f5ff', border: '#a5d8ff', icon: <IconCircleCheck size={13} /> },
  'fr:202':  { label: 'Reçu',        color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:203':  { label: 'Mis à dispo', color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:204':  { label: 'Accusé',      color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:205':  { label: 'Accepté',     color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:206':  { label: 'Partiel',     color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconAlertTriangle size={13} /> },
  'fr:207':  { label: 'Contesté',    color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconAlertTriangle size={13} /> },
  'fr:208':  { label: 'En attente',  color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconClock size={13} /> },
  'fr:209':  { label: 'Soldé',       color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:210':  { label: 'Refusé',      color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconX size={13} /> },
  'fr:211':  { label: 'Paiement envoyé',  color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:212':  { label: 'Paiement reçu',    color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  'fr:213':  { label: 'Rejeté PPF',  color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconX size={13} /> },
};

function StatusBadge({ code }: { code: string }) {
  const s = STATUS_LABELS[code] || { label: code, color: 'var(--tblr-muted)', bg: 'var(--tblr-surface-2)', border: 'var(--tblr-border)', icon: null };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.icon}{s.label}
    </span>
  );
}

export default function SuperPDPPortal() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [invoices, setInvoices] = useState<PdpInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [localInvoices, setLocalInvoices] = useState<any[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        const [status, local] = await Promise.all([
          fetchJson<{ connected: boolean }>('/api/superpdp/status'),
          fetchJson<any[]>('/api/invoices'),
        ]);
        setConnected(status.connected);
        setLocalInvoices(local);
        if (status.connected) {
          const data = await fetchJson<{ data: PdpInvoice[] }>('/api/superpdp/invoices');
          setInvoices(data.data || []);
        }
      } catch {
        setConnected(false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const refreshEvents = async (pdpId: number, localInvoiceId: string) => {
    setRefreshingId(pdpId);
    try {
      const res = await fetchJson<{ events: any[]; latest_status: string }>(`/api/superpdp/events/${localInvoiceId}`);
      setInvoices(prev => prev.map(inv => {
        if (inv.id !== pdpId) return inv;
        const newEvents = res.events.map((e: any) => ({ id: e.id, status_code: e.status_code, created_at: e.created_at }));
        return { ...inv, events: newEvents };
      }));
    } catch { /* ignore */ } finally {
      setRefreshingId(null);
    }
  };

  const getLocalInvoice = (pdpInv: PdpInvoice) => {
    if (pdpInv.external_id) return localInvoices.find(i => i.id === pdpInv.external_id);
    return localInvoices.find(i => i.superpdp_id === pdpInv.id);
  };

  const latestStatus = (inv: PdpInvoice) => inv.events?.[inv.events.length - 1]?.status_code || 'api:uploaded';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <IconLoader2 size={28} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>Portail Super PDP</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Suivi des factures électroniques envoyées au PPF</p>
        </div>
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <IconCloudUpload size={48} style={{ color: 'var(--tblr-muted)', margin: '0 auto 16px' }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--tblr-text)' }}>Super PDP non configuré</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--tblr-muted)' }}>Connectez votre compte Super PDP dans les Paramètres pour accéder au suivi des factures électroniques.</p>
          <a href="/settings?tab=plugins&plugin=superpdp"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
            Configurer Super PDP
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>Portail Super PDP</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Factures électroniques transmises au Portail Public de Facturation (PPF)</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: '#d3f9d8', color: '#2f9e44' }}>
          <IconCircleCheck size={14} /> Connecté
        </span>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <IconFileInvoice size={40} style={{ color: 'var(--tblr-muted)', margin: '0 auto 12px' }} />
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>Aucune facture envoyée via Super PDP pour l'instant.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Utilisez le bouton <strong>Envoyer au PDP</strong> (<IconCloudUpload size={11} style={{ display: 'inline' }} />) depuis la page Factures.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Facture</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Client / Vendeur</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Montant TTC</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Statut PPF</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Historique</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const local = getLocalInvoice(inv);
                const status = latestStatus(inv);
                return (
                  <tr key={inv.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg" style={{ background: '#e7f5ff', color: '#1971c2' }}>
                          <IconFileInvoice size={16} />
                        </div>
                        <div>
                          <p className="font-bold text-xs" style={{ color: 'var(--tblr-text)' }}>
                            {inv.en_invoice?.number || local?.invoice_number || `PDP #${inv.id}`}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
                            {inv.en_invoice?.issue_date || local?.issue_date || new Date(inv.created_at).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>
                        {inv.direction === 'out' ? (inv.en_invoice?.buyer?.name || local?.project_name || '—') : (inv.en_invoice?.seller?.name || '—')}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
                        {inv.direction === 'out' ? 'Émise' : 'Reçue'}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>
                      {inv.en_invoice?.totals?.total_with_vat
                        ? `${parseFloat(inv.en_invoice.totals.total_with_vat).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`
                        : local?.total_amount
                          ? `${Number(local.total_amount).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`
                          : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge code={status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-0.5 max-h-20 overflow-y-auto">
                        {inv.events.slice().reverse().map(ev => (
                          <div key={ev.id} className="flex items-center gap-1.5">
                            <span className="text-[9px] font-mono" style={{ color: 'var(--tblr-muted)' }}>
                              {new Date(ev.created_at).toLocaleDateString('fr-FR')}
                            </span>
                            <StatusBadge code={ev.status_code} />
                          </div>
                        ))}
                        {inv.events.length === 0 && <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>Aucun événement</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {local && (
                        <button
                          onClick={() => refreshEvents(inv.id, local.id)}
                          disabled={refreshingId === inv.id}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                          style={{ color: 'var(--tblr-muted)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-surface-2)'}
                          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                          title="Actualiser les événements"
                        >
                          {refreshingId === inv.id ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl p-4 text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
        <p className="font-bold mb-1" style={{ color: 'var(--tblr-text)' }}>Cycle de vie des statuts PPF</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
          {(['fr:200','fr:201','fr:202','fr:205','fr:206','fr:207','fr:210','fr:212'] as const).map(code => {
            const s = STATUS_LABELS[code];
            return <span key={code} className="flex items-center gap-1"><StatusBadge code={code} /> <span className="font-mono">{code}</span></span>;
          })}
        </div>
      </div>
    </div>
  );
}
