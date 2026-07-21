import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconPlus, IconRss, IconTrash, IconEdit, IconX, IconRefresh, IconExternalLink,
  IconCheck, IconEyeOff, IconAlertTriangle, IconFileText
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { MobileAccordionTable } from './MobileAccordionTable';
import type { TenderRssSource, TenderRssMatch } from '../types';

const emptySourceForm = { name: '', url: '', enabled: true, includeKeywordsText: '', excludeKeywordsText: '' };

export function TenderRssWatch() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [sources, setSources] = useState<TenderRssSource[]>([]);
  const [matches, setMatches] = useState<TenderRssMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<TenderRssSource | null>(null);
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [isSaving, setIsSaving] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
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
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status } : m));
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

      {/* Matches feed */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_matches_title')}</h3>
        </div>

        {matches.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_no_matches')}</div>
        ) : (
          <div>
            {matches.map(m => (
              <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
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
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
          </div>
        )}
      </div>

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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
