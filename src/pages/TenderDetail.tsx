import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  IconArrowLeft, IconBuildingSkyscraper, IconUsers, IconCalendar, IconCurrencyEuro,
  IconPlus, IconTrash, IconMapPin, IconFileText, IconSparkles, IconLock, IconCheck,
  IconAlertTriangle, IconX, IconSearch, IconWand,
} from '@tabler/icons-react';
import { fetchJson, apiFetch } from '../lib/api';
import type {
  Tender, Contact, TenderCompetitor, TenderPieceRequise, TenderReference,
  TenderMethodologyNote, TenderActivityNote, TenderEvaluationCriterion, Project, SimilarTender,
} from '../types';
import { useTranslation } from 'react-i18next';
import { OrgChart, OrgNode } from '../components/OrgChart';
import CorrespondenceTab from '../components/CorrespondenceTab';
import { ResourceAttachments } from '../components/ResourceAttachments';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CONTACT_CATEGORY_CLIENT, CONTACT_CATEGORY_COTRAITANT } from '../lib/contactCategories';
import { toRefItem, customToRefItem, type RefItem, type CustomRef } from '../lib/referenceItems';
import { useUser } from '../UserContext';
import { formatCurrency, cn } from '../lib/utils';

type TabId = 'apercu' | 'documents' | 'partenaires' | 'organigramme' | 'references' | 'methodologie';

const SECTION_LABELS: Record<TenderPieceRequise['section'], string> = {
  candidature: 'Candidature',
  offre_technique: 'Offre technique',
  offre_financiere: 'Offre financière',
};

const RISK_COLORS: Record<TenderCompetitor['risk_level'], { bg: string; color: string }> = {
  faible: { bg: 'var(--tblr-success-lt)', color: 'var(--tblr-success)' },
  moyen: { bg: 'var(--tblr-warning-lt)', color: 'var(--tblr-warning)' },
  eleve: { bg: 'var(--tblr-danger-lt)', color: 'var(--tblr-danger)' },
};

function surfaceCardStyle(): React.CSSProperties {
  return { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' };
}

function inputStyle(): React.CSSProperties {
  return { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
}

/** Bandeau affiché à la place d'une action IA quand le cabinet n'est pas au plan Enterprise. */
function EnterpriseLockBanner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg text-sm" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
      <IconLock size={16} />
      <span>{label}</span>
    </div>
  );
}

