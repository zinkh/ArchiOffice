import { useState, useEffect, useRef, FormEvent, ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconPlus, IconRss, IconTrash, IconEdit, IconX, IconRefresh, IconExternalLink,
  IconCheck, IconEyeOff, IconAlertTriangle, IconFileText, IconMapPin, IconBuildingBank,
  IconCurrencyEuro, IconCalendar, IconInbox
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { MobileAccordionTable } from './MobileAccordionTable';
import { Pagination } from './ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import type { TenderRssSource, TenderRssMatch } from '../types';

const DISMISS_UNDO_MS = 10000;

const emptySourceForm = { name: '', url: '', enabled: true, includeKeywordsText: '', excludeKeywordsText: '' };

export function TenderRssWatch() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [sources, setSources] = useState<TenderRssSource[]>([]);
  const [matches, setMatches] = useState<TenderRssMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; action?: { label: string; onClick: () => void } } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const selectedMatch = matches.find(m => m.id === selectedMatchId) || null;

  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<TenderRssSource | null>(null);
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [isSaving, setIsSaving] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  const visibleMatches = matches.filter(m => m.status !== 'dismissed');
  const matchesPagination = usePagination(visibleMatches, pageSize);

  const showToast = (
    message: string,
    type: 'success' | 'error' = 'success',
    opts?: { duration?: number; action?: { label: string; onClick: () => void } }
  ) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type, action: opts?.action });
    toastTimeoutRef.current = setTimeout(() => setToast(null), opts?.duration ?? 3500);
  };

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

  const updateMatchStatus = async (match: TenderRssMatch, status: 'read' | 'dismissed') => {
    if (status === 'dismissed') {
      await handleDismiss(match);
      return;
    }
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status } : m));
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
      showToast(t('tender_rss_dismissed_toast', { title: match.title }), 'success', {
        duration: DISMISS_UNDO_MS,
        action: { label: t('tender_rss_undo'), onClick: () => handleUndoDismiss(match, previousStatus) }
      });
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handleUndoDismiss = async (match: TenderRssMatch, previousStatus: TenderRssMatch['status']) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(null);
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: previousStatus }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: previousStatus } : m));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const handleConvert = async (match: TenderRssMatch) => {
    try {
      const { id } = await apiFetch<{ id: string }>(`/api/tender-rss-matches/${match.id}/convert`, { method: 'POST' });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'converted', tender_id: id } : m));
      showToast(t('tender_rss_converted'));
      navigate(`/tenders/${id}`);
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
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
            {visibleMatches.length > 0 && (
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

          {visibleMatches.length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_no_matches')}</div>
          ) : (
            <div>
              {matchesPagination.pageItems.map(m => (
                <div
                  key={m.id}
                  onClick={() => setSelectedMatchId(m.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--tblr-border)',
                    background: selectedMatchId === m.id ? 'var(--tblr-surface-2)' : undefined,
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.status === 'new' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                          {t('tender_rss_new')}
                        </span>
                      )}
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
                    {m.status !== 'dismissed' && m.status !== 'converted' && (
                      <>
                        {m.status === 'new' && (
                          <button onClick={() => updateMatchStatus(m, 'read')} title={t('tender_rss_mark_read')} style={{ color: 'var(--tblr-muted)' }}>
                            <IconCheck size={16} />
                          </button>
                        )}
                        <button onClick={() => updateMatchStatus(m, 'dismissed')} title={t('tender_rss_dismiss')} style={{ color: 'var(--tblr-muted)' }}>
                          <IconEyeOff size={16} />
                        </button>
                        <button
                          onClick={() => handleConvert(m)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                          style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                        >
                          <IconFileText size={14} />
                          {t('tender_rss_create_tender')}
                        </button>
                      </>
                    )}
                    {m.status === 'converted' && (
                      <span className="text-xs font-medium" style={{ color: 'var(--tblr-success)' }}>{t('tender_rss_status_converted')}</span>
                    )}
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
              <MatchDetailActions match={selectedMatch} onMarkRead={updateMatchStatus} onDismiss={updateMatchStatus} onConvert={handleConvert} t={t} />
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
            <MatchDetailActions match={selectedMatch} onMarkRead={updateMatchStatus} onDismiss={updateMatchStatus} onConvert={handleConvert} t={t} />
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

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 right-4 z-[200] px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
            style={{
              background: toast.type === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-success)',
              color: '#fff'
            }}
          >
            {toast.type === 'error' ? <IconAlertTriangle size={16} /> : null}
            {toast.message}
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className="ml-1 underline underline-offset-2 font-semibold shrink-0"
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, any>) => string;

// ── Detail panel content — shared between the desktop sidebar and the mobile bottom sheet ──
function MatchDetailContent({ match, t }: { match: TenderRssMatch; t: TFn }) {
  const fields: { icon: ElementType; label: string; value: string | null }[] = [
    { icon: IconMapPin, label: t('tender_rss_field_ville'), value: match.ville_execution ?? null },
    { icon: IconBuildingBank, label: t('tender_rss_field_pouvoir_adjudicateur'), value: match.pouvoir_adjudicateur ?? null },
    { icon: IconCurrencyEuro, label: t('tender_rss_field_montant'), value: match.montant_travaux ? formatCurrency(match.montant_travaux) : null },
    { icon: IconCalendar, label: t('tender_rss_field_date_limite'), value: match.date_limite_reponse ? new Date(match.date_limite_reponse).toLocaleDateString('fr-FR') : null },
  ].filter(f => f.value);

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        {match.source_name || '---'}
        {match.pub_date ? ` · ${new Date(match.pub_date).toLocaleDateString('fr-FR')}` : ''}
      </p>

      {fields.length > 0 && (
        <div className="space-y-2.5 rounded-lg p-3" style={{ background: 'var(--tblr-surface-2)' }}>
          {fields.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <f.icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--tblr-muted)' }} />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{f.label}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{f.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {match.description && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_description_label')}</p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--tblr-text)' }}>{match.description}</p>
        </div>
      )}

      {match.link && (
        <a
          href={match.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--tblr-primary)' }}
        >
          <IconExternalLink size={13} />
          {t('tender_rss_open_source')}
        </a>
      )}
    </div>
  );
}

// ── Detail panel footer actions — shared between the desktop sidebar and the mobile bottom sheet ──
function MatchDetailActions({
  match, onMarkRead, onDismiss, onConvert, t,
}: {
  match: TenderRssMatch;
  onMarkRead: (match: TenderRssMatch, status: 'read') => void;
  onDismiss: (match: TenderRssMatch, status: 'dismissed') => void;
  onConvert: (match: TenderRssMatch) => void;
  t: TFn;
}) {
  if (match.status === 'converted') {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-3 border-t shrink-0 text-sm font-medium" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-success)' }}>
        {t('tender_rss_status_converted')}
      </div>
    );
  }
  if (match.status === 'dismissed') return null;

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
      {match.status === 'new' && (
        <button
          onClick={() => onMarkRead(match, 'read')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconCheck size={13} /> {t('tender_rss_mark_read')}
        </button>
      )}
      <button
        onClick={() => onDismiss(match, 'dismissed')}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-danger)' }}
      >
        <IconEyeOff size={13} /> {t('tender_rss_dismiss')}
      </button>
      <button
        onClick={() => onConvert(match)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium"
        style={{ background: 'var(--tblr-primary)', color: '#fff' }}
      >
        <IconFileText size={13} /> {t('tender_rss_create_tender')}
      </button>
    </div>
  );
}
