import { useState, useEffect } from 'react';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { IconCircleCheck, IconLoader2 } from '@tabler/icons-react';
import { cn } from '../lib/utils';

export default function Settings() {
  const { t } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
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
    smtpPass: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
        // Also sync to local Dexie for offline use if needed
        db.settings.put(s);
      });
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

          <h2 className="text-xl font-bold mt-8">Configuration SMTP</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Utilisé pour l'envoi des identifiants aux nouveaux membres et les notifications. 
            <br />
            <span className="text-blue-600 dark:text-blue-400">Note pour Gmail :</span> Vous devez utiliser un <strong>"Mot de passe d'application"</strong> (généré dans votre compte Google) et non votre mot de passe habituel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="p-2 border rounded" placeholder="SMTP Host (ex: smtp.gmail.com)" value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} />
            <input className="p-2 border rounded" placeholder="SMTP Port (ex: 587, 465)" value={settings.smtpPort} onChange={e => setSettings({...settings, smtpPort: e.target.value})} />
            <input className="p-2 border rounded" placeholder="SMTP User" value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} />
            <input className="p-2 border rounded" type="password" placeholder="SMTP Password" value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
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
                  Test en cours...
                </div>
              ) : "Tester la connexion SMTP"}
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
