import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MotionConfig, motion, useInView } from 'motion/react';
import {
  IconFileText,
  IconRss,
  IconFileCode,
  IconCalendar,
  IconFileInvoice,
  IconMapPin,
} from '@tabler/icons-react';
import { ArchiOfficeLogo } from '../components/ArchiOfficeLogo';

// Implementation of the Claude Design handoff "ArchiOffice Landing v3".
// The previous landing page is kept in pages/archive/LandingV1.tsx.

const GITHUB_URL = 'https://github.com/zinkh/ArchiOffice';

const FEATURES = [
  { icon: IconFileText, key: 'devis' },
  { icon: IconRss, key: 'ao' },
  { icon: IconFileCode, key: 'cctp' },
  { icon: IconCalendar, key: 'gantt' },
  { icon: IconFileInvoice, key: 'factures' },
  { icon: IconMapPin, key: 'cadastre' },
] as const;

const PRICING_TIERS = [
  { key: 'tier1', featureCount: 4, popular: false, perMonth: true },
  { key: 'tier2', featureCount: 4, popular: true, perMonth: true },
  { key: 'tier3', featureCount: 3, popular: false, perMonth: false },
] as const;

const HERO_TAGS = ['CCTP / DPGF', 'Loi MOP', 'Factur-X', 'Chorus Pro', 'PLU'];

// Only profiles with a URL are rendered: fill these in once the accounts exist.
const SOCIAL_LINKS: { label: string; href: string; icon: ReactNode }[] = [
  {
    label: 'LinkedIn',
    href: '',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>,
  },
  {
    label: 'X',
    href: '',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z" /></svg>,
  },
  {
    label: 'Instagram',
    href: '',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>,
  },
  {
    label: 'YouTube',
    href: '',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" /></svg>,
  },
  {
    label: 'GitHub',
    href: GITHUB_URL,
    icon: <GithubMark size={20} />,
  },
];

function GithubMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}

/** Scroll-triggered reveal: rises into place once, staggered by `index` (capped, 70ms steps). */
function Reveal({ children, index = 0, className, style }: { children: ReactNode; index?: number; className?: string; style?: CSSProperties }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1], delay: Math.min(index, 6) * 0.07 }}
    >
      {children}
    </motion.div>
  );
}

function Arrow() {
  return <span className="aol-btn-arrow" aria-hidden="true">→</span>;
}

