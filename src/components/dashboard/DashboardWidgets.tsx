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
  /** Contenu libre sous la tendance (ex. sparkline). */
  children?: React.ReactNode;
}
export function StatCard({ label, value, icon: Icon, accent, accentBg, cardBg, trend, trendUp, to, children }: StatCardProps) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-all active:scale-[0.98] relative overflow-hidden"
      style={{
        background: cardBg ?? 'var(--tblr-surface)',
        border: `1px solid ${cardBg ? accent + '33' : 'var(--tblr-border)'}`,
        boxShadow: ELEVATED_SHADOW,
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
      {children}
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
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: ELEVATED_SHADOW }}
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

// ── Tableau de bord administrateur, mise en page inspirée de Sneat : une
// section d'accueil, une grille partitionnée en cartes de tailles différentes,
// des fonds teintés, des icônes en filigrane et des ombres portées pour le
// relief. La couleur porte aussi la donnée (séries, statuts, catégories).

export const ELEVATED_SHADOW = '0 2px 6px 0 rgba(67, 89, 113, 0.12)';

export const STATUS_GROUP_COLORS: Record<string, string> = {
  active: '#206bc4',
  planning: '#f59f00',
  on_hold: '#d63939',
  completed: '#2fb344',
  other: '#94a3b8',
};
export const REVENUE_INVOICED_COLOR = '#74c0fc';
export const REVENUE_PAID_COLOR = '#206bc4';
export const CATEGORY_COLORS = ['#206bc4', '#ae3ec9', '#f76707', '#2fb344', '#0ca678', '#e64980'];

/** Carte d'accueil : message à gauche, illustration à droite. */
export function HeroCard({ title, children, action }: { title: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      className="relative rounded-xl overflow-hidden h-full flex"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: ELEVATED_SHADOW }}
    >
      <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col gap-2 relative z-10">
        <h2 className="text-lg font-bold" style={{ color: 'var(--tblr-primary)' }}>{title}</h2>
        <div className="text-[13px] leading-relaxed max-w-md" style={{ color: 'var(--tblr-muted)' }}>{children}</div>
        {action && <div className="mt-auto pt-3">{action}</div>}
      </div>
      <div className="hidden sm:flex items-end shrink-0 pr-4 pt-4">
        <HeroIllustration />
      </div>
    </div>
  );
}

/** Illustration de l'accueil : un immeuble en chantier, une grue et un plan. */
export function HeroIllustration() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" fill="none" aria-hidden="true">
      <ellipse cx="110" cy="146" rx="88" ry="4" fill="#206bc4" opacity="0.12" />
      {/* Grue */}
      <rect x="36" y="22" width="5" height="124" fill="#f59f00" />
      <path d="M36 30 L41 22 M36 46 L41 38 M36 62 L41 54 M36 78 L41 70 M36 94 L41 86 M36 110 L41 102" stroke="#e67700" strokeWidth="1.5" />
      <rect x="14" y="18" width="110" height="5" rx="1" fill="#f59f00" />
      <rect x="14" y="23" width="12" height="9" rx="1" fill="#495057" />
      <line x1="104" y1="23" x2="104" y2="58" stroke="#495057" strokeWidth="1.2" />
      <rect x="96" y="58" width="16" height="7" rx="1" fill="#206bc4" />
      <path d="M38.5 18 L38.5 8 M38.5 8 L20 18 M38.5 8 L120 18" stroke="#adb5bd" strokeWidth="1" />
      {/* Immeuble */}
      <rect x="70" y="72" width="62" height="74" rx="2" fill="#206bc4" />
      <rect x="70" y="72" width="62" height="6" fill="#1a5aa6" />
      {[0, 1, 2, 3].map(r => [0, 1, 2].map(c => (
        <rect key={`${r}-${c}`} x={78 + c * 18} y={84 + r * 14} width="10" height="8" rx="1" fill={(r + c) % 3 === 0 ? '#ffd43b' : '#d0ebff'} />
      )))}
      <rect x="95" y="134" width="12" height="12" fill="#1a5aa6" />
      {/* Échafaudage du dernier niveau */}
      <path d="M70 72 V58 H132 V72 M91 58 V72 M111 58 V72" stroke="#adb5bd" strokeWidth="1.2" />
      {/* Bâtiment voisin */}
      <rect x="138" y="96" width="36" height="50" rx="2" fill="#ae3ec9" opacity="0.85" />
      {[0, 1, 2].map(r => (
        <rect key={r} x="146" y={104 + r * 13} width="20" height="6" rx="1" fill="#f3d9fa" />
      ))}
      {/* Plan roulé et arbre */}
      <rect x="150" y="136" width="30" height="7" rx="3.5" fill="#e9ecef" stroke="#adb5bd" />
      <circle cx="186" cy="118" r="10" fill="#2fb344" opacity="0.85" />
      <rect x="185" y="126" width="2" height="20" fill="#495057" />
    </svg>
  );
}

/** Jauge circulaire (0–100) avec valeur centrale. */
export function RadialGauge({ value, label, color = REVENUE_PAID_COLOR, size = 150 }: { value: number; label: string; color?: string; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = 0.75; // arc de 270°, ouvert en bas
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tblr-border)" strokeWidth={stroke}
          strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${(c * arc * v) / 100} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: 'var(--tblr-text)' }}>{Math.round(v)} %</span>
        <span className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
      </div>
    </div>
  );
}

/** Petite ligne d'évolution sans axes, pour une carte d'indicateur. */
export function Sparkline({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  const w = 120;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => [i * step, height - 4 - (d / max) * (height - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `spark-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="var(--tblr-surface)" stroke={color} strokeWidth="2" />}
    </svg>
  );
}

/** Liste classée avec barre proportionnelle colorée. */
export function RankedBars({ rows, muted }: { rows: { name: string; count: number; pct: number }[]; muted?: string }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const isMuted = r.name === muted;
        const color = isMuted ? '#adb5bd' : CATEGORY_COLORS[i % CATEGORY_COLORS.length];
        return (
          <li key={r.name} className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: color + '1f', color }}>
              {r.count}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className={`text-[13px] truncate ${isMuted ? 'italic' : 'font-medium'}`} style={{ color: isMuted ? 'var(--tblr-muted)' : 'var(--tblr-text)' }} title={r.name}>
                  {r.name}
                </span>
                <span className="text-[12px] tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>{r.pct} %</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }}>
                <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: color }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
