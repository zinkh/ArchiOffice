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
    currency: 'EUR',
    language: 'fr',
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: '',
    logoUrl: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [userSettings, setUserSettings] = useState({
    senderOption: 'agency' as 'agency' | 'personal',
    defaultEmailTemplate: ''
  });

  useEffect(() => {
    db.settings.get('general').then(s => {
      if (s) setSettings(prev => ({ ...prev, ...s }));
    });
    if (currentUser) {
      setUserSettings({
        senderOption: currentUser.senderOption || 'agency',
        defaultEmailTemplate: currentUser.defaultEmailTemplate || ''
      });
    }
  }, [currentUser]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await db.settings.put(settings);
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('general_settings')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input className="p-2 border rounded" placeholder={t('agency_name')} value={settings.agencyName} onChange={e => setSettings({...settings, agencyName: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('address')} value={settings.address} onChange={e => setSettings({...settings, address: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('phone')} value={settings.phone} onChange={e => setSettings({...settings, phone: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('email')} value={settings.email} onChange={e => setSettings({...settings, email: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('siret')} value={settings.siret} onChange={e => setSettings({...settings, siret: e.target.value})} />
        <input className="p-2 border rounded" placeholder={t('vat_number')} value={settings.vatNumber} onChange={e => setSettings({...settings, vatNumber: e.target.value})} />
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
