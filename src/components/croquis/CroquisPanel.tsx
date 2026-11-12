import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconEdit, IconLoader2, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useCroquisList } from '../../hooks/useCroquisList';
import type { CroquisParent } from '../../lib/croquisOffline';
import { loadCroquisImage } from '../../lib/croquisSync';
import type { Croquis } from '../../types';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import CroquisDialog from './CroquisDialog';

export interface CroquisPanelProps {
  /** La réunion ou le compte-rendu de chantier qui porte les croquis. */
  parent: CroquisParent;
  /** Affaire archivée : on consulte et on exporte, on ne crée, ne renomme ni ne supprime rien. */
  readOnly?: boolean;
  /** Affiche le titre « Croquis (N) » : pour un écran qui n'a pas déjà un bloc titré (le compte-rendu a le sien). */
  showHeading?: boolean;
}

/** Un refus du serveur pour une affaire archivée a son propre message ; le reste, celui de l'action. */
const errorKey = (error: unknown, fallback: string): string =>
  (error as { status?: number } | null)?.status === 409 ? 'croquis_error_archived' : fallback;

/** Aperçu d'un croquis : l'image gardée sur l'appareil, sinon celle du serveur. Rien à montrer pour un croquis vide. */
function CroquisThumb({ row }: { row: Croquis }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const blank = row.scene.elements.length === 0 && !row.bg_path;

  useEffect(() => {
    setUrl(null);
    if (blank) return undefined;
    let cancelled = false;
    let created: string | null = null;
    loadCroquisImage(row, 'preview')
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // Une nouvelle image arrive avec une nouvelle référence ou une nouvelle date de modification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.preview_path, row.updated_at, blank]);

  if (url) return <img src={url} alt="" className="h-full w-full object-contain" />;
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-neutral-400">
      <IconPencil size={28} aria-hidden />
      <span className="text-xs">{blank ? t('croquis_blank') : t('croquis_no_preview')}</span>
    </span>
  );
}

/** Titre modifiable en place : Entrée ou la sortie du champ enregistre, Échap annule. */
function RenameField({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (title: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save) onSubmit(value);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={200}
      aria-label={t('croquis_rename_label')}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className="w-full rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 pointer-coarse:min-h-11"
      style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
    />
  );
}

const ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors pointer-coarse:h-11 pointer-coarse:w-11';

/**
 * Les croquis d'une réunion ou d'un compte-rendu de chantier : liste d'aperçus, nouveau, renommer, supprimer,
 * et l'éditeur en plein écran. Fonctionne hors ligne (voir src/lib/croquisOffline.ts) : un croquis créé sur
 * un chantier sans réseau apparaît tout de suite, marqué « en attente d'envoi ».
 */
export default function CroquisPanel({ parent, readOnly = false, showHeading = false }: CroquisPanelProps) {
  const { t, i18n } = useTranslation();
  const { croquis, loading, loadFailed, reload, create, rename, remove } = useCroquisList(parent);
  const { confirm, dialog } = useConfirmDialog();
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const opened = croquis.find((c) => c.id === openId) ?? null;

  const handleNew = async () => {
    setError('');
    setCreating(true);
    try {
      const row = await create();
      setOpenId(row.id);
    } catch (e) {
      setError(t(errorKey(e, 'croquis_error_create')));
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (row: Croquis, title: string) => {
    setRenamingId(null);
    const clean = title.trim();
    if (!clean || clean === row.title) return;
    setError('');
    try {
      await rename(row.id, clean);
    } catch (e) {
      setError(t(errorKey(e, 'croquis_error_rename')));
    }
  };

  const handleDelete = async (row: Croquis) => {
    const confirmed = await confirm({
      title: t('croquis_delete_title'),
      message: t('croquis_delete_message', { title: row.title }),
      confirmLabel: t('croquis_delete'),
      cancelLabel: t('croquis_cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setError('');
    try {
      await remove(row.id);
    } catch (e) {
      setError(t(errorKey(e, 'croquis_error_delete')));
    }
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(i18n.language);
  };

  const newButton = !readOnly && (
    <button
      type="button"
      onClick={() => { void handleNew(); }}
      disabled={creating}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-50 pointer-coarse:min-h-11"
      style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
    >
      {creating ? <IconLoader2 size={14} className="animate-spin" aria-hidden /> : <IconPlus size={14} aria-hidden />}
      {t('croquis_new')}
    </button>
  );

  return (
    <div className="min-w-0">
      <div className={`mb-3 flex min-w-0 flex-wrap items-center gap-2 ${showHeading ? 'justify-between' : 'justify-end'}`}>
        {showHeading && (
          <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>
            <IconPencil size={16} aria-hidden />
            {t('croquis_section_title')} ({croquis.length})
          </h2>
        )}
        {newButton}
      </div>

      {error && (
        <p role="alert" className="mb-3 flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-danger)' }}>
          <IconAlertTriangle size={16} aria-hidden />
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--tblr-muted)' }} role="status">{t('croquis_loading_list')}</p>
      ) : loadFailed && croquis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>
          <p>{t('croquis_load_failed')}</p>
          <button type="button" onClick={() => { void reload(); }} className="rounded-lg px-3 py-1.5 text-xs pointer-coarse:min-h-11" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            {t('croquis_retry')}
          </button>
        </div>
      ) : croquis.length === 0 ? (
        <p className="py-2 text-center text-sm italic" style={{ color: 'var(--tblr-muted)' }}>
          {parent.kind === 'meeting' ? t('croquis_empty_meeting') : t('croquis_empty_report')}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {croquis.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                aria-label={`${t('croquis_open')} : ${c.title}`}
                className="block aspect-[4/3] w-full bg-white"
                style={{ borderBottom: '1px solid var(--tblr-border)' }}
              >
                <CroquisThumb row={c} />
              </button>
              <div className="flex flex-col gap-2 p-3">
                {renamingId === c.id ? (
                  <RenameField initial={c.title} onSubmit={(title) => { void handleRename(c, title); }} onCancel={() => setRenamingId(null)} />
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>{c.title}</span>
                    {c.pendingSync && (
                      <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--tblr-warning-lt, #fff3bf)', color: 'var(--tblr-warning, #e67700)' }}>
                        {t('croquis_pending_badge')}
                      </span>
                    )}
                  </div>
                )}
                {formatDate(c.updated_at) && (
                  <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('croquis_updated_on', { date: formatDate(c.updated_at) })}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium pointer-coarse:min-h-11"
                    style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                  >
                    {readOnly ? t('croquis_view') : t('croquis_open')}
                  </button>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRenamingId(c.id)}
                        aria-label={t('croquis_rename')}
                        title={t('croquis_rename')}
                        className={ICON_BUTTON}
                        style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                      >
                        <IconEdit size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleDelete(c); }}
                        aria-label={t('croquis_delete')}
                        title={t('croquis_delete')}
                        className={ICON_BUTTON}
                        style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-danger)' }}
                      >
                        <IconTrash size={16} aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {opened && <CroquisDialog row={opened} readOnly={readOnly} onClose={() => setOpenId(null)} />}
      {dialog}
    </div>
  );
}
