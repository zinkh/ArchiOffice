import { ElementType } from 'react';
import {
  IconExternalLink, IconMapPin, IconBuildingBank, IconCurrencyEuro, IconCalendar,
  IconClockHour4, IconRss, IconTag
} from '@tabler/icons-react';
import { formatCurrency } from '../../lib/utils';
import type { TenderRssMatch } from '../../types';

export type TFn = (key: string, opts?: Record<string, any>) => string;

const STATUS_COLORS: Record<TenderRssMatch['status'], { bg: string; fg: string }> = {
  new: { bg: 'var(--tblr-primary-lt)', fg: 'var(--tblr-primary)' },
  read: { bg: 'var(--tblr-surface-2)', fg: 'var(--tblr-muted)' },
  watched: { bg: 'var(--tblr-warning-lt)', fg: 'var(--tblr-warning)' },
  dismissed: { bg: 'var(--tblr-surface-2)', fg: 'var(--tblr-muted)' },
  converted: { bg: 'var(--tblr-success-lt)', fg: 'var(--tblr-success)' },
};

export function statusLabel(status: TenderRssMatch['status'], t: TFn): string {
  switch (status) {
    case 'new': return t('tender_rss_status_new');
    case 'read': return t('tender_rss_status_read');
    case 'watched': return t('tender_rss_status_watched');
    case 'dismissed': return t('tender_rss_status_dismissed');
    case 'converted': return t('tender_rss_status_converted');
  }
}

export function StatusBadge({ status, t }: { status: TenderRssMatch['status']; t: TFn }) {
  const colors = STATUS_COLORS[status];
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {statusLabel(status, t)}
    </span>
  );
}

// ── Detail panel content — shared between the "Veille RSS" and "Annonces
// sélectionnées" tabs, and between the desktop sidebar and the mobile
// bottom sheet within each. ──
export function MatchDetailContent({ match, t }: { match: TenderRssMatch; t: TFn }) {
  const fields: { icon: ElementType; label: string; value: string | null }[] = [
    { icon: IconRss, label: t('tender_rss_field_source'), value: match.source_name ?? null },
    { icon: IconTag, label: t('tender_rss_field_status'), value: statusLabel(match.status, t) },
    { icon: IconCalendar, label: t('tender_rss_field_pub_date'), value: match.pub_date ? new Date(match.pub_date).toLocaleDateString('fr-FR') : null },
    { icon: IconClockHour4, label: t('tender_rss_field_detected_at'), value: match.created_at ? new Date(match.created_at).toLocaleString('fr-FR') : null },
    { icon: IconMapPin, label: t('tender_rss_field_ville'), value: match.ville_execution ?? null },
    { icon: IconBuildingBank, label: t('tender_rss_field_pouvoir_adjudicateur'), value: match.pouvoir_adjudicateur ?? null },
    { icon: IconCurrencyEuro, label: t('tender_rss_field_montant'), value: match.montant_travaux ? formatCurrency(match.montant_travaux) : null },
    { icon: IconCalendar, label: t('tender_rss_field_date_limite'), value: match.date_limite_reponse ? new Date(match.date_limite_reponse).toLocaleDateString('fr-FR') : null },
  ].filter(f => f.value);

  return (
    <div className="space-y-4">
      {fields.length > 0 && (
        <div className="space-y-2.5 rounded-lg p-3" style={{ background: 'var(--tblr-surface-2)' }}>
          {fields.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <f.icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--tblr-muted)' }} />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{f.label}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{f.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {match.description && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_description_label')}</p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--tblr-text)' }}>{match.description}</p>
        </div>
      )}

      {match.link && (
        <a
          href={match.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--tblr-primary)' }}
        >
          <IconExternalLink size={13} />
          {t('tender_rss_open_source')}
        </a>
      )}
    </div>
  );
}
