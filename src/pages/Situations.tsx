import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  IconPlus, IconTrash, IconEdit, IconCheck, IconX, IconDownload,
  IconCalculator, IconChevronDown, IconChevronRight, IconAlertTriangle,
  IconBuildingBank, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

// ── Types locaux ────────────────────────────────────────────────────────────

interface Marche {
  id: string;
  project_id: string;
  entreprise_nom: string;
  entreprise_siret?: string;
  lot_numero: string;
  lot_titre: string;
  montant_ht: number;
  tva_rate: number;
  date_os?: string;
  duree_mois?: number;
  avance_pct: number;
  avance_montant_ttc: number;
  avance_remboursee_cumul: number;
  retenue_garantie_pct: number;
  retenue_garantie_bancaire: boolean;
  retenue_garantie_bancaire_montant: number;
  revision_active: boolean;
  revision_formule: RevisionFormule;
  notes?: string;
  statut: string;
}

interface RevisionFormule {
  fixe: number;
  indices: RevisionIndice[];
}

interface RevisionIndice {
  code: string;
  label: string;
  poids: number;
  I0: number;
  In?: number;
}

interface SituationAvecMarche {
  id: string;
  project_id: string;
  numero_situation: number;
  date_situation: string;
  etat: 'Brouillon' | 'Validée' | 'Payée';
  marche_id?: string;
  date_reception_situation?: string;
  penalites_ht?: number;
  penalites_notes?: string;
  avance_remboursement?: number;
  revision_coeff?: number;
  revision_indices?: any;
  notes_moe?: string;
  marche?: Marche;
  chorus_pro_id?: string;
  chorus_pro_status?: string;
  buyer_siret?: string;
  buyer_service_code?: string;
  engagement_number?: string;
}

interface EnrichedItem {
  id: string;
  designation: string;
  unite: string;
  quantite_prevue: number;
  prix_unitaire_ht: number;
  montant_total: number;
  detail_id: string | null;
  avancement_n: number;
  avancement_n_moins_1: number;
  montant_cumul_n: number;
  montant_cumul_n_moins_1: number;
  montant_periode: number;
}

const f2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';

// ── Constantes indices BT/TP courants ───────────────────────────────────────
const INDICES_COURANTS: { code: string; label: string }[] = [
  { code: 'BT01', label: 'BT01 — Maçonnerie' },
  { code: 'BT02', label: 'BT02 — Charpente bois' },
  { code: 'BT03', label: 'BT03 — Charpente métallique' },
  { code: 'BT04', label: 'BT04 — Couverture' },
  { code: 'BT05', label: 'BT05 — Étanchéité' },
  { code: 'BT07', label: 'BT07 — Menuiseries' },
  { code: 'BT10', label: 'BT10 — Plâtrerie' },
  { code: 'BT11', label: 'BT11 — Carrelage faïence' },
  { code: 'BT12', label: 'BT12 — Peinture vitrerie' },
  { code: 'BT13', label: 'BT13 — Plomberie sanitaire' },
  { code: 'BT14', label: 'BT14 — Chauffage' },
  { code: 'BT15', label: 'BT15 — Électricité' },
  { code: 'BT28', label: 'BT28 — Gros œuvre' },
  { code: 'TP01', label: 'TP01 — Terrassement' },
  { code: 'TP02', label: 'TP02 — Canalisations' },
  { code: 'TP09', label: 'TP09 — Routes' },
];

