import { useState, useEffect, FormEvent } from 'react';
import {
  IconPlus, IconRss, IconTrash, IconEdit, IconX, IconRefresh, IconExternalLink,
  IconCheck, IconEye, IconEyeOff, IconAlertTriangle, IconInbox
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { MobileAccordionTable } from './MobileAccordionTable';
import { Pagination } from './ui/Pagination';
import { Toast } from './ui/Toast';
import { usePagination } from '../hooks/usePagination';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { MatchDetailContent, StatusBadge, type TFn } from './tenderRss/MatchDetailContent';
import type { TenderRssSource, TenderRssMatch } from '../types';

const DISMISS_UNDO_MS = 10000;
const WATCH_UNDO_MS = 10000;

const emptySourceForm = { name: '', url: '', enabled: true, includeKeywordsText: '', excludeKeywordsText: '' };

export function TenderRssWatch() {
  const { t } = useTranslation();

  const [sources, setSources] = useState<TenderRssSource[]>([]);
  const [matches, setMatches] = useState<TenderRssMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const { toast, showToast, clearToast } = useToastWithUndo();

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const selectedMatch = matches.find(m => m.id === selectedMatchId) || null;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<TenderRssSource | null>(null);
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [isSaving, setIsSaving] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  // Only new/read items belong in the inbox — ignored, watched and
  // converted items each have their own destination (hidden, or the
  // "Annonces sélectionnées" tab).
  const inboxMatches = matches.filter(m => m.status === 'new' || m.status === 'read');
  const matchesPagination = usePagination(inboxMatches, pageSize);

  const fetchSources = () => fetchJson<TenderRssSource[]>('/api/tender-rss-sources').then(setSources);
  const fetchMatches = () => fetchJson<TenderRssMatch[]>('/api/tender-rss-matches').then(setMatches);

  useEffect(() => {
    Promise.all([fetchSources(), fetchMatches()])
      .catch(() => showToast(t('tender_rss_load_error'), 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleOpenCreateSource = () => {
    setEditingSource(null);
    setSourceForm(emptySourceForm);
    setIsSourceModalOpen(true);
  };

  const handleOpenEditSource = (source: TenderRssSource) => {
    setEditingSource(source);
    setSourceForm({
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      includeKeywordsText: (source.include_keywords || []).join(', '),
      excludeKeywordsText: (source.exclude_keywords || []).join(', ')
    });
    setIsSourceModalOpen(true);
  };

  const parseKeywords = (text: string) => text.split(',').map(k => k.trim()).filter(Boolean);

  const handleSaveSource = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        name: sourceForm.name,
        url: sourceForm.url,
        enabled: sourceForm.enabled,
        include_keywords: parseKeywords(sourceForm.includeKeywordsText),
        exclude_keywords: parseKeywords(sourceForm.excludeKeywordsText)
      };
      if (editingSource) {
        await apiFetch(`/api/tender-rss-sources/${editingSource.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/tender-rss-sources', { method: 'POST', body: JSON.stringify(payload) });
      }
      await fetchSources();
      setIsSourceModalOpen(false);
      showToast(editingSource ? t('tender_rss_source_updated') : t('tender_rss_source_created'));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSource = async (source: TenderRssSource) => {
    if (!confirm(t('tender_rss_confirm_delete_source', { name: source.name }))) return;
    try {
      await apiFetch(`/api/tender-rss-sources/${source.id}`, { method: 'DELETE' });
      await Promise.all([fetchSources(), fetchMatches()]);
      showToast(t('tender_rss_source_deleted'));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handlePollNow = async () => {
    setPolling(true);
    try {
      await apiFetch('/api/tender-rss-sources/poll-now', { method: 'POST' });
      await Promise.all([fetchSources(), fetchMatches()]);
      showToast(t('tender_rss_poll_done'));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_poll_error'), 'error');
    } finally {
      setPolling(false);
    }
  };

  const deselect = (id: string) => setSelectedIds(prev => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  const handleMarkRead = async (match: TenderRssMatch) => {
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: 'read' }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'read' } : m));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handleDismiss = async (match: TenderRssMatch) => {
    const previousStatus = match.status;
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: 'dismissed' }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'dismissed' } : m));
      setSelectedMatchId(prev => prev === match.id ? null : prev);
      deselect(match.id);
      showToast(t('tender_rss_dismissed_toast', { title: match.title }), 'success', {
        duration: DISMISS_UNDO_MS,
        action: { label: t('tender_rss_undo'), onClick: () => handleUndoStatus(match, previousStatus) }
      });
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handleWatch = async (match: TenderRssMatch) => {
    const previousStatus = match.status;
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: 'watched' }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'watched' } : m));
      setSelectedMatchId(prev => prev === match.id ? null : prev);
      deselect(match.id);
      showToast(t('tender_rss_watched_toast', { title: match.title }), 'success', {
        duration: WATCH_UNDO_MS,
        action: { label: t('tender_rss_undo'), onClick: () => handleUndoStatus(match, previousStatus) }
      });
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handleUndoStatus = async (match: TenderRssMatch, previousStatus: TenderRssMatch['status']) => {
    clearToast();
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: previousStatus }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: previousStatus } : m));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const pageIds = matchesPagination.pageItems.map(m => m.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      pageIds.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(t('tender_rss_bulk_delete_confirm', { count: ids.length }))) return;
    setIsBulkDeleting(true);
    try {
      await apiFetch('/api/tender-rss-matches/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
      setMatches(prev => prev.filter(m => !ids.includes(m.id)));
      setSelectedIds(new Set());
      setSelectedMatchId(prev => prev && ids.includes(prev) ? null : prev);
      showToast(t('tender_rss_bulk_delete_done', { count: ids.length }));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_bulk_delete_error'), 'error');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Sources panel */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="flex items-center gap-2">
            <IconRss size={18} style={{ color: 'var(--tblr-primary)' }} />
            <h3 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_sources_title')}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePollNow}
              disabled={polling}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconRefresh size={16} className={polling ? 'animate-spin' : ''} />
              {t('tender_rss_poll_now')}
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleOpenCreateSource}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              <IconPlus size={16} />
              {t('tender_rss_add_source')}
            </motion.button>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_no_sources')}</div>
        ) : (
          <>
            <div className="md:hidden">
              <MobileAccordionTable
                data={sources}
                keyField="id"
                columns={[
                  { label: t('tender_rss_source_name'), primary: true, render: (s: TenderRssSource) => (
                    <div>
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--tblr-muted)' }}>{s.url}</p>
                    </div>
                  )},
                  { label: t('tender_rss_status'), render: (s: TenderRssSource) => s.enabled ? t('tender_rss_enabled') : t('tender_rss_disabled') },
                  { label: t('tender_rss_last_polled'), render: (s: TenderRssSource) => s.last_polled_at ? new Date(s.last_polled_at).toLocaleString('fr-FR') : t('tender_rss_never_polled') },
                ]}
                actions={(s: TenderRssSource) => (
                  <div className="flex gap-2">
                    <button onClick={() => handleOpenEditSource(s)} style={{ color: 'var(--tblr-primary)' }}><IconEdit size={16} /></button>
                    <button onClick={() => handleDeleteSource(s)} style={{ color: 'var(--tblr-danger)' }}><IconTrash size={16} /></button>
                  </div>
                )}
              />
            </div>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_source_name')}</th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_filters')}</th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_status')}</th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_last_polled')}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                    <td className="px-4 py-3">
                      <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>{s.name}</p>
                      <p className="text-xs truncate max-w-xs" style={{ color: 'var(--tblr-muted)' }}>{s.url}</p>
                      {s.last_error && (
                        <p className="text-xs flex items-center gap-1 mt-1" style={{ color: 'var(--tblr-danger)' }}>
                          <IconAlertTriangle size={12} /> {s.last_error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                      {s.include_keywords?.length ? `${t('tender_rss_include')}: ${s.include_keywords.join(', ')}` : t('tender_rss_no_filter')}
                      {s.exclude_keywords?.length ? ` — ${t('tender_rss_exclude')}: ${s.exclude_keywords.join(', ')}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          background: s.enabled ? 'var(--tblr-success-lt)' : 'var(--tblr-surface-2)',
                          color: s.enabled ? 'var(--tblr-success)' : 'var(--tblr-muted)'
                        }}
                      >
                        {s.enabled ? t('tender_rss_enabled') : t('tender_rss_disabled')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                      {s.last_polled_at ? new Date(s.last_polled_at).toLocaleString('fr-FR') : t('tender_rss_never_polled')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleOpenEditSource(s)} style={{ color: 'var(--tblr-primary)' }}><IconEdit size={16} /></button>
                        <button onClick={() => handleDeleteSource(s)} style={{ color: 'var(--tblr-danger)' }}><IconTrash size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Matches — master/detail */}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        {/* Master list */}
        <div
          className="min-w-0 flex-1 rounded-lg overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_matches_title')}</h3>
            {inboxMatches.length > 0 && (
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                {t('tender_rss_page_size_label')}
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 rounded-lg text-xs outline-none"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                {t('tender_rss_page_size_suffix')}
              </label>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>
                {t('tender_rss_bulk_selected_count', { count: selectedIds.size })}
              </span>
              <button
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-60"
                style={{ background: 'var(--tblr-danger)', color: '#fff' }}
              >
                <IconTrash size={14} />
                {t('tender_rss_bulk_delete')}
              </button>
            </div>
          )}

          {inboxMatches.length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_no_matches')}</div>
          ) : (
            <div>
              <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={e => toggleSelectAllOnPage(e.target.checked)}
                  aria-label={allPageSelected ? t('tender_rss_deselect_all') : t('tender_rss_select_all')}
                />
                <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                  {allPageSelected ? t('tender_rss_deselect_all') : t('tender_rss_select_all')}
                </span>
              </div>
              {matchesPagination.pageItems.map(m => (
                <div
                  key={m.id}
                  onClick={() => setSelectedMatchId(m.id)}
                  className="flex items-center gap-3 p-4 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--tblr-border)',
                    background: selectedMatchId === m.id ? 'var(--tblr-surface-2)' : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => toggleSelected(m.id, e.target.checked)}
                    className="shrink-0"
                  />
                  <div className="flex flex-1 min-w-0 flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {m.status === 'new' && <StatusBadge status={m.status} t={t} />}
                        <p className="font-medium text-sm truncate" style={{ color: 'var(--tblr-text)' }}>{m.title}</p>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                        {m.source_name || '---'}
                        {m.pub_date ? ` · ${new Date(m.pub_date).toLocaleDateString('fr-FR')}` : ''}
                        {m.ville_execution ? ` · ${m.ville_execution}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {m.link && (
                        <a href={m.link} target="_blank" rel="noopener noreferrer" title={t('tender_rss_open_source')} style={{ color: 'var(--tblr-muted)' }}>
                          <IconExternalLink size={16} />
                        </a>
                      )}
                      {m.status === 'new' && (
                        <button onClick={() => handleMarkRead(m)} title={t('tender_rss_mark_read')} style={{ color: 'var(--tblr-muted)' }}>
                          <IconCheck size={16} />
                        </button>
                      )}
                      <button onClick={() => handleDismiss(m)} title={t('tender_rss_dismiss')} style={{ color: 'var(--tblr-muted)' }}>
                        <IconEyeOff size={16} />
                      </button>
                      <button
                        onClick={() => handleWatch(m)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                        style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                      >
                        <IconEye size={14} />
                        {t('tender_rss_watch')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <Pagination
                currentPage={matchesPagination.currentPage}
                totalPages={matchesPagination.totalPages}
                totalItems={matchesPagination.totalItems}
                pageSize={matchesPagination.pageSize}
                onPageChange={matchesPagination.setPage}
                style={{ borderTop: '1px solid var(--tblr-border)' }}
              />
            </div>
          )}
        </div>

        {/* Detail panel — large screens only */}
        <div
          className="hidden lg:flex lg:flex-col w-[380px] shrink-0 self-start sticky top-4 max-h-[calc(100vh-2rem)] rounded-lg overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          {selectedMatch ? (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
                <h3 className="font-semibold text-sm truncate pr-2" style={{ color: 'var(--tblr-text)' }}>{selectedMatch.title}</h3>
                <button onClick={() => setSelectedMatchId(null)} className="rounded p-1 hover:bg-[var(--tblr-surface-2)] transition-colors shrink-0"><IconX size={16} style={{ color: 'var(--tblr-muted)' }} /></button>
              </div>
              <div className="overflow-y-auto p-4 flex-1">
                <MatchDetailContent match={selectedMatch} t={t} />
              </div>
              <InboxDetailActions match={selectedMatch} onMarkRead={handleMarkRead} onDismiss={handleDismiss} onWatch={handleWatch} t={t} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center flex-1" style={{ color: 'var(--tblr-muted)' }}>
              <IconInbox size={28} className="opacity-40" />
              <p className="text-sm">{t('tender_rss_select_hint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail — mobile/small-screen bottom sheet */}
      {selectedMatch && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col" style={{ background: 'var(--tblr-surface)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
              <h3 className="font-semibold text-base truncate pr-2" style={{ color: 'var(--tblr-text)' }}>{selectedMatch.title}</h3>
              <button onClick={() => setSelectedMatchId(null)} className="rounded p-1 hover:bg-[var(--tblr-surface-2)] transition-colors shrink-0"><IconX size={18} style={{ color: 'var(--tblr-muted)' }} /></button>
            </div>
            <div className="overflow-y-auto p-5 flex-1">
              <MatchDetailContent match={selectedMatch} t={t} />
            </div>
            <InboxDetailActions match={selectedMatch} onMarkRead={handleMarkRead} onDismiss={handleDismiss} onWatch={handleWatch} t={t} />
          </div>
        </div>
      )}

      {/* Source create/edit modal */}
      <AnimatePresence>
        {isSourceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-md overflow-hidden"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
                  {editingSource ? t('tender_rss_edit_source_title') : t('tender_rss_create_source_title')}
                </h3>
                <button onClick={() => setIsSourceModalOpen(false)} style={{ color: 'var(--tblr-muted)' }}>
                  <IconX size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveSource} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_source_name')}</label>
                  <input
                    required
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={sourceForm.name}
                    onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_source_url')}</label>
                  <input
                    required
                    type="url"
                    placeholder="https://www.exemple.fr/flux-avis-marches.rss"
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={sourceForm.url}
                    onChange={e => setSourceForm({ ...sourceForm, url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_include_keywords_label')}</label>
                  <input
                    placeholder={t('tender_rss_keywords_placeholder')}
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={sourceForm.includeKeywordsText}
                    onChange={e => setSourceForm({ ...sourceForm, includeKeywordsText: e.target.value })}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_include_keywords_hint')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_exclude_keywords_label')}</label>
                  <input
                    placeholder={t('tender_rss_keywords_placeholder')}
                    className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={sourceForm.excludeKeywordsText}
                    onChange={e => setSourceForm({ ...sourceForm, excludeKeywordsText: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}>
                  <input
                    type="checkbox"
                    checked={sourceForm.enabled}
                    onChange={e => setSourceForm({ ...sourceForm, enabled: e.target.checked })}
                  />
                  {t('tender_rss_enabled')}
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsSourceModalOpen(false)}
                    className="px-4 py-2 rounded-md font-medium text-sm"
                    style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  >
                    {t('btn_cancel')}
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-md font-medium text-sm shadow-sm disabled:opacity-60"
                    style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                  >
                    {t('save')}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </div>
  );
}

// ── Detail panel footer actions — shared between the desktop sidebar and the mobile bottom sheet ──
function InboxDetailActions({
  match, onMarkRead, onDismiss, onWatch, t,
}: {
  match: TenderRssMatch;
  onMarkRead: (match: TenderRssMatch) => void;
  onDismiss: (match: TenderRssMatch) => void;
  onWatch: (match: TenderRssMatch) => void;
  t: TFn;
}) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
      {match.status === 'new' && (
        <button
          onClick={() => onMarkRead(match)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconCheck size={13} /> {t('tender_rss_mark_read')}
        </button>
      )}
      <button
        onClick={() => onDismiss(match)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-danger)' }}
      >
        <IconEyeOff size={13} /> {t('tender_rss_dismiss')}
      </button>
      <button
        onClick={() => onWatch(match)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium"
        style={{ background: 'var(--tblr-primary)', color: '#fff' }}
      >
        <IconEye size={13} /> {t('tender_rss_watch')}
      </button>
    </div>
  );
}
