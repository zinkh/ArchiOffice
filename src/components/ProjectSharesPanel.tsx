// Partage d'une affaire avec un confrère, côté cabinet : inviter, régler les
// droits, retirer l'accès. Les droits sont vérifiés par le serveur à chaque
// requête de l'invité (server/projectShares/access.ts) ; cet écran ne fait que
// les régler. Réservé aux administrateurs et managers : pour les autres, le
// serveur répond 403 et le panneau ne s'affiche pas.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

type Access = 'none' | 'read' | 'write';
interface Grant { kind: 'lots' | 'tasks'; access: 'read' | 'write' }
interface Share { id: string; email: string; name: string | null; grants: Grant[] }
interface SharesPayload {
  shares: Share[];
  limits: { guestsPerProject: number; guestsPerTenant: number };
  usage: { project: number; tenant: number };
  writableKinds: string[];
}

const KINDS: Array<'lots' | 'tasks'> = ['lots', 'tasks'];

function accessOf(grants: Grant[], kind: Grant['kind']): Access {
  return grants.find(g => g.kind === kind)?.access ?? 'none';
}

function toGrants(values: Record<Grant['kind'], Access>): Grant[] {
  return KINDS.flatMap(kind => (values[kind] === 'none' ? [] : [{ kind, access: values[kind] as 'read' | 'write' }]));
}

function AccessSelect({ kind, value, writable, onChange }: {
  kind: Grant['kind']; value: Access; writable: boolean; onChange: (v: Access) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="font-medium text-[var(--tblr-text)]">{t(`share_kind_${kind}`)}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as Access)}
        className="px-2 py-1 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <option value="none">{t('share_access_none')}</option>
        <option value="read">{t('share_access_read')}</option>
        {writable && <option value="write">{t('share_access_write')}</option>}
      </select>
    </label>
  );
}

function ShareRow({ projectId, share, writableKinds, onChanged, onMessage }: {
  projectId: string; share: Share; writableKinds: string[];
  onChanged: () => void; onMessage: (text: string, isError?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<Grant['kind'], Access>>({
    lots: accessOf(share.grants, 'lots'), tasks: accessOf(share.grants, 'tasks'),
  });
  const [busy, setBusy] = useState(false);
  const label = share.name || share.email;

  const save = async () => {
    const grants = toGrants(values);
    if (!grants.length) { onMessage(t('share_pick_one'), true); return; }
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/shares/${share.id}`, { method: 'PUT', body: JSON.stringify({ grants }) });
      onMessage(t('share_saved'));
      onChanged();
    } catch (e: any) { onMessage(e?.message || t('share_error'), true); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!window.confirm(t('share_revoke_confirm', { name: label }))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/shares/${share.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e: any) { onMessage(e?.message || t('share_error'), true); setBusy(false); }
  };

  return (
    <li className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--tblr-text)] truncate">{label}</div>
          {share.name && <div className="text-xs text-[var(--tblr-muted)] truncate">{share.email}</div>}
        </div>
        <button
          type="button" onClick={revoke} disabled={busy}
          aria-label={t('share_revoke')} title={t('share_revoke')}
          className="p-1.5 rounded-lg text-[var(--tblr-muted)] hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <IconTrash size={16} />
        </button>
      </div>
      <div className="space-y-1.5">
        {KINDS.map(kind => (
          <AccessSelect
            key={kind} kind={kind} value={values[kind]} writable={writableKinds.includes(kind)}
            onChange={v => setValues(prev => ({ ...prev, [kind]: v }))}
          />
        ))}
      </div>
      <button
        type="button" onClick={save} disabled={busy}
        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] disabled:opacity-50"
      >
        {t('share_save')}
      </button>
    </li>
  );
}

export default function ProjectSharesPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<SharesPayload | null>(null);
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<Record<Grant['kind'], Access>>({ lots: 'read', tasks: 'read' });
  const [busy, setBusy] = useState(false);

  const say = useCallback((text: string, isError = false) => setMessage({ text, isError }), []);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<SharesPayload>(`/api/projects/${projectId}/shares`));
    } catch (e: any) {
      // Réservé aux administrateurs et managers : pour les autres, on ne montre rien.
      if (e?.status === 403 || e?.status === 404) setHidden(true);
      else say(e?.message || t('share_error'), true);
    }
  }, [projectId, say, t]);

  useEffect(() => { setHidden(false); setData(null); void load(); }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const grants = toGrants(invite);
    if (!grants.length) { say(t('share_pick_one'), true); return; }
    setBusy(true);
    setMessage(null);
    try {
      const created = await apiFetch<{ emailSent: boolean }>(`/api/projects/${projectId}/shares`, {
        method: 'POST', body: JSON.stringify({ email, name: name || undefined, grants }),
      });
      say(created.emailSent ? t('share_invited') : t('share_invited_no_mail'));
      setEmail('');
      setName('');
      await load();
    } catch (e: any) { say(e?.message || t('share_error'), true); }
    finally { setBusy(false); }
  };

  if (hidden) return null;
  const writableKinds = data?.writableKinds ?? [];

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-[var(--tblr-text)]">
          <IconUsersGroup size={16} />
          {t('share_panel_title')}
        </span>
        {data && (
          <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">
            {t('share_usage', { count: data.usage.project, max: data.limits.guestsPerProject })}
          </span>
        )}
      </div>
      <p className="px-4 pb-3 text-xs text-[var(--tblr-muted)]">{t('share_panel_hint')}</p>

      {data && data.shares.length === 0 && (
        <p className="px-4 py-3 text-xs text-[var(--tblr-muted)]" style={{ borderTop: '1px solid var(--tblr-border)' }}>{t('share_empty')}</p>
      )}
      {data && data.shares.length > 0 && (
        <ul>
          {data.shares.map(share => (
            <ShareRow
              key={`${share.id}-${share.grants.map(g => `${g.kind}${g.access}`).join('')}`}
              projectId={projectId} share={share} writableKinds={writableKinds}
              onChanged={load} onMessage={say}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder={t('share_email_label')} aria-label={t('share_email_label')}
          className="w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <input
          type="text" value={name} onChange={e => setName(e.target.value)} maxLength={120}
          placeholder={t('share_name_label')} aria-label={t('share_name_label')}
          className="w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <div className="space-y-1.5">
          {KINDS.map(kind => (
            <AccessSelect
              key={kind} kind={kind} value={invite[kind]} writable={writableKinds.includes(kind)}
              onChange={v => setInvite(prev => ({ ...prev, [kind]: v }))}
            />
          ))}
        </div>
        <button
          type="submit" disabled={busy || !email}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {busy ? t('share_inviting') : t('share_invite')}
        </button>
        {message && (
          <p role="status" className={`text-xs ${message.isError ? 'text-red-600' : 'text-[var(--tblr-muted)]'}`}>{message.text}</p>
        )}
      </form>
    </div>
  );
}
