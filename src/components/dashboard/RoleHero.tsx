import * as React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconChevronRight } from '@tabler/icons-react';
import { buildHeroContent, type HeroRole, type HeroStats } from '../../lib/dashboardHero';
import { HeroCard, formatEur } from './DashboardWidgets';

interface RoleHeroProps {
  role: HeroRole;
  name: string;
  stats: HeroStats;
}

/** Panneau d'accueil commun à tous les profils : le message change, pas la carte. */
export default function RoleHero({ role, name, stats }: RoleHeroProps) {
  const { t } = useTranslation();
  const content = React.useMemo(() => buildHeroContent(role, stats, formatEur), [role, stats]);
  const firstName = name.trim().split(/\s+/)[0] ?? '';

  return (
    <HeroCard
      title={firstName ? t('dashboard_hero_title', { name: firstName }) : t('dashboard_hero_title_anon')}
      action={
        <Link
          to={content.cta.to}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors"
          style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
        >
          {t(content.cta.key)}
          <IconChevronRight size={14} />
        </Link>
      }
    >
      {content.lines.map((line, i) => (
        <p key={i} className={i > 0 ? 'mt-1' : undefined}>
          {line.map((part, j) => {
            const raw = t(part.key, part.params);
            const text = /[.!?]$/.test(raw) ? raw : `${raw}.`;
            return (
              <React.Fragment key={part.key}>
                {j > 0 && ' '}
                {part.alert ? <strong style={{ color: '#d63939' }}>{text}</strong> : text}
              </React.Fragment>
            );
          })}
        </p>
      ))}
    </HeroCard>
  );
}
