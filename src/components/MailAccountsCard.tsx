// Réglage personnel des boîtes mail connectées, dans la section utilisateur
// de /settings. Personnel comme PushNotificationsCard : chaque architecte
// connecte ses propres adresses (cabinet, personnelle, dédiée aux AO...) et
// désigne laquelle sert par défaut pour lire et écrire — le hook
// useMailAccounts est aussi celui de la page Boîte mail et de l'onglet
// Correspondance, ce composant n'en est qu'une vue de gestion dédiée.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconBrandGoogle, IconBrandWindows, IconMailbox, IconLoader2,
  IconStar, IconStarFilled, IconTrash, IconSettings,
} from '@tabler/icons-react';
import { useMailAccounts, type MailAccount, type MailProvider } from '../hooks/useMailAccounts';

const PROVIDER_ICON: Record<MailProvider, typeof IconBrandGoogle> = {
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  infomaniak: IconMailbox,
};

export function MailAccountsCard() {
  const { t } = useTranslation();
  const {
    accounts, loading, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, connectOutlook, connectImap, disconnect, setDefault, setImapSmtp,
  } = useMailAccounts();
  const [smtpEditingId, setSmtpEditingId] = useState<string | null>(null);
  const [smtpForm, setSmtpForm] = useState({ smtpHost: '', smtpPort: '465', smtpUsername: '', smtpPassword: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openSmtpEditor = (account: MailAccount) => {
    setSmtpEditingId(account.id);
    setSmtpForm({ smtpHost: 'mail.infomaniak.com', smtpPort: '465', smtpUsername: account.email || '', smtpPassword: '' });
  };

  const saveSmtp = async (accountId: string) => {
    await setImapSmtp(accountId, smtpForm);
    setSmtpEditingId(null);
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_explanation')}</p>

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : accounts.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_empty')}</p>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => {
            const Icon = PROVIDER_ICON[a.provider];
            return (
              <div key={a.id} className="rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
                <div className="flex items-center justify-between gap-3 p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{a.displayName || a.email}</div>
                      {a.displayName && <div className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{a.email}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setDefault(a.id)}
                      disabled={a.isDefault}
                      title={a.isDefault ? (t('mail_accounts_default') as string) : (t('mail_accounts_set_default') as string)}
                      className="p-1.5 rounded-lg disabled:opacity-100"
                      style={{ color: a.isDefault ? 'var(--tblr-warning)' : 'var(--tblr-muted)' }}
                    >
                      {a.isDefault ? <IconStarFilled size={15} /> : <IconStar size={15} />}
                    </button>
                    {a.provider === 'infomaniak' && (
                      <button
                        onClick={() => openSmtpEditor(a)}
                        title={t('mail_accounts_smtp_section') as string}
                        className="p-1.5 rounded-lg"
                        style={{ color: a.hasSmtp ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}
                      >
                        <IconSettings size={15} />
                      </button>
                    )}
                    {confirmDeleteId === a.id ? (
                      <div className="flex items-center gap-1 text-xs">
                        <button onClick={() => { disconnect(a.id); setConfirmDeleteId(null); }} className="px-2 py-1 rounded-lg font-medium" style={{ background: 'var(--tblr-danger)', color: 'white' }}>
                          {t('mail_accounts_disconnect_confirm')}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ color: 'var(--tblr-muted)' }}>{t('btn_close') as string}</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(a.id)} title={t('correspondence_disconnect') as string} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-danger)' }}>
                        <IconTrash size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {a.provider === 'infomaniak' && smtpEditingId === a.id && (
                  <div className="grid grid-cols-2 gap-2 p-2.5" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                    <input placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={smtpForm.smtpHost} onChange={e => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })} />
                    <input placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={smtpForm.smtpPort} onChange={e => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })} />
                    <input type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={smtpForm.smtpUsername} onChange={e => setSmtpForm({ ...smtpForm, smtpUsername: e.target.value })} />
                    <input type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={smtpForm.smtpPassword} onChange={e => setSmtpForm({ ...smtpForm, smtpPassword: e.target.value })} />
                    <div className="col-span-2 flex items-center gap-2">
                      <button onClick={() => saveSmtp(a.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--tblr-primary)', color: 'white' }}>{t('save') as string}</button>
                      <button onClick={() => setSmtpEditingId(null)} className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('btn_close') as string}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={connectGmail} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconBrandGoogle size={13} /> {t('correspondence_connect_gmail')}
        </button>
        <button onClick={connectOutlook} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconBrandWindows size={13} /> {t('correspondence_connect_outlook')}
        </button>
        <button onClick={() => setShowImapForm(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconMailbox size={13} /> {t('correspondence_connect_imap')}
        </button>
      </div>

      {showImapForm && (
        <form onSubmit={connectImap} className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <input required placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.host} onChange={e => setImapForm({ ...imapForm, host: e.target.value })} />
          <input required placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.port} onChange={e => setImapForm({ ...imapForm, port: e.target.value })} />
          <input required type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.username} onChange={e => setImapForm({ ...imapForm, username: e.target.value })} />
          <input required type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.password} onChange={e => setImapForm({ ...imapForm, password: e.target.value })} />
          <p className="col-span-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_connect_imap_password_hint')}</p>
          <p className="col-span-2 text-xs font-semibold uppercase tracking-wide mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_smtp_section')}</p>
          <p className="col-span-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_smtp_hint')}</p>
          <input placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpHost} onChange={e => setImapForm({ ...imapForm, smtpHost: e.target.value })} />
          <input placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpPort} onChange={e => setImapForm({ ...imapForm, smtpPort: e.target.value })} />
          <input type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpUsername} onChange={e => setImapForm({ ...imapForm, smtpUsername: e.target.value })} />
          <input type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpPassword} onChange={e => setImapForm({ ...imapForm, smtpPassword: e.target.value })} />
          <div className="col-span-2 flex items-center gap-2">
            <button type="submit" disabled={imapConnecting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
              {imapConnecting && <IconLoader2 size={13} className="animate-spin" />} {t('correspondence_connect_imap_submit')}
            </button>
            <button type="button" onClick={() => setShowImapForm(false)} className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('btn_close') as string}</button>
          </div>
        </form>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400 flex items-center justify-between gap-2">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
}
