import React, { useState, useEffect, useCallback } from 'react';
import {
  IconPlus, IconX, IconCheck, IconClock, IconSend, IconBan,
  IconFileText, IconTrash, IconPencil, IconDownload, IconFilter,
  IconContract, IconCurrencyEuro, IconBuildingSkyscraper, IconUsers,
  IconAlertTriangle, IconFileImport,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { fetchJson, apiFetch } from '../lib/api';
import type { ContratMOE, ContratMOEMission, ContratCotraitant, ContratSousTraitant, Contact, Project } from '../types';
import { useTranslation } from 'react-i18next';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn } from '../lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_CONTRAT_LABELS: Record<string, string> = {
  construction_neuve: 'Construction neuve',
  rehabilitation: 'Réhabilitation / Rénovation',
  concours: "Concours d'architecture",
  amo: 'Mission AMO',
  diagnostic: 'Diagnostic / Audit',
  urbanisme: 'Urbanisme / PLU',
};

const TYPE_MOA_LABELS: Record<string, string> = {
  prive: 'Maître d\'ouvrage privé',
  public: 'Maître d\'ouvrage public',
  copropriete: 'Copropriété',
};

const STATUS_CONFIG = {
  Brouillon: { label: 'Brouillon', bg: '#f1f3f6', color: '#6c7a91', icon: IconClock },
  Envoyé:    { label: 'Envoyé',    bg: '#e8f0fb', color: '#206bc4', icon: IconSend },
  Signé:     { label: 'Signé',     bg: '#d3f9d8', color: '#2f9e44', icon: IconCheck },
  Résilié:   { label: 'Résilié',   bg: '#ffe3e3', color: '#d63939', icon: IconBan },
} as const;

const INDICES_REVISION = ['BT01', 'BT02', 'BT50', 'Ingénierie BT', 'ICC', 'IRL'];

const DEFAULT_MISSIONS: ContratMOEMission[] = [
  { id: 'esquisse',  name: 'Esquisse (ESQ)',           pct: 10, incluse: true },
  { id: 'aps',       name: 'Avant-Projet Sommaire (APS)', pct: 12, incluse: true },
  { id: 'apd',       name: 'Avant-Projet Détaillé (APD)', pct: 14, incluse: true },
  { id: 'pro',       name: 'Projet (PRO)',              pct: 18, incluse: true },
  { id: 'act',       name: 'Assistance Contrats de Travaux (ACT)', pct: 7, incluse: true },
  { id: 'visa',      name: 'Visa',                     pct: 7,  incluse: true },
  { id: 'det',       name: 'Direction de l\'Exécution des Travaux (DET)', pct: 25, incluse: true },
  { id: 'aor',       name: 'Assistance aux Opérations de Réception (AOR)', pct: 7, incluse: true },
  { id: 'opc',       name: 'OPC',                      pct: 0,  incluse: false },
  { id: 'diag',      name: 'Diagnostic',               pct: 0,  incluse: false },
];

