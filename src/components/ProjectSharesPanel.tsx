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
import ShareProposalsInbox from './ShareProposalsInbox';
import ShareActProposalsInbox from './ShareActProposalsInbox';

type Access = 'none' | 'read' | 'comment' | 'write';
/** Un atelier de l'affaire : un droit par atelier, jamais par lot. */
type Atelier = 'lots' | 'tasks' | 'documents' | 'cctp' | 'dpgf' | 'act' | 'reports' | 'reserves' | 'gpa';
interface Grant { kind: Atelier; access: 'read' | 'comment' | 'write' }
interface Share { id: string; email: string; name: string | null; contactId?: string | null; grants: Grant[] }
/** Fiche de l'annuaire du cabinet, réduite à ce qui sert à choisir un confrère. */
interface ContactOption { id: string; name: string; email: string; company: string }
interface SharesPayload {
  shares: Share[];
  limits: { guestsPerProject: number; guestsPerTenant: number };
  usage: { project: number; tenant: number };
  writableKinds: string[];
  commentableKinds?: string[];
  lots: InboxLot[];
}

/** Droits en cours d'édition : un niveau par atelier. */
type GrantState = Record<Atelier, Access>;

/** Les ateliers dans l'ordre de l'affaire. */
const ATELIERS: Atelier[] = ['lots', 'tasks', 'documents', 'cctp', 'dpgf', 'act', 'reports', 'reserves', 'gpa'];
/** Ateliers dont la modification est SOUMISE À VALIDATION (le confrère propose, le cabinet approuve). */
const PROPOSAL_ATELIERS: Atelier[] = ['cctp', 'dpgf', 'act'];
/** Niveaux de repli quand le serveur ne dit pas ce qui est modifiable ou commentable (instance plus ancienne). */
const FALLBACK_WRITABLE: Atelier[] = ['tasks', 'cctp', 'dpgf', 'act', 'reports', 'reserves', 'gpa'];
const FALLBACK_COMMENTABLE: Atelier[] = ['cctp', 'dpgf'];

const emptyState = (): GrantState => ({ lots: 'read', tasks: 'read', documents: 'none', cctp: 'none', dpgf: 'none', act: 'none', reports: 'none', reserves: 'none', gpa: 'none' });

function stateOf(grants: Grant[]): GrantState {
  const state: GrantState = { lots: 'none', tasks: 'none', documents: 'none', cctp: 'none', dpgf: 'none', act: 'none', reports: 'none', reserves: 'none', gpa: 'none' };
  for (const g of grants) if (g.kind in state) state[g.kind] = g.access;
  return state;
}

function grantsOf(state: GrantState): Grant[] {
  return ATELIERS.flatMap(kind => (state[kind] === 'none' ? [] : [{ kind, access: state[kind] as Grant['access'] }]));
}

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Les contacts du cabinet qui peuvent être invités : la fiche doit porter une adresse (la même règle que le serveur). */
function toOption(c: any): ContactOption {
  const email = [c.email_work, c.email, c.email_home, c.email_other].map(asText).find(Boolean) ?? '';
  const person = [asText(c.first_name), asText(c.last_name)].filter(Boolean).join(' ');
  return { id: String(c.id), name: person || asText(c.company_name), email: email.toLowerCase(), company: person ? asText(c.company_name) : '' };
}

function AccessSelect({ label, value, options, onChange, writeKey = 'share_access_write' }: {
  label: string; value: Access; options: Access[]; onChange: (v: Access) => void;
  /** Libellé du niveau « modification » : pour le CCTP et le DPGF, la modification passe par une validation du cabinet. */
  writeKey?: string;
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
        {options.map(o => <option key={o} value={o}>{t(o === 'write' ? writeKey : `share_access_${o}`)}</option>)}
      </select>
    </label>
  );
}

/**
 * Les niveaux d'un atelier : aucun accès, puis lecture et commentaire là où les commentaires existent (CCTP, DPGF)
 * ou lecture seule ailleurs, puis lecture et modification là où la modification est branchée côté serveur.
 */
function optionsFor(kind: Atelier, writable: Atelier[], commentable: Atelier[]): Access[] {
  const levels: Access[] = ['none', commentable.includes(kind) ? 'comment' : 'read'];
  if (writable.includes(kind)) levels.push('write');
  return levels;
}

