// Partage d'une affaire avec un confrère, côté cabinet : inviter, régler les
// droits, retirer l'accès, lire les commentaires. Les droits sont vérifiés par le
// serveur à chaque requête de l'invité (server/projectShares/access.ts) ; cet écran
// ne fait que les régler. Réservé aux administrateurs et managers : pour les
// autres, le serveur répond 403 et le panneau ne s'affiche pas.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import ShareCommentsInbox, { type InboxLot } from './ShareCommentsInbox';

type Access = 'none' | 'read' | 'comment' | 'write';
type SimpleKind = 'lots' | 'tasks' | 'documents';
type LotKind = 'cctp' | 'dpgf';
interface Grant { kind: SimpleKind | LotKind; access: 'read' | 'comment' | 'write'; lotId?: string }
interface Share { id: string; email: string; name: string | null; grants: Grant[] }
interface SharesPayload {
  shares: Share[];
  limits: { guestsPerProject: number; guestsPerTenant: number };
  usage: { project: number; tenant: number };
  writableKinds: string[];
  lots: InboxLot[];
}

/** Droits en cours d'édition : les types simples, et un niveau par lot pour le CCTP et le DPGF. */
interface GrantState { simple: Record<SimpleKind, Access>; lot: Record<LotKind, Record<string, Access>> }

const SIMPLE_KINDS: SimpleKind[] = ['lots', 'tasks', 'documents'];
const LOT_KINDS: LotKind[] = ['cctp', 'dpgf'];

const emptyState = (): GrantState => ({
  simple: { lots: 'read', tasks: 'read', documents: 'none' },
  lot: { cctp: {}, dpgf: {} },
});

function stateOf(grants: Grant[]): GrantState {
  const state: GrantState = { simple: { lots: 'none', tasks: 'none', documents: 'none' }, lot: { cctp: {}, dpgf: {} } };
  for (const g of grants) {
    if (g.kind === 'cctp' || g.kind === 'dpgf') { if (g.lotId) state.lot[g.kind][g.lotId] = g.access; }
    else state.simple[g.kind] = g.access;
  }
  return state;
}

function grantsOf(state: GrantState): Grant[] {
  const simple = SIMPLE_KINDS.flatMap(kind => (state.simple[kind] === 'none' ? [] : [{ kind, access: state.simple[kind] as Grant['access'] }]));
  const lots = LOT_KINDS.flatMap(kind => Object.entries(state.lot[kind])
    .filter(([, access]) => access !== 'none')
    .map(([lotId, access]) => ({ kind, access: access as Grant['access'], lotId })));
  return [...simple, ...lots];
}

function AccessSelect({ label, value, options, onChange }: {
  label: string; value: Access; options: Access[]; onChange: (v: Access) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="font-medium text-[var(--tblr-text)]">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as Access)}
        className="px-2 py-1 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {options.map(o => <option key={o} value={o}>{t(`share_access_${o}`)}</option>)}
      </select>
    </label>
  );
}

function GrantsEditor({ state, onChange, writableKinds, lots }: {
  state: GrantState; onChange: (next: GrantState) => void; writableKinds: string[]; lots: InboxLot[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {SIMPLE_KINDS.map(kind => (
          <AccessSelect
            key={kind} label={t(`share_kind_${kind}`)} value={state.simple[kind]}
            options={writableKinds.includes(kind) ? ['none', 'read', 'write'] : ['none', 'read']}
            onChange={v => onChange({ ...state, simple: { ...state.simple, [kind]: v } })}
          />
        ))}
      </div>
      {LOT_KINDS.map(kind => (
        <div key={kind} className="space-y-1.5">
          <div className="text-xs font-bold text-[var(--tblr-text)]">{t(`share_kind_${kind}`)}</div>
          {lots.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('share_no_lots')}</p>}
          {lots.map(lot => (
            <AccessSelect
              key={lot.id} label={[lot.lot_number, lot.lot_title].filter(Boolean).join(' ') || lot.id}
              value={state.lot[kind][lot.id] ?? 'none'} options={['none', 'read', 'comment']}
              onChange={v => onChange({ ...state, lot: { ...state.lot, [kind]: { ...state.lot[kind], [lot.id]: v } } })}
            />
          ))}
        </div>
      ))}
      <p className="text-xs text-[var(--tblr-muted)]">{t('share_lots_hint')}</p>
    </div>
  );
}

function ShareRow({ projectId, share, writableKinds, lots, onChanged, onMessage }: {
  projectId: string; share: Share; writableKinds: string[]; lots: InboxLot[];
  onChanged: () => void; onMessage: (text: string, isError?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<GrantState>(() => stateOf(share.grants));
  const [busy, setBusy] = useState(false);
  const label = share.name || share.email;

  const save = async () => {
    const grants = grantsOf(state);
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
      <GrantsEditor state={state} onChange={setState} writableKinds={writableKinds} lots={lots} />
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
  const [invite, setInvite] = useState<GrantState>(emptyState);
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
    const grants = grantsOf(invite);
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
  const lots = data?.lots ?? [];

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
              key={`${share.id}-${share.grants.map(g => `${g.kind}${g.lotId ?? ''}${g.access}`).join('')}`}
              projectId={projectId} share={share} writableKinds={writableKinds} lots={lots}
              onChanged={load} onMessage={say}
            />
          ))}
        </ul>
      )}

      <ShareCommentsInbox projectId={projectId} lots={lots} />

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
        <GrantsEditor state={invite} onChange={setInvite} writableKinds={writableKinds} lots={lots} />
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