function ChevronHead() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M12 6 L32 20 L12 34" fill="none" stroke="#0f1a26" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LandingHeader() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Close the sheet when the layout goes back to desktop.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 859px)');
    const onChange = () => { if (!mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const links = [
    { href: '#plateforme', label: t('landing3_nav_platform') },
    { href: '#fonctionnalites', label: t('landing3_nav_features') },
    { href: '#actualites', label: t('landing3_nav_news') },
    { href: '#tarifs', label: t('landing3_nav_pricing') },
  ];

  return (
    <header className="aol-header">
      <div className="aol-header-bar">
        <a href="#top" className="aol-brand">
          <ArchiOfficeLogo size={28} />
          <span className="aol-brand-name">ArchiOffice</span>
        </a>
        <nav className="aol-nav">
          {links.map(l => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        <div className="aol-header-actions">
          <Link to="/login" className="aol-header-login">{t('landing3_nav_login')}</Link>
          <Link to="/register" className="aol-btn aol-btn-ink aol-header-cta">{t('landing3_nav_cta')}</Link>
        </div>
        <button
          type="button"
          className="aol-burger"
          onClick={() => setOpen(o => !o)}
          aria-label={t('landing3_nav_menu')}
          aria-expanded={open}
          aria-controls="aol-mobile-menu"
        >
          <span /><span /><span />
        </button>
      </div>
      <div id="aol-mobile-menu" className={`aol-sheet${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
        {/* Remounted on each open so the staggered entrance replays. */}
        <nav key={String(open)} className="aol-sheet-nav">
          {links.map((l, i) => (
            <a key={l.href} href={l.href} onClick={close} style={{ animationDelay: `${i * 0.05}s` }}>{l.label}</a>
          ))}
          <Link to="/login" onClick={close} style={{ animationDelay: '.2s' }}>{t('landing3_nav_login')}</Link>
        </nav>
        <Link to="/register" onClick={close} className="aol-btn aol-btn-ink aol-sheet-cta" style={{ animationDelay: '.25s' }}>
          {t('landing3_trial_cta')}
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  const { t } = useTranslation();

  return (
    <section id="top" className="aol-hero">
      <div className="aol-wrap">
        <div className="aol-hero-kicker aol-rise">
          <a href={GITHUB_URL} className="aol-oss-pill" target="_blank" rel="noreferrer">
            <GithubMark size={14} />
            {t('landing3_hero_oss')}
          </a>
          <span className="aol-hero-tagline">{t('landing3_hero_tagline')}</span>
        </div>
        <h1 className="aol-rise">
          {t('landing3_hero_title')} <em>{t('landing3_hero_title_accent')}</em>
        </h1>
        <div className="aol-hero-row aol-rise">
          <p>
            {t('landing3_hero_subtitle_before')}
            <strong>{t('landing3_hero_subtitle_strong')}</strong>
            {t('landing3_hero_subtitle_after')}
          </p>
          <div className="aol-hero-ctas">
            <Link to="/register" className="aol-btn aol-btn-lg aol-btn-hero">
              {t('landing3_hero_cta_primary')} <Arrow />
            </Link>
            <a href="#plateforme" className="aol-btn aol-btn-lg aol-btn-outline aol-btn-hero-alt">
              {t('landing3_hero_cta_secondary')}
            </a>
          </div>
        </div>
        <div className="aol-hero-media aol-rise">
          <img src="/landing/hero-dashboard.webp" alt={t('landing3_hero_media_alt')} width={1672} height={941} fetchPriority="high" />
        </div>
        <div className="aol-hero-foot">
          <div className="aol-hero-tags">
            {HERO_TAGS.map(tag => <span key={tag}>{tag}</span>)}
          </div>
          <p>{t('landing3_hero_foot')}</p>
        </div>
      </div>
    </section>
  );
}

/** "more design, less paperasse." drawn with simple shapes; plays once on entering the viewport. */
function Manifesto() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const d = (delay: number, extra?: CSSProperties): CSSProperties => ({ animationDelay: `${delay}s`, ...extra });

  return (
    <section id="manifeste" className="aol-manifeste">
      <div ref={ref} className={`aol-manifeste-card${inView ? ' is-on' : ''}`}>
        <div className="aol-mf" role="img" aria-label={t('landing3_manifesto_label')}>
          <div className="aol-mf-row" aria-hidden="true">
            <span className="aol-mf-pop aol-mf-ring" style={d(0)} />
            <span className="aol-mf-line" style={d(0.15)}><span /></span>
            <span className="aol-mf-pop aol-mf-dot" style={d(0.25, { width: '1em', height: '1em', background: '#f0592a', animationDuration: '.6s' })} />
            <span className="aol-mf-line" style={d(0.5)}><span /><ChevronHead /></span>
            <span className="aol-mf-pop aol-mf-tri" style={d(0.7)} />
            <span className="aol-mf-word" style={d(0.8)}>{t('landing3_manifesto_more')}</span>
            <span className="aol-mf-stack">
              <svg viewBox="0 0 40 40" className="aol-mf-pop" style={d(1, { width: '.4em', height: '.4em' })} aria-hidden="true">
                <path d="M8 32 L32 8 M14 8 H32 V26" fill="none" stroke="#0f1a26" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="aol-mf-dot" style={{ width: '.42em', height: '.42em', background: '#3d6be0', animation: 'aol-bob 2.4s 1.6s ease-in-out infinite alternate' }} />
            </span>
          </div>
          <div className="aol-mf-row" aria-hidden="true">
            <span className="aol-mf-word" style={d(0.95)}>{t('landing3_manifesto_design')}</span>
            <span className="aol-mf-pill" style={d(1.15)}><span style={d(2.3)}><span /></span></span>
            <span className="aol-mf-pop" style={d(1.5, { fontSize: '.4em', animationDuration: '.4s' })}>×</span>
            <span className="aol-mf-pop aol-mf-dot" style={d(1.6, { width: '.7em', height: '.7em', background: '#3aa565' })} />
          </div>
          <div className="aol-mf-row" aria-hidden="true">
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              <span className="aol-mf-half" style={d(1.25, { background: '#a15bd6' })} />
              <span className="aol-mf-half" style={d(1.4, { background: '#3aa565' })} />
            </span>
            <span className="aol-mf-line" style={d(1.45)}><span /><ChevronHead /></span>
            <span className="aol-mf-word" style={d(1.5)}>{t('landing3_manifesto_less')}</span>
            <span className="aol-mf-pill" style={d(1.7)}><span style={d(3.1)}><span /></span></span>
            <span className="aol-mf-half" style={d(2, { background: '#3aa565' })} />
          </div>
          <div className="aol-mf-row" aria-hidden="true">
            <span className="aol-mf-line is-dashed" style={d(1.9)}><span /><ChevronHead /></span>
            <span className="aol-mf-word" style={d(1.85)}>{t('landing3_manifesto_paperwork')}</span>
            <svg
              viewBox="0 0 40 40"
              style={{ width: '.3em', height: '.3em', flexShrink: 0, alignSelf: 'flex-end', marginBottom: '.12em', animation: 'aol-spin 14s 2.4s linear infinite' }}
              aria-hidden="true"
            >
              <g fill="none" stroke="#0f1a26" strokeWidth="3.5">
                <ellipse cx="20" cy="20" rx="7" ry="17" />
                <ellipse cx="20" cy="20" rx="7" ry="17" transform="rotate(60 20 20)" />
                <ellipse cx="20" cy="20" rx="7" ry="17" transform="rotate(120 20 20)" />
              </g>
              <circle cx="20" cy="20" r="4" fill="#0f1a26" />
            </svg>
          </div>
        </div>
        <p className="aol-lead aol-mf-caption">{t('landing3_manifesto_caption')}</p>
      </div>
    </section>
  );
}

function Platform() {
  const { t } = useTranslation();

  return (
    <section id="plateforme" className="aol-plateforme">
      <div className="aol-wrap aol-split">
        <Reveal>
          <div className="aol-eyebrow" style={{ marginBottom: 26 }}>{t('landing3_platform_eyebrow')}</div>
          <h2 className="aol-h2">{t('landing3_platform_title')}</h2>
          <p className="aol-lead">{t('landing3_platform_desc')}</p>
          <a href="#fonctionnalites" className="aol-btn aol-btn-md aol-btn-ink">
            {t('landing3_platform_cta')} <Arrow />
          </a>
        </Reveal>
        <Reveal index={1} className="aol-media-card">
          <div className="aol-cover" style={{ aspectRatio: '972 / 820', background: '#f8f6f1' }}>
            <img src="/landing/plateforme-ecosysteme.webp" alt={t('landing3_platform_media_alt')} width={972} height={820} loading="lazy" />
          </div>
          <div className="aol-stats">
            {[1, 2, 3].map(n => (
              <div key={n}>
                <div className="aol-stat-value">{t(`landing3_platform_stat${n}_value`)}</div>
                <div className="aol-stat-label">{t(`landing3_platform_stat${n}_label`)}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Marquee() {
  const { t } = useTranslation();
  const items = [1, 2, 3, 4].map(n => t(`landing3_marquee_${n}`));

  return (
    <div className="aol-marquee">
      <div className="aol-marquee-track">
        {[0, 1].map(copy => (
          <div key={copy} aria-hidden={copy === 1 || undefined}>
            {items.flatMap((item, i) => [<span key={i}>{item}</span>, <span key={`s${i}`} aria-hidden="true">•</span>])}
          </div>
        ))}
      </div>
    </div>
  );
}

function Agents() {
  const { t } = useTranslation();

  return (
    <section className="aol-agents">
      <Reveal className="aol-wrap aol-agents-card">
        <div className="aol-cover" style={{ aspectRatio: '1032 / 340', background: '#f4f1ec' }}>
          <img src="/landing/agents-journee.webp" alt={t('landing3_agents_media_alt')} width={1032} height={340} loading="lazy" />
        </div>
        <div className="aol-agents-body">
          <h2 className="aol-h2">{t('landing3_agents_title')}</h2>
          <p>{t('landing3_agents_desc')}</p>
          <div className="aol-btn-row">
            <a href="#tarifs" className="aol-btn aol-btn-md aol-btn-ink">{t('landing3_agents_cta')}</a>
            <a href="#actualites" className="aol-btn aol-btn-md aol-btn-outline">{t('landing3_agents_cta_secondary')}</a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function VideoBand() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Muted autoplay, unless the visitor asked for reduced motion.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      v.pause();
      return;
    }
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  return (
    <section className="aol-video">
      <Reveal className="aol-wrap aol-video-card">
        <video ref={videoRef} src="/landing/chantier.mp4" muted loop playsInline preload="metadata" aria-hidden="true" />
        <div className="aol-video-shade" />
        <div className="aol-video-body">
          <h2>{t('landing3_video_title')}</h2>
          <div>
            <p>{t('landing3_video_desc')}</p>
            <Link to="/register" className="aol-btn aol-btn-md aol-btn-white">
              {t('landing3_trial_cta')} <Arrow />
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Features() {
  const { t } = useTranslation();

  return (
    <section id="fonctionnalites" className="aol-features">
      <div className="aol-wrap">
        <Reveal className="aol-section-head">
          <h2 className="aol-h2">{t('landing3_features_title')}</h2>
          <p>{t('landing3_features_subtitle')}</p>
        </Reveal>
        <Reveal className="aol-cover aol-features-banner">
          <img src="/landing/fonctionnalites-plan-batiment.webp" alt={t('landing3_features_media_alt')} width={2172} height={724} loading="lazy" />
        </Reveal>
        <div className="aol-grid">
          {FEATURES.map(({ icon: Icon, key }, i) => (
            <Reveal key={key} index={i}>
              <div className="aol-feature">
                <div className="aol-feature-icon"><Icon size={22} stroke={2} /></div>
                <h3>{t(`landing3_feature_${key}_title`)}</h3>
                <p>{t(`landing3_feature_${key}_desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function News() {
  const { t } = useTranslation();

  return (
    <section id="actualites" className="aol-news">
      <div className="aol-wrap">
        <Reveal className="aol-section-head">
          <h2 className="aol-h2">{t('landing3_news_title')}</h2>
          <a href="#actualites" className="aol-btn aol-btn-outline aol-news-head-btn">{t('landing3_news_all')}</a>
        </Reveal>
        <div className="aol-news-grid">
          {[1, 2, 3, 4].map((n, i) => (
            <Reveal key={n} index={i}>
              <article className="aol-article">
                <div className="aol-eyebrow">{t(`landing3_news${n}_tag`)}</div>
                <h3>{t(`landing3_news${n}_title`)}</h3>
                <p>{t(`landing3_news${n}_desc`)}</p>
                <a href="#actualites">{t('landing3_news_read_more')}</a>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Beliefs() {
  const { t } = useTranslation();

  return (
    <section className="aol-convictions">
      <div className="aol-wrap aol-split">
        <Reveal>
          <div className="aol-eyebrow">{t('landing3_beliefs_eyebrow')}</div>
          <h2>{t('landing3_beliefs_title')}</h2>
          <p className="aol-convictions-intro">{t('landing3_beliefs_intro')}</p>
          <Link to="/register" className="aol-btn aol-btn-md aol-btn-white">{t('landing3_beliefs_cta')}</Link>
        </Reveal>
        <Reveal index={1}>
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} className="aol-belief">
              <h3>{t(`landing3_belief${n}_title`)}</h3>
              <p>
                {t(`landing3_belief${n}_desc`)}
                {n === 5 && <> <a href={GITHUB_URL} target="_blank" rel="noreferrer">{t('landing3_github')}</a></>}
              </p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function Pricing() {
  const { t } = useTranslation();

  return (
    <section id="tarifs" className="aol-pricing">
      <div className="aol-wrap">
        <Reveal className="aol-pricing-head">
          <h2 className="aol-h2">{t('landing3_pricing_title')}</h2>
          <p>{t('landing3_pricing_subtitle')}</p>
        </Reveal>
        <div className="aol-pricing-grid">
          {PRICING_TIERS.map(({ key, featureCount, popular, perMonth }, i) => (
            <Reveal key={key} index={i}>
              <div className={`aol-tier${popular ? ' is-popular' : ''}`}>
                {popular && <span className="aol-tier-badge">{t('landing3_pricing_popular')}</span>}
                <h3>{t(`landing3_pricing_${key}_name`)}</h3>
                <div className="aol-tier-price">
                  {t(`landing3_pricing_${key}_price`)}
                  {perMonth && <small>{t('landing3_pricing_per_month')}</small>}
                </div>
                <p className="aol-tier-desc">{t(`landing3_pricing_${key}_desc`)}</p>
                <ul>
                  {Array.from({ length: featureCount }, (_, idx) => idx + 1).map(n => (
                    <li key={n}>{t(`landing3_pricing_${key}_feat${n}`)}</li>
                  ))}
                </ul>
                <Link to="/register" className={`aol-btn ${popular ? 'aol-btn-blue' : 'aol-btn-outline'}`}>
                  {t(`landing3_pricing_${key}_cta`)}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { t } = useTranslation();

  return (
    <section className="aol-final">
      <div className="aol-final-card">
        <Reveal><h2>{t('landing3_final_title')}</h2></Reveal>
        <Reveal index={1}>
          <p>{t('landing3_final_subtitle')}</p>
          <Link to="/register" className="aol-btn aol-btn-white aol-btn-white-ink">
            {t('landing3_trial_cta')} <Arrow />
          </Link>
          <p className="aol-final-note">{t('landing3_final_note')}</p>
        </Reveal>
      </div>
    </section>
  );
}

function LandingFooter() {
  const { t } = useTranslation();

  return (
    <footer className="aol-footer">
      <div className="aol-wrap">
        <div className="aol-footer-top">
          <Reveal className="aol-footer-brand">
            <ArchiOfficeLogo size={64} />
            <span>ArchiOffice</span>
          </Reveal>
          <Reveal index={1} className="aol-footer-cols">
            <nav>
              <div className="aol-eyebrow">{t('landing3_footer_col_platform')}</div>
              <a href="#plateforme">{t('landing3_footer_projects')}</a>
              <a href="#fonctionnalites">{t('landing3_nav_features')}</a>
              <a href="#tarifs">{t('landing3_nav_pricing')}</a>
            </nav>
            <nav>
              <div className="aol-eyebrow">{t('landing3_footer_col_firm')}</div>
              <a href="#actualites">{t('landing3_nav_news')}</a>
              <Link to="/login">{t('landing3_nav_login')}</Link>
              <Link to="/register">{t('landing3_footer_register')}</Link>
            </nav>
          </Reveal>
          <Reveal index={2} className="aol-socials">
            {SOCIAL_LINKS.filter(s => s.href).map(s => (
              <a key={s.label} href={s.href} aria-label={s.label} title={s.label} className="aol-social" target="_blank" rel="noreferrer">
                {s.icon}
              </a>
            ))}
          </Reveal>
        </div>
        <div className="aol-footer-bottom">
          <p>{t('footer_rights')}</p>
          <nav className="aol-footer-legal">
            <Link to="/privacy">{t('footer_privacy')}</Link>
            <Link to="/terms">{t('footer_terms')}</Link>
          </nav>
        </div>
        <p className="aol-footer-note">
          {t('landing3_footer_note')}{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">{t('landing3_footer_code_link')}</a>
        </p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="aol">
        <LandingHeader />
        <Hero />
        <Manifesto />
        <Platform />
        <Marquee />
        <Agents />
        <VideoBand />
        <Features />
        <News />
        <Beliefs />
        <Pricing />
        <FinalCTA />
        <LandingFooter />
      </div>
    </MotionConfig>
  );
}
