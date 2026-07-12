import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconCommand, IconMailCheck } from '@tabler/icons-react';

export default function Register() {
  const [form, setForm] = useState({
    cabinet_name: '',
    slug: '',
    admin_name: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState<{ email: string; emailSent: boolean } | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: value,
      // Auto-générer le slug depuis le nom du cabinet
      ...(name === 'cabinet_name' ? { slug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') } : {}),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm_password) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (form.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/public/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cabinet_name: form.cabinet_name,
        slug: form.slug,
        admin_name: form.admin_name,
        email: form.email,
        password: form.password,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Erreur lors de l\'inscription.');
      setLoading(false);
      return;
    }

    // Le compte est créé mais l'email n'est pas encore confirmé — on ne
    // connecte plus automatiquement, il faut d'abord cliquer le lien reçu.
    setConfirmationSent({ email: form.email, emailSent: !!data.emailSent });
    setLoading(false);
  };

  const handleResend = async () => {
    if (!confirmationSent) return;
    setResending(true);
    setResent(false);
    try {
      await fetch('/api/public/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmationSent.email }),
      });
      setResent(true);
    } finally {
      setResending(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505] py-12">
        <div className="w-full max-w-lg p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
              <IconMailCheck size={28} />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Vérifiez votre email</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
            Votre cabinet a été créé. Un email de confirmation a été envoyé à{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{confirmationSent.email}</span>.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
            Cliquez sur le lien reçu pour activer votre compte avant de vous connecter.
          </p>
          {!confirmationSent.emailSent && (
            <p className="text-sm text-amber-600 dark:text-amber-500 mb-6">
              L'envoi automatique a rencontré un problème — utilisez le bouton ci-dessous pour renvoyer l'email.
            </p>
          )}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors mb-3"
          >
            {resending ? 'Envoi en cours...' : 'Renvoyer l\'email de confirmation'}
          </button>
          {resent && <p className="text-sm text-green-600 dark:text-green-500 mb-3">Email renvoyé.</p>}
          <Link to="/login" className="text-sm text-blue-600 hover:underline">
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505] py-12">
      <div className="w-full max-w-lg p-8 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded flex items-center justify-center text-white">
            <IconCommand size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-white mb-2">
          Créer votre cabinet
        </h2>
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          14 jours d'essai gratuit, sans carte bancaire
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Nom du cabinet *
            </label>
            <input
              type="text"
              name="cabinet_name"
              value={form.cabinet_name}
              onChange={handleChange}
              placeholder="Dupont Architecture"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Identifiant URL
            </label>
            <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
              <input
                type="text"
                name="slug"
                value={form.slug}
                onChange={handleChange}
                placeholder="dupont-architecture"
                pattern="[-a-z0-9]+"
                className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white outline-none min-w-0"
                required
              />
              <span className="px-3 py-2 bg-zinc-50 dark:bg-zinc-700 text-zinc-400 dark:text-zinc-400 text-sm border-l border-zinc-300 dark:border-zinc-600 whitespace-nowrap">.archimanager.fr</span>
            </div>
            {form.slug && (
              <p className="mt-1 text-xs text-zinc-400">Votre espace : <span className="font-mono text-blue-500">{form.slug}.archimanager.fr</span></p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Votre nom *
            </label>
            <input
              type="text"
              name="admin_name"
              value={form.admin_name}
              onChange={handleChange}
              placeholder="Jean Dupont"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Email professionnel *
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="jean@dupont-archi.fr"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Mot de passe *
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="8 caractères min."
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Confirmer *
              </label>
              <input
                type="password"
                name="confirm_password"
                value={form.confirm_password}
                onChange={handleChange}
                placeholder="Répéter"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors mt-2"
          >
            {loading ? 'Création en cours...' : 'Créer mon cabinet'}
          </button>

          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Déjà un compte ?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
