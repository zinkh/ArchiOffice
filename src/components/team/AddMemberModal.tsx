import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { launchOriginRef } from '../../lib/launchOrigin';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { UserProfile } from '../../services/userService';
import { FOCUS_FIELD, FOCUS_RING, MONO_LABEL, ROLES, RoleGlyph, roleTone, tint, type SystemRole } from './teamShared';

type NewUser = Omit<UserProfile, 'id'>;

interface AddMemberModalProps {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (user: NewUser) => void;
}

const INPUT = cn('tblr-input', FOCUS_FIELD);

/** Feuille depuis le bas sur téléphone, planche centrée au bureau. Échap ferme, le premier champ prend le focus. */
export default function AddMemberModal({ isSubmitting, onClose, onSubmit }: AddMemberModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<NewUser>({ name: '', email: '', system_role: 'user', role: '' });
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        ref={launchOriginRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-add-title"
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={DEFAULT_SPRING}
        className="relative max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--tblr-radius)] border border-[var(--tblr-border)] border-t-2 border-t-[var(--tblr-primary)] bg-[var(--tblr-surface)] pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-[var(--tblr-radius)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--tblr-border)] px-5 py-4 sm:px-6">
          <div>
            <p className={MONO_LABEL}>{t('team_eyebrow')}</p>
            <h2 id="team-add-title" className="mt-1 text-2xl font-semibold tracking-tight text-[var(--tblr-text)]">
              {t('team_add_member_title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('team_modal_close') as string}
            className={cn('btn btn-ghost -mr-1.5 !p-1.5', FOCUS_RING)}
          >
            <IconX size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5 sm:px-6">
          <label className="block">
            <span className={cn(MONO_LABEL, 'mb-1.5 block')}>{t('team_full_name_label')}</span>
            <input ref={firstField} type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} placeholder={t('team_full_name_placeholder') as string} />
          </label>
          <label className="block">
            <span className={cn(MONO_LABEL, 'mb-1.5 block')}>{t('team_email_label')}</span>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} placeholder={t('team_email_placeholder') as string} />
          </label>
          <label className="block">
            <span className={cn(MONO_LABEL, 'mb-1.5 block')}>{t('team_job_title_label')}</span>
            <input type="text" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={INPUT} placeholder={t('team_job_title_placeholder') as string} />
          </label>

          <fieldset>
            <legend className={cn(MONO_LABEL, 'mb-1.5')}>{t('team_system_access_level')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.slice().reverse().map((r: SystemRole) => {
                const checked = form.system_role === r;
                return (
                  <label
                    key={r}
                    style={checked ? { borderColor: roleTone(r), backgroundColor: tint(roleTone(r), 12) } : undefined}
                    className={cn(
                      'flex cursor-pointer gap-2.5 rounded-[var(--tblr-radius)] border p-2.5 text-[var(--tblr-text)] transition-colors duration-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--tblr-primary)]',
                      !checked && 'border-[var(--tblr-border)] hover:border-[var(--tblr-primary)]',
                    )}
                  >
                    <input type="radio" name="system_role" value={r} checked={checked} onChange={() => setForm({ ...form, system_role: r })} className="sr-only" />
                    <RoleGlyph role={r} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">{t(`team_role_short_${r}`)}</span>
                      <span className="mt-0.5 block text-[0.6875rem] leading-snug text-zinc-600 dark:text-zinc-400">
                        {t(`team_role_hint_${r}`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{t('team_modal_hint')}</p>

          <div className="flex gap-3 border-t border-dashed border-[var(--tblr-border)] pt-5">
            <button type="button" onClick={onClose} className={cn('btn btn-secondary flex-1 justify-center !py-2.5 font-semibold', FOCUS_RING)}>
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn('btn btn-primary flex-1 justify-center !py-2.5 font-semibold disabled:opacity-50', FOCUS_RING)}
            >
              {isSubmitting ? (
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <IconCheck size={18} aria-hidden="true" />
              )}
              {t('team_create_user_btn')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
