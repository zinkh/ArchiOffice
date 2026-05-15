import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { IconCircleCheck, IconLoader2, IconPlugConnected, IconPlugConnectedX, IconExternalLink } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { IconLanguage } from '@tabler/icons-react';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
  const location = useLocation();
  const [settings, setSettings] = useState({
    id: 'general',
    agencyName: '',
    address: '',
    phone: '',
    email: '',
    siret: '',
    vatNumber: '',
    seller_iban: '',
    seller_bic: '',
    currency: 'EUR',
    language: 'fr',
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: '',
    logoUrl: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    zoho_client_id: '',
    zoho_client_secret: '',
    zoho_org_id: '',
    zoho_data_center: 'com',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [zohoStatus, setZohoStatus] = useState<{ connected: boolean; has_credentials: boolean } | null>(null);
  const [isDisconnectingZoho, setIsDisconnectingZoho] = useState(false);
  const [zohoNotice, setZohoNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [userSettings, setUserSettings] = useState({
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: '',
    phone: '',
    address: '',
    jobTitle: '',
    department: ''
  });

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(s => {
        if (s) setSettings(prev => ({ ...prev, ...s }));
        db.settings.put(s);
      });
    fetch('/api/zoho/status')
      .then(res => res.json())
      .then(s => setZohoStatus(s))
      .catch(() => {});
    if (currentUser) {
      setUserSettings({
        senderOption: currentUser.senderOption || 'agency',
        defaultEmailTemplate: currentUser.defaultEmailTemplate || '',
        phone: currentUser.phone || '',
        address: currentUser.address || '',
        jobTitle: currentUser.jobTitle || '',
        department: currentUser.department || ''
      });
    }
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('zoho_connected') === '1') {
      setZohoStatus(prev => ({ ...prev!, connected: true }));
      setZohoNotice({ type: 'success', message: t('zoho_connected_success') });
      window.history.replaceState({}, '', '/settings');
    } else if (params.get('zoho_error') === '1') {
      setZohoNotice({ type: 'error', message: t('zoho_connect_error') });
      window.history.replaceState({}, '', '/settings');
    }
  }, [location.search, t]);

  const handleZohoDisconnect = async () => {
    setIsDisconnectingZoho(true);
    try {
      await fetch('/api/zoho/disconnect', { method: 'DELETE' });
      setZohoStatus(prev => ({ ...prev!, connected: false }));
      setZohoNotice({ type: 'success', message: t('zoho_disconnected') });
    } catch {
      setZohoNotice({ type: 'error', message: t('zoho_connect_error') });
    } finally {
      setIsDisconnectingZoho(false);
    }
  };

  const handleTestSmtp = async () => {
    setIsTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: settings.smtpHost,
          smtpPort: settings.smtpPort,
          smtpUser: settings.smtpUser,
          smtpPass: settings.smtpPass
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSmtpTestResult({ success: true, message: 'Test email sent successfully to ' + settings.smtpUser });
      } else {
        let errorMessage = data.error || 'Failed to send test email';
        
        // Provide helpful hints for common Gmail errors
        if (errorMessage.includes('534-5.7.9')) {
          errorMessage = "Erreur Gmail : Un mot de passe d'application est requis. Veuillez en générer un dans les paramètres de sécurité de votre compte Google (Validation en deux étapes requise).";
        } else if (errorMessage.includes('535-5.7.8')) {
          errorMessage = "Erreur d'authentification : Identifiants incorrects. Si vous utilisez Gmail, assurez-vous d'utiliser un 'Mot de passe d'application' et non votre mot de passe habituel.";
        } else if (errorMessage.includes('ECONNREFUSED')) {
          errorMessage = "Connexion refusée : Vérifiez l'hôte SMTP et le port. Assurez-vous que votre serveur autorise les connexions sortantes.";
        } else if (errorMessage.includes('ETIMEDOUT')) {
          errorMessage = "Délai d'attente dépassé : Le serveur SMTP ne répond pas. Vérifiez le port (587 ou 465) et vos paramètres de pare-feu.";
        }

        setSmtpTestResult({ success: false, message: errorMessage });
      }
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save to server
      if (currentUser?.system_role === 'admin') {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });
        // Save to local Dexie
        await db.settings.put(settings);
      }
      
      if (currentUser) {
        const updatedUser = { ...currentUser, ...userSettings } as any;
        await fetch(`/api/team/${currentUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userSettings)
        });
        setCurrentUser(updatedUser);
      }
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const isAdmin = currentUser?.system_role === 'admin';

  return (
    <div className="space-y-6">
      {isAdmin && (
        <>
          <h1 className="text-2xl font-bold">{t('general_settings')}</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="p-2 border rounded" placeholder={t('agency_name')} value={settings.agencyName} onChange={e => setSettings({...settings, agencyName: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('address')} value={settings.address} onChange={e => setSettings({...settings, address: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('phone')} value={settings.phone} onChange={e => setSettings({...settings, phone: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('email')} value={settings.email} onChange={e => setSettings({...settings, email: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('siret')} value={settings.siret} onChange={e => setSettings({...settings, siret: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('vat_number')} value={settings.vatNumber} onChange={e => setSettings({...settings, vatNumber: e.target.value})} />
            <input className="p-2 border rounded font-mono" placeholder="IBAN" value={settings.seller_iban} onChange={e => setSettings({...settings, seller_iban: e.target.value})} />
            <input className="p-2 border rounded font-mono" placeholder="BIC" value={settings.seller_bic} onChange={e => setSettings({...settings, seller_bic: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('currency')} value={settings.currency} onChange={e => setSettings({...settings, currency: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('language')} value={settings.language} onChange={e => setSettings({...settings, language: e.target.value})} />
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t('company_logo')}</label>
              <input 
                type="file" 
                accept="image/*" 
                className="p-2 border rounded" 
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setSettings({...settings, logoUrl: reader.result as string});
                    };
                    reader.readAsDataURL(file);
                  }
                }} 
              />
              {settings.logoUrl && <img src={settings.logoUrl} alt="Logo" className="w-32 h-32 object-contain mt-2" />}
            </div>
          </div>

          <h2 className="text-xl font-bold mt-8">{t('settings_smtp_title')}</h2>
          <p className="text-sm text-zinc-500 mb-4">{t('settings_smtp_explanation')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="p-2 border rounded" placeholder={t('settings_smtp_host_placeholder')} value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('settings_smtp_port_placeholder')} value={settings.smtpPort} onChange={e => setSettings({...settings, smtpPort: e.target.value})} />
            <input className="p-2 border rounded" placeholder={t('settings_smtp_user_placeholder')} value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} />
            <input className="p-2 border rounded" type="password" placeholder={t('settings_smtp_password_placeholder')} value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={isTestingSmtp || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass}
              className="w-fit px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg text-sm font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              {isTestingSmtp ? (
                <div className="flex items-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin" />
                  {t('settings_smtp_testing')}
                </div>
              ) : t('settings_smtp_test_btn')}
            </button>
            {smtpTestResult && (
              <div className={cn(
                "text-sm p-3 rounded-lg border",
                smtpTestResult.success 
                  ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400" 
                  : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
              )}>
                {smtpTestResult.message}
              </div>
            )}
          </div>

          <h2 className="text-xl font-bold mt-8">{t('email_settings')}</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="sender" value="agency" checked={settings.senderOption === 'agency'} onChange={e => setSettings({...settings, senderOption: 'agency'})} />
                {t('send_from_agency')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="sender" value="personal" checked={settings.senderOption === 'personal'} onChange={e => setSettings({...settings, senderOption: 'personal'})} />
                {t('send_from_personal')}
              </label>
            </div>
            <textarea 
              className="w-full p-2 border rounded h-32" 
              placeholder={t('default_email_template')} 
              value={settings.defaultEmailTemplate ?? ''} 
              onChange={e => setSettings({...settings, defaultEmailTemplate: e.target.value})} 
            />
          </div>
        </>
      )}
      
      <h2 className="text-xl font-bold mt-8">{t('user_information')}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input className="p-2 border rounded" placeholder={t('phone')} value={userSettings.phone} onChange={e => setUserSettings({...userSettings, phone: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('address')} value={userSettings.address} onChange={e => setUserSettings({...userSettings, address: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('job_title')} value={userSettings.jobTitle} onChange={e => setUserSettings({...userSettings, jobTitle: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('department')} value={userSettings.department} onChange={e => setUserSettings({...userSettings, department: e.target.value})} />
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-3 mb-2">
          <IconLanguage size={18} className="text-zinc-400" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('language')}</span>
        </div>
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden w-fit">
          <button
            type="button"
            onClick={() => i18n.changeLanguage('fr')}
            className={cn(
              "px-5 py-2 text-sm font-medium transition-colors",
              i18n.language.startsWith('fr')
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            )}
          >
            Français
          </button>
          <button
            type="button"
            onClick={() => i18n.changeLanguage('en')}
            className={cn(
              "px-5 py-2 text-sm font-medium transition-colors border-l border-zinc-200 dark:border-zinc-700",
              i18n.language.startsWith('en')
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            )}
          >
            English
          </button>
        </div>
      </div>

      <h2 className="text-xl font-bold mt-8">{t('email_settings')}</h2>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="sender" value="agency" checked={settings.senderOption === 'agency'} onChange={e => setSettings({...settings, senderOption: 'agency'})} />
            {t('send_from_agency')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="sender" value="personal" checked={settings.senderOption === 'personal'} onChange={e => setSettings({...settings, senderOption: 'personal'})} />
            {t('send_from_personal')}
          </label>
        </div>
        <textarea 
          className="w-full p-2 border rounded h-32" 
          placeholder={t('default_email_template')} 
          value={settings.defaultEmailTemplate ?? ''} 
          onChange={e => setSettings({...settings, defaultEmailTemplate: e.target.value})} 
        />
      </div>

      {/* ── Zoho Invoice ── */}
      <h2 className="text-xl font-bold mt-8">{t('zoho_section_title')}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t('zoho_section_subtitle')}</p>

      {zohoNotice && (
        <div className={cn(
          "text-sm p-3 rounded-lg border mb-4",
          zohoNotice.type === 'success'
            ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
            : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
        )}>
          {zohoNotice.message}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 w-fit">
        {zohoStatus?.connected ? (
          <>
            <IconPlugConnected size={18} className="text-green-500" />
            <span className="text-sm font-medium text-green-600 dark:text-green-400">{t('zoho_status_connected')}</span>
          </>
        ) : (
          <>
            <IconPlugConnectedX size={18} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-500">{t('zoho_status_disconnected')}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{t('zoho_data_center_label')}</label>
          <select
            className="w-full p-2 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 text-sm"
            value={settings.zoho_data_center}
            onChange={e => setSettings({ ...settings, zoho_data_center: e.target.value })}
          >
            <option value="com">Global (.com)</option>
            <option value="eu">Europe (.eu)</option>
            <option value="in">Inde (.in)</option>
            <option value="com.au">Australie (.com.au)</option>
            <option value="jp">Japon (.jp)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{t('zoho_org_id_label')}</label>
          <input
            className="w-full p-2 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 text-sm"
            placeholder="123456789"
            value={settings.zoho_org_id}
            onChange={e => setSettings({ ...settings, zoho_org_id: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{t('zoho_client_id_label')}</label>
          <input
            className="w-full p-2 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 text-sm font-mono"
            placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXX"
            value={settings.zoho_client_id}
            onChange={e => setSettings({ ...settings, zoho_client_id: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{t('zoho_client_secret_label')}</label>
          <input
            type="password"
            className="w-full p-2 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 text-sm font-mono"
            placeholder="••••••••••••••••••••••••••"
            value={settings.zoho_client_secret}
            onChange={e => setSettings({ ...settings, zoho_client_secret: e.target.value })}
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 mb-4">
        <p className="font-bold mb-1">{t('zoho_callback_hint_title')}</p>
        <code className="block bg-white dark:bg-zinc-900 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 font-mono">
          {typeof window !== 'undefined' ? `${window.location.origin}/api/zoho/callback` : '/api/zoho/callback'}
        </code>
        <p className="mt-1 text-blue-600 dark:text-blue-400">{t('zoho_callback_hint_desc')}</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <a
          href="https://api-console.zoho.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <IconExternalLink size={16} />
          {t('zoho_api_console_btn')}
        </a>
        {!zohoStatus?.connected ? (
          <button
            type="button"
            disabled={!settings.zoho_client_id || !settings.zoho_client_secret || !settings.zoho_org_id}
            onClick={async () => {
              await handleSave();
              window.location.href = '/api/zoho/auth';
            }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconPlugConnected size={16} />
            {t('zoho_connect_btn')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleZohoDisconnect}
            disabled={isDisconnectingZoho}
            className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm font-bold hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors"
          >
            {isDisconnectingZoho ? <IconLoader2 size={16} className="animate-spin" /> : <IconPlugConnectedX size={16} />}
            {t('zoho_disconnect_btn')}
          </button>
        )}
      </div>

      <h2 className="text-xl font-bold mt-8">{t('my_email_settings')}</h2>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="userSender" value="agency" checked={userSettings.senderOption === 'agency'} onChange={e => setUserSettings({...userSettings, senderOption: 'agency'})} />
            {t('send_from_agency')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="userSender" value="personal" checked={userSettings.senderOption === 'personal'} onChange={e => setUserSettings({...userSettings, senderOption: 'personal'})} />
            {t('send_from_personal')}
          </label>
        </div>
        <textarea 
          className="w-full p-2 border rounded h-32" 
          placeholder={t('default_email_template')} 
          value={userSettings.defaultEmailTemplate ?? ''} 
          onChange={e => setUserSettings({...userSettings, defaultEmailTemplate: e.target.value})} 
        />
      </div>

      <button 
        disabled={isSaving || showSuccess}
        className={cn(
          "px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2",
          showSuccess 
            ? "bg-green-600 text-white" 
            : "bg-blue-600 text-white hover:bg-blue-700",
          (isSaving || showSuccess) && "opacity-80 cursor-not-allowed"
        )}
        onClick={handleSave}
      >
        {isSaving ? (
          <>
            <IconLoader2 className="w-4 h-4 animate-spin" />
            {t('saving')}...
          </>
        ) : showSuccess ? (
          <>
            <IconCircleCheck size={20} />
            {t('settings_saved')}
          </>
        ) : (
          t('save')
        )}
      </button>
    </div>
  );
}
