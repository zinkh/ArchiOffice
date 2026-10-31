import type { FormEvent } from 'react';
import { IconCloud, IconLoader2 } from '@tabler/icons-react';

// Formulaire de reconnexion au cloud d'un poste déjà lié : seul le mot de passe
// du compte cloud est demandé, l'adresse est celle du lien existant (voir
// server/cloudLinkRoutes.ts, /cloud-link-reconnect). Affiché dans la carte
// « Synchronisation cloud » de Réglages pour un poste dont l'import est
// terminé mais dont la session cloud a expiré : le message d'erreur renvoie
// justement vers ce formulaire.

interface CloudReconnectFormProps {
  email: string | null;
  password: string;
  error: string | null;
  busy: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}

export function CloudReconnectForm({
  email, password, error, busy, onPasswordChange, onSubmit, onCancel,
}: CloudReconnectFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 max-w-sm">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>
          Mot de passe du compte cloud{email ? ` (${email})` : ''}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          required
          autoFocus
        />
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors disabled:opacity-50"
          style={{ background: 'var(--tblr-primary)' }}
        >
          {busy ? <IconLoader2 size={13} className="animate-spin" /> : <IconCloud size={13} />}
          Se reconnecter et resynchroniser
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