export default function TenderDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantPlan } = useUser();
  const isEnterprise = tenantPlan === 'enterprise';

  const [tender, setTender] = useState<Tender | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('apercu');

  // ── Aperçu : description, évaluation, concurrents, notes de suivi ──
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [criteriaForm, setCriteriaForm] = useState<TenderEvaluationCriterion[]>([]);
  const [isSavingApercu, setIsSavingApercu] = useState(false);
  const [competitors, setCompetitors] = useState<TenderCompetitor[]>([]);
  const [competitorForm, setCompetitorForm] = useState({ name: '', info: '', risk_level: 'moyen' as TenderCompetitor['risk_level'] });
  const [activityNotes, setActivityNotes] = useState<TenderActivityNote[]>([]);
  const [newActivityNote, setNewActivityNote] = useState('');
  const [aperçuLoaded, setAperçuLoaded] = useState(false);
  const [enveloppeDraft, setEnveloppeDraft] = useState('');
  const [isEstimatingEnveloppe, setIsEstimatingEnveloppe] = useState(false);
  const [enveloppeError, setEnveloppeError] = useState<string | null>(null);
  const [similarTenders, setSimilarTenders] = useState<SimilarTender[]>([]);
  const [resultForm, setResultForm] = useState({ entreprise_retenue: '', honoraires_retenus_montant: '' });
  const [isSavingResult, setIsSavingResult] = useState(false);

  // ── Documents : pièces demandées ──
  const [pieces, setPieces] = useState<TenderPieceRequise[]>([]);
  const [piecesLoaded, setPiecesLoaded] = useState(false);
  const [isAnalyzingDce, setIsAnalyzingDce] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [newPiece, setNewPiece] = useState({ section: 'candidature' as TenderPieceRequise['section'], label: '' });

  // ── Partenaires ──
  const [mandataireId, setMandataireId] = useState('');
  const [specialtiesForm, setSpecialtiesForm] = useState<{ id?: string; specialty_name: string; contact_id?: string }[]>([]);
  const [isSavingPartners, setIsSavingPartners] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactModalCategory, setContactModalCategory] = useState<string>(CONTACT_CATEGORY_COTRAITANT);

  // ── Références ──
  const [references, setReferences] = useState<TenderReference[]>([]);
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [isRefPickerOpen, setIsRefPickerOpen] = useState(false);
  const [refPickerItems, setRefPickerItems] = useState<RefItem[]>([]);
  const [refPickerQuery, setRefPickerQuery] = useState('');
  const [refPickerPeriod, setRefPickerPeriod] = useState<'all' | '3' | '5' | '10'>('all');
  const [refPickerCategory, setRefPickerCategory] = useState('all');
  const [refPickerSort, setRefPickerSort] = useState<'none' | 'budget_desc' | 'budget_asc'>('none');

  // ── Note méthodologique ──
  const [methodologyNotes, setMethodologyNotes] = useState<TenderMethodologyNote[]>([]);
  const [methodologyLoaded, setMethodologyLoaded] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [draftingNoteId, setDraftingNoteId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [tenderData, contactsData] = await Promise.all([
          fetchJson<Tender>(`/api/tenders/${id}`),
          fetchJson<Contact[]>('/api/contacts'),
        ]);
        setTender(tenderData);
        setContacts(contactsData);
        setDescriptionDraft(tenderData.description || '');
        setCriteriaForm(tenderData.evaluation_criteria_list || []);
        setMandataireId(tenderData.mandataire_id || '');
        setSpecialtiesForm(tenderData.specialties_list || []);
        setEnveloppeDraft(tenderData.enveloppe_previsionnelle != null ? String(tenderData.enveloppe_previsionnelle) : '');
        setResultForm({
          entreprise_retenue: tenderData.entreprise_retenue || '',
          honoraires_retenus_montant: tenderData.honoraires_retenus_montant != null ? String(tenderData.honoraires_retenus_montant) : '',
        });
      } catch (err) {
        console.error('Failed to load tender details:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [id]);

  useEffect(() => {
    if (!tender) return;
    if (activeTab === 'apercu' && !aperçuLoaded) {
      setAperçuLoaded(true);
      fetchJson<TenderCompetitor[]>(`/api/tender-competitors?tender_id=${tender.id}`).then(setCompetitors).catch(console.error);
      fetchJson<TenderActivityNote[]>(`/api/tender-activity-notes?tender_id=${tender.id}`).then(setActivityNotes).catch(console.error);
      fetchJson<SimilarTender[]>(`/api/tenders/${tender.id}/candidatures-similaires`).then(setSimilarTenders).catch(console.error);
    }
    if (activeTab === 'documents' && !piecesLoaded) {
      setPiecesLoaded(true);
      fetchJson<TenderPieceRequise[]>(`/api/tender-pieces?tender_id=${tender.id}`).then(setPieces).catch(console.error);
    }
    if (activeTab === 'references' && !referencesLoaded) {
      setReferencesLoaded(true);
      fetchJson<TenderReference[]>(`/api/tender-references?tender_id=${tender.id}`).then(setReferences).catch(console.error);
    }
    if (activeTab === 'methodologie' && !methodologyLoaded) {
      setMethodologyLoaded(true);
      fetchJson<TenderMethodologyNote[]>(`/api/tender-methodology-notes?tender_id=${tender.id}`).then(setMethodologyNotes).catch(console.error);
    }
  }, [activeTab, tender, aperçuLoaded, piecesLoaded, referencesLoaded, methodologyLoaded]);

  const saveTenderPatch = async (patch: Partial<Tender>) => {
    if (!tender) return;
    const merged = { ...tender, ...patch };
    const saved = await apiFetch<any>(`/api/tenders/${tender.id}`, { method: 'PUT', body: JSON.stringify(merged) });
    const formatted: Tender = { ...saved, mandatory_visit: !!saved.mandatory_visit };
    setTender(formatted);
    return formatted;
  };

  // ── Aperçu handlers ──
  const saveDescription = async () => {
    if (!tender || descriptionDraft === (tender.description || '')) return;
    setIsSavingApercu(true);
    try { await saveTenderPatch({ description: descriptionDraft }); }
    finally { setIsSavingApercu(false); }
  };

  const criteriaTotal = criteriaForm.reduce((acc, c) => acc + (Number(c.weight_pct) || 0), 0);

  const saveCriteria = async () => {
    setIsSavingApercu(true);
    try { await saveTenderPatch({ evaluation_criteria_list: criteriaForm }); }
    finally { setIsSavingApercu(false); }
  };

  const saveEnveloppe = async () => {
    if (!tender) return;
    const value = enveloppeDraft.trim() === '' ? null : Number(enveloppeDraft);
    if (value === tender.enveloppe_previsionnelle) return;
    setIsSavingApercu(true);
    try { await saveTenderPatch({ enveloppe_previsionnelle: value }); }
    finally { setIsSavingApercu(false); }
  };

  const estimateEnveloppeWithAi = async () => {
    if (!tender) return;
    setIsEstimatingEnveloppe(true);
    setEnveloppeError(null);
    try {
      const res = await apiFetch<{ enveloppe_previsionnelle: number | null }>(`/api/tenders/${tender.id}/estimate-enveloppe`, { method: 'POST' });
      if (res.enveloppe_previsionnelle != null) {
        setEnveloppeDraft(String(res.enveloppe_previsionnelle));
        setTender(prev => prev ? { ...prev, enveloppe_previsionnelle: res.enveloppe_previsionnelle } : prev);
      } else {
        setEnveloppeError(t('tender_detail_enveloppe_not_found'));
      }
    } catch (err: any) {
      setEnveloppeError(err?.message || t('tender_detail_enveloppe_estimate_error'));
    } finally {
      setIsEstimatingEnveloppe(false);
    }
  };

  const saveResult = async () => {
    if (!tender) return;
    setIsSavingResult(true);
    try {
      await saveTenderPatch({
        entreprise_retenue: resultForm.entreprise_retenue.trim() || null,
        honoraires_retenus_montant: resultForm.honoraires_retenus_montant.trim() === '' ? null : Number(resultForm.honoraires_retenus_montant),
      });
    } finally {
      setIsSavingResult(false);
    }
  };
  const resultPercent = tender?.enveloppe_previsionnelle && resultForm.honoraires_retenus_montant.trim() !== ''
    ? (Number(resultForm.honoraires_retenus_montant) / tender.enveloppe_previsionnelle) * 100
    : null;

  const addCriterion = () => setCriteriaForm(prev => [...prev, { label: '', weight_pct: 0 }]);
  const updateCriterion = (idx: number, field: 'label' | 'weight_pct', value: string) => {
    setCriteriaForm(prev => prev.map((c, i) => i === idx ? { ...c, [field]: field === 'weight_pct' ? Number(value) || 0 : value } : c));
  };
  const removeCriterion = (idx: number) => setCriteriaForm(prev => prev.filter((_, i) => i !== idx));

  const addCompetitor = async () => {
    if (!tender || !competitorForm.name.trim()) return;
    const created = await apiFetch<TenderCompetitor>('/api/tender-competitors', {
      method: 'POST', body: JSON.stringify({ tender_id: tender.id, ...competitorForm }),
    });
    setCompetitors(prev => [...prev, created]);
    setCompetitorForm({ name: '', info: '', risk_level: 'moyen' });
  };
  const removeCompetitor = async (compId: string) => {
    await apiFetch(`/api/tender-competitors/${compId}`, { method: 'DELETE' });
    setCompetitors(prev => prev.filter(c => c.id !== compId));
  };
  const updateCompetitorRisk = async (comp: TenderCompetitor, risk_level: TenderCompetitor['risk_level']) => {
    setCompetitors(prev => prev.map(c => c.id === comp.id ? { ...c, risk_level } : c));
    await apiFetch(`/api/tender-competitors/${comp.id}`, { method: 'PUT', body: JSON.stringify({ ...comp, risk_level }) });
  };

  const addActivityNote = async () => {
    if (!tender || !newActivityNote.trim()) return;
    const created = await apiFetch<TenderActivityNote>('/api/tender-activity-notes', {
      method: 'POST', body: JSON.stringify({ tender_id: tender.id, content: newActivityNote.trim() }),
    });
    setActivityNotes(prev => [created, ...prev]);
    setNewActivityNote('');
  };

  // ── Documents / pièces handlers ──
  const handleAnalyzeDce = async () => {
    if (!tender) return;
    setIsAnalyzingDce(true);
    setAnalyzeError(null);
    try {
      await apiFetch(`/api/tenders/${tender.id}/analyze-dce`, { method: 'POST' });
      const refreshed = await fetchJson<TenderPieceRequise[]>(`/api/tender-pieces?tender_id=${tender.id}`);
      setPieces(refreshed);
    } catch (err: any) {
      setAnalyzeError(err?.message || "Échec de l'analyse du DCE.");
    } finally {
      setIsAnalyzingDce(false);
    }
  };

  const markPieceStatus = async (piece: TenderPieceRequise, status: TenderPieceRequise['status']) => {
    setPieces(prev => prev.map(p => p.id === piece.id ? { ...p, status } : p));
    await apiFetch(`/api/tender-pieces/${piece.id}`, { method: 'PUT', body: JSON.stringify({ ...piece, status }) });
  };
  const removePiece = async (pieceId: string) => {
    await apiFetch(`/api/tender-pieces/${pieceId}`, { method: 'DELETE' });
    setPieces(prev => prev.filter(p => p.id !== pieceId));
  };
  const addManualPiece = async () => {
    if (!tender || !newPiece.label.trim()) return;
    const created = await apiFetch<TenderPieceRequise>('/api/tender-pieces', {
      method: 'POST', body: JSON.stringify({ tender_id: tender.id, section: newPiece.section, label: newPiece.label.trim(), obligatoire: true }),
    });
    setPieces(prev => [...prev, created]);
    setNewPiece({ section: 'candidature', label: '' });
  };

  // ── Partenaires handlers ──
  const addSpecialtyRow = () => setSpecialtiesForm(prev => [...prev, { specialty_name: '', contact_id: '' }]);
  const removeSpecialtyRow = (idx: number) => setSpecialtiesForm(prev => prev.filter((_, i) => i !== idx));
  const updateSpecialtyRow = (idx: number, field: 'specialty_name' | 'contact_id', value: string) => {
    setSpecialtiesForm(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };
  const savePartners = async () => {
    setIsSavingPartners(true);
    try { await saveTenderPatch({ mandataire_id: mandataireId || undefined, specialties_list: specialtiesForm as any }); }
    finally { setIsSavingPartners(false); }
  };

  // ── Références handlers ──
  const openRefPicker = async () => {
    setIsRefPickerOpen(true);
    if (refPickerItems.length === 0) {
      const [projects, customRefs] = await Promise.all([
        fetchJson<Project[]>('/api/projects'),
        fetchJson<CustomRef[]>('/api/references/custom'),
      ]);
      setRefPickerItems([...projects.map(toRefItem), ...customRefs.map(customToRefItem)]);
    }
  };
  const addReference = async (item: RefItem) => {
    if (!tender) return;
    const created = await apiFetch<TenderReference>('/api/tender-references', {
      method: 'POST',
      body: JSON.stringify(item.source === 'project' ? { tender_id: tender.id, project_id: item.id } : { tender_id: tender.id, custom_reference_id: item.id }),
    });
    setReferences(prev => [...prev, { ...created, name: item.name, client: item.client, category: item.category, source: item.source }]);
  };
  const removeReference = async (refId: string) => {
    await apiFetch(`/api/tender-references/${refId}`, { method: 'DELETE' });
    setReferences(prev => prev.filter(r => r.id !== refId));
  };
  const toggleReferenceRequired = async (ref: TenderReference) => {
    const required = !ref.required;
    setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, required } : r));
    await apiFetch(`/api/tender-references/${ref.id}`, { method: 'PUT', body: JSON.stringify({ required }) });
  };
  const selectedRefIds = new Set(references.map(r => (r.project_id || r.custom_reference_id) + ':' + (r.project_id ? 'project' : 'manual')));
  const refPickerCategories = Array.from(new Set(refPickerItems.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const refPickerPeriodCutoffYear = refPickerPeriod === 'all' ? null : new Date().getFullYear() - Number(refPickerPeriod);
  const filteredRefPickerItems = refPickerItems
    .filter(item => !selectedRefIds.has(`${item.id}:${item.source}`))
    .filter(item => !refPickerQuery.trim() || item.name.toLowerCase().includes(refPickerQuery.trim().toLowerCase()))
    .filter(item => refPickerCategory === 'all' || item.category === refPickerCategory)
    .filter(item => {
      if (refPickerPeriodCutoffYear === null) return true;
      if (!item.end_date) return false;
      return new Date(item.end_date).getFullYear() >= refPickerPeriodCutoffYear;
    })
    .sort((a, b) => {
      if (refPickerSort === 'none') return 0;
      const diff = (a.budget ?? 0) - (b.budget ?? 0);
      return refPickerSort === 'budget_asc' ? diff : -diff;
    });

  // ── Note méthodologique handlers ──
  const addMethodologyNote = async () => {
    if (!tender || !newNoteTitle.trim()) return;
    const created = await apiFetch<TenderMethodologyNote>('/api/tender-methodology-notes', {
      method: 'POST', body: JSON.stringify({ tender_id: tender.id, title: newNoteTitle.trim(), sort_order: methodologyNotes.length }),
    });
    setMethodologyNotes(prev => [...prev, created]);
    setNewNoteTitle('');
  };
  const updateMethodologyNoteContent = async (note: TenderMethodologyNote, content: string) => {
    setMethodologyNotes(prev => prev.map(n => n.id === note.id ? { ...n, content } : n));
  };
  const saveMethodologyNote = async (note: TenderMethodologyNote) => {
    await apiFetch(`/api/tender-methodology-notes/${note.id}`, { method: 'PUT', body: JSON.stringify(note) });
  };
  const removeMethodologyNote = async (noteId: string) => {
    await apiFetch(`/api/tender-methodology-notes/${noteId}`, { method: 'DELETE' });
    setMethodologyNotes(prev => prev.filter(n => n.id !== noteId));
  };
  const draftNoteWithAi = async (note: TenderMethodologyNote) => {
    if (!tender) return;
    setDraftingNoteId(note.id);
    try {
      const { content } = await apiFetch<{ content: string }>(`/api/tenders/${tender.id}/methodology/${note.id}/draft-ai`, { method: 'POST' });
      setMethodologyNotes(prev => prev.map(n => n.id === note.id ? { ...n, content, status: 'redige' } : n));
    } catch (err) {
      console.error(err);
    } finally {
      setDraftingNoteId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderBottomColor: 'var(--tblr-primary)' }} />
      </div>
    );
  }

  if (!tender) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tenders_not_found')}</h2>
        <button onClick={() => navigate('/tenders')} className="mt-4" style={{ color: 'var(--tblr-primary)' }}>
          {t('tenders_back_link')}
        </button>
      </div>
    );
  }

  const mandataireContact = contacts.find(c => c.id === tender.mandataire_id);
  const piecesFournies = pieces.filter(p => p.status === 'fournie').length;

  const orgData: OrgNode = {
    id: 'mandataire',
    name: mandataireContact ? `${mandataireContact.first_name} ${mandataireContact.last_name}` : t('tender_detail_org_no_mandataire'),
    title: t('tender_detail_org_mandataire_role'),
    department: 'Architecture',
    children: (tender.specialties_list || []).map(spec => {
      const specContact = contacts.find(c => c.id === spec.contact_id);
      return {
        id: spec.id,
        name: specContact ? `${specContact.first_name} ${specContact.last_name}` : t('tender_detail_org_unassigned'),
        title: spec.specialty_name,
        department: specContact?.category || 'Technique',
      };
    }),
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'apercu', label: t('tender_detail_tab_apercu') },
    { id: 'documents', label: t('tender_detail_tab_documents'), count: piecesLoaded ? pieces.length : undefined },
    { id: 'partenaires', label: t('tender_detail_tab_partenaires'), count: (tender.specialties_list || []).length || undefined },
    { id: 'organigramme', label: t('tender_detail_tab_organigramme') },
    { id: 'references', label: t('tender_detail_tab_references'), count: referencesLoaded ? references.length : undefined },
    { id: 'methodologie', label: t('tender_detail_tab_methodologie') },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate('/tenders')}
          className="flex items-center gap-2 w-fit transition-colors"
          style={{ color: 'var(--tblr-muted)' }}
        >
          <IconArrowLeft size={18} />
          {t('tenders_back_link')}
        </button>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{tender.title}</h1>
            <p className="flex items-center gap-2 mt-1 text-sm" style={{ color: 'var(--tblr-muted)' }}>
              <IconBuildingSkyscraper size={16} />
              {tender.client}
              {tender.ville_execution && (<><IconMapPin size={14} className="ml-2" />{tender.ville_execution}</>)}
            </p>
          </div>
          <span className={cn('px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider')} style={{
            background: tender.status === 'Won' ? 'var(--tblr-success-lt)' : tender.status === 'Lost' ? 'var(--tblr-danger-lt)' : 'var(--tblr-primary-lt)',
            color: tender.status === 'Won' ? 'var(--tblr-success)' : tender.status === 'Lost' ? 'var(--tblr-danger)' : 'var(--tblr-primary)',
          }}>
            {tender.status}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: IconUsers, label: t('tender_detail_stat_candidats'), value: String(competitors.length), sub: `${pieces.length} ${t('tender_detail_stat_pieces_dce_sub')}` },
          { icon: IconCurrencyEuro, label: t('tender_detail_stat_montant_estime'), value: formatCurrency(tender.value), sub: t('tender_detail_stat_montant_sub') },
          { icon: IconCalendar, label: t('tender_detail_stat_date_limite'), value: tender.submission_deadline ? new Date(tender.submission_deadline).toLocaleDateString('fr-FR') : '—', sub: '' },
          { icon: IconFileText, label: t('tender_detail_stat_pieces_a_fournir'), value: `${piecesFournies}/${pieces.length}`, sub: t('tender_detail_stat_pieces_completees') },
        ].map((stat, i) => (
          <div key={i} className="rounded-lg p-4" style={surfaceCardStyle()}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{stat.label}</p>
            <p className="text-xl font-bold mt-1" style={{ color: 'var(--tblr-text)' }}>{stat.value}</p>
            {stat.sub && <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--tblr-border)' }}>
        {tabs.map(tabItem => (
          <button
            key={tabItem.id}
            onClick={() => setActiveTab(tabItem.id)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap"
            style={{
              borderColor: activeTab === tabItem.id ? 'var(--tblr-primary)' : 'transparent',
              color: activeTab === tabItem.id ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
            }}
          >
            {tabItem.label}
            {tabItem.count !== undefined && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>{tabItem.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Aperçu */}
      {activeTab === 'apercu' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg p-5 space-y-4" style={surfaceCardStyle()}>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_field_description')}</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={inputStyle()}
                  value={descriptionDraft}
                  onChange={e => setDescriptionDraft(e.target.value)}
                  onBlur={saveDescription}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('client')}</p>
                  <p style={{ color: 'var(--tblr-text)' }}>{tender.client}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Type</p>
                  <p style={{ color: 'var(--tblr-text)' }}>{tender.type || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_field_specialites')}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(tender.specialties_list || []).length > 0 ? tender.specialties_list!.map(s => (
                      <span key={s.id} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>{s.specialty_name}</span>
                    )) : <span className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_no_specialties')}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Évaluation */}
            <div className="rounded-lg p-5 space-y-3" style={surfaceCardStyle()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_detail_field_evaluation')}</h3>
                <button onClick={addCriterion} className="text-xs flex items-center gap-1 font-bold uppercase" style={{ color: 'var(--tblr-primary)' }}>
                  <IconPlus size={12} /> {t('tender_detail_add_criterion')}
                </button>
              </div>

              {/* Enveloppe prévisionnelle des honoraires */}
              <div className="space-y-1.5 pb-2 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_enveloppe_label')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0}
                    placeholder={t('tender_detail_enveloppe_placeholder')}
                    className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={inputStyle()}
                    value={enveloppeDraft}
                    onChange={e => setEnveloppeDraft(e.target.value)}
                    onBlur={saveEnveloppe}
                  />
                  {isEnterprise && (
                    <button
                      onClick={estimateEnveloppeWithAi}
                      disabled={isEstimatingEnveloppe}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg disabled:opacity-60 whitespace-nowrap"
                      style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                    >
                      <IconSparkles size={12} className={isEstimatingEnveloppe ? 'animate-pulse' : ''} />
                      {isEstimatingEnveloppe ? t('tender_detail_analyzing_dce') : t('tender_detail_enveloppe_search_dce')}
                    </button>
                  )}
                </div>
                {!isEnterprise && <p className="text-[10px] italic" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_enveloppe_ai_enterprise_hint')}</p>}
                {enveloppeError && (
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--tblr-danger)' }}><IconAlertTriangle size={12} /> {enveloppeError}</p>
                )}
              </div>

              <div className="space-y-2">
                {criteriaForm.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      placeholder={t('tender_detail_criterion_label_placeholder')}
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                      style={inputStyle()}
                      value={c.label}
                      onChange={e => updateCriterion(idx, 'label', e.target.value)}
                    />
                    <input
                      type="number" min={0} max={100}
                      className="w-20 px-3 py-1.5 rounded-lg text-sm outline-none"
                      style={inputStyle()}
                      value={c.weight_pct}
                      onChange={e => updateCriterion(idx, 'weight_pct', e.target.value)}
                    />
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>%</span>
                    <button onClick={() => removeCriterion(idx)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={16} /></button>
                  </div>
                ))}
                {criteriaForm.length === 0 && <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_no_criteria')}</p>}
              </div>
              <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                <span className="text-xs" style={{ color: criteriaTotal === 100 || criteriaForm.length === 0 ? 'var(--tblr-muted)' : 'var(--tblr-warning)' }}>
                  {t('tender_detail_criteria_total', { total: criteriaTotal })}
                </span>
                <button onClick={saveCriteria} disabled={isSavingApercu} className="text-xs font-bold uppercase px-3 py-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>{t('save')}</button>
              </div>
            </div>

            {/* Analyse concurrentielle */}
            <div className="rounded-lg p-5 space-y-3" style={surfaceCardStyle()}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_detail_competitive_analysis')}</h3>
              <div className="space-y-2">
                {competitors.map(comp => (
                  <div key={comp.id} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{comp.name}</p>
                      {comp.info && <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{comp.info}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={comp.risk_level}
                        onChange={e => updateCompetitorRisk(comp, e.target.value as TenderCompetitor['risk_level'])}
                        className="text-[10px] font-bold uppercase px-2 py-1 rounded-full outline-none"
                        style={{ background: RISK_COLORS[comp.risk_level].bg, color: RISK_COLORS[comp.risk_level].color, border: 'none' }}
                      >
                        <option value="faible">{t('tender_detail_risk_faible')}</option>
                        <option value="moyen">{t('tender_detail_risk_moyen')}</option>
                        <option value="eleve">{t('tender_detail_risk_eleve')}</option>
                      </select>
                      <button onClick={() => removeCompetitor(comp.id)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                <input
                  placeholder={t('tender_detail_competitor_name_placeholder')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                  style={inputStyle()}
                  value={competitorForm.name}
                  onChange={e => setCompetitorForm(prev => ({ ...prev, name: e.target.value }))}
                />
                <input
                  placeholder={t('tender_detail_competitor_info_placeholder')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                  style={inputStyle()}
                  value={competitorForm.info}
                  onChange={e => setCompetitorForm(prev => ({ ...prev, info: e.target.value }))}
                />
                <button onClick={addCompetitor} className="p-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}><IconPlus size={16} /></button>
              </div>

              {/* Candidatures similaires — autres affaires du cabinet, même type de procédure ou même spécialité, dont l'entreprise retenue est connue */}
              {similarTenders.length > 0 && (
                <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_similar_tenders_title')}</p>
                  {similarTenders.map(st => (
                    <div key={st.id} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{st.title}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{st.client}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold" style={{ color: 'var(--tblr-primary)' }}>{st.entreprise_retenue}</p>
                        {st.honoraires_retenus_montant != null && <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{formatCurrency(st.honoraires_retenus_montant)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Correspondance */}
            <div className="rounded-lg p-5" style={surfaceCardStyle()}>
              <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--tblr-text)' }}>{t('correspondence_title')}</h3>
              <CorrespondenceTab localType="tender" localId={tender.id} contactEmail={mandataireContact?.email} />
            </div>
          </div>

          {/* Résultat de la consultation */}
          <div className="rounded-lg p-5 space-y-3 h-fit" style={surfaceCardStyle()}>
            <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_detail_result_title')}</h3>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_result_entreprise_label')}</label>
              <input
                placeholder={t('tender_detail_result_entreprise_placeholder')}
                className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle()}
                value={resultForm.entreprise_retenue}
                onChange={e => setResultForm(prev => ({ ...prev, entreprise_retenue: e.target.value }))}
                onBlur={saveResult}
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_result_honoraires_label')}</label>
              <input
                type="number" min={0}
                placeholder={t('tender_detail_result_honoraires_placeholder')}
                className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle()}
                value={resultForm.honoraires_retenus_montant}
                onChange={e => setResultForm(prev => ({ ...prev, honoraires_retenus_montant: e.target.value }))}
                onBlur={saveResult}
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_result_percent_label')}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>
                {resultPercent !== null ? `${resultPercent.toFixed(1)} %` : '—'}
              </span>
            </div>
            {resultPercent === null && !tender.enveloppe_previsionnelle && (
              <p className="text-[10px] italic" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_result_percent_hint')}</p>
            )}
            {isSavingResult && <p className="text-[10px] italic" style={{ color: 'var(--tblr-muted)' }}>{t('saving')}</p>}
          </div>

          {/* Notes de suivi */}
          <div className="rounded-lg p-5 space-y-3 h-fit" style={surfaceCardStyle()}>
            <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_detail_activity_notes')}</h3>
            <div className="space-y-2">
              <textarea
                rows={2}
                placeholder={t('tender_detail_activity_note_placeholder')}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStyle()}
                value={newActivityNote}
                onChange={e => setNewActivityNote(e.target.value)}
              />
              <button onClick={addActivityNote} className="w-full text-xs font-bold uppercase px-3 py-1.5 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>{t('tender_detail_add_note')}</button>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
              {activityNotes.map(note => (
                <div key={note.id} className="text-sm">
                  <p style={{ color: 'var(--tblr-text)' }}>{note.content}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{note.author_name} · {new Date(note.created_at).toLocaleString('fr-FR')}</p>
                </div>
              ))}
              {activityNotes.length === 0 && <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_no_activity_notes')}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Documents */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          <div className="rounded-lg p-5" style={surfaceCardStyle()}>
            <ResourceAttachments resourceType="tenders" resourceId={tender.id} category="DCE" />
          </div>

          <div className="rounded-lg p-5 space-y-3" style={surfaceCardStyle()}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                <IconFileText size={18} /> {t('tender_detail_pieces_title')}
              </h3>
              {isEnterprise ? (
                <button
                  onClick={handleAnalyzeDce}
                  disabled={isAnalyzingDce}
                  className="flex items-center gap-2 text-xs font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-60"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  <IconSparkles size={14} className={isAnalyzingDce ? 'animate-pulse' : ''} />
                  {isAnalyzingDce ? t('tender_detail_analyzing_dce') : t('tender_detail_analyze_dce')}
                </button>
              ) : null}
            </div>
            {!isEnterprise && <EnterpriseLockBanner label={t('tender_detail_ai_enterprise_only')} />}
            {analyzeError && (
              <p className="text-xs flex items-center gap-1" style={{ color: 'var(--tblr-danger)' }}><IconAlertTriangle size={12} /> {analyzeError}</p>
            )}

            {(['candidature', 'offre_technique', 'offre_financiere'] as const).map(section => {
              const sectionPieces = pieces.filter(p => p.section === section);
              if (sectionPieces.length === 0) return null;
              return (
                <div key={section} className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{SECTION_LABELS[section]}</p>
                  {sectionPieces.map(piece => (
                    <div key={piece.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>{piece.label}</span>
                          {piece.quantity_required && <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>({piece.quantity_required} {t('tender_detail_required_count_suffix')})</span>}
                          {piece.status === 'detectee_ia' && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>{t('tender_detail_detected_ia')}</span>
                          )}
                        </div>
                        {piece.source_hint && <p className="text-[10px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{piece.source_hint}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => markPieceStatus(piece, piece.status === 'fournie' ? 'a_fournir' : 'fournie')}
                          className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full"
                          style={piece.status === 'fournie'
                            ? { background: 'var(--tblr-success-lt)', color: 'var(--tblr-success)' }
                            : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
                        >
                          <IconCheck size={12} /> {piece.status === 'fournie' ? t('tender_detail_piece_fournie') : t('tender_detail_piece_mark_fournie')}
                        </button>
                        <button onClick={() => removePiece(piece.id)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {pieces.length === 0 && <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_no_pieces')}</p>}

            <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
              <select
                value={newPiece.section}
                onChange={e => setNewPiece(prev => ({ ...prev, section: e.target.value as TenderPieceRequise['section'] }))}
                className="px-2 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle()}
              >
                <option value="candidature">{SECTION_LABELS.candidature}</option>
                <option value="offre_technique">{SECTION_LABELS.offre_technique}</option>
                <option value="offre_financiere">{SECTION_LABELS.offre_financiere}</option>
              </select>
              <input
                placeholder={t('tender_detail_add_piece_placeholder')}
                className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle()}
                value={newPiece.label}
                onChange={e => setNewPiece(prev => ({ ...prev, label: e.target.value }))}
              />
              <button onClick={addManualPiece} className="p-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}><IconPlus size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Partenaires */}
      {activeTab === 'partenaires' && (
        <div className="rounded-lg p-5 space-y-4" style={surfaceCardStyle()}>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_representative_label')}</label>
            <ContactAutocomplete
              contacts={contacts}
              value={mandataireId}
              onChange={setMandataireId}
              onAddNew={() => { setContactModalCategory(CONTACT_CATEGORY_CLIENT); setIsContactModalOpen(true); }}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_required_specialties_label')}</label>
              <button onClick={addSpecialtyRow} className="text-[10px] flex items-center gap-1 font-bold uppercase" style={{ color: 'var(--tblr-primary)' }}>
                <IconPlus size={12} /> {t('tenders_add_specialty_btn')}
              </button>
            </div>
            <div className="space-y-2">
              {specialtiesForm.map((spec, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    placeholder={t('tenders_specialty_placeholder')}
                    className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={inputStyle()}
                    value={spec.specialty_name}
                    onChange={e => updateSpecialtyRow(idx, 'specialty_name', e.target.value)}
                  />
                  <ContactAutocomplete
                    className="flex-1"
                    contacts={contacts}
                    value={spec.contact_id || ''}
                    onChange={val => updateSpecialtyRow(idx, 'contact_id', val)}
                    onAddNew={() => { setContactModalCategory(CONTACT_CATEGORY_COTRAITANT); setIsContactModalOpen(true); }}
                  />
                  <button onClick={() => removeSpecialtyRow(idx)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={16} /></button>
                </div>
              ))}
              {specialtiesForm.length === 0 && <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_no_specialties_yet')}</p>}
            </div>
          </div>
          <button onClick={savePartners} disabled={isSavingPartners} className="text-xs font-bold uppercase px-4 py-2 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>{t('save')}</button>
        </div>
      )}

      {/* Organigramme */}
      {activeTab === 'organigramme' && (
        <div className="rounded-2xl p-8 overflow-hidden" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
          <OrgChart data={orgData} />
        </div>
      )}

      {/* Références */}
      {activeTab === 'references' && (
        <div className="rounded-lg p-5 space-y-4" style={surfaceCardStyle()}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm" style={{ color: 'var(--tblr-text)' }}>
              {t('tender_detail_references_stat', { selected: references.length, required: references.filter(r => r.required).length })}
            </p>
            <button onClick={openRefPicker} className="flex items-center gap-2 text-xs font-bold uppercase px-3 py-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
              <IconPlus size={14} /> {t('tender_detail_add_reference')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {references.map(ref => (
              <div key={ref.id} className="p-3 rounded-lg" style={{ border: ref.required ? '1px solid var(--tblr-primary)' : '1px solid var(--tblr-border)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{ref.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{ref.client}{ref.category ? ` · ${ref.category}` : ''}</p>
                  </div>
                  <button onClick={() => removeReference(ref.id)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={14} /></button>
                </div>
                <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                  <input type="checkbox" checked={ref.required} onChange={() => toggleReferenceRequired(ref)} />
                  {t('tender_detail_reference_required_label')}
                </label>
              </div>
            ))}
            {references.length === 0 && <p className="text-xs italic col-span-2" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_no_references')}</p>}
          </div>
        </div>
      )}

      {/* Note méthodologique */}
      {activeTab === 'methodologie' && (
        <div className="space-y-4">
          {!isEnterprise && <EnterpriseLockBanner label={t('tender_detail_ai_enterprise_only')} />}
          {methodologyNotes.map(note => (
            <div key={note.id} className="rounded-lg p-5 space-y-3" style={surfaceCardStyle()}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{note.title}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={note.status === 'redige'
                    ? { background: 'var(--tblr-success-lt)', color: 'var(--tblr-success)' }
                    : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                    {note.status === 'redige' ? t('tender_detail_note_redige') : t('tender_detail_note_a_rediger')}
                  </span>
                  {isEnterprise && (
                    <button
                      onClick={() => draftNoteWithAi(note)}
                      disabled={draftingNoteId === note.id}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-lg disabled:opacity-60"
                      style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                    >
                      <IconWand size={12} /> {draftingNoteId === note.id ? t('tender_detail_drafting') : t('tender_detail_draft_with_ai')}
                    </button>
                  )}
                  <button onClick={() => removeMethodologyNote(note.id)} style={{ color: 'var(--tblr-muted)' }}><IconTrash size={14} /></button>
                </div>
              </div>
              <textarea
                rows={5}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStyle()}
                value={note.content}
                onChange={e => updateMethodologyNoteContent(note, e.target.value)}
                onBlur={() => saveMethodologyNote(note)}
              />
            </div>
          ))}
          <div className="rounded-lg p-4 flex items-center gap-2" style={surfaceCardStyle()}>
            <input
              placeholder={t('tender_detail_add_note_section_placeholder')}
              className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
              style={inputStyle()}
              value={newNoteTitle}
              onChange={e => setNewNoteTitle(e.target.value)}
            />
            <button onClick={addMethodologyNote} className="p-1.5 rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}><IconPlus size={16} /></button>
          </div>
        </div>
      )}

      {/* Sélecteur de références */}
      {isRefPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" style={surfaceCardStyle()}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_detail_add_reference')}</h3>
              <button onClick={() => setIsRefPickerOpen(false)} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
            </div>
            <div className="p-4 space-y-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
                <input
                  placeholder={t('tender_detail_reference_search_placeholder')}
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                  style={inputStyle()}
                  value={refPickerQuery}
                  onChange={e => setRefPickerQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {(['all', '3', '5', '10'] as const).map(period => (
                  <button
                    key={period}
                    onClick={() => setRefPickerPeriod(period)}
                    className="text-xs font-medium px-2.5 py-1 rounded-full"
                    style={refPickerPeriod === period
                      ? { background: 'var(--tblr-primary)', color: '#fff' }
                      : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
                  >
                    {t(period === 'all' ? 'tender_detail_reference_filter_period_all' : `tender_detail_reference_filter_period_${period}`)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="flex-1 min-w-[10rem] px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={inputStyle()}
                  value={refPickerCategory}
                  onChange={e => setRefPickerCategory(e.target.value)}
                >
                  <option value="all">{t('tender_detail_reference_filter_category_all')}</option>
                  {refPickerCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <select
                  className="flex-1 min-w-[10rem] px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={inputStyle()}
                  value={refPickerSort}
                  onChange={e => setRefPickerSort(e.target.value as typeof refPickerSort)}
                >
                  <option value="none">{t('tender_detail_reference_filter_sort_none')}</option>
                  <option value="budget_desc">{t('tender_detail_reference_filter_sort_budget_desc')}</option>
                  <option value="budget_asc">{t('tender_detail_reference_filter_sort_budget_asc')}</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {filteredRefPickerItems.map(item => (
                <button
                  key={`${item.source}:${item.id}`}
                  onClick={() => { addReference(item); }}
                  className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg text-left"
                  style={{ border: '1px solid var(--tblr-border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{item.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{item.client}{item.category ? ` · ${item.category}` : ''}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>
                      {item.end_date
                        ? t('tender_detail_reference_delivery_date', { date: new Date(item.end_date).toLocaleDateString('fr-FR') })
                        : t('tender_detail_reference_delivery_date_unknown')}
                      {item.budget ? ` · ${formatCurrency(item.budget)}` : ''}
                    </p>
                  </div>
                  <IconPlus size={16} style={{ color: 'var(--tblr-primary)' }} />
                </button>
              ))}
              {filteredRefPickerItems.length === 0 && <p className="text-xs italic text-center py-6" style={{ color: 'var(--tblr-muted)' }}>{t('tender_detail_no_search_results')}</p>}
            </div>
          </div>
        </div>
      )}

      <ContactModal
        isOpen={isContactModalOpen}
        initialCategory={contactModalCategory}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={() => {
          fetchJson<Contact[]>('/api/contacts').then(setContacts).catch(console.error);
        }}
      />
    </div>
  );
}
