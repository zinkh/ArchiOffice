import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconX, IconEyeOff, IconFileText, IconInbox } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { Pagination } from './ui/Pagination';
import { Toast } from './ui/Toast';
import { usePagination } from '../hooks/usePagination';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { MatchDetailContent, StatusBadge, type TFn } from './tenderRss/MatchDetailContent';
import type { TenderRssMatch } from '../types';

export function TenderRssSelected() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [matches, setMatches] = useState<TenderRssMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToastWithUndo();

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const selectedMatch = matches.find(m => m.id === selectedMatchId) || null;

  // Only watched and converted items live here — this is where "Créer un
  // appel d'offres" becomes available (once an item has been "surveillée"
  // from the Veille RSS tab), and where converted items keep showing after.
  const selectedMatches = matches.filter(m => m.status === 'watched' || m.status === 'converted');
  const matchesPagination = usePagination(selectedMatches);

  const fetchMatches = () => fetchJson<TenderRssMatch[]>('/api/tender-rss-matches').then(setMatches);

  useEffect(() => {
    fetchMatches()
      .catch(() => showToast(t('tender_rss_load_error'), 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleUnwatch = async (match: TenderRssMatch) => {
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: 'read' }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'read' } : m));
      setSelectedMatchId(prev => prev === match.id ? null : prev);
      showToast(t('tender_rss_unwatched_toast', { title: match.title }));
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
    <div className="flex flex-col lg:flex-row items-start gap-6">
      {/* Master list */}
      <div
        className="min-w-0 flex-1 rounded-lg overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tender_rss_selected_title')}</h3>
        </div>

        {selectedMatches.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_selected_no_matches')}</div>
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
                    <StatusBadge status={m.status} t={t} />
                    <p className="font-medium text-sm truncate" style={{ color: 'var(--tblr-text)' }}>{m.title}</p>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                    {m.source_name || '---'}
                    {m.pub_date ? ` · ${new Date(m.pub_date).toLocaleDateString('fr-FR')}` : ''}
                    {m.ville_execution ? ` · ${m.ville_execution}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  {m.status === 'watched' && (
                    <>
                      <button onClick={() => handleUnwatch(m)} title={t('tender_rss_unwatch')} style={{ color: 'var(--tblr-muted)' }}>
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
            <SelectedDetailActions match={selectedMatch} onUnwatch={handleUnwatch} onConvert={handleConvert} t={t} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center flex-1" style={{ color: 'var(--tblr-muted)' }}>
            <IconInbox size={28} className="opacity-40" />
            <p className="text-sm">{t('tender_rss_select_hint')}</p>
          </div>
        )}
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
            <SelectedDetailActions match={selectedMatch} onUnwatch={handleUnwatch} onConvert={handleConvert} t={t} />
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

// ── Detail panel footer actions — shared between the desktop sidebar and the mobile bottom sheet ──
function SelectedDetailActions({
  match, onUnwatch, onConvert, t,
}: {
  match: TenderRssMatch;
  onUnwatch: (match: TenderRssMatch) => void;
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

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
      <button
        onClick={() => onUnwatch(match)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-[var(--tblr-surface-2)]"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
      >
        <IconEyeOff size={13} /> {t('tender_rss_unwatch')}
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