// ── Composant principal ─────────────────────────────────────────────────────
export default function Situations({ projectId: propProjectId }: { projectId?: string }) {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const projectId = propProjectId || routeProjectId || '';

  const [tab, setTab] = useState<'marches' | 'situations' | 'etat'>('situations');
  const [marches, setMarches] = useState<Marche[]>([]);
  const [situations, setSituations] = useState<SituationAvecMarche[]>([]);
  const [selectedSit, setSelectedSit] = useState<SituationAvecMarche | null>(null);
  const [enrichedItems, setEnrichedItems] = useState<EnrichedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingItems, setSavingItems] = useState(false);

  // ── Formulaire marché ──────────────────────────────────────────────────────
  const emptyMarche = (): Partial<Marche> => ({
    entreprise_nom: '', lot_numero: '', lot_titre: '', montant_ht: 0,
    tva_rate: 20, avance_pct: 0, retenue_garantie_pct: 5,
    retenue_garantie_bancaire: false, revision_active: false,
    revision_formule: { fixe: 0.15, indices: [] }, statut: 'en_cours',
  });
  const [editingMarche, setEditingMarche] = useState<Partial<Marche> | null>(null);
  const [marcheForm, setMarcheForm] = useState<Partial<Marche>>(emptyMarche());

  // ── Formulaire situation ───────────────────────────────────────────────────
  const emptySit = () => ({ date_situation: new Date().toISOString().slice(0, 10), etat: 'Brouillon' as const, marche_id: '' });
  const [showNewSit, setShowNewSit] = useState(false);
  const [newSitForm, setNewSitForm] = useState(emptySit());
  const [savingSit, setSavingSit] = useState(false);

  // ── État d'acompte override ────────────────────────────────────────────────
  const [etatForm, setEtatForm] = useState({
    date_reception_situation: '',
    penalites_ht: 0,
    penalites_notes: '',
    avance_remboursement: 0,
    revision_coeff: 1,
    notes_moe: '',
  });
  const [savingEtat, setSavingEtat] = useState(false);

  // ── Chorus Pro (factures de travaux) ───────────────────────────────────────
  const [chorusProConnected, setChorusProConnected] = useState(false);
  const [projectClientSiret, setProjectClientSiret] = useState('');
  const [chorusProModalOpen, setChorusProModalOpen] = useState(false);
  const [chorusProForm, setChorusProForm] = useState({ buyer_siret: '', buyer_service_code: '', engagement_number: '' });
  const [sendingToChorusPro, setSendingToChorusPro] = useState(false);
  const [chorusProNotice, setChorusProNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    apiFetch<{ connected: boolean }>('/api/chorus-pro/status').then(s => setChorusProConnected(!!s.connected)).catch(() => {});
    if (!projectId) return;
    apiFetch<any[]>('/api/projects').then(projects => {
      setProjectClientSiret(projects.find(p => p.id === projectId)?.client_siret || '');
    }).catch(() => {});
  }, [projectId]);

  const openChorusProModal = () => {
    if (!selectedSit) return;
    setChorusProNotice(null);
    setChorusProForm({
      buyer_siret: selectedSit.buyer_siret || projectClientSiret || '',
      buyer_service_code: selectedSit.buyer_service_code || '',
      engagement_number: selectedSit.engagement_number || '',
    });
    setChorusProModalOpen(true);
  };

  const handleSendToChorusPro = async () => {
    if (!selectedSit) return;
    setSendingToChorusPro(true);
    try {
      const res = await apiFetch<{ success: boolean; chorus_pro_id?: string; status?: string; error?: string }>(
        `/api/chorus-pro/send-situation/${selectedSit.id}`,
        { method: 'POST', body: JSON.stringify(chorusProForm) }
      );
      if (res.success) {
        const updatedSit = { ...selectedSit, chorus_pro_id: res.chorus_pro_id, chorus_pro_status: res.status, ...chorusProForm };
        setSelectedSit(updatedSit);
        setSituations(prev => prev.map(s => s.id === selectedSit.id ? updatedSit : s));
        setChorusProNotice({ type: 'success', message: `Situation déposée sur Chorus Pro (ID: ${res.chorus_pro_id}).` });
        setChorusProModalOpen(false);
      } else {
        setChorusProNotice({ type: 'error', message: res.error || 'Envoi échoué.' });
      }
    } catch (e: any) {
      setChorusProNotice({ type: 'error', message: e.message });
    } finally {
      setSendingToChorusPro(false);
    }
  };

  // ── Chargement marchés ─────────────────────────────────────────────────────
  const loadMarches = useCallback(async () => {
    if (!projectId) return;
    const data = await apiFetch<Marche[]>(`/api/marches-entreprises/${projectId}`);
    setMarches(data ?? []);
  }, [projectId]);

  // ── Chargement situations ──────────────────────────────────────────────────
  const loadSituations = useCallback(async () => {
    if (!projectId) return;
    const data = await apiFetch<SituationAvecMarche[]>(`/api/situations/${projectId}/avec-marche`);
    setSituations(data ?? []);
  }, [projectId]);

  useEffect(() => {
    loadMarches();
    loadSituations();
  }, [loadMarches, loadSituations]);

  // ── Chargement détails enrichis quand on change de situation ──────────────
  useEffect(() => {
    if (!selectedSit) { setEnrichedItems([]); return; }
    setLoadingItems(true);
    apiFetch<{ situation: any; items: EnrichedItem[] }>(`/api/situations/${selectedSit.id}/details-enhanced`)
      .then(r => setEnrichedItems(r?.items ?? []))
      .catch(() => setEnrichedItems([]))
      .finally(() => setLoadingItems(false));
    // Préremplir le form état d'acompte
    setEtatForm({
      date_reception_situation: selectedSit.date_reception_situation?.slice(0, 10) ?? '',
      penalites_ht: selectedSit.penalites_ht ?? 0,
      penalites_notes: selectedSit.penalites_notes ?? '',
      avance_remboursement: selectedSit.avance_remboursement ?? 0,
      revision_coeff: selectedSit.revision_coeff ?? 1,
      notes_moe: selectedSit.notes_moe ?? '',
    });
  }, [selectedSit?.id]);

  // ── Calcul état d'acompte ──────────────────────────────────────────────────
  const marche = selectedSit?.marche;
  const montantHT = enrichedItems.reduce((s, i) => s + i.montant_periode, 0);
  const revisionMontant = marche?.revision_active ? montantHT * (etatForm.revision_coeff - 1) : 0;
  const htRevise = montantHT + revisionMontant;
  const tvaRate = Number(marche?.tva_rate ?? 20) / 100;
  const tva = htRevise * tvaRate;
  const ttc = htRevise + tva;
  const retenue = marche?.retenue_garantie_bancaire ? 0 : (Number(marche?.retenue_garantie_pct ?? 5) / 100 * ttc);
  const net = ttc - retenue - etatForm.avance_remboursement - etatForm.penalites_ht;

  // ── Sauvegarde des détails de décompte ────────────────────────────────────
  const handleSaveItems = async () => {
    if (!selectedSit) return;
    setSavingItems(true);
    try {
      await apiFetch(`/api/situations/${selectedSit.id}/detail-bulk`, {
        method: 'POST',
        body: JSON.stringify({
          items: enrichedItems.map(i => ({
            dpgf_item_id: i.id,
            pourcentage_avancement: i.avancement_n,
            montant_periode: i.montant_periode,
          })),
        }),
      });
      await loadSituations();
    } finally { setSavingItems(false); }
  };

  // ── Sauvegarde état d'acompte ─────────────────────────────────────────────
  const handleSaveEtat = async () => {
    if (!selectedSit) return;
    setSavingEtat(true);
    try {
      const updated = await apiFetch<SituationAvecMarche>(`/api/situations/${selectedSit.id}/etat-acompte`, {
        method: 'PUT',
        body: JSON.stringify({ ...etatForm, marche_id: selectedSit.marche_id }),
      });
      setSelectedSit(s => s ? { ...s, ...updated } : s);
      await loadSituations();
    } finally { setSavingEtat(false); }
  };

  // ── Créer une nouvelle situation ──────────────────────────────────────────
  const handleCreateSit = async () => {
    setSavingSit(true);
    try {
      const res = await apiFetch<SituationAvecMarche>('/api/situations', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...newSitForm }),
      });
      setShowNewSit(false);
      setNewSitForm(emptySit());
      await loadSituations();
      setSelectedSit(res);
      setTab('situations');
    } finally { setSavingSit(false); }
  };

  // ── Supprimer une situation ───────────────────────────────────────────────
  const handleDeleteSit = async (id: string) => {
    if (!confirm('Supprimer cette situation ?')) return;
    await apiFetch(`/api/situations/${id}`, { method: 'DELETE' });
    if (selectedSit?.id === id) setSelectedSit(null);
    await loadSituations();
  };

  // ── Changer statut situation ──────────────────────────────────────────────
  const handleChangeEtat = async (sit: SituationAvecMarche, etat: SituationAvecMarche['etat']) => {
    await apiFetch(`/api/situations/${sit.id}/etat-acompte`, {
      method: 'PUT',
      body: JSON.stringify({ etat }),
    });
    await loadSituations();
    if (selectedSit?.id === sit.id) setSelectedSit(s => s ? { ...s, etat } : s);
  };

  // ── CRUD marchés ──────────────────────────────────────────────────────────
  const handleSaveMarche = async () => {
    if (editingMarche?.id) {
      await apiFetch(`/api/marches-entreprises/${editingMarche.id}`, {
        method: 'PUT',
        body: JSON.stringify(marcheForm),
      });
    } else {
      await apiFetch('/api/marches-entreprises', {
        method: 'POST',
        body: JSON.stringify({ ...marcheForm, project_id: projectId }),
      });
    }
    setEditingMarche(null);
    setMarcheForm(emptyMarche());
    await loadMarches();
  };

  const handleDeleteMarche = async (id: string) => {
    if (!confirm('Supprimer ce marché ?')) return;
    await apiFetch(`/api/marches-entreprises/${id}`, { method: 'DELETE' });
    await loadMarches();
  };

  // ── Télécharger PDF état d'acompte ───────────────────────────────────────
  const handleDownloadPdf = () => {
    if (!selectedSit) return;
    window.open(`/api/situations/${selectedSit.id}/etat-acompte-pdf`, '_blank');
  };

  const statColor = (e: string) =>
    e === 'Payée' ? 'bg-green-100 text-green-800' : e === 'Validée' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600';

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Onglets principaux */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
        {(['marches', 'situations', 'etat'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-[var(--tblr-primary)] text-[var(--tblr-primary)]'
                : 'border-transparent text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]'
            }`}
          >
            {t === 'marches' ? 'Marchés entreprises' : t === 'situations' ? 'Projet de décompte' : "État d'acompte"}
          </button>
        ))}
      </div>

      {/* ── Tab Marchés ─────────────────────────────────────────────────── */}
      {tab === 'marches' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Marchés des entreprises</h2>
            <button
              onClick={() => { setEditingMarche({}); setMarcheForm(emptyMarche()); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-white"
              style={{ background: 'var(--tblr-primary)' }}
            >
              <IconPlus size={14} /> Nouveau marché
            </button>
          </div>

          {/* Liste marchés */}
          <div className="space-y-3">
            {marches.length === 0 && (
              <p className="text-sm text-[var(--tblr-muted)] py-4 text-center">Aucun marché enregistré</p>
            )}
            {marches.map(m => (
              <div key={m.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm">{m.entreprise_nom}</p>
                    <p className="text-xs text-[var(--tblr-muted)]">Lot {m.lot_numero} — {m.lot_titre}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm">{f2(m.montant_ht)} € HT</p>
                    <button onClick={() => { setEditingMarche(m); setMarcheForm({ ...m }); }} className="p-1 rounded hover:bg-[var(--tblr-surface-2)]"><IconEdit size={14} /></button>
                    <button onClick={() => handleDeleteMarche(m.id)} className="p-1 rounded hover:bg-red-50 text-red-500"><IconTrash size={14} /></button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--tblr-muted)]">
                  <span>TVA : {m.tva_rate} %</span>
                  <span>Avance : {m.avance_pct} %</span>
                  <span>Retenue : {m.retenue_garantie_pct} %{m.retenue_garantie_bancaire ? ' (garantie bancaire)' : ''}</span>
                  {m.revision_active && <span className="text-blue-600 font-medium">Révision active — a={m.revision_formule?.fixe}, {m.revision_formule?.indices?.length ?? 0} indice(s)</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Formulaire marché (drawer inline) */}
          {editingMarche !== null && (
            <MarcheForm
              form={marcheForm}
              setForm={setMarcheForm}
              onSave={handleSaveMarche}
              onCancel={() => setEditingMarche(null)}
              isEdit={!!editingMarche.id}
            />
          )}
        </div>
      )}

      {/* ── Tab Situations / Projet de décompte ──────────────────────────── */}
      {tab === 'situations' && (
        <div className="flex gap-4">
          {/* Liste situations */}
          <div className="w-64 shrink-0 space-y-1">
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs font-semibold text-[var(--tblr-muted)] uppercase tracking-wide">Situations</p>
              <button onClick={() => setShowNewSit(true)} className="p-1 rounded hover:bg-[var(--tblr-surface-2)]" title="Nouvelle situation"><IconPlus size={14} /></button>
            </div>
            {situations.map(s => (
              <div
                key={s.id}
                onClick={() => setSelectedSit(s)}
                className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm transition-colors ${
                  selectedSit?.id === s.id ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]' : 'hover:bg-[var(--tblr-surface-2)]'
                }`}
              >
                <div>
                  <p className="font-medium">Sit. n°{s.numero_situation}</p>
                  <p className="text-xs text-[var(--tblr-muted)]">{new Date(s.date_situation).toLocaleDateString('fr-FR')}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statColor(s.etat)}`}>{s.etat}</span>
                  <button onClick={e => { e.stopPropagation(); handleDeleteSit(s.id); }} className="p-0.5 rounded hover:bg-red-50 text-red-400 opacity-0 group-hover:opacity-100"><IconTrash size={12} /></button>
                </div>
              </div>
            ))}
            {situations.length === 0 && <p className="text-xs text-[var(--tblr-muted)] text-center py-4">Aucune situation</p>}
          </div>

          {/* Détail situation */}
          <div className="flex-1">
            {!selectedSit ? (
              <p className="text-sm text-[var(--tblr-muted)] mt-8 text-center">Sélectionnez une situation</p>
            ) : (
              <div className="space-y-4">
                {/* En-tête */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">Situation n°{selectedSit.numero_situation}</h3>
                    <p className="text-xs text-[var(--tblr-muted)]">
                      {new Date(selectedSit.date_situation).toLocaleDateString('fr-FR')}
                      {selectedSit.marche && ` · ${selectedSit.marche.entreprise_nom} — Lot ${selectedSit.marche.lot_numero}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Statut rapide */}
                    <select
                      value={selectedSit.etat}
                      onChange={e => handleChangeEtat(selectedSit, e.target.value as any)}
                      className="text-xs border rounded px-2 py-1"
                      style={{ borderColor: 'var(--tblr-border)' }}
                    >
                      <option value="Brouillon">Brouillon</option>
                      <option value="Validée">Validée</option>
                      <option value="Payée">Payée</option>
                    </select>
                    {/* Sélectionner le marché */}
                    <select
                      value={selectedSit.marche_id ?? ''}
                      onChange={async e => {
                        await apiFetch(`/api/situations/${selectedSit.id}/etat-acompte`, {
                          method: 'PUT',
                          body: JSON.stringify({ marche_id: e.target.value || null }),
                        });
                        await loadSituations();
                        const updated = situations.find(s => s.id === selectedSit.id);
                        if (updated) setSelectedSit({ ...updated, marche_id: e.target.value || undefined });
                      }}
                      className="text-xs border rounded px-2 py-1"
                      style={{ borderColor: 'var(--tblr-border)' }}
                    >
                      <option value="">— Lier à un marché —</option>
                      {marches.map(m => <option key={m.id} value={m.id}>{m.entreprise_nom} — Lot {m.lot_numero}</option>)}
                    </select>
                  </div>
                </div>

                {/* Tableau projet de décompte (REF20A) */}
                {loadingItems ? (
                  <p className="text-sm text-[var(--tblr-muted)]">Chargement…</p>
                ) : enrichedItems.length === 0 ? (
                  <p className="text-sm text-[var(--tblr-muted)] text-center py-6">Aucun poste DPGF — ajoutez des items dans le DPGF du projet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-[var(--tblr-muted)] border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                          <th className="text-left py-2 pr-2 font-medium">Désignation</th>
                          <th className="text-right py-2 px-2 font-medium w-24">Montant total HT</th>
                          <th className="text-right py-2 px-2 font-medium w-20">Av. N-1 %</th>
                          <th className="text-right py-2 px-2 font-medium w-20">Av. N %</th>
                          <th className="text-right py-2 px-2 font-medium w-28">Montant période HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrichedItems.map((item, idx) => (
                          <tr key={item.id} className={idx % 2 === 0 ? 'bg-[var(--tblr-surface)]' : 'bg-[var(--tblr-surface-2)]'}>
                            <td className="py-1.5 pr-2 text-xs">{item.designation}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{f2(item.montant_total)} €</td>
                            <td className="text-right py-1.5 px-2 text-[var(--tblr-muted)]">{item.avancement_n_moins_1} %</td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={item.avancement_n}
                                onChange={e => {
                                  const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                                  setEnrichedItems(prev => prev.map(i => {
                                    if (i.id !== item.id) return i;
                                    const cumN = i.montant_total * val / 100;
                                    return { ...i, avancement_n: val, montant_cumul_n: cumN, montant_periode: cumN - i.montant_cumul_n_moins_1 };
                                  }));
                                }}
                                className="w-16 text-right text-xs border rounded px-1 py-0.5 tabular-nums"
                                style={{ borderColor: 'var(--tblr-border)' }}
                              />
                            </td>
                            <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${item.montant_periode < 0 ? 'text-red-600' : ''}`}>
                              {f2(item.montant_periode)} €
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-semibold" style={{ borderColor: 'var(--tblr-border)' }}>
                          <td className="py-2 pr-2 text-xs">TOTAL PÉRIODE HT</td>
                          <td />
                          <td />
                          <td />
                          <td className="text-right py-2 px-2 tabular-nums">{f2(montantHT)} €</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Bouton sauvegarder décompte */}
                {enrichedItems.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveItems}
                      disabled={savingItems}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-60"
                      style={{ background: 'var(--tblr-primary)' }}
                    >
                      <IconCheck size={14} /> {savingItems ? 'Enregistrement…' : 'Enregistrer le décompte'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab État d'acompte ────────────────────────────────────────────── */}
      {tab === 'etat' && (
        <div className="flex gap-4">
          {/* Liste situations (même colonne gauche) */}
          <div className="w-64 shrink-0 space-y-1">
            <p className="text-xs font-semibold text-[var(--tblr-muted)] uppercase tracking-wide mb-2">Situations</p>
            {situations.map(s => (
              <div
                key={s.id}
                onClick={() => setSelectedSit(s)}
                className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm transition-colors ${
                  selectedSit?.id === s.id ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]' : 'hover:bg-[var(--tblr-surface-2)]'
                }`}
              >
                <div>
                  <p className="font-medium">Sit. n°{s.numero_situation}</p>
                  <p className="text-xs text-[var(--tblr-muted)]">{new Date(s.date_situation).toLocaleDateString('fr-FR')}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statColor(s.etat)}`}>{s.etat}</span>
              </div>
            ))}
          </div>

          {/* Panneau état d'acompte */}
          <div className="flex-1">
            {!selectedSit ? (
              <p className="text-sm text-[var(--tblr-muted)] mt-8 text-center">Sélectionnez une situation</p>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">État d'acompte n°{selectedSit.numero_situation}</h3>
                    {selectedSit.chorus_pro_id && selectedSit.chorus_pro_status && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider" style={{ background: '#e0e7ff', color: '#4338ca' }}>
                        Chorus Pro : {selectedSit.chorus_pro_status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {chorusProConnected && (
                      <button
                        onClick={openChorusProModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-white"
                        style={{ background: '#4338ca' }}
                        title={selectedSit.chorus_pro_id ? `Re-envoyer à Chorus Pro (${selectedSit.chorus_pro_status})` : 'Envoyer à Chorus Pro'}
                      >
                        <IconBuildingBank size={14} /> Envoyer à Chorus Pro
                      </button>
                    )}
                    <button
                      onClick={handleDownloadPdf}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border"
                      style={{ borderColor: 'var(--tblr-border)' }}
                    >
                      <IconDownload size={14} /> Export PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Récapitulatif financier */}
                  <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}>
                    <p className="text-xs font-semibold text-[var(--tblr-muted)] uppercase tracking-wide mb-3">Récapitulatif</p>
                    <EtatLine label="Décompte mensuel HT" value={montantHT} />
                    {marche?.revision_active && (
                      <>
                        <EtatLine label={`Révision des prix (Cn = ${etatForm.revision_coeff.toFixed(6)})`} value={revisionMontant} sign />
                        <EtatLine label="Total HT révisé" value={htRevise} bold />
                      </>
                    )}
                    <EtatLine label={`TVA ${marche?.tva_rate ?? 20} %`} value={tva} sign prefix="+" />
                    <div className="border-t pt-2" style={{ borderColor: 'var(--tblr-border)' }}>
                      <EtatLine label="TOTAL TTC" value={ttc} bold />
                    </div>
                    <div className="border-t pt-2" style={{ borderColor: 'var(--tblr-border)' }}>
                      <EtatLine label={`Retenue de garantie ${marche?.retenue_garantie_pct ?? 5} %${marche?.retenue_garantie_bancaire ? ' (bancaire)' : ''}`} value={-retenue} sign />
                      {etatForm.avance_remboursement > 0 && <EtatLine label="Remboursement avance" value={-etatForm.avance_remboursement} sign />}
                      {etatForm.penalites_ht > 0 && <EtatLine label="Pénalités de retard" value={-etatForm.penalites_ht} sign />}
                    </div>
                    <div className="border-t-2 pt-2" style={{ borderColor: 'var(--tblr-border)' }}>
                      <EtatLine label="NET À PAYER TTC" value={net} bold large />
                    </div>
                  </div>

                  {/* Paramètres */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-[var(--tblr-muted)] uppercase tracking-wide">Paramètres</p>
                    <Field label="Date réception situation">
                      <input type="date" value={etatForm.date_reception_situation}
                        onChange={e => setEtatForm(f => ({ ...f, date_reception_situation: e.target.value }))}
                        className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
                    </Field>
                    {marche?.revision_active && (
                      <Field label={`Coefficient révision Cn (formule : a=${marche.revision_formule?.fixe})`}>
                        <input type="number" step="0.000001" value={etatForm.revision_coeff}
                          onChange={e => setEtatForm(f => ({ ...f, revision_coeff: parseFloat(e.target.value) || 1 }))}
                          className="w-full text-sm border rounded px-2 py-1.5 tabular-nums" style={{ borderColor: 'var(--tblr-border)' }} />
                        <p className="text-[10px] text-[var(--tblr-muted)] mt-0.5">
                          Cn = {marche.revision_formule?.fixe} + Σ(poids × In/I0) — voir indices INSEE BT/TP
                        </p>
                      </Field>
                    )}
                    <Field label="Pénalités de retard HT (€)">
                      <input type="number" min={0} step={0.01} value={etatForm.penalites_ht}
                        onChange={e => setEtatForm(f => ({ ...f, penalites_ht: parseFloat(e.target.value) || 0 }))}
                        className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
                    </Field>
                    <Field label="Motif pénalités">
                      <input type="text" value={etatForm.penalites_notes}
                        onChange={e => setEtatForm(f => ({ ...f, penalites_notes: e.target.value }))}
                        className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
                    </Field>
                    <Field label="Remboursement avance (€ TTC)">
                      <input type="number" min={0} step={0.01} value={etatForm.avance_remboursement}
                        onChange={e => setEtatForm(f => ({ ...f, avance_remboursement: parseFloat(e.target.value) || 0 }))}
                        className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
                    </Field>
                    <Field label="Notes MOE">
                      <textarea value={etatForm.notes_moe} rows={3}
                        onChange={e => setEtatForm(f => ({ ...f, notes_moe: e.target.value }))}
                        className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
                    </Field>
                    <button
                      onClick={handleSaveEtat}
                      disabled={savingEtat}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-60"
                      style={{ background: 'var(--tblr-primary)' }}
                    >
                      <IconCheck size={14} /> {savingEtat ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>

                {/* Révision — aide indices */}
                {marche?.revision_active && marche.revision_formule?.indices?.length > 0 && (
                  <div className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                    <p className="font-medium mb-2">Formule de révision — indices de la période</p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-[var(--tblr-muted)]">
                          <th className="text-left py-1">Indice</th>
                          <th className="text-right py-1">Poids</th>
                          <th className="text-right py-1">I0</th>
                          <th className="text-right py-1">In</th>
                          <th className="text-right py-1">In/I0</th>
                          <th className="text-right py-1">Contribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marche.revision_formule.indices.map((ind, i) => {
                          const ratio = ind.In && ind.I0 ? ind.In / ind.I0 : 1;
                          return (
                            <tr key={i}>
                              <td className="py-0.5">{ind.code} — {ind.label}</td>
                              <td className="text-right py-0.5 tabular-nums">{ind.poids}</td>
                              <td className="text-right py-0.5 tabular-nums">{ind.I0}</td>
                              <td className="text-right py-0.5 tabular-nums">{ind.In ?? '—'}</td>
                              <td className="text-right py-0.5 tabular-nums">{ind.I0 && ind.In ? (ind.In / ind.I0).toFixed(4) : '—'}</td>
                              <td className="text-right py-0.5 tabular-nums">{ind.I0 && ind.In ? (ind.poids * ratio).toFixed(4) : '—'}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t font-semibold" style={{ borderColor: 'var(--tblr-border)' }}>
                          <td className="py-1" colSpan={5}>Cn = {marche.revision_formule.fixe} + Σ contributions</td>
                          <td className="text-right py-1 tabular-nums">{etatForm.revision_coeff.toFixed(6)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal nouvelle situation ──────────────────────────────────────── */}
      {showNewSit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="font-semibold text-base">Nouvelle situation</h3>
            <Field label="Date">
              <input type="date" value={newSitForm.date_situation}
                onChange={e => setNewSitForm(f => ({ ...f, date_situation: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }} />
            </Field>
            <Field label="Marché lié">
              <select value={newSitForm.marche_id}
                onChange={e => setNewSitForm(f => ({ ...f, marche_id: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5" style={{ borderColor: 'var(--tblr-border)' }}>
                <option value="">— Aucun —</option>
                {marches.map(m => <option key={m.id} value={m.id}>{m.entreprise_nom} — Lot {m.lot_numero}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewSit(false)} className="px-3 py-1.5 text-sm rounded border" style={{ borderColor: 'var(--tblr-border)' }}>Annuler</button>
              <button onClick={handleCreateSit} disabled={savingSit} className="px-3 py-1.5 text-sm rounded text-white font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)' }}>
                {savingSit ? '…' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal envoi Chorus Pro ──────────────────────────────────────────── */}
      {chorusProModalOpen && selectedSit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-6 w-[26rem] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base flex items-center gap-2"><IconBuildingBank size={18} style={{ color: '#4338ca' }} /> Envoyer à Chorus Pro</h3>
              <button onClick={() => setChorusProModalOpen(false)}><IconX size={18} /></button>
            </div>
            <p className="text-xs text-[var(--tblr-muted)]">
              Situation n°{selectedSit.numero_situation}{selectedSit.marche && ` — ${selectedSit.marche.entreprise_nom} (lot ${selectedSit.marche.lot_numero})`}.
              {!selectedSit.marche?.entreprise_siret && (
                <span className="block mt-1 text-red-600">Le SIRET de l'entreprise n'est pas renseigné sur le marché lié — ajoutez-le dans l'onglet Marchés avant l'envoi.</span>
              )}
            </p>
            <Field label="SIRET du destinataire (structure publique) *">
              <input value={chorusProForm.buyer_siret}
                onChange={e => setChorusProForm(f => ({ ...f, buyer_siret: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5 font-mono" style={{ borderColor: 'var(--tblr-border)' }}
                placeholder="14 chiffres" />
            </Field>
            <Field label="Code du service exécutant">
              <input value={chorusProForm.buyer_service_code}
                onChange={e => setChorusProForm(f => ({ ...f, buyer_service_code: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5 font-mono" style={{ borderColor: 'var(--tblr-border)' }}
                placeholder="Optionnel" />
            </Field>
            <Field label="Numéro d'engagement / de marché">
              <input value={chorusProForm.engagement_number}
                onChange={e => setChorusProForm(f => ({ ...f, engagement_number: e.target.value }))}
                className="w-full text-sm border rounded px-2 py-1.5 font-mono" style={{ borderColor: 'var(--tblr-border)' }}
                placeholder="Optionnel selon la structure" />
            </Field>
            {chorusProNotice && (
              <div className="text-sm p-3 rounded-lg" style={chorusProNotice.type === 'success' ? { background: '#d3f9d8', color: '#2f9e44' } : { background: '#ffe3e3', color: '#c92a2a' }}>
                {chorusProNotice.message}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setChorusProModalOpen(false)} className="px-3 py-1.5 text-sm rounded border" style={{ borderColor: 'var(--tblr-border)' }}>Annuler</button>
              <button
                onClick={handleSendToChorusPro}
                disabled={sendingToChorusPro || !chorusProForm.buyer_siret || !selectedSit.marche?.entreprise_siret}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded text-white font-medium disabled:opacity-60"
                style={{ background: '#4338ca' }}
              >
                {sendingToChorusPro ? <IconLoader2 size={14} className="animate-spin" /> : <IconBuildingBank size={14} />}
                {sendingToChorusPro ? 'Envoi…' : 'Déposer sur Chorus Pro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composant MarcheForm ────────────────────────────────────────────────────
function MarcheForm({
  form, setForm, onSave, onCancel, isEdit,
}: {
  form: Partial<Marche>;
  setForm: (f: Partial<Marche>) => void;
  onSave: () => void;
  onCancel: () => void;
  isEdit: boolean;
}) {
  const rf = form.revision_formule ?? { fixe: 0.15, indices: [] };

  const addIndice = () => {
    setForm({ ...form, revision_formule: { ...rf, indices: [...rf.indices, { code: '', label: '', poids: 0, I0: 100 }] } });
  };
  const removeIndice = (i: number) => {
    setForm({ ...form, revision_formule: { ...rf, indices: rf.indices.filter((_, j) => j !== i) } });
  };
  const updateIndice = (i: number, field: keyof RevisionIndice, value: any) => {
    const updated = rf.indices.map((ind, j) => j === i ? { ...ind, [field]: value } : ind);
    setForm({ ...form, revision_formule: { ...rf, indices: updated } });
  };

  // Vérification : fixe + Σpoids ≈ 1
  const somme = rf.fixe + rf.indices.reduce((s, ind) => s + Number(ind.poids), 0);
  const formulaOk = Math.abs(somme - 1) < 0.001;

  return (
    <div className="rounded-xl border p-5 space-y-4 mt-4" style={{ borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}>
      <h3 className="font-semibold text-sm">{isEdit ? 'Modifier le marché' : 'Nouveau marché'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entreprise *">
          <input value={form.entreprise_nom ?? ''} onChange={e => setForm({ ...form, entreprise_nom: e.target.value })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="SIRET entreprise (requis pour Chorus Pro)">
          <input value={form.entreprise_siret ?? ''} onChange={e => setForm({ ...form, entreprise_siret: e.target.value })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white font-mono" style={{ borderColor: 'var(--tblr-border)' }} placeholder="14 chiffres" />
        </Field>
        <Field label="Lot n°">
          <input value={form.lot_numero ?? ''} onChange={e => setForm({ ...form, lot_numero: e.target.value })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="Titre du lot">
          <input value={form.lot_titre ?? ''} onChange={e => setForm({ ...form, lot_titre: e.target.value })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="Montant marché HT (€)">
          <input type="number" step={0.01} value={form.montant_ht ?? 0} onChange={e => setForm({ ...form, montant_ht: parseFloat(e.target.value) || 0 })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="TVA (%)">
          <input type="number" step={0.1} value={form.tva_rate ?? 20} onChange={e => setForm({ ...form, tva_rate: parseFloat(e.target.value) || 20 })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="Avance (%)">
          <input type="number" step={0.1} min={0} max={30} value={form.avance_pct ?? 0} onChange={e => setForm({ ...form, avance_pct: parseFloat(e.target.value) || 0 })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <Field label="Retenue de garantie (%)">
          <input type="number" step={0.1} min={0} max={5} value={form.retenue_garantie_pct ?? 5} onChange={e => setForm({ ...form, retenue_garantie_pct: parseFloat(e.target.value) || 5 })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white" style={{ borderColor: 'var(--tblr-border)' }} />
        </Field>
        <div className="flex items-center gap-2 mt-1">
          <input type="checkbox" id="rg-banc" checked={!!form.retenue_garantie_bancaire} onChange={e => setForm({ ...form, retenue_garantie_bancaire: e.target.checked })} />
          <label htmlFor="rg-banc" className="text-sm">Garantie bancaire (dispense retenue)</label>
        </div>
      </div>

      {/* Révision des prix */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="rev-active" checked={!!form.revision_active} onChange={e => setForm({ ...form, revision_active: e.target.checked })} />
          <label htmlFor="rev-active" className="text-sm font-medium">Révision des prix (formule INSEE BT/TP)</label>
        </div>
        {form.revision_active && (
          <div className="space-y-2 pl-4">
            <Field label={`Partie fixe a₀ (total formule = 1, actuel: ${somme.toFixed(3)})`}>
              <input type="number" step={0.01} min={0} max={1} value={rf.fixe} onChange={e => setForm({ ...form, revision_formule: { ...rf, fixe: parseFloat(e.target.value) || 0 } })}
                className={`w-full text-sm border rounded px-2 py-1.5 bg-white ${!formulaOk ? 'border-red-400' : ''}`} style={formulaOk ? { borderColor: 'var(--tblr-border)' } : {}} />
              {!formulaOk && <p className="text-[10px] text-red-600 mt-0.5">⚠ a₀ + Σ poids doit être égal à 1 (actuel : {somme.toFixed(3)})</p>}
            </Field>
            <div className="space-y-2">
              {rf.indices.map((ind, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={ind.code} onChange={e => {
                    const found = INDICES_COURANTS.find(ic => ic.code === e.target.value);
                    updateIndice(i, 'code', e.target.value);
                    if (found) updateIndice(i, 'label', found.label.split(' — ')[1]);
                  }} className="text-xs border rounded px-1 py-1 bg-white flex-1" style={{ borderColor: 'var(--tblr-border)' }}>
                    <option value="">— Indice —</option>
                    {INDICES_COURANTS.map(ic => <option key={ic.code} value={ic.code}>{ic.label}</option>)}
                  </select>
                  <input type="number" step={0.01} min={0} max={1} placeholder="Poids" value={ind.poids}
                    onChange={e => updateIndice(i, 'poids', parseFloat(e.target.value) || 0)}
                    className="w-20 text-xs border rounded px-1 py-1 bg-white tabular-nums" style={{ borderColor: 'var(--tblr-border)' }} />
                  <input type="number" step={0.1} placeholder="I0" value={ind.I0}
                    onChange={e => updateIndice(i, 'I0', parseFloat(e.target.value) || 100)}
                    className="w-20 text-xs border rounded px-1 py-1 bg-white tabular-nums" style={{ borderColor: 'var(--tblr-border)' }} />
                  <button onClick={() => removeIndice(i)} className="text-red-400 hover:text-red-600"><IconTrash size={13} /></button>
                </div>
              ))}
              <button onClick={addIndice} className="text-xs text-[var(--tblr-primary)] flex items-center gap-1 hover:underline">
                <IconPlus size={12} /> Ajouter un indice
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border bg-white" style={{ borderColor: 'var(--tblr-border)' }}>Annuler</button>
        <button onClick={onSave} className="px-3 py-1.5 text-sm rounded text-white font-medium" style={{ background: 'var(--tblr-primary)' }}>
          {isEdit ? 'Mettre à jour' : 'Créer le marché'}
        </button>
      </div>
    </div>
  );
}

// ── Helpers UI ───────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <label className="block text-xs text-[var(--tblr-muted)] mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function EtatLine({ label, value, bold, large, sign, prefix }: {
  label: string; value: number; bold?: boolean; large?: boolean; sign?: boolean; prefix?: string;
}) {
  const display = `${prefix ?? (sign && value < 0 ? '− ' : sign && value >= 0 ? '+ ' : '')}${f2(Math.abs(value))} €`;
  return (
    <div className={`flex justify-between items-center text-xs ${bold ? 'font-semibold' : ''} ${large ? 'text-sm' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0 && sign ? 'text-red-600' : ''}`}>{display}</span>
    </div>
  );
}