const inputCls = 'w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm';
const inputStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider mb-1';
const labelStyle: React.CSSProperties = { color: 'var(--tblr-muted)' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n?: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.Brouillon;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ── PDF Generation ───────────────────────────────────────────────────────────

function generateContratPdf(contrat: ContratMOE, agencyName?: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 20;

  // Header
  doc.setFillColor(32, 107, 196);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text('CONTRAT DE MAÎTRISE D\'ŒUVRE', margin, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  if (contrat.numero) doc.text(`Réf. : ${contrat.numero}`, margin, 21);
  doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, W - margin, 21, { align: 'right' });

  // Type badge
  doc.setFillColor(245, 247, 251);
  doc.rect(0, 30, W, 12, 'F');
  doc.setTextColor(100, 120, 150);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(TYPE_CONTRAT_LABELS[contrat.type_contrat] ?? contrat.type_contrat, margin, 38);
  doc.text(TYPE_MOA_LABELS[contrat.type_moa] ?? contrat.type_moa, W / 2, 38, { align: 'center' });

  let y = 50;

  const sectionTitle = (title: string) => {
    doc.setFillColor(240, 245, 255);
    doc.rect(margin, y, W - 2 * margin, 7, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(32, 107, 196);
    doc.text(title, margin + 3, y + 5);
    y += 10;
  };

  const field = (label: string, value: string, x: number, colW: number) => {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 130, 150);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 40);
    doc.text(value || '—', x, y + 5);
    return y + 10;
  };

  // Parties
  sectionTitle('1. PARTIES AU CONTRAT');
  const colW = (W - 2 * margin - 5) / 2;
  field('Maître d\'Ouvrage', contrat.client_name || '—', margin, colW);
  const savedY = y;
  field('Cabinet d\'Architecture (MOE)', agencyName || '—', margin + colW + 5, colW);
  y = savedY + 10;

  // Objet
  sectionTitle('2. OBJET DE LA MISSION');
  field('Intitulé du projet', contrat.intitule_projet || '—', margin, W - 2 * margin);
  y += 2;
  field('Adresse des travaux', contrat.adresse_travaux || '—', margin, W - 2 * margin);
  y += 2;
  const savedY2 = y;
  field('Surface de plancher', contrat.surface_plancher ? `${contrat.surface_plancher} m²` : '—', margin, colW);
  field('Budget prévisionnel TTC', fmt(contrat.budget_previsionnel), margin + colW + 5, colW);
  y = savedY2 + 10;

  // Missions
  sectionTitle('3. MISSIONS CONFIÉES');
  const missionsIncluses = (contrat.missions_list || []).filter(m => m.incluse);
  if (missionsIncluses.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Mission', 'Part honoraires (%)']],
      body: missionsIncluses.map(m => [m.name, m.pct != null && m.pct > 0 ? `${m.pct} %` : '—']),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [32, 107, 196], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 255] },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Honoraires
  sectionTitle('4. HONORAIRES');
  if (contrat.mode_honoraires === 'forfait') {
    field('Mode', 'Forfait', margin, colW);
    const savedY3 = y;
    field('Montant HT', fmt(contrat.montant_honoraires), margin + colW + 5, colW);
    y = savedY3 + 10;
  } else {
    field('Mode', 'Pourcentage du coût travaux', margin, colW);
    const savedY3 = y;
    field('Taux', contrat.taux_honoraires ? `${contrat.taux_honoraires} %` : '—', margin + colW + 5, colW);
    y = savedY3 + 10;
  }
  field('Indice de révision', contrat.indice_revision || 'BT01', margin, colW);
  y += 2;

  // Calendrier
  if (contrat.date_debut || contrat.date_fin) {
    sectionTitle('5. CALENDRIER');
    const savedY4 = y;
    field('Date de début', contrat.date_debut ? new Date(contrat.date_debut).toLocaleDateString('fr-FR') : '—', margin, colW);
    field('Date de fin prévisionnelle', contrat.date_fin ? new Date(contrat.date_fin).toLocaleDateString('fr-FR') : '—', margin + colW + 5, colW);
    y = savedY4 + 10;
  }

  // Clauses
  if (y > 240) { doc.addPage(); y = 20; }
  sectionTitle('6. CLAUSES PARTICULIÈRES');
  const clauses = [];
  if (contrat.clause_mediation) clauses.push(['Médiation', 'En cas de litige, les parties s\'engagent à recourir à la médiation avant toute procédure judiciaire.']);
  if (contrat.clause_propriete_intellectuelle) clauses.push(['Propriété intellectuelle', 'Les plans, documents et créations produits par le MOE demeurent sa propriété intellectuelle. Leur utilisation est soumise au respect du droit d\'auteur.']);
  if (contrat.clause_resiliation) clauses.push(['Résiliation', contrat.clause_resiliation]);
  if (clauses.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Clause', 'Contenu']],
      body: clauses,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [32, 107, 196], textColor: 255 },
      columnStyles: { 0: { cellWidth: 35, fontStyle: 'bold' } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Assurance
  if (contrat.assureur || contrat.numero_police) {
    sectionTitle('7. ASSURANCE PROFESSIONNELLE');
    field('Assureur', contrat.assureur || '—', margin, colW);
    const savedY5 = y;
    field('N° de police', contrat.numero_police || '—', margin + colW + 5, colW);
    y = savedY5 + 10;
  }

  // Signatures
  if (y > 240) { doc.addPage(); y = 20; }
  y += 10;
  doc.setFillColor(245, 247, 251);
  doc.rect(margin, y, W - 2 * margin, 35, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 70, 90);
  doc.text('Fait en deux exemplaires originaux', W / 2, y + 6, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Le Maître d\'Ouvrage', margin + colW / 2, y + 15, { align: 'center' });
  doc.text('Le Maître d\'Œuvre', margin + colW + 5 + colW / 2, y + 15, { align: 'center' });
  doc.text('Signature et cachet :', margin + 5, y + 25);
  doc.text('Signature et cachet :', margin + colW + 10, y + 25);

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(160, 170, 185);
    doc.text(`Contrat MOE — ${contrat.numero || 'Brouillon'} — Page ${i}/${pageCount}`, W / 2, 292, { align: 'center' });
  }

  doc.save(`Contrat_MOE_${contrat.numero || contrat.intitule_projet || 'nouveau'}.pdf`);
}

