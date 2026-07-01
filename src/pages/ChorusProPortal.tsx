import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconBuildingBank, IconRefresh, IconLoader2, IconCircleCheck, IconX, IconClock, IconFileInvoice, IconAlertTriangle } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import type { Invoice } from '../types';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  DEPOSEE:             { label: 'Déposée',            color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe', icon: <IconBuildingBank size={13} /> },
  A_TRAITER:           { label: 'À traiter',          color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe', icon: <IconClock size={13} /> },
  MISE_A_DISPOSITION:  { label: 'Mise à disposition', color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe', icon: <IconCircleCheck size={13} /> },
  MANDATEE:            { label: 'Mandatée',           color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconClock size={13} /> },
  COMPTABILISEE:       { label: 'Comptabilisée',      color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconClock size={13} /> },
  SERVICE_FAIT:        { label: 'Service fait',       color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconCircleCheck size={13} /> },
  MISE_EN_PAIEMENT:    { label: 'Mise en paiement',   color: '#e67700', bg: '#fff3bf', border: '#ffe066', icon: <IconClock size={13} /> },
  REJETEE:             { label: 'Rejetée',            color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconX size={13} /> },
  SUSPENDUE:           { label: 'Suspendue',          color: '#c92a2a', bg: '#ffe3e3', border: '#ffc9c9', icon: <IconAlertTriangle size={13} /> },
  PAIEMENT_EFFECTUE:   { label: 'Paiement effectué',  color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
  SOLDEE:               { label: 'Soldée',             color: '#2f9e44', bg: '#d3f9d8', border: '#b2f2bb', icon: <IconCircleCheck size={13} /> },
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

export default function ChorusProPortal() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const status = await fetchJson<{ connected: boolean }>('/api/chorus-pro/status');
        setConnected(status.connected);
        if (status.connected) {
          const data = await fetchJson<Invoice[]>('/api/chorus-pro/invoices');
          setInvoices(data || []);
        }
      } catch {
        setConnected(false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const refreshStatus = async (invoiceId: string) => {
    setRefreshingId(invoiceId);
    try {
      const res = await fetchJson<{ latest_status?: string }>(`/api/chorus-pro/status/${invoiceId}`);
      if (res.latest_status) {
        setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, chorus_pro_status: res.latest_status } : inv));
      }
    } catch { /* ignore */ } finally {
      setRefreshingId(null);
    }
  };

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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>Portail Chorus Pro</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Suivi des factures transmises aux maîtrises d'ouvrage publiques</p>
        </div>
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <IconBuildingBank size={48} style={{ color: 'var(--tblr-muted)', margin: '0 auto 16px' }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--tblr-text)' }}>Chorus Pro non configuré</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--tblr-muted)' }}>Connectez votre compte Chorus Pro (PISTE + compte technique) dans les Paramètres pour accéder au suivi des factures B2G.</p>
          <a href="/settings?tab=plugins&plugin=chorus_pro"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
            Configurer Chorus Pro
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>Portail Chorus Pro</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Factures de maîtrise d'œuvre et de travaux transmises aux structures publiques</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: '#d3f9d8', color: '#2f9e44' }}>
          <IconCircleCheck size={14} /> Connecté
        </span>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <IconFileInvoice size={40} style={{ color: 'var(--tblr-muted)', margin: '0 auto 12px' }} />
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>Aucune facture envoyée via Chorus Pro pour l'instant.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Utilisez le bouton <strong>Envoyer à Chorus Pro</strong> (<IconBuildingBank size={11} style={{ display: 'inline' }} />) depuis la page Factures.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Facture</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Projet</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>SIRET destinataire</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Montant TTC</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Statut Chorus Pro</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg" style={{ background: '#eef2ff', color: '#4338ca' }}>
                        <IconFileInvoice size={16} />
                      </div>
                      <div>
                        <p className="font-bold text-xs" style={{ color: 'var(--tblr-text)' }}>{inv.invoice_number}</p>
                        <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{inv.issue_date}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>{inv.project_name || '—'}</td>
                  <td className="px-5 py-4 font-mono text-xs" style={{ color: 'var(--tblr-text)' }}>{inv.buyer_siret || '—'}</td>
                  <td className="px-5 py-4 font-mono text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>
                    {inv.total_amount ? Number(inv.total_amount).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
                  </td>
                  <td className="px-5 py-4">
                    {inv.chorus_pro_status ? <StatusBadge code={inv.chorus_pro_status} /> : <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>—</span>}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => refreshStatus(inv.id)}
                      disabled={refreshingId === inv.id}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{ color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-surface-2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                      title="Actualiser le statut"
                    >
                      {refreshingId === inv.id ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl p-4 text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
        <p className="font-bold mb-1" style={{ color: 'var(--tblr-text)' }}>Cycle de vie des statuts Chorus Pro</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
          {Object.keys(STATUS_LABELS).map(code => (
            <span key={code} className="flex items-center gap-1"><StatusBadge code={code} /></span>
          ))}
        </div>
      </div>
    </div>
  );
}
