import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft, IconCheck, IconExternalLink, IconFileTypePdf, IconLayoutGrid, IconLink,
  IconLoader2, IconPhoto, IconPlus, IconUpload, IconX,
} from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { queuedJsonRequest, queuedMultipartRequest } from '../../lib/offlineQueue';
import { SignedImage } from '../SignedImage';
import { fetchAgencySettings } from '../../lib/pdfLetterhead';
import { exportInspirationBoardToPDF } from '../../lib/inspirationExport';
import type {
  InspirationBoard, InspirationBoardItem, InspirationItem, InspirationPhase,
} from '../../types';

interface InspirationPayload {
  boards: InspirationBoard[];
  items: InspirationItem[];
  placements: InspirationBoardItem[];
}

const PHASES: Array<'ALL' | InspirationPhase> = ['ALL', 'ESQ', 'APS', 'APD', 'PRO'];
const BOARD_FORMATS = ['A4P', 'A4L', 'A3P', 'A3L', '16:9'];
const BOARD_LAYOUTS = ['grid', 'mosaic', 'materials'] as const;

function itemImage(item: InspirationItem, alt: string) {
  if (item.local_preview_url) {
    return <img src={item.local_preview_url} alt={alt} className="h-full w-full object-cover" />;
  }
  if (item.file_url) {
    return <SignedImage src={item.file_url} alt={alt} className="h-full w-full object-cover" deferUntilVisible />;
  }
  if (item.source_url) {
    return <img src={item.source_url} alt={alt} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />;
  }
  return <div className="h-full w-full flex items-center justify-center text-[var(--tblr-muted)]"><IconPhoto size={28} /></div>;
}

