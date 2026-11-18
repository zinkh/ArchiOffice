// Bandeau de chiffres en tête d'un atelier partagé, comme les cartes de suivi de la fiche du cabinet.
// La couleur ne sert qu'à porter une donnée (un retard), jamais à décorer.
export interface SharedKpi { label: string; value: string | number; tone?: 'neutral' | 'danger' | 'ok' }

const TONE: Record<NonNullable<SharedKpi['tone']>, string> = {
  neutral: 'var(--tblr-text)',
  danger: '#b91c1c',
  ok: '#15803d',
};

export default function SharedKpis({ items }: { items: SharedKpi[] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map(item => (
        <div key={item.label} className="rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{item.label}</dt>
          <dd className="text-xl font-bold tabular-nums" style={{ color: TONE[item.tone ?? 'neutral'] }}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
