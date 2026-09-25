import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { IconTrendingUp, IconTrendingDown } from '@tabler/icons-react';

export const PIE_COLORS = ['#2fb344', '#206bc4', '#f76707', '#6c7a91'];
export const BAR_COLOR = '#206bc4';
export const BUDGET_ESTIMATED_COLOR = '#6c7a91';
export const BUDGET_ACTUAL_COLOR = '#2fb344';

export const formatEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'In Progress': { bg: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' },
    'Completed':   { bg: '#d3f9d8',                color: '#2f9e44' },
    'Planning':    { bg: '#fff3bf',                color: '#e67700' },
    'On Hold':     { bg: '#ffe3e3',                color: '#c92a2a' },
  };
  const s = map[status] ?? { bg: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' };
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;       // hex color
  accentBg: string;     // light tint
  cardBg?: string;      // optional card background tint
  trend?: string;
  trendUp?: boolean;
  to?: string;
}
export function StatCard({ label, value, icon: Icon, accent, accentBg, cardBg, trend, trendUp, to }: StatCardProps) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-all active:scale-[0.98] relative overflow-hidden"
      style={{
        background: cardBg ?? 'var(--tblr-surface)',
        border: `1px solid ${cardBg ? accent + '33' : 'var(--tblr-border)'}`,
        boxShadow: 'var(--tblr-shadow)',
      }}
      onClick={() => to && navigate(to)}
    >
      <div
        className="absolute -bottom-3 -right-3 pointer-events-none"
        style={{ color: accent, opacity: 0.12 }}
      >
        <Icon size={80} strokeWidth={1.2} />
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: cardBg ? accent : 'var(--tblr-muted)' }}
        >
          {label}
        </span>
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accentBg, color: accent }}
        >
          <Icon size={16} />
        </span>
      </div>

      <p
        className="text-2xl font-bold leading-none"
        style={{ color: cardBg ? accent : 'var(--tblr-text)' }}
      >
        {value}
      </p>

      {trend && (
        <div className="flex items-center gap-1 text-[11px] font-medium">
          {trendUp !== undefined && (
            trendUp
              ? <IconTrendingUp size={12} style={{ color: '#2fb344' }} />
              : <IconTrendingDown size={12} style={{ color: '#d63939' }} />
          )}
          <span style={{ color: cardBg ? accent + 'cc' : 'var(--tblr-muted)' }}>{trend}</span>
        </div>
      )}
    </div>
  );
}

export function TblrTooltip({ active, payload, label, valueFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 text-[13px] rounded"
      style={{
        background: 'var(--tblr-surface)',
        border: '1px solid var(--tblr-border)',
        boxShadow: 'var(--tblr-shadow)',
        color: 'var(--tblr-text)',
      }}
    >
      {label && <p className="font-semibold mb-1" style={{ color: 'var(--tblr-muted)', fontSize: '11px', textTransform: 'uppercase' }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: p.color || p.payload?.fill }} /><span style={{ color: 'var(--tblr-muted)' }}>{p.name} :</span> <strong className="tabular-nums">{valueFormatter ? valueFormatter(p.value) : p.value}</strong></p>
      ))}
    </div>
  );
}

export function SectionCard({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--tblr-border)' }}
      >
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function QuickAction({ icon: Icon, label, to, color }: { icon: React.ElementType; label: string; to: string; color: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all active:scale-95 flex-1"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
    >
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center"
        style={{ background: color + '18', color }}
      >
        <Icon size={22} />
      </span>
      <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--tblr-muted)' }}>
        {label}
      </span>
    </button>
  );
}

// ── Tableau de bord administrateur : présentation sobre, en nuances de gris.
// La couleur est réservée à la donnée (séries, statuts) et aux alertes, plus
// aux fonds de cartes : huit cartes teintées avec icône filigrane se
// disputaient l'attention sans hiérarchie.

export const STATUS_GROUP_COLORS: Record<string, string> = {
  active: '#206bc4',
  planning: '#f59f00',
  on_hold: '#d63939',
  completed: '#2fb344',
  other: '#94a3b8',
};
export const REVENUE_INVOICED_COLOR = '#cbd5e1';
export const REVENUE_PAID_COLOR = '#206bc4';

type Tone = 'default' | 'danger' | 'success';
const TONE_COLOR: Record<Tone, string> = { default: 'var(--tblr-muted)', danger: '#d63939', success: '#2f9e44' };

export function KpiTile({ label, value, hint, hintTone = 'default', icon: Icon, to, progress }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: Tone;
  icon: React.ElementType;
  to?: string;
  /** 0–100 : fine jauge sous la valeur (ex. taux d'encaissement). */
  progress?: number;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => to && navigate(to)}
      className={`text-left rounded-xl p-4 flex flex-col gap-3 transition-colors ${to ? 'hover:border-[var(--tblr-text)] cursor-pointer' : 'cursor-default'}`}
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
        <Icon size={16} style={{ color: 'var(--tblr-muted)' }} className="shrink-0" />
      </div>
      <p className="text-[26px] font-bold leading-none tabular-nums tracking-tight" style={{ color: 'var(--tblr-text)' }}>{value}</p>
      {progress !== undefined && (
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: 'var(--tblr-text)' }} />
        </div>
      )}
      {hint && (
        <p className="text-[12px] flex items-center gap-1.5" style={{ color: TONE_COLOR[hintTone] }}>
          {hintTone !== 'default' && <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: TONE_COLOR[hintTone] }} />}
          {hint}
        </p>
      )}
    </button>
  );
}

export function MiniStatStrip({ items }: { items: { label: string; value: React.ReactNode; to?: string; tone?: Tone }[] }) {
  const navigate = useNavigate();
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 rounded-xl overflow-hidden"
      style={{ background: 'var(--tblr-border)', gap: 1, border: '1px solid var(--tblr-border)' }}
    >
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          onClick={() => item.to && navigate(item.to)}
          className={`text-left px-4 py-3 flex items-baseline justify-between gap-2 ${item.to ? 'cursor-pointer' : 'cursor-default'}`}
          style={{ background: 'var(--tblr-surface)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{item.label}</span>
          <span className="text-[17px] font-bold tabular-nums" style={{ color: item.tone && item.tone !== 'default' ? TONE_COLOR[item.tone] : 'var(--tblr-text)' }}>
            {item.value}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Liste classée avec barre proportionnelle : plus lisible qu'un bar chart pour quelques catégories à libellés longs. */
export function RankedBars({ rows, muted }: { rows: { name: string; count: number; pct: number }[]; muted?: string }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <ul className="space-y-3">
      {rows.map(r => {
        const isMuted = r.name === muted;
        return (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className={`text-[13px] truncate ${isMuted ? 'italic' : 'font-medium'}`} style={{ color: isMuted ? 'var(--tblr-muted)' : 'var(--tblr-text)' }} title={r.name}>
                {r.name}
              </span>
              <span className="text-[12px] tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                <strong style={{ color: 'var(--tblr-text)' }}>{r.count}</strong> · {r.pct} %
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.count / max) * 100}%`, background: isMuted ? '#cbd5e1' : 'var(--tblr-text)', opacity: isMuted ? 1 : 0.85 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