export function InspirationBoards({ projectId, projectName, projectCode }: { projectId: string; projectName?: string; projectCode?: string }) {
  const { t } = useTranslation();
  const uploadRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const [boards, setBoards] = useState<InspirationBoard[]>([]);
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [placements, setPlacements] = useState<InspirationBoardItem[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'ALL' | InspirationPhase>('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [boardTitle, setBoardTitle] = useState('');
  const [boardPhase, setBoardPhase] = useState<InspirationPhase>('ESQ');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<InspirationPayload>('/api/inspiration-boards?project_id=' + encodeURIComponent(projectId));
      setBoards(data.boards || []);
      setItems(data.items || []);
      setPlacements(data.placements || []);
    } catch (err: any) {
      setError(err?.message || t('inspiration_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    return () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    };
  }, [projectId]);

  const activeBoard = useMemo(
    () => boards.find(board => board.id === activeBoardId) || null,
    [boards, activeBoardId],
  );

  const filteredBoards = useMemo(
    () => boards.filter(board => phase === 'ALL' || board.phase === phase),
    [boards, phase],
  );
  const filteredItems = useMemo(
    () => items.filter(item => phase === 'ALL' || item.phase === phase),
    [items, phase],
  );
  const boardPlacements = useMemo(
    () => placements.filter(placement => placement.board_id === activeBoardId),
    [placements, activeBoardId],
  );
  const boardItems = useMemo(() => {
    const order = new Map(boardPlacements.map((placement, index) => [placement.item_id, placement.z_index ?? index]));
    return items
      .filter(item => order.has(item.id))
      .sort((a, b) => Number(order.get(a.id) || 0) - Number(order.get(b.id) || 0));
  }, [items, boardPlacements]);

  const isOnActiveBoard = (itemId: string) => (
    !!activeBoardId && placements.some(p => p.board_id === activeBoardId && p.item_id === itemId)
  );

  const createBoard = async () => {
    const title = boardTitle.trim();
    if (!title) return;
    const id = crypto.randomUUID();
    const optimistic: InspirationBoard = {
      id,
      project_id: projectId,
      title,
      phase: boardPhase,
      format: 'A3L',
      layout: 'grid',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pendingSync: true,
    };
    setBusy(true);
    setError(null);
    try {
      const result = await queuedJsonRequest<InspirationBoard>({
        entity: 'inspirationBoard',
        id,
        method: 'POST',
        url: '/api/inspiration-boards',
        body: { ...optimistic, pendingSync: undefined },
      });
      const saved = result.queued ? optimistic : result.data!;
      setBoards(prev => [saved, ...prev.filter(b => b.id !== id)]);
      setActiveBoardId(id);
      setBoardTitle('');
      setShowCreateBoard(false);
    } catch (err: any) {
      setError(err?.message || t('inspiration_board_create_failed'));
    } finally {
      setBusy(false);
    }
  };

  const updateBoard = async (patch: Partial<Pick<InspirationBoard, 'layout' | 'format' | 'phase'>>) => {
    if (!activeBoard) return;
    const before = activeBoard;
    setBoards(prev => prev.map(b => b.id === before.id ? { ...b, ...patch } : b));
    try {
      await queuedJsonRequest<InspirationBoard>({
        entity: 'inspirationBoard',
        id: crypto.randomUUID(),
        method: 'PUT',
        url: '/api/inspiration-boards/' + encodeURIComponent(before.id),
        body: patch,
      });
    } catch (err: any) {
      setBoards(prev => prev.map(b => b.id === before.id ? before : b));
      setError(err?.message || t('inspiration_board_update_failed'));
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const id = crypto.randomUUID();
        const placementId = activeBoardId ? crypto.randomUUID() : '';
        const itemPhase: InspirationPhase = activeBoard?.phase || (phase === 'ALL' ? 'ESQ' : phase);
        const preview = URL.createObjectURL(file);
        previewUrls.current.push(preview);
        const optimistic: InspirationItem = {
          id,
          project_id: projectId,
          title: file.name,
          phase: itemPhase,
          category: 'architecture',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          pendingSync: true,
          local_preview_url: preview,
        };

        const result = await queuedMultipartRequest<{ item: InspirationItem; placement?: InspirationBoardItem | null }>({
          entity: 'inspirationItem',
          id,
          method: 'POST',
          url: '/api/inspiration-items',
          blob: file,
          blobFieldName: 'file',
          blobFilename: file.name || 'inspiration.jpg',
          extraFields: {
            id,
            project_id: projectId,
            phase: itemPhase,
            category: 'architecture',
            title: file.name,
            ...(activeBoardId ? { board_id: activeBoardId, placement_id: placementId } : {}),
          },
        });

        if (result.queued) {
          setItems(prev => [optimistic, ...prev]);
          if (activeBoardId) {
            setPlacements(prev => [...prev, {
              id: placementId,
              project_id: projectId,
              board_id: activeBoardId,
              item_id: id,
              z_index: prev.filter(p => p.board_id === activeBoardId).length,
              pendingSync: true,
            }]);
          }
        } else if (result.data?.item) {
          setItems(prev => [result.data!.item, ...prev.filter(item => item.id !== id)]);
          if (result.data.placement) setPlacements(prev => [...prev, result.data!.placement!]);
          URL.revokeObjectURL(preview);
          previewUrls.current = previewUrls.current.filter(url => url !== preview);
        }
      }
    } catch (err: any) {
      setError(err?.message || t('inspiration_upload_failed'));
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const addUrl = async () => {
    const sourceUrl = urlDraft.trim();
    if (!sourceUrl) return;
    try {
      new URL(sourceUrl);
    } catch {
      setError(t('inspiration_url_invalid'));
      return;
    }

    const id = crypto.randomUUID();
    const placementId = activeBoardId ? crypto.randomUUID() : '';
    const itemPhase: InspirationPhase = activeBoard?.phase || (phase === 'ALL' ? 'ESQ' : phase);
    const body = {
      id,
      project_id: projectId,
      phase: itemPhase,
      category: 'architecture',
      source_url: sourceUrl,
      title: sourceUrl,
      ...(activeBoardId ? { board_id: activeBoardId, placement_id: placementId } : {}),
    };

    setBusy(true);
    setError(null);
    try {
      const result = await queuedJsonRequest<{ item: InspirationItem; placement?: InspirationBoardItem | null }>({
        entity: 'inspirationItem',
        id,
        method: 'POST',
        url: '/api/inspiration-items',
        body,
      });
      if (result.queued) {
        setItems(prev => [{
          id,
          project_id: projectId,
          title: sourceUrl,
          phase: itemPhase,
          category: 'architecture',
          source_url: sourceUrl,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          pendingSync: true,
        }, ...prev]);
        if (activeBoardId) {
          setPlacements(prev => [...prev, {
            id: placementId,
            project_id: projectId,
            board_id: activeBoardId,
            item_id: id,
            z_index: prev.filter(p => p.board_id === activeBoardId).length,
            pendingSync: true,
          }]);
        }
      } else if (result.data?.item) {
        setItems(prev => [result.data!.item, ...prev]);
        if (result.data.placement) setPlacements(prev => [...prev, result.data!.placement!]);
      }
      setUrlDraft('');
      setShowUrlForm(false);
    } catch (err: any) {
      setError(err?.message || t('inspiration_url_add_failed'));
    } finally {
      setBusy(false);
    }
  };

  const addItemToBoard = async (item: InspirationItem) => {
    if (!activeBoardId || isOnActiveBoard(item.id)) return;
    const id = crypto.randomUUID();
    const optimistic: InspirationBoardItem = {
      id,
      project_id: projectId,
      board_id: activeBoardId,
      item_id: item.id,
      z_index: boardPlacements.length,
      pendingSync: true,
    };
    setPlacements(prev => [...prev, optimistic]);
    try {
      const result = await queuedJsonRequest<InspirationBoardItem>({
        entity: 'inspirationBoardItem',
        id,
        method: 'POST',
        url: '/api/inspiration-boards/' + encodeURIComponent(activeBoardId) + '/items',
        body: { id, project_id: projectId, item_id: item.id, z_index: boardPlacements.length },
      });
      if (!result.queued && result.data) {
        setPlacements(prev => prev.map(p => p.id === id ? result.data! : p));
      }
    } catch (err: any) {
      setPlacements(prev => prev.filter(p => p.id !== id));
      setError(err?.message || t('inspiration_board_add_failed'));
    }
  };

  const removeItemFromBoard = async (itemId: string) => {
    if (!activeBoardId) return;
    const removed = placements.filter(p => p.board_id === activeBoardId && p.item_id === itemId);
    setPlacements(prev => prev.filter(p => !(p.board_id === activeBoardId && p.item_id === itemId)));
    try {
      await queuedJsonRequest({
        entity: 'inspirationBoardItem',
        id: crypto.randomUUID(),
        method: 'DELETE',
        url: '/api/inspiration-boards/' + encodeURIComponent(activeBoardId) + '/items/' + encodeURIComponent(itemId),
      });
    } catch (err: any) {
      setPlacements(prev => [...prev, ...removed]);
      setError(err?.message || t('inspiration_board_remove_failed'));
    }
  };

  const exportPdf = async () => {
    if (!activeBoard || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const settings = await fetchAgencySettings();
      await exportInspirationBoardToPDF(
        activeBoard,
        boardItems,
        { name: projectName || '', project_code: projectCode },
        settings,
      );
    } catch (err: any) {
      setError(err?.message || t('inspiration_export_failed'));
    } finally {
      setExporting(false);
    }
  };

  const coverForBoard = (boardId: string) => {
    const placement = placements.find(p => p.board_id === boardId);
    return placement ? items.find(item => item.id === placement.item_id) || null : null;
  };

  const layoutClass = activeBoard?.layout === 'materials'
    ? 'grid-cols-3 sm:grid-cols-4'
    : activeBoard?.layout === 'mosaic'
      ? 'grid-cols-2 sm:grid-cols-3'
      : 'grid-cols-2 sm:grid-cols-3';

  if (loading) {
    return (
      <div className="min-h-[24rem] flex items-center justify-center gap-2 text-sm text-[var(--tblr-muted)]">
        <IconLoader2 size={18} className="animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-5" style={{ background: 'var(--tblr-bg)' }}>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => void addFiles(e.target.files)}
      />

      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-start gap-3">
          {activeBoard && (
            <button
              type="button"
              onClick={() => setActiveBoardId(null)}
              className="mt-0.5 p-2 rounded-lg hover:bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]"
              aria-label={t('inspiration_back')}
            >
              <IconArrowLeft size={18} />
            </button>
          )}
          <div>
            <h2 className="text-lg font-bold text-[var(--tblr-text)]">
              {activeBoard ? activeBoard.title : t('inspiration_title')}
            </h2>
            <p className="text-sm text-[var(--tblr-muted)] mt-0.5">
              {activeBoard ? t('inspiration_board_subtitle') : t('inspiration_subtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--tblr-surface)] border border-[var(--tblr-border)] text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] disabled:opacity-50"
          >
            <IconUpload size={16} /> {t('inspiration_add_photos')}
          </button>
          <button
            type="button"
            onClick={() => setShowUrlForm(v => !v)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--tblr-surface)] border border-[var(--tblr-border)] text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] disabled:opacity-50"
          >
            <IconLink size={16} /> {t('inspiration_add_url')}
          </button>
          {activeBoard && (
            <button
              type="button"
              onClick={() => void exportPdf()}
              disabled={busy || exporting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--tblr-surface)] border border-[var(--tblr-border)] text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] disabled:opacity-50"
            >
              {exporting ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileTypePdf size={16} />} {t(exporting ? 'inspiration_exporting' : 'inspiration_export_pdf')}
            </button>
          )}
          {!activeBoard && (
            <button
              type="button"
              onClick={() => setShowCreateBoard(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-white"
              style={{ background: 'var(--tblr-primary)' }}
            >
              <IconPlus size={16} /> {t('inspiration_new_board')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg px-4 py-3 text-sm border" style={{ borderColor: 'var(--tblr-danger)', color: 'var(--tblr-danger)', background: 'var(--tblr-surface)' }}>
          {error}
        </div>
      )}

      {showUrlForm && (
        <div className="rounded-xl p-4 flex flex-col sm:flex-row gap-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <input
            type="url"
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            placeholder="https://..."
            className="flex-1 rounded-lg px-3 py-2 text-sm bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="button" onClick={() => void addUrl()} disabled={busy || !urlDraft.trim()} className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--tblr-primary)' }}>
            {t('inspiration_add')}
          </button>
          <button type="button" onClick={() => setShowUrlForm(false)} className="p-2 rounded-lg text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)]"><IconX size={18} /></button>
        </div>
      )}

      {!activeBoard && (
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={t('inspiration_phase_filter')}>
          {PHASES.map(p => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={phase === p}
              onClick={() => setPhase(p)}
              className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border"
              style={{
                background: phase === p ? 'var(--tblr-primary)' : 'var(--tblr-surface)',
                color: phase === p ? '#fff' : 'var(--tblr-muted)',
                borderColor: phase === p ? 'var(--tblr-primary)' : 'var(--tblr-border)',
              }}
            >
              {p === 'ALL' ? t('inspiration_all') : p}
            </button>
          ))}
        </div>
      )}

      {showCreateBoard && !activeBoard && (
        <div className="rounded-xl p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <label className="space-y-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{t('inspiration_board_name')}</span>
            <input
              autoFocus
              value={boardTitle}
              onChange={e => setBoardTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createBoard(); }}
              className="w-full rounded-lg px-3 py-2 text-sm bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('inspiration_board_name_placeholder')}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{t('inspiration_phase')}</span>
            <select value={boardPhase} onChange={e => setBoardPhase(e.target.value as InspirationPhase)} className="rounded-lg px-3 py-2 text-sm bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]">
              {PHASES.filter(p => p !== 'ALL').map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void createBoard()} disabled={busy || !boardTitle.trim()} className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--tblr-primary)' }}>
              {t('inspiration_create')}
            </button>
            <button type="button" onClick={() => setShowCreateBoard(false)} className="px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">
              {t('projectdetail_dialog_cancel')}
            </button>
          </div>
        </div>
      )}

      {activeBoard ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-5">
          <section className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-3 sm:p-4 flex flex-wrap gap-2 items-center justify-between border-b border-[var(--tblr-border)]">
              <div className="flex items-center gap-2 text-sm text-[var(--tblr-muted)]">
                <IconLayoutGrid size={17} />
                <span>{activeBoard.phase}</span>
                {activeBoard.pendingSync && <span className="text-amber-600">{t('inspiration_pending_sync')}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={activeBoard.format}
                  onChange={e => void updateBoard({ format: e.target.value as InspirationBoard['format'] })}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]"
                  aria-label={t('inspiration_format')}
                >
                  {BOARD_FORMATS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <select
                  value={activeBoard.layout}
                  onChange={e => void updateBoard({ layout: e.target.value as InspirationBoard['layout'] })}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]"
                  aria-label={t('inspiration_layout')}
                >
                  {BOARD_LAYOUTS.map(value => <option key={value} value={value}>{t('inspiration_layout_' + value)}</option>)}
                </select>
              </div>
            </div>

            <div className="p-4 sm:p-6 min-h-[32rem]" style={{ background: 'var(--tblr-surface-2)' }}>
              {boardItems.length ? (
                <div className={'grid gap-3 ' + layoutClass}>
                  {boardItems.map((item, index) => (
                    <figure
                      key={item.id}
                      className={
                        'group relative overflow-hidden rounded-lg bg-white shadow-sm ' +
                        (activeBoard.layout === 'mosaic' && index === 0 ? 'sm:col-span-2 sm:row-span-2' : '')
                      }
                      style={{ border: '1px solid var(--tblr-border)' }}
                    >
                      <div className={activeBoard.layout === 'materials' ? 'aspect-square' : 'aspect-[4/3]'}>
                        {itemImage(item, item.title || t('inspiration_image_alt'))}
                      </div>
                      <figcaption className="p-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--tblr-text)] truncate">{item.title || t('inspiration_untitled')}</p>
                          <p className="text-[0.6875rem] text-[var(--tblr-muted)]">{item.phase} · {item.category}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeItemFromBoard(item.id)}
                          title={t('inspiration_remove_from_board')}
                          className="p-1.5 rounded-md text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <IconX size={15} />
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="w-full min-h-[28rem] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)] hover:border-[var(--tblr-primary)] transition"
                  style={{ borderColor: 'var(--tblr-border)' }}
                >
                  <IconPhoto size={44} stroke={1.4} />
                  <span className="font-semibold">{t('inspiration_board_empty')}</span>
                  <span className="text-xs">{t('inspiration_board_empty_hint')}</span>
                </button>
              )}
            </div>
          </section>

          <aside className="rounded-xl overflow-hidden xl:sticky xl:top-3 xl:self-start" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <div className="p-4 border-b border-[var(--tblr-border)]">
              <h3 className="text-sm font-bold text-[var(--tblr-text)]">{t('inspiration_library')}</h3>
              <p className="text-xs text-[var(--tblr-muted)] mt-1">{t('inspiration_library_hint')}</p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2 max-h-[66vh] overflow-y-auto">
              {items.map(item => {
                const selected = isOnActiveBoard(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={selected}
                    onClick={() => void addItemToBoard(item)}
                    className="relative rounded-lg overflow-hidden aspect-square border text-left disabled:cursor-default"
                    style={{ borderColor: selected ? 'var(--tblr-primary)' : 'var(--tblr-border)' }}
                    title={selected ? t('inspiration_already_on_board') : t('inspiration_add_to_board')}
                  >
                    {itemImage(item, item.title || t('inspiration_image_alt'))}
                    <span className="absolute inset-x-0 bottom-0 p-1.5 text-[0.6875rem] font-semibold text-white bg-black/55 truncate">
                      {item.title || t('inspiration_untitled')}
                    </span>
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 rounded-full p-1 bg-[var(--tblr-primary)] text-white"><IconCheck size={13} /></span>
                    )}
                  </button>
                );
              })}
              {!items.length && <p className="col-span-2 text-xs text-[var(--tblr-muted)] p-3">{t('inspiration_library_empty')}</p>}
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-5">
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBoards.map(board => {
                const cover = coverForBoard(board.id);
                const count = placements.filter(p => p.board_id === board.id).length;
                return (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => setActiveBoardId(board.id)}
                    className="text-left rounded-xl overflow-hidden group hover:-translate-y-0.5 transition-transform"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
                  >
                    <div className="aspect-[16/9] bg-[var(--tblr-surface-2)] overflow-hidden">
                      {cover ? itemImage(cover, board.title) : (
                        <div className="h-full flex items-center justify-center text-[var(--tblr-muted)]"><IconLayoutGrid size={36} stroke={1.4} /></div>
                      )}
                    </div>
                    <div className="p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-sm text-[var(--tblr-text)] truncate">{board.title}</h3>
                        <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">{board.phase}</span>
                      </div>
                      <p className="text-xs text-[var(--tblr-muted)] mt-1">{t('inspiration_board_count', { count })}</p>
                    </div>
                  </button>
                );
              })}
              {!filteredBoards.length && (
                <button
                  type="button"
                  onClick={() => setShowCreateBoard(true)}
                  className="min-h-[14rem] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)] transition"
                  style={{ borderColor: 'var(--tblr-border)' }}
                >
                  <IconPlus size={30} />
                  <span className="text-sm font-bold">{t('inspiration_first_board')}</span>
                </button>
              )}
            </div>
          </section>

          <aside className="rounded-xl overflow-hidden xl:sticky xl:top-3 xl:self-start" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <div className="p-4 border-b border-[var(--tblr-border)]">
              <h3 className="text-sm font-bold text-[var(--tblr-text)]">{t('inspiration_library')}</h3>
              <p className="text-xs text-[var(--tblr-muted)] mt-1">{t('inspiration_library_project_hint')}</p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2 max-h-[62vh] overflow-y-auto">
              {filteredItems.map(item => (
                <div key={item.id} className="relative rounded-lg overflow-hidden aspect-square border" style={{ borderColor: 'var(--tblr-border)' }}>
                  {itemImage(item, item.title || t('inspiration_image_alt'))}
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 p-1.5 bg-black/55">
                    <span className="min-w-0 flex-1 text-[0.6875rem] font-semibold text-white truncate">{item.title || t('inspiration_untitled')}</span>
                    {item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-white/80 hover:text-white" title={t('inspiration_open_source')}>
                        <IconExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {!filteredItems.length && <p className="col-span-2 text-xs text-[var(--tblr-muted)] p-3">{t('inspiration_library_empty')}</p>}
            </div>
          </aside>
        </div>
      )}

      {busy && (
        <div className="fixed bottom-5 right-5 z-40 rounded-full px-3 py-2 flex items-center gap-2 text-xs font-semibold shadow-lg" style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
          <IconLoader2 size={15} className="animate-spin" /> {t('inspiration_saving')}
        </div>
      )}
    </div>
  );
}

export default InspirationBoards;
