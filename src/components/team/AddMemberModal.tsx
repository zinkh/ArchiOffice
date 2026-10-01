import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { launchOriginRef } from '../../lib/launchOrigin';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { UserProfile } from '../../services/userService';
import { FOCUS_RING, HAIRLINE, MONO_LABEL, ROLES, RoleGlyph, type SystemRole } from './teamShared';

type NewUser = Omit<UserProfile, 'id'>;

interface AddMemberModalProps {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (user: NewUser) => void;
}

const INPUT = cn(
  'w-full rounded-[2px] border bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 hover:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-100',
  HAIRLINE,
  FOCUS_RING,
);

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
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
        className="relative max-h-[100dvh] w-full max-w-lg overflow-y-auto border border-zinc-900 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-100/70 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-900/80 px-5 py-4 dark:border-zinc-100/70 sm:px-6">
          <div>
            <p className={MONO_LABEL}>{t('team_eyebrow')}</p>
            <h2 id="team-add-title" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              {t('team_add_member_title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('team_modal_close') as string}
            className={cn('-mr-1.5 border border-transparent p-1.5 text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 dark:hover:border-zinc-100 dark:hover:text-white', FOCUS_RING)}
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
                    className={cn(
                      'flex cursor-pointer gap-2.5 border p-2.5 transition-colors duration-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-zinc-900 dark:has-[:focus-visible]:outline-white',
                      checked
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                        : cn(HAIRLINE, 'text-zinc-900 hover:border-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-100'),
                    )}
                  >
                    <input type="radio" name="system_role" value={r} checked={checked} onChange={() => setForm({ ...form, system_role: r })} className="sr-only" />
                    <RoleGlyph role={r} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">{t(`team_role_short_${r}`)}</span>
                      <span className={cn('mt-0.5 block text-[0.6875rem] leading-snug', checked ? 'opacity-75' : 'text-zinc-500 dark:text-zinc-400')}>
                        {t(`team_role_hint_${r}`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t('team_modal_hint')}</p>

          <div className="flex gap-3 border-t border-dashed border-zinc-300 pt-5 dark:border-zinc-700">
            <button
              type="button"
              onClick={onClose}
              className={cn('flex-1 rounded-[2px] border border-zinc-900/80 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:border-zinc-100/70 dark:text-white [@media(hover:hover)]:hover:bg-zinc-100 dark:[@media(hover:hover)]:hover:bg-zinc-800', FOCUS_RING)}
            >
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn('flex flex-1 items-center justify-center gap-2 rounded-[2px] bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-[transform,background-color] duration-100 active:scale-[0.97] disabled:opacity-50 dark:bg-white dark:text-zinc-900 [@media(hover:hover)]:hover:bg-zinc-700 dark:[@media(hover:hover)]:hover:bg-zinc-200', FOCUS_RING)}
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
