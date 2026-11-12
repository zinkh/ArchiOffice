import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileTypePdf, IconLoader2 } from '@tabler/icons-react';
import type { LoadedBackground } from '../../lib/croquis/background';
import {
  loadBackgroundFromSource,
  photosToSources,
  plansToSources,
  type BackgroundSource,
} from '../../lib/croquis/projectBackground';
import { SignedImage } from '../SignedImage';
import { ModalShell } from '../ui/ModalShell';
import { FULL_BTN, SEGMENT, SEGMENT_BTN } from './ui';

interface CroquisProjectBackgroundProps {
  projectId: string;
  /** Le fond choisi, déjà réduit et converti : à traiter comme une image importée. */
  onPick: (loaded: LoadedBackground) => void;
}

type SourcesState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ready'; plans: BackgroundSource[]; photos: BackgroundSource[] };

async function fetchJson(url: string): Promise<unknown[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Plans et photos de l'affaire, lus à l'ouverture de la fenêtre. Pas de cache : il faut le réseau pour poser le fond. */
function useProjectSources(projectId: string): SourcesState {
  const [state, setState] = useState<SourcesState>(() => (navigator.onLine ? { status: 'loading' } : { status: 'offline' }));

  useEffect(() => {
    if (!navigator.onLine) {
      setState({ status: 'offline' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    const id = encodeURIComponent(projectId);
    void Promise.all([fetchJson(`/api/plans?project_id=${id}`), fetchJson(`/api/projects/${id}/observations`)]).then(([plans, observations]) => {
      if (cancelled) return;
      // Une des deux lectures peut échouer sans empêcher l'autre : on montre ce qu'on a.
      if (plans === null && observations === null) {
        setState({ status: 'error' });
        return;
      }
      setState({
        status: 'ready',
        plans: plansToSources((plans ?? []) as Parameters<typeof plansToSources>[0]),
        photos: photosToSources((observations ?? []) as Parameters<typeof photosToSources>[0]),
      });
    });
    return () => { cancelled = true; };
  }, [projectId]);

  return state;
}

const CARD =
  'group relative flex aspect-square min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-left ' +
  'hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60';

function SourceCard({ source, label, busy, disabled, onPick }: {
  source: BackgroundSource;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  // Un plan en PDF n'a pas de vignette (le rendre coûte cher) : une icône et son nom suffisent.
  const showImage = source.kind === 'photo' || !source.isPdf;
  return (
    <button type="button" className={CARD} onClick={onPick} disabled={disabled} aria-label={`${t('croquis_picker_use')} : ${label}`}>
      <span className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100">
        {showImage ? (
          <SignedImage src={source.fileUrl} alt="" className="h-full w-full object-cover" deferUntilVisible />
        ) : (
          <IconFileTypePdf size={36} className="text-neutral-500" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 border-t border-neutral-200 px-2 py-1.5">
        <span className="truncate text-xs font-medium text-neutral-900">{label}</span>
        {source.detail && <span className="truncate text-[11px] text-neutral-500">{source.detail}</span>}
      </span>
      {busy && (
        <span className="absolute inset-0 grid place-items-center bg-white/80" role="status">
          <span className="inline-flex items-center gap-2 text-xs text-neutral-700">
            <IconLoader2 size={16} className="animate-spin" aria-hidden />
            {t('croquis_picker_preparing')}
          </span>
        </span>
      )}
    </button>
  );
}

function PickerDialog({ projectId, onPick, onClose }: CroquisProjectBackgroundProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const sources = useProjectSources(projectId);
  const [tab, setTab] = useState<'plans' | 'photos'>('plans');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const choose = async (source: BackgroundSource) => {
    setError('');
    setBusyId(source.id);
    try {
      onPick(await loadBackgroundFromSource(source));
      onClose();
    } catch {
      setError(t('croquis_picker_error'));
      setBusyId(null);
    }
  };

  const list = sources.status === 'ready' ? (tab === 'plans' ? sources.plans : sources.photos) : [];

  return (
    <ModalShell title={t('croquis_picker_title')} subtitle={t('croquis_picker_subtitle')} onClose={onClose} busy={busyId !== null} size="xl">
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {sources.status === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500" role="status">
            <IconLoader2 size={18} className="animate-spin" aria-hidden />
            {t('croquis_loading_list')}
          </p>
        )}
        {sources.status === 'offline' && <p className="py-8 text-center text-sm text-neutral-500">{t('croquis_picker_offline')}</p>}
        {sources.status === 'error' && <p className="py-8 text-center text-sm text-neutral-500">{t('croquis_picker_list_error')}</p>}

        {sources.status === 'ready' && (
          <>
            <div className={`${SEGMENT} max-w-xs`} role="group" aria-label={t('croquis_picker_title')}>
              <button type="button" className={SEGMENT_BTN} aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}>
                {t('croquis_picker_plans')} ({sources.plans.length})
              </button>
              <button type="button" className={SEGMENT_BTN} aria-pressed={tab === 'photos'} onClick={() => setTab('photos')}>
                {t('croquis_picker_photos')} ({sources.photos.length})
              </button>
            </div>
            {tab === 'plans' && sources.plans.length > 0 && <p className="text-xs text-neutral-500">{t('croquis_picker_pdf_note')}</p>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {list.length === 0 ? (
              <p className="py-6 text-center text-sm italic text-neutral-500">
                {tab === 'plans' ? t('croquis_picker_empty_plans') : t('croquis_picker_empty_photos')}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {list.map((source, index) => (
                  <li key={source.id} className="min-w-0">
                    <SourceCard
                      source={source}
                      label={source.name || t('croquis_picker_photo', { n: index + 1 })}
                      busy={busyId === source.id}
                      disabled={busyId !== null}
                      onPick={() => { void choose(source); }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

/** Bouton du panneau « Fond » : choisir un plan ou une photo déjà présents sur l'affaire. */
export default function CroquisProjectBackground({ projectId, onPick }: CroquisProjectBackgroundProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={FULL_BTN} onClick={() => setOpen(true)}>
        {t('croquis_bg_from_project')}
      </button>
      {open && <PickerDialog projectId={projectId} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}
