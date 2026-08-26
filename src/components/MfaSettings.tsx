import React, { useEffect, useState } from 'react';
import { IconDeviceMobile, IconTrash, IconShieldCheck } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';

interface TotpFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
}

// Supabase Auth's built-in TOTP MFA (server/UserContext.tsx and this
// component are the whole of it — Supabase itself issues and verifies the
// codes and stamps the resulting session's AAL, nothing here talks to a
// custom backend). Cloud accounts only: offline/local-mode auth
// (src/lib/localAuth.ts) is a separate bcrypt-based scheme with no
// Supabase session to attach a factor to — Profile.tsx only renders this
// component outside isOfflineBuild().
export default function MfaSettings() {
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFactors = async () => {
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (err) { setError(err.message); return; }
    setFactors((data?.totp as TotpFactor[]) || []);
  };

  useEffect(() => { void loadFactors(); }, []);

  const startEnroll = async () => {
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (err) throw err;
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (err: any) {
      setError(err?.message || "Échec de l'activation de la double authentification.");
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    // Drop the still-unverified factor rather than leaving it dangling —
    // otherwise a user who closes the dialog mid-setup accumulates
    // "unverified" factors that Supabase's own enroll() call rejects a
    // fresh attempt against (one unverified TOTP factor per user, max).
    if (enrolling) {
      await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
    }
    setEnrolling(null);
    setCode('');
    setError(null);
  };

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolling) return;
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: code.trim() });
      if (err) throw err;
      setEnrolling(null);
      setCode('');
      await loadFactors();
    } catch (err: any) {
      setError(err?.message || 'Code invalide. Vérifiez votre application d\'authentification et réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const disableFactor = async (factorId: string) => {
    if (!window.confirm(
      'Désactiver la double authentification ? Votre compte ne sera plus protégé que par votre mot de passe.'
    )) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
      if (err) throw err;
      await loadFactors();
    } catch (err: any) {
      setError(err?.message || 'Échec de la désactivation.');
    } finally {
      setBusy(false);
    }
  };

  if (factors === null) return null;

  const activeFactor = factors.find(f => f.status === 'verified');

  if (enrolling) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 py-2">
          <img src={enrolling.qrCode} alt="QR code d'activation" className="w-40 h-40 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white p-2" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
            Scannez ce code avec votre application d'authentification (Google Authenticator, Authy, 1Password…),
            ou saisissez la clé manuellement :
          </p>
          <code className="text-xs bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded select-all">{enrolling.secret}</code>
        </div>
        <form onSubmit={confirmEnroll} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Code à 6 chiffres</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
              autoFocus
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none tracking-widest text-center font-mono"
              placeholder="000000"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {busy ? 'Vérification...' : 'Confirmer'}
            </button>
            <button type="button" onClick={cancelEnroll} className="py-2 px-4 text-sm text-zinc-500 hover:underline">
              Annuler
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (activeFactor) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <IconShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Double authentification activée</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Un code de votre application d'authentification est requis à chaque connexion.</p>
          </div>
        </div>
        <button
          onClick={() => disableFactor(activeFactor.id)}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
        >
          <IconTrash size={14} /> Désactiver
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <IconDeviceMobile size={18} className="text-zinc-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Double authentification désactivée</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Ajoutez une couche de sécurité avec une application d'authentification (TOTP).</p>
          </div>
        </div>
        <button
          onClick={startEnroll}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {busy ? 'Chargement...' : 'Activer'}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
