// Volet « Étude de faisabilité » du détail d'une proposition (Proposals.tsx).
// Sur le modèle de la note méthodologique des appels d'offres : des rubriques
// ordonnées, rédigées à la main ou avec l'IA (plan Enterprise), enrichies de
// blocs d'informations de la proposition et du terrain (src/lib/feasibilityBlocks.ts)
// et d'extraits de cartes IGN (FeasibilityMapDialog.tsx), exportables en PDF et
// en Word à la charte du cabinet (src/lib/feasibilityExport.ts).
// Serveur : server/routes/proposalFeasibility.ts et proposalFeasibilityAi.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconSparkles, IconWand, IconTrash, IconPlus, IconGripVertical, IconMap2, IconListDetails, IconLock,
  IconFileTypePdf, IconFileTypeDocx, IconAlertTriangle, IconChevronDown, IconX, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { startPressDrag } from '../../lib/pressDrag';
import { useUser } from '../../UserContext';
import { SignedImage } from '../SignedImage';
import { FeasibilityMapDialog } from './FeasibilityMapDialog';
import {
  FEASIBILITY_BLOCK_KINDS, appendBlock, buildFeasibilityBlock,
  type FeasibilityBlockKind, type FeasibilityIllustration, type FeasibilitySection, type FeasibilitySiteData,
} from '../../lib/feasibilityBlocks';
import type { Proposal } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import { useActiveGroupement } from '../../hooks/useActiveGroupement';

/** Blocs qui ont besoin des données publiques du terrain (lues à la demande). */
const SITE_BLOCKS: FeasibilityBlockKind[] = ['urbanisme', 'risques', 'patrimoine'];

const inputStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
const cardStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' };
const softButton: React.CSSProperties = { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' };

interface Props {
  proposalId: string;
  /** État courant du formulaire de la proposition (y compris les modifications non enregistrées). */
  proposal: Partial<Proposal>;
  parcelGeometry?: GeoJSON.Geometry | null;
  settings: AgencySettings;
  onCount?: (n: number) => void;
}

export function FeasibilityStudy({ proposalId, proposal, parcelGeometry, settings, onCount }: Props) {
  const { t } = useTranslation();
  // Les logos des cotraitants de la proposition figurent sur l'étude exportée.
  useActiveGroupement(proposal.specialties_list);
  const { tenantPlan } = useUser();
  const isEnterprise = tenantPlan === 'enterprise';

  const [sections, setSections] = useState<FeasibilitySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [insertMenuFor, setInsertMenuFor] = useState<string | null>(null);
  const [mapFor, setMapFor] = useState<string | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState<Set<string>>(new Set());
  const [siteData, setSiteData] = useState<FeasibilitySiteData | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => { onCount?.(sections.length); }, [sections.length, onCount]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<FeasibilitySection[]>(`/api/proposals/${proposalId}/feasibility`)
      .then(rows => { if (!cancelled) setSections(rows); })
      .catch(err => { if (!cancelled) setError(err?.message || t('feas_error_generic')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [proposalId, t]);

  const patchLocal = (id: string, patch: Partial<FeasibilitySection>) =>
    setSections(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));

  const save = useCallback(async (id: string, patch: Partial<Pick<FeasibilitySection, 'title' | 'content' | 'instructions' | 'illustrations'>>) => {
    try {
      await apiFetch(`/api/proposals/${proposalId}/feasibility/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
      if (patch.content !== undefined) patchLocal(id, { status: patch.content.trim() ? 'redige' : 'a_rediger' });
    } catch (err: any) {
      setError(err?.message || t('feas_error_generic'));
    }
  }, [proposalId, t]);

  const loadSite = async (): Promise<FeasibilitySiteData | null> => {
    if (siteData) return siteData;
    setSiteLoading(true);
    try {
      const data = await apiFetch<FeasibilitySiteData>(`/api/proposals/${proposalId}/feasibility-site-data`);
      setSiteData(data);
      return data;
    } catch (err: any) {
      setError(err?.message || t('feas_error_generic'));
      return null;
    } finally {
      setSiteLoading(false);
    }
  };

  const addSection = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const created = await apiFetch<FeasibilitySection>(`/api/proposals/${proposalId}/feasibility`, {
        method: 'POST', body: JSON.stringify({ title, sort_order: sections.length }),
      });
      setSections(prev => [...prev, created]);
      setNewTitle('');
    } catch (err: any) { setError(err?.message || t('feas_error_generic')); }
  };

  const prefill = async () => {
    setPrefilling(true);
    setError(null);
    try {
      const { sections: created } = await apiFetch<{ sections: FeasibilitySection[] }>(`/api/proposals/${proposalId}/feasibility/prefill-sections`, { method: 'POST' });
      setSections(prev => [...prev, ...created.map(s => ({ ...s, illustrations: s.illustrations || [] }))]);
    } catch (err: any) { setError(err?.message || t('feas_error_generic')); }
    finally { setPrefilling(false); }
  };

  const draft = async (section: FeasibilitySection) => {
    setDraftingId(section.id);
    setError(null);
    try {
      // Le serveur reprend le texte déjà saisi : on l'enregistre d'abord.
      await save(section.id, { content: section.content, instructions: section.instructions });
      const { content } = await apiFetch<{ content: string }>(`/api/proposals/${proposalId}/feasibility/${section.id}/draft-ai`, { method: 'POST' });
      patchLocal(section.id, { content, status: content.trim() ? 'redige' : 'a_rediger' });
    } catch (err: any) { setError(err?.message || t('feas_error_generic')); }
    finally { setDraftingId(null); }
  };

  const remove = async (section: FeasibilitySection) => {
    if (!window.confirm(t('feas_delete_confirm', { title: section.title }) as string)) return;
    try {
      await apiFetch(`/api/proposals/${proposalId}/feasibility/${section.id}`, { method: 'DELETE' });
      setSections(prev => prev.filter(s => s.id !== section.id));
    } catch (err: any) { setError(err?.message || t('feas_error_generic')); }
  };

  const insertBlock = async (section: FeasibilitySection, kind: FeasibilityBlockKind) => {
    setInsertMenuFor(null);
    setNotice(null);
    const site = SITE_BLOCKS.includes(kind) ? await loadSite() : siteData;
    const block = buildFeasibilityBlock(kind, proposal, site ?? undefined);
    if (!block) { setNotice(t('feas_block_empty')); return; }
    const content = appendBlock(section.content, block);
    patchLocal(section.id, { content });
    await save(section.id, { content });
  };

  const openMap = async (section: FeasibilitySection) => {
    setNotice(null);
    const site = await loadSite();
    if (!site?.address) { setNotice(t('feas_map_no_address')); return; }
    setMapFor(section.id);
  };

  const addIllustration = async (sectionId: string, ill: FeasibilityIllustration) => {
    const section = sectionsRef.current.find(s => s.id === sectionId);
    if (!section) return;
    const illustrations = [...section.illustrations, ill];
    patchLocal(sectionId, { illustrations });
    setMapFor(null);
    await save(sectionId, { illustrations });
  };

  const updateCaption = (sectionId: string, documentId: string, caption: string) => {
    const section = sectionsRef.current.find(s => s.id === sectionId);
    if (!section) return;
    patchLocal(sectionId, { illustrations: section.illustrations.map(i => (i.document_id === documentId ? { ...i, caption } : i)) });
  };

  const removeIllustration = async (section: FeasibilitySection, documentId: string) => {
    const illustrations = section.illustrations.filter(i => i.document_id !== documentId);
    patchLocal(section.id, { illustrations });
    await save(section.id, { illustrations });
    // Meilleur effort : un rôle sans droit de suppression garde le document
    // dans les pièces de la proposition, l'étude ne l'affiche simplement plus.
    apiFetch(`/api/documents/${documentId}`, { method: 'DELETE' }).catch(() => {});
  };

  const startReorder = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const before = sectionsRef.current.map(s => s.id).join();
    startPressDrag(e, {
      onLift: () => setDraggingId(id),
      onMove: ({ y }) => {
        const current = sectionsRef.current;
        const from = current.findIndex(s => s.id === id);
        let to = 0;
        for (const s of current) {
          if (s.id === id) continue;
          const r = cardRefs.current.get(s.id)?.getBoundingClientRect();
          if (r && y > r.top + r.height / 2) to++;
        }
        if (to === from) return;
        const next = [...current];
        const [held] = next.splice(from, 1);
        next.splice(to, 0, held);
        setSections(next.map((s, i) => ({ ...s, sort_order: i })));
      },
      onEnd: ({ cancelled }) => {
        setDraggingId(null);
        const ids = sectionsRef.current.map(s => s.id);
        if (cancelled || ids.join() === before) return;
        apiFetch(`/api/proposals/${proposalId}/feasibility/order`, { method: 'PUT', body: JSON.stringify({ ids }) })
          .catch(err => setError(err?.message || t('feas_error_generic')));
      },
    });
  };

  const runExport = async (kind: 'pdf' | 'docx') => {
    setExporting(kind);
    setError(null);
    try {
      const mod = await import('../../lib/feasibilityExport');
      const fn = kind === 'pdf' ? mod.exportFeasibilityPdf : mod.exportFeasibilityDocx;
      await fn(proposal, sectionsRef.current, settings);
    } catch (err: any) { setError(err?.message || t('feas_error_generic')); }
    finally { setExporting(null); }
  };

  const mapSection = sections.find(s => s.id === mapFor);

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('feas_intro')}</p>
      {!isEnterprise && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <IconLock size={14} /> {t('feas_ai_enterprise_only')}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg text-sm" style={{ background: 'var(--tblr-danger-lt)', color: 'var(--tblr-danger)' }}>
          <span className="flex items-center gap-2"><IconAlertTriangle size={16} /> {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t('feas_cancel') as string}><IconX size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg text-sm" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('feas_cancel') as string}><IconX size={14} /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={prefill} disabled={prefilling}
          className="flex items-center gap-1.5 text-xs font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-60"
          style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
          <IconSparkles size={14} /> {prefilling ? t('feas_prefilling') : t('feas_prefill')}
        </button>
        <button type="button" onClick={() => runExport('pdf')} disabled={!sections.length || !!exporting}
          className="flex items-center gap-1.5 text-xs font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-50" style={softButton}>
          {exporting === 'pdf' ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileTypePdf size={14} />} {t('feas_export_pdf')}
        </button>
        <button type="button" onClick={() => runExport('docx')} disabled={!sections.length || !!exporting}
          className="flex items-center gap-1.5 text-xs font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-50" style={softButton}>
          {exporting === 'docx' ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileTypeDocx size={14} />} {t('feas_export_docx')}
        </button>
      </div>

      {loading && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('feas_loading')}</p>}
      {!loading && sections.length === 0 && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('feas_empty')}</p>}

      {sections.map((section, index) => {
        const showInstructions = instructionsOpen.has(section.id) || !!section.instructions;
        return (
          <div key={section.id} ref={el => { if (el) cardRefs.current.set(section.id, el); else cardRefs.current.delete(section.id); }}
            className={`rounded-lg p-4 space-y-3 ${draggingId === section.id ? 'shadow-lg opacity-90' : ''}`} style={cardStyle}>
            <div className="flex items-center gap-2">
              <span onPointerDown={e => startReorder(e, section.id)} title={t('feas_reorder') as string}
                className="cursor-grab touch-none p-0.5 rounded" style={{ color: 'var(--tblr-muted)' }} aria-label={t('feas_reorder') as string}>
                <IconGripVertical size={16} />
              </span>
              <span className="text-xs font-bold w-5 text-center" style={{ color: 'var(--tblr-muted)' }}>{index + 1}</span>
              <input
                className="flex-1 min-w-0 bg-transparent text-sm font-bold outline-none rounded px-1 py-0.5"
                style={{ color: 'var(--tblr-text)' }}
                value={section.title}
                maxLength={200}
                aria-label={t('feas_section_title') as string}
                onChange={e => patchLocal(section.id, { title: e.target.value })}
                onBlur={e => { if (e.target.value.trim()) void save(section.id, { title: e.target.value }); }}
              />
              <span className="text-[0.6875rem] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0" style={section.status === 'redige'
                ? { background: 'var(--tblr-success-lt)', color: 'var(--tblr-success)' }
                : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                {section.status === 'redige' ? t('feas_status_redige') : t('feas_status_a_rediger')}
              </span>
              <button type="button" onClick={() => remove(section)} aria-label={t('feas_delete') as string} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={14} /></button>
            </div>

            <textarea
              rows={6}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={inputStyle}
              placeholder={t('feas_content_placeholder') as string}
              value={section.content}
              onChange={e => patchLocal(section.id, { content: e.target.value })}
              onBlur={e => void save(section.id, { content: e.target.value })}
            />

            {section.illustrations.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.illustrations.map(ill => (
                  <figure key={ill.document_id} className="space-y-1">
                    <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
                      <SignedImage src={ill.file_url} alt={ill.caption} className="w-full h-auto block" />
                      <button type="button" onClick={() => removeIllustration(section, ill.document_id)}
                        className="absolute top-1.5 right-1.5 p-1 rounded-full" aria-label={t('feas_remove_illustration') as string}
                        style={{ background: 'rgba(255,255,255,0.9)', color: '#111' }}>
                        <IconX size={14} />
                      </button>
                    </div>
                    <input className="w-full px-2 py-1 rounded text-xs italic" style={inputStyle} value={ill.caption} maxLength={300}
                      placeholder={t('feas_map_caption') as string}
                      onChange={e => updateCaption(section.id, ill.document_id, e.target.value)}
                      onBlur={() => { const s = sectionsRef.current.find(x => x.id === section.id); if (s) void save(section.id, { illustrations: s.illustrations }); }} />
                  </figure>
                ))}
              </div>
            )}

            {showInstructions && (
              <label className="block text-xs font-semibold space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                <span>{t('feas_instructions')}</span>
                <input className="w-full px-3 py-1.5 rounded-lg text-sm font-normal" style={inputStyle} maxLength={2000}
                  placeholder={t('feas_instructions_placeholder') as string}
                  value={section.instructions}
                  onChange={e => patchLocal(section.id, { instructions: e.target.value })}
                  onBlur={e => void save(section.id, { instructions: e.target.value })} />
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button type="button" onClick={() => setInsertMenuFor(insertMenuFor === section.id ? null : section.id)}
                  aria-expanded={insertMenuFor === section.id}
                  className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg" style={softButton}>
                  {siteLoading && insertMenuFor === null ? <IconLoader2 size={12} className="animate-spin" /> : <IconListDetails size={12} />}
                  {t('feas_insert')} <IconChevronDown size={12} />
                </button>
                {insertMenuFor === section.id && (
                  <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-lg shadow-lg py-1" style={cardStyle} role="menu">
                    {FEASIBILITY_BLOCK_KINDS.map(kind => (
                      <button key={kind} type="button" role="menuitem" onClick={() => insertBlock(section, kind)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:opacity-80" style={{ color: 'var(--tblr-text)' }}>
                        {t(`feas_block_${kind}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => openMap(section)} disabled={siteLoading}
                className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg disabled:opacity-60" style={softButton}>
                <IconMap2 size={12} /> {t('feas_map')}
              </button>
              {!showInstructions && (
                <button type="button" onClick={() => setInstructionsOpen(prev => new Set(prev).add(section.id))}
                  className="text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg" style={{ color: 'var(--tblr-muted)' }}>
                  {t('feas_instructions')}
                </button>
              )}
              {isEnterprise && (
                <button type="button" onClick={() => draft(section)} disabled={draftingId === section.id}
                  title={t('feas_draft_hint') as string}
                  className="ml-auto flex items-center gap-1 text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg disabled:opacity-60"
                  style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                  <IconWand size={12} /> {draftingId === section.id ? t('feas_drafting') : t('feas_draft_ai')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="rounded-lg p-3 flex items-center gap-2" style={cardStyle}>
        <input
          placeholder={t('feas_add_placeholder') as string}
          className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
          style={inputStyle}
          value={newTitle}
          maxLength={200}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addSection(); } }}
        />
        <button type="button" onClick={addSection} aria-label={t('feas_add') as string} className="p-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
          <IconPlus size={16} />
        </button>
      </div>

      {mapSection && siteData?.address && (
        <FeasibilityMapDialog
          proposalId={proposalId}
          lat={siteData.address.lat}
          lon={siteData.address.lon}
          parcelGeometry={parcelGeometry}
          onInsert={ill => addIllustration(mapSection.id, ill)}
          onClose={() => setMapFor(null)}
        />
      )}
    </div>
  );
}
