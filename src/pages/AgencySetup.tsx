import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBuilding, IconUsersGroup, IconSearch, IconClock, IconX, IconArrowLeft } from '@tabler/icons-react';
import { ArchiOfficeLogo } from '../components/ArchiOfficeLogo';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';

type Mode = 'choice' | 'create' | 'join';

interface PendingRequest { id: string; tenantName: string; createdAt: string }
interface TenantResult { id: string; name: string }

export default function AgencySetup() {
  const navigate = useNavigate();
  const { currentUser, isLoading, signOut } = useUser();
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [mode, setMode] = useState<Mode>('choice');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [agencyName, setAgencyName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Join search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TenantResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!currentUser) { navigate('/login', { replace: true }); return; }
    if (currentUser.tenantId) { navigate('/', { replace: true }); return; }

    apiFetch<{ hasTenant: boolean; pendingRequest: PendingRequest | null }>('/api/agency-setup/status')
      .then(status => {
        if (status.hasTenant) { navigate('/', { replace: true }); return; }
        setPending(status.pendingRequest);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [isLoading, currentUser, navigate]);

  useEffect(() => {
    if (mode !== 'join') { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      apiFetch<TenantResult[]>(`/api/agency-setup/search?q=${encodeURIComponent(query.trim())}`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agencyName.trim()) { setError("Le nom de l'agence est requis."); return; }
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/api/agency-setup/create', {
        method: 'POST',
        body: JSON.stringify({ agencyName, address, phone, email }),
      });
      // Full reload so UserContext re-fetches /api/me with the new tenant.
      window.location.href = '/';
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la création de l\'agence.');
      setSaving(false);
    }
  };

  const handleJoin = async (tenant: TenantResult) => {
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/api/agency-setup/join', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      setPending({ id: '', tenantName: tenant.name, createdAt: new Date().toISOString() });
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la demande de rattachement.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelRequest = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/agency-setup/join', { method: 'DELETE' });
      setPending(null);
      setMode('choice');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || checking) return null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <ArchiOfficeLogo size={48} />
          <h1 className="mt-3 text-2xl font-bold text-zinc-900 dark:text-white">Bienvenue sur ArchiOffice</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {pending ? 'Votre demande est en cours de traitement' : 'Rattachez votre compte à une agence pour continuer'}
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-lg p-8">
          {pending ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <IconClock size={24} />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Demande envoyée</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Votre demande de rattachement à <span className="font-medium text-zinc-700 dark:text-zinc-300">{pending.tenantName}</span> a été envoyée
                à ses administrateurs. Vous recevrez l'accès dès qu'elle sera approuvée.
              </p>
              <button
                type="button"
                onClick={handleCancelRequest}
                disabled={saving}
                className="text-sm text-red-500 hover:underline disabled:opacity-50"
              >
                Annuler la demande
              </button>
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button type="button" onClick={() => signOut().then(() => navigate('/login'))} className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                  Se déconnecter
                </button>
              </div>
            </div>
          ) : mode === 'choice' ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMode('create')}
                className="w-full flex items-start gap-3 p-4 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 text-left transition-colors"
              >
                <IconBuilding size={22} className="mt-0.5 flex-shrink-0 text-blue-600" />
                <div>
                  <div className="font-medium text-zinc-900 dark:text-white">Créer mon agence</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">Démarrez un nouvel espace pour votre cabinet.</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('join')}
                className="w-full flex items-start gap-3 p-4 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 text-left transition-colors"
              >
                <IconUsersGroup size={22} className="mt-0.5 flex-shrink-0 text-blue-600" />
                <div>
                  <div className="font-medium text-zinc-900 dark:text-white">Rejoindre une agence existante</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">Un administrateur devra approuver votre demande.</div>
                </div>
              </button>
              <div className="pt-2 text-center">
                <button type="button" onClick={() => signOut().then(() => navigate('/login'))} className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                  Se déconnecter
                </button>
              </div>
            </div>
          ) : mode === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <button type="button" onClick={() => setMode('choice')} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-2">
                <IconArrowLeft size={16} /> Retour
              </button>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Nom du cabinet *</label>
                <input
                  type="text"
                  value={agencyName}
                  onChange={e => setAgencyName(e.target.value)}
                  placeholder="Dupont Architecture"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Adresse</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="12 rue de la Paix, 75001 Paris"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Téléphone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {saving ? 'Création en cours...' : 'Créer mon agence'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <button type="button" onClick={() => { setMode('choice'); setError(null); }} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-2">
                <IconArrowLeft size={16} /> Retour
              </button>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Rechercher votre agence</label>
                <div className="relative">
                  <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Nom du cabinet..."
                    className="w-full pl-9 pr-9 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    autoFocus
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                      <IconX size={16} />
                    </button>
                  )}
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {searching && <p className="text-sm text-zinc-400 text-center py-4">Recherche...</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-sm text-zinc-400 text-center py-4">Aucune agence trouvée.</p>
                )}
                {results.map(tenant => (
                  <button
                    key={tenant.id}
                    type="button"
                    disabled={saving}
                    onClick={() => handleJoin(tenant)}
                    className="w-full flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 text-left transition-colors disabled:opacity-50"
                  >
                    <span className="font-medium text-zinc-900 dark:text-white">{tenant.name}</span>
                    <span className="text-xs text-blue-600">Demander à rejoindre</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