// ── Form Field ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls} style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

function ContratModal({
  contrat,
  contacts,
  projects,
  onSave,
  onClose,
}: {
  contrat: Partial<ContratMOE> | null;
  contacts: Contact[];
  projects: Project[];
  onSave: (c: Partial<ContratMOE>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<ContratMOE>>(() => contrat ? {
    ...contrat,
    cotraitants: contrat.cotraitants || [],
    sous_traitants: contrat.sous_traitants || [],
  } : {
    type_contrat: 'construction_neuve',
    type_moa: 'prive',
    status: 'Brouillon',
    mode_honoraires: 'forfait',
    indice_revision: 'BT01',
    clause_mediation: true,
    clause_propriete_intellectuelle: true,
    missions_list: DEFAULT_MISSIONS,
    cotraitants: [],
    sous_traitants: [],
  });
  const [saving, setSaving] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [tab, setTab] = useState<'general' | 'missions' | 'honoraires' | 'equipe' | 'clauses'>('general');

  const set = (key: keyof ContratMOE, val: any) => setForm(f => ({ ...f, [key]: val }));

  const toggleMission = (id: string) => {
    setForm((f: Partial<ContratMOE>) => ({
      ...f,
      missions_list: (f.missions_list || []).map((m: ContratMOEMission) => m.id === id ? { ...m, incluse: !m.incluse } : m),
    }));
  };

  const updateMissionPct = (id: string, pct: number) => {
    setForm((f: Partial<ContratMOE>) => ({
      ...f,
      missions_list: (f.missions_list || []).map((m: ContratMOEMission) => m.id === id ? { ...m, pct } : m),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const TABS = [
    { id: 'general', label: 'Général' },
    { id: 'missions', label: 'Missions' },
    { id: 'honoraires', label: 'Honoraires' },
    { id: 'equipe', label: 'Équipe MOE' },
    { id: 'clauses', label: 'Clauses' },
  ] as const;

  // Helpers équipe MOE
  const addCotraitant = () => {
    const newC: ContratCotraitant = { id: crypto.randomUUID(), contact_name: '', specialty: '', fee_pct: 0, montant_honoraires: 0 };
    setForm(f => ({ ...f, cotraitants: [...(f.cotraitants || []), newC] }));
  };
  const updateCotraitant = (id: string, key: keyof ContratCotraitant, val: any) => {
    setForm(f => ({ ...f, cotraitants: (f.cotraitants || []).map(c => c.id === id ? { ...c, [key]: val } : c) }));
  };
  const removeCotraitant = (id: string) => {
    setForm(f => ({ ...f, cotraitants: (f.cotraitants || []).filter(c => c.id !== id) }));
  };
  const addSousTraitant = () => {
    const newS: ContratSousTraitant = { id: crypto.randomUUID(), contact_name: '', specialty: '', montant: 0, paiement_direct_moa: false };
    setForm(f => ({ ...f, sous_traitants: [...(f.sous_traitants || []), newS] }));
  };
  const updateSousTraitant = (id: string, key: keyof ContratSousTraitant, val: any) => {
    setForm(f => ({ ...f, sous_traitants: (f.sous_traitants || []).map(s => s.id === id ? { ...s, [key]: val } : s) }));
  };
  const removeSousTraitant = (id: string) => {
    setForm(f => ({ ...f, sous_traitants: (f.sous_traitants || []).filter(s => s.id !== id) }));
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -10 }}
          className="relative w-full max-w-2xl rounded-xl shadow-2xl my-8"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
            <div className="flex items-center gap-3">
              <IconContract size={20} style={{ color: 'var(--tblr-primary)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>
                {contrat?.id ? 'Modifier le contrat' : 'Nouveau contrat MOE'}
              </h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
              <IconX size={16} style={{ color: 'var(--tblr-muted)' }} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-6" style={{ borderColor: 'var(--tblr-border)' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn('px-4 py-3 text-sm font-medium border-b-2 transition-colors', tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">

              {/* TAB: Général */}
              {tab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="N° de contrat">
                      <input className={inputCls} style={inputStyle} value={form.numero || ''} onChange={e => set('numero', e.target.value)} placeholder="ex : MOE-2026-001" />
                    </Field>
                    <Field label="Statut">
                      <select className={inputCls} style={inputStyle} value={form.status || 'Brouillon'} onChange={e => set('status', e.target.value as any)}>
                        {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat *">
                      <select required className={inputCls} style={inputStyle} value={form.type_contrat || 'construction_neuve'} onChange={e => set('type_contrat', e.target.value as any)}>
                        {Object.entries(TYPE_CONTRAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="Type de maître d'ouvrage *">
                      <select required className={inputCls} style={inputStyle} value={form.type_moa || 'prive'} onChange={e => set('type_moa', e.target.value as any)}>
                        {Object.entries(TYPE_MOA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                  </div>

                  <Field label="Maître d'ouvrage (client)">
                    <ContactAutocomplete
                      contacts={contacts}
                      value={form.client_id || ''}
                      onChange={id => set('client_id', id)}
                      onAddNew={() => setShowContactModal(true)}
                    />
                  </Field>

                  <Field label="Projet associé">
                    <select className={inputCls} style={inputStyle} value={form.project_id || ''} onChange={e => set('project_id', e.target.value || undefined)}>
                      <option value="">— Aucun —</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>

                  <Field label="Intitulé du projet">
                    <input className={inputCls} style={inputStyle} value={form.intitule_projet || ''} onChange={e => set('intitule_projet', e.target.value)} placeholder="ex : Construction d'une maison individuelle" />
                  </Field>

                  <Field label="Adresse des travaux">
                    <input className={inputCls} style={inputStyle} value={form.adresse_travaux || ''} onChange={e => set('adresse_travaux', e.target.value)} />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Surface de plancher (m²)">
                      <input type="number" min={0} className={inputCls} style={inputStyle} value={form.surface_plancher ?? ''} onChange={e => set('surface_plancher', e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </Field>
                    <Field label="Budget prévisionnel TTC (€)">
                      <input type="number" min={0} className={inputCls} style={inputStyle} value={form.budget_previsionnel ?? ''} onChange={e => set('budget_previsionnel', e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Date de début">
                      <input type="date" className={inputCls} style={inputStyle} value={form.date_debut || ''} onChange={e => set('date_debut', e.target.value)} />
                    </Field>
                    <Field label="Date de fin prévisionnelle">
                      <input type="date" className={inputCls} style={inputStyle} value={form.date_fin || ''} onChange={e => set('date_fin', e.target.value)} />
                    </Field>
                  </div>

                  <Field label="Notes">
                    <textarea className={cn(inputCls, 'resize-none h-20')} style={inputStyle} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
                  </Field>
                </div>
              )}

              {/* TAB: Missions */}
              {tab === 'missions' && (
                <div className="space-y-2">
                  <p className="text-xs mb-3" style={{ color: 'var(--tblr-muted)' }}>
                    Cochez les missions incluses dans ce contrat et indiquez la part des honoraires pour chacune.
                  </p>
                  {(form.missions_list || DEFAULT_MISSIONS).map(mission => (
                    <div key={mission.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                      <input
                        type="checkbox"
                        checked={mission.incluse}
                        onChange={() => toggleMission(mission.id)}
                        className="w-4 h-4 rounded flex-shrink-0"
                      />
                      <span className={cn('flex-1 text-sm', !mission.incluse && 'opacity-40')} style={{ color: 'var(--tblr-text)' }}>
                        {mission.name}
                      </span>
                      {mission.incluse && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={mission.pct ?? ''}
                            onChange={e => updateMissionPct(mission.id, parseFloat(e.target.value) || 0)}
                            className="w-16 p-1.5 rounded text-sm text-center"
                            style={inputStyle}
                          />
                          <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>%</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="text-xs mt-2" style={{ color: 'var(--tblr-muted)' }}>
                    Total : {(form.missions_list || []).filter(m => m.incluse).reduce((s, m) => s + (m.pct || 0), 0)} %
                  </p>
                </div>
              )}

              {/* TAB: Honoraires */}
              {tab === 'honoraires' && (
                <div className="space-y-4">
                  <Field label="Mode de calcul des honoraires">
                    <div className="grid grid-cols-2 gap-3">
                      {(['forfait', 'pourcentage'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => set('mode_honoraires', mode)}
                          className={cn('p-3 rounded-lg border text-sm font-medium text-left transition-all', form.mode_honoraires === mode
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'hover:border-gray-400'
                          )}
                          style={form.mode_honoraires !== mode ? { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' } : {}}
                        >
                          <div className="font-semibold capitalize">{mode === 'forfait' ? 'Forfait' : 'Pourcentage'}</div>
                          <div className="text-xs opacity-70 mt-0.5">
                            {mode === 'forfait' ? 'Montant fixe HT' : '% du coût travaux HT'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </Field>

                  {form.mode_honoraires === 'forfait' ? (
                    <Field label="Montant des honoraires HT (€)">
                      <input type="number" min={0} className={inputCls} style={inputStyle} value={form.montant_honoraires ?? ''} onChange={e => set('montant_honoraires', e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </Field>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Taux d'honoraires (%)">
                        <input type="number" min={0} max={30} step={0.1} className={inputCls} style={inputStyle} value={form.taux_honoraires ?? ''} onChange={e => set('taux_honoraires', e.target.value ? parseFloat(e.target.value) : undefined)} />
                      </Field>
                      {form.budget_previsionnel && form.taux_honoraires && (
                        <div className="flex flex-col justify-end pb-2">
                          <p className="text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>Estimation honoraires HT</p>
                          <p className="text-lg font-bold" style={{ color: 'var(--tblr-primary)' }}>
                            {fmt(form.budget_previsionnel * form.taux_honoraires / 100)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <Field label="Indice de révision des honoraires">
                    <select className={inputCls} style={inputStyle} value={form.indice_revision || 'BT01'} onChange={e => set('indice_revision', e.target.value)}>
                      {INDICES_REVISION.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Délai d'exécution (jours)">
                      <input type="number" min={0} className={inputCls} style={inputStyle} value={form.delai_execution ?? ''} onChange={e => set('delai_execution', e.target.value ? parseInt(e.target.value) : undefined)} />
                    </Field>
                    <Field label="Pénalités de retard (€/jour)">
                      <input type="number" min={0} className={inputCls} style={inputStyle} value={form.penalites_retard ?? ''} onChange={e => set('penalites_retard', e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </Field>
                  </div>
                </div>
              )}

              {/* TAB: Équipe MOE */}
              {tab === 'equipe' && (
                <div className="space-y-6">
                  {/* Cotraitants */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>Cotraitants</p>
                        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Les honoraires cotraitants ne sont pas intégrés à la comptabilité de l'agence.</p>
                      </div>
                      <button type="button" onClick={addCotraitant} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
                        <IconPlus size={13} /> Ajouter
                      </button>
                    </div>
                    {(form.cotraitants || []).length === 0 && (
                      <p className="text-xs italic py-3 text-center" style={{ color: 'var(--tblr-muted)' }}>Aucun cotraitant</p>
                    )}
                    <div className="space-y-2">
                      {(form.cotraitants || []).map(ct => (
                        <div key={ct.id} className="p-3 rounded-lg space-y-2" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelCls} style={labelStyle}>Contact</label>
                              <ContactAutocomplete contacts={contacts} value={ct.contact_id || ''} onChange={id => {
                                const c = contacts.find(c => c.id === id);
                                const name = c ? (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()) : '';
                                updateCotraitant(ct.id, 'contact_id', id);
                                updateCotraitant(ct.id, 'contact_name', name);
                              }} onAddNew={() => {}} />
                            </div>
                            <div>
                              <label className={labelCls} style={labelStyle}>Spécialité</label>
                              <input className={inputCls} style={inputStyle} value={ct.specialty || ''} onChange={e => updateCotraitant(ct.id, 'specialty', e.target.value)} placeholder="ex : Ingénierie structure" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelCls} style={labelStyle}>Part honoraires (%)</label>
                              <input type="number" min={0} max={100} step={0.5} className={inputCls} style={inputStyle} value={ct.fee_pct ?? ''} onChange={e => updateCotraitant(ct.id, 'fee_pct', parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                              <label className={labelCls} style={labelStyle}>Montant HT (€)</label>
                              <input type="number" min={0} className={inputCls} style={inputStyle} value={ct.montant_honoraires ?? ''} onChange={e => updateCotraitant(ct.id, 'montant_honoraires', parseFloat(e.target.value) || 0)} />
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button type="button" onClick={() => removeCotraitant(ct.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"><IconTrash size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sous-traitants */}
                  <div className="pt-4 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>Sous-traitants</p>
                        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Les honoraires sous-traitants sont intégrés à la comptabilité sauf si paiement direct par le MOA.</p>
                      </div>
                      <button type="button" onClick={addSousTraitant} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                        <IconPlus size={13} /> Ajouter
                      </button>
                    </div>
                    {(form.sous_traitants || []).length === 0 && (
                      <p className="text-xs italic py-3 text-center" style={{ color: 'var(--tblr-muted)' }}>Aucun sous-traitant</p>
                    )}
                    <div className="space-y-2">
                      {(form.sous_traitants || []).map(st => (
                        <div key={st.id} className="p-3 rounded-lg space-y-2" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelCls} style={labelStyle}>Contact</label>
                              <ContactAutocomplete contacts={contacts} value={st.contact_id || ''} onChange={id => {
                                const c = contacts.find(c => c.id === id);
                                const name = c ? (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()) : '';
                                updateSousTraitant(st.id, 'contact_id', id);
                                updateSousTraitant(st.id, 'contact_name', name);
                              }} onAddNew={() => {}} />
                            </div>
                            <div>
                              <label className={labelCls} style={labelStyle}>Spécialité / Prestation</label>
                              <input className={inputCls} style={inputStyle} value={st.specialty || ''} onChange={e => updateSousTraitant(st.id, 'specialty', e.target.value)} placeholder="ex : Coordination SPS" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelCls} style={labelStyle}>Montant HT (€)</label>
                              <input type="number" min={0} className={inputCls} style={inputStyle} value={st.montant ?? ''} onChange={e => updateSousTraitant(st.id, 'montant', parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="flex flex-col justify-end">
                              <label className="flex items-start gap-2 cursor-pointer">
                                <input type="checkbox" checked={!!st.paiement_direct_moa} onChange={e => updateSousTraitant(st.id, 'paiement_direct_moa', e.target.checked)} className="w-4 h-4 rounded mt-0.5 flex-shrink-0" />
                                <span className="text-xs" style={{ color: 'var(--tblr-text)' }}>
                                  Paiement direct par le Maître d'Ouvrage
                                  <span className="block text-[10px]" style={{ color: 'var(--tblr-muted)' }}>(hors comptabilité agence)</span>
                                </span>
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button type="button" onClick={() => removeSousTraitant(st.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"><IconTrash size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Clauses */}
              {tab === 'clauses' && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {[
                      { key: 'clause_mediation' as const, label: 'Clause de médiation', desc: 'En cas de litige, les parties s\'engagent à recourir à la médiation avant toute procédure judiciaire.' },
                      { key: 'clause_propriete_intellectuelle' as const, label: 'Clause de propriété intellectuelle', desc: 'Les plans, documents et créations du MOE demeurent sa propriété intellectuelle.' },
                    ].map(clause => (
                      <div key={clause.key} className="flex items-start gap-3 p-4 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                        <input
                          type="checkbox"
                          checked={!!form[clause.key]}
                          onChange={e => set(clause.key, e.target.checked)}
                          className="w-4 h-4 rounded mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{clause.label}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{clause.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Field label="Clause de résiliation (personnalisée)">
                    <textarea className={cn(inputCls, 'resize-none h-24')} style={inputStyle} value={form.clause_resiliation || ''} onChange={e => set('clause_resiliation', e.target.value)} placeholder="Décrivez les conditions de résiliation du contrat..." />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Assureur RC Pro">
                      <input className={inputCls} style={inputStyle} value={form.assureur || ''} onChange={e => set('assureur', e.target.value)} placeholder="ex : MAF" />
                    </Field>
                    <Field label="N° de police d'assurance">
                      <input className={inputCls} style={inputStyle} value={form.numero_police || ''} onChange={e => set('numero_police', e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--tblr-muted)' }}>
                Annuler
              </button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                <IconCheck size={15} />
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>

      {showContactModal && (
        <ContactModal
          isOpen={showContactModal}
          onClose={() => setShowContactModal(false)}
          onSuccess={(c) => {
            set('client_id', c.id);
            setShowContactModal(false);
          }}
        />
      )}
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function proposalToContrat(p: any): Partial<ContratMOE> {
  const cotraitants: ContratCotraitant[] = (p.specialties_list || []).map((s: any) => ({
    id: crypto.randomUUID(),
    contact_id: s.contact_id || undefined,
    contact_name: s.contact_name || s.specialty_name || '',
    specialty: s.specialty_name || '',
    fee_pct: 0,
    montant_honoraires: 0,
  }));
  return {
    type_contrat: 'construction_neuve',
    type_moa: 'prive',
    status: 'Brouillon',
    mode_honoraires: 'forfait',
    indice_revision: 'BT01',
    clause_mediation: true,
    clause_propriete_intellectuelle: true,
    missions_list: DEFAULT_MISSIONS,
    intitule_projet: p.title || '',
    client_id: p.client_id || undefined,
    budget_previsionnel: p.construction_cost || undefined,
    montant_honoraires: p.amount || undefined,
    cotraitants,
    sous_traitants: [],
  };
}

export default function Contrats() {
  const { t } = useTranslation();
  const location = useLocation();
  const [contrats, setContrats] = useState<ContratMOE[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContrat, setEditingContrat] = useState<ContratMOE | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, contacts, projects] = await Promise.all([
        fetchJson<ContratMOE[]>('/api/contrats_moe'),
        fetchJson<Contact[]>('/api/contacts'),
        fetchJson<Project[]>('/api/projects'),
      ]);
      setContrats(c);
      setContacts(contacts);
      setProjects(projects);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const fromProposal = (location.state as any)?.fromProposal;
    if (fromProposal) {
      setEditingContrat(proposalToContrat(fromProposal) as ContratMOE);
      setIsModalOpen(true);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const openNew = () => { setEditingContrat(null); setIsModalOpen(true); };
  const openEdit = (c: ContratMOE) => { setEditingContrat(c); setIsModalOpen(true); };
  const closeModal = () => { setIsModalOpen(false); setEditingContrat(null); };

  const handleSave = async (data: Partial<ContratMOE>) => {
    if (editingContrat?.id) {
      await apiFetch(`/api/contrats_moe/${editingContrat.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/contrats_moe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    closeModal();
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce contrat ?')) return;
    await apiFetch(`/api/contrats_moe/${id}`, { method: 'DELETE' });
    load();
  };

  const filtered = contrats.filter(c => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || (c.intitule_projet || '').toLowerCase().includes(q) || (c.client_name || '').toLowerCase().includes(q) || (c.numero || '').toLowerCase().includes(q);
    const matchStatus = !filterStatus || c.status === filterStatus;
    const matchType = !filterType || c.type_contrat === filterType;
    return matchSearch && matchStatus && matchType;
  });

  const stats = {
    total: contrats.length,
    signes: contrats.filter(c => c.status === 'Signé').length,
    envoyes: contrats.filter(c => c.status === 'Envoyé').length,
    montantTotal: contrats.filter(c => c.status === 'Signé').reduce((s, c) => s + (c.montant_honoraires || 0), 0),
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--tblr-body-bg)' }}>
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#e8f0fb' }}>
              <IconContract size={18} style={{ color: '#206bc4' }} />
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>Contrats MOE</h1>
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Générateur de contrats de maîtrise d'œuvre — modèles MAF</p>
            </div>
          </div>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            <IconPlus size={15} />
            Nouveau contrat
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Total', value: stats.total, icon: IconFileText, color: '#6c7a91' },
            { label: 'Envoyés', value: stats.envoyes, icon: IconSend, color: '#206bc4' },
            { label: 'Signés', value: stats.signes, icon: IconCheck, color: '#2f9e44' },
            { label: 'Honoraires signés', value: fmt(stats.montantTotal), icon: IconCurrencyEuro, color: '#ae3ec9' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
              <s.icon size={20} style={{ color: s.color }} />
              <div>
                <p className="text-lg font-bold leading-none" style={{ color: 'var(--tblr-text)' }}>{s.value}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b shrink-0 flex items-center gap-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <div className="relative flex-1 max-w-xs">
          <IconFilter size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
          <input
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
            style={inputStyle}
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="px-3 py-2 rounded-lg text-sm" style={inputStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Tous statuts</option>
          {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="px-3 py-2 rounded-lg text-sm" style={inputStyle} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">Tous types</option>
          {Object.entries(TYPE_CONTRAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <IconContract size={40} className="mb-3 opacity-30" style={{ color: 'var(--tblr-muted)' }} />
            <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>Aucun contrat</p>
            <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Créez votre premier contrat de maîtrise d'œuvre</p>
            <button onClick={openNew} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              <IconPlus size={14} />
              Nouveau contrat
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filtered.map(contrat => (
                <motion.div
                  key={contrat.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-xl p-4"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#e8f0fb' }}>
                        <IconBuildingSkyscraper size={16} style={{ color: '#206bc4' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {contrat.numero && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                              {contrat.numero}
                            </span>
                          )}
                          <StatusBadge status={contrat.status} />
                          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                            {TYPE_CONTRAT_LABELS[contrat.type_contrat] ?? contrat.type_contrat}
                          </span>
                        </div>
                        <p className="font-semibold mt-1 truncate" style={{ color: 'var(--tblr-text)' }}>
                          {contrat.intitule_projet || 'Sans intitulé'}
                        </p>
                        <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                          {contrat.client_name && <span>{contrat.client_name}</span>}
                          {contrat.project_name && <span>· {contrat.project_name}</span>}
                          {contrat.adresse_travaux && <span>· {contrat.adresse_travaux}</span>}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                          {contrat.mode_honoraires === 'forfait' && contrat.montant_honoraires && (
                            <span className="font-medium" style={{ color: 'var(--tblr-primary)' }}>{fmt(contrat.montant_honoraires)} HT</span>
                          )}
                          {contrat.mode_honoraires === 'pourcentage' && contrat.taux_honoraires && (
                            <span className="font-medium" style={{ color: 'var(--tblr-primary)' }}>{contrat.taux_honoraires} % des travaux</span>
                          )}
                          {contrat.date_debut && <span>Du {new Date(contrat.date_debut).toLocaleDateString('fr-FR')}</span>}
                          {contrat.date_fin && <span>au {new Date(contrat.date_fin).toLocaleDateString('fr-FR')}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => generateContratPdf(contrat)}
                        title="Télécharger PDF"
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                      >
                        <IconDownload size={15} />
                      </button>
                      <button
                        onClick={() => openEdit(contrat)}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(contrat.id)}
                        className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Missions preview */}
                  {contrat.missions_list && contrat.missions_list.filter(m => m.incluse).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                      {contrat.missions_list.filter(m => m.incluse).map(m => (
                        <span key={m.id} className="text-[10px] px-2 py-0.5 rounded font-medium" style={{ background: '#e8f0fb', color: '#206bc4' }}>
                          {m.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <ContratModal
            contrat={editingContrat}
            contacts={contacts}
            projects={projects}
            onSave={handleSave}
            onClose={closeModal}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
