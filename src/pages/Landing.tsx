import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  IconMenu2,
  IconX,
  IconCheck,
  IconArrowRight,
  IconFileText,
  IconRss,
  IconFileCode,
  IconCalendar,
  IconFileInvoice,
  IconMapPin,
} from '@tabler/icons-react';
import { BrandLogo } from '../components/ArchiOfficeLogo';
import i18n, { changeLanguageLazy } from '../i18n';

const FEATURES = [
  { icon: IconFileText, titleKey: 'landing_feature_devis_title', descKey: 'landing_feature_devis_desc' },
  { icon: IconRss, titleKey: 'landing_feature_ao_title', descKey: 'landing_feature_ao_desc' },
  { icon: IconFileCode, titleKey: 'landing_feature_cctp_title', descKey: 'landing_feature_cctp_desc' },
  { icon: IconCalendar, titleKey: 'landing_feature_gantt_title', descKey: 'landing_feature_gantt_desc' },
  { icon: IconFileInvoice, titleKey: 'landing_feature_factures_title', descKey: 'landing_feature_factures_desc' },
  { icon: IconMapPin, titleKey: 'landing_feature_cadastre_title', descKey: 'landing_feature_cadastre_desc' },
] as const;

const HOW_IT_WORKS_STEPS = [1, 2, 3, 4] as const;

const PRICING_TIERS = [
  { key: 'tier1', featureCount: 4, popular: false },
  { key: 'tier2', featureCount: 4, popular: true },
  { key: 'tier3', featureCount: 3, popular: false },
] as const;

const fadeInUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

function LandingNav() {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--tblr-surface) 92%, transparent)', borderColor: 'var(--tblr-border)' }}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2 shrink-0">
          <BrandLogo size={28} />
          <span className="font-semibold text-base" style={{ color: 'var(--tblr-text)' }}>ArchiOffice</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium" style={{ color: 'var(--tblr-muted)' }}>
          <a href="#fonctionnalites" className="hover:opacity-80" style={{ color: 'inherit' }}>{t('landing_nav_features')}</a>
          <a href="#comment-ca-marche" className="hover:opacity-80" style={{ color: 'inherit' }}>{t('landing_nav_how_it_works')}</a>
          <a href="#tarifs" className="hover:opacity-80" style={{ color: 'inherit' }}>{t('landing_nav_pricing')}</a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <div className="flex rounded-md overflow-hidden text-xs font-medium" style={{ border: '1px solid var(--tblr-border)' }}>
            <button type="button" onClick={() => changeLanguageLazy('fr')} className="px-2.5 py-1.5"
              style={i18n.language.startsWith('fr') ? { background: 'var(--tblr-primary)', color: '#fff' } : { color: 'var(--tblr-muted)' }}>
              FR
            </button>
            <button type="button" onClick={() => changeLanguageLazy('en')} className="px-2.5 py-1.5"
              style={i18n.language.startsWith('en') ? { background: 'var(--tblr-primary)', color: '#fff' } : { color: 'var(--tblr-muted)' }}>
              EN
            </button>
          </div>
          <Link to="/login" className="btn btn-ghost text-sm px-4 py-2">{t('landing_nav_login')}</Link>
          <Link to="/register" className="btn btn-primary text-sm px-4 py-2">{t('landing_nav_cta')}</Link>
        </div>

        <button type="button" className="md:hidden p-2" style={{ color: 'var(--tblr-text)' }} onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
          {mobileOpen ? <IconX size={22} /> : <IconMenu2 size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t px-4 py-4 flex flex-col gap-4 text-sm font-medium" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <a href="#fonctionnalites" onClick={() => setMobileOpen(false)} style={{ color: 'inherit' }}>{t('landing_nav_features')}</a>
          <a href="#comment-ca-marche" onClick={() => setMobileOpen(false)} style={{ color: 'inherit' }}>{t('landing_nav_how_it_works')}</a>
          <a href="#tarifs" onClick={() => setMobileOpen(false)} style={{ color: 'inherit' }}>{t('landing_nav_pricing')}</a>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => changeLanguageLazy('fr')} className="px-3 py-1.5 rounded-md text-xs font-medium"
              style={i18n.language.startsWith('fr') ? { background: 'var(--tblr-primary)', color: '#fff' } : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              FR
            </button>
            <button type="button" onClick={() => changeLanguageLazy('en')} className="px-3 py-1.5 rounded-md text-xs font-medium"
              style={i18n.language.startsWith('en') ? { background: 'var(--tblr-primary)', color: '#fff' } : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              EN
            </button>
          </div>
          <Link to="/login" className="btn btn-secondary text-sm px-4 py-2 justify-center">{t('landing_nav_login')}</Link>
          <Link to="/register" className="btn btn-primary text-sm px-4 py-2 justify-center">{t('landing_nav_cta')}</Link>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden px-4 sm:px-6 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] -z-10"
        style={{ background: 'radial-gradient(600px circle at 50% 0%, var(--tblr-primary-lt), transparent 70%)' }}
      />
      <motion.h1
        {...fadeInUp}
        className="max-w-3xl mx-auto text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1]"
        style={{ color: 'var(--tblr-text)' }}
      >
        {t('landing_hero_title')}
      </motion.h1>
      <motion.p
        {...fadeInUp}
        transition={{ ...fadeInUp.transition, delay: 0.1 }}
        className="max-w-2xl mx-auto mt-6 text-base md:text-lg"
        style={{ color: 'var(--tblr-muted)' }}
      >
        {t('landing_hero_subtitle')}
      </motion.p>
      <motion.div
        {...fadeInUp}
        transition={{ ...fadeInUp.transition, delay: 0.2 }}
        className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3"
      >
        <Link to="/register" className="btn btn-primary text-base px-6 py-3">
          {t('landing_hero_cta_primary')}
          <IconArrowRight size={18} />
        </Link>
        <a href="#fonctionnalites" className="btn btn-secondary text-base px-6 py-3">
          {t('landing_hero_cta_secondary')}
        </a>
      </motion.div>
      <p className="mt-5 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('landing_hero_trust_note')}</p>
    </section>
  );
}

