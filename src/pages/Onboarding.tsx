import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBuilding, IconPhoto, IconUser, IconUsers, IconCheck, IconArrowRight, IconArrowLeft, IconUpload, IconX, IconPlus } from '@tabler/icons-react';
import { ArchiOfficeLogo } from '../components/ArchiOfficeLogo';
import { getAccessToken } from '../lib/authToken';
import { apiFetch } from '../lib/api';

const STEPS = [
  { id: 'agency', label: 'Votre cabinet', icon: IconBuilding },
  { id: 'logo', label: 'Logo', icon: IconPhoto },
  { id: 'avatar', label: 'Avatar', icon: IconUser },
  { id: 'invite', label: 'Équipe', icon: IconUsers },
];

interface InviteRow { name: string; email: string; role: string }

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0 — agency
  const [agencyName, setAgencyName] = useState('');
  const [agencyAddress, setAgencyAddress] = useState('');
  const [agencyPhone, setAgencyPhone] = useState('');
  const [agencyEmail, setAgencyEmail] = useState('');

  // Step 1 — logo
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  // Step 2 — avatar
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  // Step 3 — invite
  const [invites, setInvites] = useState<InviteRow[]>([{ name: '', email: '', role: 'Member' }]);
  const [inviteResults, setInviteResults] = useState<Record<number, 'ok' | 'err'>>({});

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveAgency = async (): Promise<boolean> => {
    if (!agencyName.trim()) { setError('Le nom du cabinet est requis.'); return false; }
    setError(null);
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ agencyName, address: agencyAddress, phone: agencyPhone, email: agencyEmail }),
      });
      return true;
    } catch {
      setError('Erreur lors de la sauvegarde.');
      return false;
    }
  };

  const uploadLogo = async (): Promise<void> => {
    if (!logoFile) return;
    const fd = new FormData();
    fd.append('file', logoFile);
    await authFetch('/api/upload/logo', { method: 'POST', body: fd });
  };

  const uploadAvatar = async (): Promise<void> => {
    if (!avatarFile) return;
    const fd = new FormData();
    fd.append('file', avatarFile);
    await authFetch('/api/upload/avatar', { method: 'POST', body: fd });
  };

  const sendInvites = async () => {
    const filled = invites.filter(i => i.email.trim());
    const results: Record<number, 'ok' | 'err'> = {};
    for (let i = 0; i < filled.length; i++) {
      const inv = filled[i];
      try {
        await apiFetch('/api/team', {
          method: 'POST',
          body: JSON.stringify({ name: inv.name || inv.email.split('@')[0], email: inv.email, role: inv.role }),
        });
        results[i] = 'ok';
      } catch {
        results[i] = 'err';
      }
    }
    setInviteResults(results);
  };

  const next = async () => {
    setSaving(true);
    setError(null);
    try {
      if (step === 0) {
        const ok = await saveAgency();
        if (!ok) { setSaving(false); return; }
      } else if (step === 1) {
        await uploadLogo();
      } else if (step === 2) {
        await uploadAvatar();
      }
      setStep(s => s + 1);
    } catch (e: any) {
      setError(e?.message || 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setSaving(true);
    try {
      await sendInvites();
      localStorage.setItem('archioffice_onboarding_done', '1');
      navigate('/');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      localStorage.setItem('archioffice_onboarding_done', '1');
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <ArchiOfficeLogo size={48} />
          <h1 className="mt-3 text-2xl font-bold text-zinc-900 dark:text-white">Bienvenue sur ArchiOffice</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Configurons votre espace en quelques étapes</p>
        </div>

        {/* Step indicators — circles row then labels row, so connector lines align with circle centers */}
        <div className="mb-8">
          <div className="flex items-center justify-center">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step;
              const active = i === step;
              return (
                <React.Fragment key={s.id}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                    done ? 'bg-blue-600 border-blue-600 text-white' :
                    active ? 'border-blue-600 text-blue-600 bg-white dark:bg-zinc-900' :
                    'border-zinc-300 dark:border-zinc-700 text-zinc-400 bg-white dark:bg-zinc-900'
                  } ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-40'}`}>
                    {done ? <IconCheck size={18} /> : <Icon size={18} />}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 max-w-[60px] transition-colors ${i < step ? 'bg-blue-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <div className="hidden sm:flex justify-center mt-2" style={{ gap: 0 }}>
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <React.Fragment key={s.id}>
                  <div className={`w-10 flex-shrink-0 flex justify-center transition-opacity ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-40'}`}>
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-center leading-tight">{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className="flex-1 max-w-[60px]" />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-lg p-8 min-h-[320px]">

          {/* Step 0 — Agency info */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Votre cabinet</h2>
                <p className="text-sm text-zinc-500 mt-1">Ces informations apparaîtront sur vos documents.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Nom du cabinet *</label>
                <input
                  type="text"
                  value={agencyName}
                  onChange={e => setAgencyName(e.target.value)}
                  placeholder="Dupont Architecture"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Adresse</label>
                <input
                  type="text"
                  value={agencyAddress}
                  onChange={e => setAgencyAddress(e.target.value)}
                  placeholder="12 rue de la Paix, 75001 Paris"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Téléphone</label>
                  <input
                    type="tel"
                    value={agencyPhone}
                    onChange={e => setAgencyPhone(e.target.value)}
                    placeholder="+33 1 23 45 67 89"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={agencyEmail}
                    onChange={e => setAgencyEmail(e.target.value)}
                    placeholder="contact@dupont-archi.fr"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 1 — Logo */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Logo de votre cabinet</h2>
                <p className="text-sm text-zinc-500 mt-1">Il apparaîtra dans l'en-tête de vos PDFs et dans la barre latérale.</p>
              </div>
              {logoPreview ? (
                <div className="border-2 border-zinc-200 dark:border-zinc-700 rounded-xl p-6 flex flex-col items-center gap-3">
                  <img src={logoPreview} alt="Aperçu logo" className="max-h-32 max-w-full object-contain rounded" />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => logoRef.current?.click()}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Changer
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-600">|</span>
                    <button
                      type="button"
                      onClick={() => { setLogoPreview(null); setLogoFile(null); }}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => logoRef.current?.click()}
                >
                  <IconUpload size={32} className="text-zinc-400" />
                  <p className="text-sm text-zinc-500 text-center">
                    Cliquez pour sélectionner une image<br />
                    <span className="text-xs text-zinc-400">PNG, JPG, SVG — max 5 Mo</span>
                  </p>
                </div>
              )}
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 2 — Avatar */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Votre photo de profil</h2>
                <p className="text-sm text-zinc-500 mt-1">Elle apparaîtra dans le menu et votre profil.</p>
              </div>
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-28 h-28 rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center cursor-pointer overflow-hidden hover:border-blue-400 transition-colors"
                  onClick={() => avatarRef.current?.click()}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Aperçu avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <IconUser size={32} />
                      <span className="text-xs">Ajouter</span>
                    </div>
                  )}
                </div>
                {avatarPreview && (
                  <button
                    onClick={() => { setAvatarPreview(null); setAvatarFile(null); }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Supprimer
                  </button>
                )}
              </div>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 3 — Invite team */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Inviter votre équipe</h2>
                <p className="text-sm text-zinc-500 mt-1">Les collaborateurs recevront leurs identifiants par email.</p>
              </div>
              <div className="space-y-3">
                {invites.map((inv, i) => (
                  <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                      type="text"
                      placeholder="Prénom Nom"
                      value={inv.name}
                      onChange={e => setInvites(prev => prev.map((row, j) => j === i ? { ...row, name: e.target.value } : row))}
                      className="flex-1 min-w-0 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <input
                      type="email"
                      placeholder="email@cabinet.fr"
                      value={inv.email}
                      onChange={e => setInvites(prev => prev.map((row, j) => j === i ? { ...row, email: e.target.value } : row))}
                      className="flex-1 min-w-0 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <div className="flex gap-2 items-center">
                      <select
                        value={inv.role}
                        onChange={e => setInvites(prev => prev.map((row, j) => j === i ? { ...row, role: e.target.value } : row))}
                        className="flex-1 sm:flex-none px-2 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="Member">Membre</option>
                        <option value="Manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                      <div className="w-5 flex-shrink-0">
                        {inviteResults[i] === 'ok' && <IconCheck size={18} className="text-green-500" />}
                        {inviteResults[i] === 'err' && <IconX size={18} className="text-red-500" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setInvites(prev => [...prev, { name: '', email: '', role: 'Member' }])}
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
              >
                <IconPlus size={16} /> Ajouter une ligne
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <IconArrowLeft size={16} /> Retour
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={skip}
              className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {step < STEPS.length - 1 ? 'Passer cette étape' : 'Terminer sans inviter'}
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={saving}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
              >
                {saving ? 'Enregistrement...' : 'Continuer'} <IconArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={finish}
                disabled={saving}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
              >
                {saving ? 'Envoi en cours...' : 'Terminer et accéder'} <IconCheck size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