function GrantsEditor({ state, onChange, writableKinds, commentableKinds }: {
  state: GrantState; onChange: (next: GrantState) => void; writableKinds: string[]; commentableKinds: string[];
}) {
  const { t } = useTranslation();
  const writable = (writableKinds.length ? writableKinds : FALLBACK_WRITABLE) as Atelier[];
  const commentable = (commentableKinds.length ? commentableKinds : FALLBACK_COMMENTABLE) as Atelier[];
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold text-[var(--tblr-text)]">{t('share_ateliers_title')}</div>
      {ATELIERS.map(kind => (
        <AccessSelect
          key={kind} label={t(`share_kind_${kind}`)} value={state[kind]}
          writeKey={PROPOSAL_ATELIERS.includes(kind) ? 'share_access_write_propose' : 'share_access_write'}
          options={optionsFor(kind, writable, commentable)}
          onChange={v => onChange({ ...state, [kind]: v })}
        />
      ))}
      <p className="text-xs text-[var(--tblr-muted)]">{t('share_ateliers_hint')}</p>
    </div>
  );
}

function ShareRow({ projectId, share, writableKinds, commentableKinds, onChanged, onMessage }: {
  projectId: string; share: Share; writableKinds: string[]; commentableKinds: string[];
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
      <GrantsEditor state={state} onChange={setState} writableKinds={writableKinds} commentableKinds={commentableKinds} />
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
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState('');
  const [query, setQuery] = useState('');
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

  // Le confrère se choisit dans les contacts de l'agence : la fiche porte ensuite le suivi des opérations en collaboration.
  useEffect(() => {
    apiFetch<any[]>('/api/contacts')
      .then(rows => setContacts(rows.map(toOption).filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'))))
      .catch(() => setContacts([]));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const grants = grantsOf(invite);
    if (!grants.length) { say(t('share_pick_one'), true); return; }
    setBusy(true);
    setMessage(null);
    try {
      const created = await apiFetch<{ emailSent: boolean }>(`/api/projects/${projectId}/shares`, {
        method: 'POST', body: JSON.stringify({ contact_id: contactId, grants }),
      });
      say(created.emailSent ? t('share_invited') : t('share_invited_no_mail'));
      setContactId('');
      setQuery('');
      await load();
    } catch (e: any) { say(e?.message || t('share_error'), true); }
    finally { setBusy(false); }
  };

  if (hidden) return null;
  const writableKinds = data?.writableKinds ?? [];
  const commentableKinds = data?.commentableKinds ?? [];
  const lots = data?.lots ?? [];
  const invitedIds = new Set((data?.shares ?? []).map(share => share.contactId).filter(Boolean));
  const invitedEmails = new Set((data?.shares ?? []).map(share => share.email.toLowerCase()));
  const needle = query.trim().toLowerCase();
  const matches = contacts
    .filter(c => !needle || `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(needle))
    .slice(0, 50);
  const chosen = contacts.find(c => c.id === contactId) ?? null;

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
              projectId={projectId} share={share} writableKinds={writableKinds} commentableKinds={commentableKinds}
              onChanged={load} onMessage={say}
            />
          ))}
        </ul>
      )}

      <ShareProposalsInbox projectId={projectId} lots={lots} />
      <ShareActProposalsInbox projectId={projectId} />
      <ShareCommentsInbox projectId={projectId} lots={lots} />

      <form onSubmit={submit} className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
        <input
          type="search" value={chosen ? chosen.name : query}
          onChange={e => { setContactId(''); setQuery(e.target.value); }}
          placeholder={t('share_contact_search')} aria-label={t('share_contact_search')}
          className="w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        {!chosen && (
          <ul role="listbox" aria-label={t('share_contact_list')} className="max-h-44 overflow-y-auto rounded-lg border border-[var(--tblr-border)]">
            {matches.length === 0 && <li className="px-3 py-2 text-xs text-[var(--tblr-muted)]">{t('share_contact_none')}</li>}
            {matches.map(c => {
              const already = invitedIds.has(c.id) || (!!c.email && invitedEmails.has(c.email));
              const disabled = !c.email || already;
              return (
                <li key={c.id} role="option" aria-selected={false} aria-disabled={disabled}>
                  <button
                    type="button" disabled={disabled} onClick={() => setContactId(c.id)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="font-medium text-[var(--tblr-text)]">{c.name}</span>
                    {c.company && <span className="text-[var(--tblr-muted)]"> · {c.company}</span>}
                    <span className="block text-[var(--tblr-muted)]">
                      {!c.email ? t('share_contact_no_email') : already ? t('share_contact_already') : c.email}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {chosen && <p className="text-xs text-[var(--tblr-muted)]">{chosen.email}</p>}
        <GrantsEditor state={invite} onChange={setInvite} writableKinds={writableKinds} commentableKinds={commentableKinds} />
        <button
          type="submit" disabled={busy || !chosen}
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