function FeatureGrid() {
  const { t } = useTranslation();

  return (
    <section id="fonctionnalites" className="px-4 sm:px-6 py-20 md:py-28" style={{ background: 'var(--tblr-surface-2)' }}>
      <div className="max-w-[1100px] mx-auto">
        <motion.div {...fadeInUp} className="max-w-2xl mx-auto text-center mb-14">
          <div className="subheader mb-2">{t('landing_features_eyebrow')}</div>
          <h2 className="text-3xl md:text-4xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('landing_features_title')}</h2>
          <p className="mt-4 text-base" style={{ color: 'var(--tblr-muted)' }}>{t('landing_features_subtitle')}</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, titleKey, descKey }, i) => (
            <motion.div
              key={titleKey}
              {...fadeInUp}
              transition={{ ...fadeInUp.transition, delay: (i % 3) * 0.08 }}
              className="card"
            >
              <div
                className="w-10 h-10 flex items-center justify-center rounded-md mb-4"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
              >
                <Icon size={20} />
              </div>
              <h3 className="font-semibold text-base mb-1.5" style={{ color: 'var(--tblr-text)' }}>{t(titleKey)}</h3>
              <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t(descKey)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();

  return (
    <section id="comment-ca-marche" className="px-4 sm:px-6 py-20 md:py-28">
      <div className="max-w-[1000px] mx-auto">
        <motion.div {...fadeInUp} className="max-w-2xl mx-auto text-center mb-14">
          <div className="subheader mb-2">{t('landing_how_eyebrow')}</div>
          <h2 className="text-3xl md:text-4xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('landing_how_title')}</h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {HOW_IT_WORKS_STEPS.map((step, i) => (
            <motion.div key={step} {...fadeInUp} transition={{ ...fadeInUp.transition, delay: i * 0.08 }}>
              <div
                className="w-9 h-9 flex items-center justify-center rounded-full font-semibold text-sm mb-4"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                {step}
              </div>
              <h3 className="font-semibold text-base mb-1.5" style={{ color: 'var(--tblr-text)' }}>
                {t(`landing_how_step${step}_title`)}
              </h3>
              <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t(`landing_how_step${step}_desc`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const { t } = useTranslation();

  return (
    <section id="tarifs" className="px-4 sm:px-6 py-20 md:py-28" style={{ background: 'var(--tblr-surface-2)' }}>
      <div className="max-w-[1100px] mx-auto">
        <motion.div {...fadeInUp} className="max-w-2xl mx-auto text-center mb-14">
          <div className="subheader mb-2">{t('landing_pricing_eyebrow')}</div>
          <h2 className="text-3xl md:text-4xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('landing_pricing_title')}</h2>
          <p className="mt-4 text-base" style={{ color: 'var(--tblr-muted)' }}>{t('landing_pricing_subtitle')}</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {PRICING_TIERS.map(({ key, featureCount, popular }, i) => (
            <motion.div
              key={key}
              {...fadeInUp}
              transition={{ ...fadeInUp.transition, delay: i * 0.08 }}
              className="card flex flex-col"
              style={popular ? { borderColor: 'var(--tblr-primary)', borderWidth: 2 } : undefined}
            >
              {popular && (
                <span
                  className="tblr-badge self-start mb-3"
                  style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                >
                  {t('landing_pricing_most_popular')}
                </span>
              )}
              <h3 className="font-semibold text-lg" style={{ color: 'var(--tblr-text)' }}>{t(`landing_pricing_${key}_name`)}</h3>
              <div className="mt-2 text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t(`landing_pricing_${key}_price`)}</div>
              <p className="mt-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t(`landing_pricing_${key}_desc`)}</p>
              <ul className="mt-5 space-y-2.5 flex-1">
                {Array.from({ length: featureCount }, (_, idx) => idx + 1).map(n => (
                  <li key={n} className="flex items-start gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}>
                    <IconCheck size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--tblr-primary)' }} />
                    {t(`landing_pricing_${key}_feat${n}`)}
                  </li>
                ))}
              </ul>
              <Link
                to="/register"
                className={`btn ${popular ? 'btn-primary' : 'btn-secondary'} text-sm px-4 py-2.5 mt-6 justify-center`}
              >
                {t(`landing_pricing_${key}_cta`)}
              </Link>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-xs mt-8" style={{ color: 'var(--tblr-muted)' }}>{t('landing_pricing_disclaimer')}</p>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { t } = useTranslation();

  return (
    <section className="px-4 sm:px-6 py-20 md:py-24 text-center" style={{ background: 'var(--tblr-primary)' }}>
      <motion.div {...fadeInUp} className="max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-white">{t('landing_final_cta_title')}</h2>
        <p className="mt-4 text-base text-white/85">{t('landing_final_cta_subtitle')}</p>
        <Link
          to="/register"
          className="btn text-base px-6 py-3 mt-8 inline-flex"
          style={{ background: '#fff', color: 'var(--tblr-primary)', borderColor: '#fff' }}
        >
          {t('landing_final_cta_button')}
          <IconArrowRight size={18} />
        </Link>
      </motion.div>
    </section>
  );
}

function LandingFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t px-4 sm:px-6 py-8" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}>
      <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BrandLogo size={22} />
          <span className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>ArchiOffice</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 text-sm" style={{ color: 'var(--tblr-muted)' }}>
          <Link to="/login" className="hover:underline" style={{ color: 'inherit' }}>{t('landing_footer_login')}</Link>
          <Link to="/register" className="hover:underline" style={{ color: 'inherit' }}>{t('landing_footer_register')}</Link>
          <Link to="/privacy" className="hover:underline" style={{ color: 'inherit' }}>{t('footer_privacy')}</Link>
          <Link to="/terms" className="hover:underline" style={{ color: 'inherit' }}>{t('footer_terms')}</Link>
        </div>
        <div className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('footer_rights')}</div>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div id="top" className="min-h-screen font-sans" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-text)' }}>
      <LandingNav />
      <Hero />
      <FeatureGrid />
      <HowItWorks />
      <Pricing />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
