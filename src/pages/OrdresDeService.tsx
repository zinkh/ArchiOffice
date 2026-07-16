import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconPlus, IconX, IconCheck, IconClock, IconAlertTriangle,
  IconChevronRight, IconFilter, IconTrash, IconPencil,
  IconFileText, IconBuildingFactory2, IconCalendar,
  IconCurrencyEuro, IconSend, IconCircleCheck, IconBan,
  IconDownload,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';
import type { OrdreDeService, Project } from '../types';

// ── Status config
const STATUS_CONFIG = {
  draft:     { label: 'Brouillon',  bg: '#f1f3f6', color: '#6c7a91', icon: IconClock },
  submitted: { label: 'Émis',       bg: '#e8f0fb', color: '#206bc4', icon: IconSend },
  approved:  { label: 'AR reçu',    bg: '#d3f9d8', color: '#2f9e44', icon: IconCircleCheck },
  rejected:  { label: 'Annulé',     bg: '#ffe3e3', color: '#d63939', icon: IconBan },
} as const;

const ORIGINE_LABELS: Record<string, string> = {
  maitrise_ouvrage: "Maîtrise d'ouvrage",
  maitrise_oeuvre:  "Maîtrise d'œuvre",
  aleas:            'Aléas de chantier',
  autres:           'Autres',
};

const inputCls = "w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm";
const inputStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' } as React.CSSProperties;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function formatCurrency(n?: number) {
  if (n === undefined || n === null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

// ── PDF generation
async function generateOsPdf(os: OrdreDeService, project?: Project) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 20;

  // Header band
  doc.setFillColor(32, 107, 196);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ORDRE DE SERVICE', margin, 12);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`N° OS : ${os.os_number}`, margin, 20);
  if (os.date) doc.text(`Date : ${new Date(os.date).toLocaleDateString('fr-FR')}`, W - margin, 20, { align: 'right' });

  // Status badge area
  const statusCfg = STATUS_CONFIG[os.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  doc.setFillColor(245, 247, 251);
  doc.rect(0, 28, W, 12, 'F');
  doc.setTextColor(100, 120, 150);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`STATUT : ${statusCfg.label.toUpperCase()}`, margin, 36);
  if (project) doc.text(`AFFAIRE : ${project.name}`, W / 2, 36, { align: 'center' });

  let y = 48;

  // Parties
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, y, (W - 2 * margin) / 2 - 3, 28, 'F');
  doc.rect(W / 2 + 3, y, (W - 2 * margin) / 2 - 3, 28, 'F');

  doc.setTextColor(100, 120, 150);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text("MAÎTRISE D'ŒUVRE", margin + 3, y + 5);
  doc.text('ENTREPRISE', W / 2 + 6, y + 5);
  doc.setTextColor(30, 40, 60);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const moeLines = doc.splitTextToSize(os.maitrise_oeuvre_adresse || os.emetteur_os || '—', 70);
  doc.text(moeLines, margin + 3, y + 12);
  const entLines = doc.splitTextToSize(os.entreprise || os.destinataire_os || '—', 70);
  doc.text(entLines, W / 2 + 6, y + 12);

  y += 34;

  // Objet
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(32, 107, 196);
  doc.text("OBJET DE L'ORDRE DE SERVICE", margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 40, 60);
  doc.setFontSize(9);
  const objetLines = doc.splitTextToSize(os.objet || os.description || '—', W - 2 * margin);
  doc.text(objetLines, margin, y);
  y += objetLines.length * 5 + 6;

  // Details table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Champ', 'Valeur']],
    body: [
      ['N° de marché', os.march_number || '—'],
      ['Lot / Entreprise', [os.lot, os.entreprise].filter(Boolean).join(' · ') || '—'],
      ['Origine de la demande', ORIGINE_LABELS[os.origine_demande || ''] || '—'],
      ['Montant du marché HT', formatCurrency(os.montant_marche_ht)],
      ['Délai d\'exécution', os.delai_execution ? `${os.delai_execution} ${os.delai_unit || 'jours'}` : '—'],
      ['Date de fourniture', os.date_fourniture ? new Date(os.date_fourniture).toLocaleDateString('fr-FR') : '—'],
      ['Article CCAP', os.article_ccap || '—'],
      ['Incidences délais', os.incidences_delais_type === 'oui' ? `Oui — ${os.incidences_delais_details || ''}` : 'Non'],
      ['Incidences coûts', os.incidences_couts_type === 'oui' ? 'Oui' : 'Non'],
      ['Montant devis présenté HT', formatCurrency(os.montant_devis_presente)],
      ['Montant devis accepté HT', formatCurrency(os.montant_devis_accepte)],
    ],
    headStyles: { fillColor: [32, 107, 196], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [30, 40, 60] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 12;

  // Signature block
  const sigY = Math.min(finalY, 230);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, sigY, (W - 2 * margin) / 2 - 4, 38, 'F');
  doc.rect(W / 2 + 4, sigY, (W - 2 * margin) / 2 - 4, 38, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 120, 150);
  doc.text("SIGNATURE MAÎTRISE D'ŒUVRE", margin + 3, sigY + 6);
  doc.text('SIGNATURE ENTREPRISE', W / 2 + 7, sigY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(150, 160, 175);
  doc.text('Date : ______________________', margin + 3, sigY + 30);
  doc.text('Date : ______________________', W / 2 + 7, sigY + 30);

  // AR block
  if (os.date_ar || os.date_execution) {
    const arY = sigY + 44;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(47, 158, 68);
    if (os.date_ar) doc.text(`Accusé de réception : ${new Date(os.date_ar).toLocaleDateString('fr-FR')}`, margin, arY);
    if (os.date_execution) doc.text(`Date d'exécution : ${new Date(os.date_execution).toLocaleDateString('fr-FR')}`, W / 2, arY);
  }

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(180, 190, 200);
  doc.setFont('helvetica', 'normal');
  doc.text(`ArchiOffice · OS N°${os.os_number} · Généré le ${new Date().toLocaleDateString('fr-FR')}`, W / 2, 290, { align: 'center' });

  doc.save(`OS-${os.os_number}-${(os.title || 'document').replace(/[^a-z0-9]/gi, '_')}.pdf`);
}

// ── Empty OS form
const emptyForm = (): Partial<OrdreDeService> => ({
  os_number: '',
  title: '',
  date: new Date().toISOString().split('T')[0],
  type: 'travaux',
  status: 'draft',
  origine_demande: 'maitrise_oeuvre',
  incidences_delais_type: 'non',
  incidences_couts_type: 'non',
});

export default function OrdresDeService() {
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [osList, setOsList] = useState<OrdreDeService[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOs, setEditingOs] = useState<OrdreDeService | null>(null);
  const [osToDelete, setOsToDelete] = useState<OrdreDeService | null>(null);
  const [arModal, setArModal] = useState<OrdreDeService | null>(null);
  const [arDate, setArDate] = useState('');
  const [arNotes, setArNotes] = useState('');
  const [execDate, setExecDate] = useState('');

  // Form state
  const [form, setForm] = useState<Partial<OrdreDeService>>(emptyForm());
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const data = await apiFetch<OrdreDeService[]>('/api/ordres_de_service');
    setOsList(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    apiFetch<Project[]>('/api/projects').then(d => setProjects(d || []));
    refresh();
  }, [refresh]);

  // Auto-assign next OS number when opening new form
  const openNew = async () => {
    const f = emptyForm();
    try {
      const q = filterProject ? `?project_id=${filterProject}` : '';
      const data = await apiFetch<{ next: string }>(`/api/ordres_de_service/next-number${q}`);
      f.os_number = data.next;
    } catch { f.os_number = '001'; }
    f.project_id = filterProject || '';
    f.emetteur_os = currentUser?.name || '';
    setForm(f);
    setEditingOs(null);
    setIsFormOpen(true);
  };

  const openEdit = (os: OrdreDeService) => {
    setForm({ ...os });
    setEditingOs(os);
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.title || !form.os_number) return;
    setSaving(true);
    try {
      if (editingOs) {
        await apiFetch(`/api/ordres_de_service/${editingOs.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch('/api/ordres_de_service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      await refresh();
      setIsFormOpen(false);
    } catch (e) { alert('Erreur: ' + e); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (os: OrdreDeService, newStatus: OrdreDeService['status']) => {
    if (newStatus === 'approved') {
      setArModal(os);
      setArDate(new Date().toISOString().split('T')[0]);
      setArNotes('');
      setExecDate('');
      return;
    }
    try {
      await apiFetch(`/api/ordres_de_service/${os.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await refresh();
    } catch (e) { alert('Erreur: ' + e); }
  };

  const handleArConfirm = async () => {
    if (!arModal) return;
    try {
      await apiFetch(`/api/ordres_de_service/${arModal.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', date_ar: arDate, date_execution: execDate || undefined, notes_ar: arNotes || undefined }),
      });
      await refresh();
      setArModal(null);
    } catch (e) { alert('Erreur: ' + e); }
  };

  const handleDelete = async () => {
    if (!osToDelete) return;
    await apiFetch(`/api/ordres_de_service/${osToDelete.id}`, { method: 'DELETE' });
    await refresh();
    setOsToDelete(null);
  };

  const field = (key: keyof OrdreDeService) => ({
    value: (form[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  // Filtered list
  const filtered = osList.filter(os => {
    if (filterProject && os.project_id !== filterProject) return false;
    if (filterStatus && os.status !== filterStatus) return false;
    return true;
  });

  // Stats
  const stats = {
    total: osList.length,
    draft: osList.filter(o => o.status === 'draft').length,
    submitted: osList.filter(o => o.status === 'submitted').length,
    approved: osList.filter(o => o.status === 'approved').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Ordres de Service</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>MPRO §2.4.2 — Enregistrement obligatoire du chantier</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm"
          style={{ background: 'var(--tblr-primary)', color: '#fff' }}
        >
          <IconPlus size={16} /> Nouvel OS
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total OS', value: stats.total, color: '#6c7a91', bg: '#f1f3f6', icon: IconFileText },
          { label: 'Brouillons', value: stats.draft, color: '#6c7a91', bg: '#f1f3f6', icon: IconClock },
          { label: 'Émis', value: stats.submitted, color: '#206bc4', bg: '#e8f0fb', icon: IconSend },
          { label: 'AR reçu', value: stats.approved, color: '#2f9e44', bg: '#d3f9d8', icon: IconCircleCheck },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 flex items-center gap-3 relative overflow-hidden" style={{ background: s.bg, border: `1px solid ${s.color}22` }}>
            <div className="absolute -bottom-2 -right-2 opacity-10" style={{ color: s.color }}><s.icon size={56} /></div>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: s.color + '22', color: s.color }}><s.icon size={18} /></div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
              <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          value={filterProject}
          onChange={e => setFilterProject(e.target.value)}
        >
          <option value="">Toutes les affaires</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">Tous les statuts</option>
          <option value="draft">Brouillon</option>
          <option value="submitted">Émis</option>
          <option value="approved">AR reçu</option>
          <option value="rejected">Annulé</option>
        </select>
        {(filterProject || filterStatus) && (
          <button
            onClick={() => { setFilterProject(''); setFilterStatus(''); }}
            className="px-3 py-2 rounded-xl text-sm flex items-center gap-1.5"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
          >
            <IconX size={14} /> Effacer
          </button>
        )}
        <span className="ml-auto text-xs self-center" style={{ color: 'var(--tblr-muted)' }}>{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {loading ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
              <IconFileText size={28} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Aucun ordre de service</p>
            <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>Créez votre premier OS avec le bouton ci-dessus</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-widest" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderBottom: '1px solid var(--tblr-border)' }}>
                  <th className="px-4 py-3">N° OS</th>
                  <th className="px-4 py-3">Objet</th>
                  <th className="px-4 py-3">Affaire / Entreprise</th>
                  <th className="px-4 py-3">Date émission</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">AR / Exécution</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(os => {
                  const project = projects.find(p => p.id === os.project_id);
                  return (
                    <tr key={os.id} className="transition-colors" style={{ borderTop: '1px solid var(--tblr-border)' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-sm" style={{ color: 'var(--tblr-primary)' }}>OS {os.os_number}</span>
                        {os.type === 'contrat_moe' && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: '#f8d7ff', color: '#ae3ec9' }}>MOE</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--tblr-text)' }} title={os.title}>{os.title}</p>
                        {os.lot && <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>Lot : {os.lot}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {project && <p className="text-xs font-medium truncate max-w-[150px]" style={{ color: 'var(--tblr-text)' }}>{project.name}</p>}
                        {os.entreprise && <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--tblr-muted)' }}><IconBuildingFactory2 size={10} />{os.entreprise}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                        {os.date_emission
                          ? new Date(os.date_emission).toLocaleDateString('fr-FR')
                          : os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—'
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={os.status} />
                          {/* Status transition buttons */}
                          <div className="flex gap-1 mt-0.5">
                            {os.status === 'draft' && (
                              <button
                                onClick={() => handleStatusChange(os, 'submitted')}
                                className="text-[9px] px-2 py-0.5 rounded font-bold transition-all"
                                style={{ background: '#e8f0fb', color: '#206bc4' }}
                                title="Émettre l'OS"
                              >
                                Émettre →
                              </button>
                            )}
                            {os.status === 'submitted' && (
                              <>
                                <button
                                  onClick={() => handleStatusChange(os, 'approved')}
                                  className="text-[9px] px-2 py-0.5 rounded font-bold"
                                  style={{ background: '#d3f9d8', color: '#2f9e44' }}
                                  title="Enregistrer l'accusé de réception"
                                >
                                  AR reçu →
                                </button>
                                <button
                                  onClick={() => handleStatusChange(os, 'rejected')}
                                  className="text-[9px] px-2 py-0.5 rounded font-bold"
                                  style={{ background: '#ffe3e3', color: '#d63939' }}
                                  title="Annuler"
                                >
                                  Annuler
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {os.date_ar ? (
                          <div>
                            <p className="text-xs font-medium" style={{ color: '#2f9e44' }}>AR : {new Date(os.date_ar).toLocaleDateString('fr-FR')}</p>
                            {os.date_execution && <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>Exec. : {new Date(os.date_execution).toLocaleDateString('fr-FR')}</p>}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>
                        {os.montant_devis_accepte
                          ? formatCurrency(os.montant_devis_accepte)
                          : os.montant_devis_presente
                          ? <span style={{ color: 'var(--tblr-muted)' }}>{formatCurrency(os.montant_devis_presente)}</span>
                          : <span style={{ color: 'var(--tblr-muted)' }}>—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => generateOsPdf(os, project)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            title="Exporter PDF"
                          >
                            <IconDownload size={15} />
                          </button>
                          <button
                            onClick={() => openEdit(os)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            title="Modifier"
                          >
                            <IconPencil size={15} />
                          </button>
                          <button
                            onClick={() => setOsToDelete(os)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            title="Supprimer"
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>

        {/* OS Form modal */}
        {isFormOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="my-4 w-full max-w-2xl rounded-2xl shadow-2xl"
              style={{ background: 'var(--tblr-surface)' }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>
                    {editingOs ? `Modifier OS ${editingOs.os_number}` : 'Nouvel Ordre de Service'}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>Tous les champs marqués * sont requis</p>
                </div>
                <button onClick={() => setIsFormOpen(false)} className="p-2 rounded-lg" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
              </div>

              <div className="p-6 space-y-5">
                {/* Identifiants */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>Identification</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>N° OS *</label>
                      <input {...field('os_number')} className={inputCls} style={inputStyle} placeholder="001" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>N° marché</label>
                      <input {...field('march_number')} className={inputCls} style={inputStyle} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Date *</label>
                      <input type="date" {...field('date')} className={inputCls} style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* Objet */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>Objet</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Titre *</label>
                      <input {...field('title')} className={inputCls} style={inputStyle} placeholder="Titre de l'ordre de service" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Description détaillée de l'objet</label>
                      <textarea
                        value={form.objet ?? form.description ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, objet: e.target.value, description: e.target.value }))}
                        className={inputCls}
                        style={inputStyle}
                        rows={3}
                        placeholder="Description précise des travaux ou prestations demandées…"
                      />
                    </div>
                  </div>
                </div>

                {/* Parties */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>Parties</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Affaire</label>
                      <select
                        value={form.project_id ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, project_id: e.target.value }))}
                        className={inputCls} style={inputStyle}
                      >
                        <option value="">— Choisir une affaire —</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Type</label>
                      <select
                        value={form.type ?? 'travaux'}
                        onChange={e => setForm(prev => ({ ...prev, type: e.target.value as OrdreDeService['type'] }))}
                        className={inputCls} style={inputStyle}
                      >
                        <option value="travaux">Travaux</option>
                        <option value="contrat_moe">Contrat MOE</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Émetteur (MOE)</label>
                      <input {...field('emetteur_os')} className={inputCls} style={inputStyle} placeholder="Agence d'architecture" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Destinataire (Entreprise)</label>
                      <input {...field('entreprise')} className={inputCls} style={inputStyle} placeholder="Nom de l'entreprise" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Lot</label>
                      <input {...field('lot')} className={inputCls} style={inputStyle} placeholder="Ex: Gros œuvre" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Origine de la demande</label>
                      <select
                        value={form.origine_demande ?? 'maitrise_oeuvre'}
                        onChange={e => setForm(prev => ({ ...prev, origine_demande: e.target.value as OrdreDeService['origine_demande'] }))}
                        className={inputCls} style={inputStyle}
                      >
                        <option value="maitrise_ouvrage">Maîtrise d'ouvrage</option>
                        <option value="maitrise_oeuvre">Maîtrise d'œuvre</option>
                        <option value="aleas">Aléas de chantier</option>
                        <option value="autres">Autres</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Délais & Coûts */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>Délais & Coûts</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Délai d'exécution</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          value={form.delai_execution ?? ''}
                          onChange={e => setForm(prev => ({ ...prev, delai_execution: parseInt(e.target.value) || undefined }))}
                          className={inputCls}
                          style={inputStyle}
                          placeholder="0"
                        />
                        <select
                          value={form.delai_unit ?? 'jours'}
                          onChange={e => setForm(prev => ({ ...prev, delai_unit: e.target.value }))}
                          className="p-2.5 rounded-lg text-xs outline-none"
                          style={inputStyle}
                        >
                          <option value="jours">j</option>
                          <option value="semaines">sem.</option>
                          <option value="mois">mois</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Date de fourniture</label>
                      <input type="date" {...field('date_fourniture')} className={inputCls} style={inputStyle} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Montant marché HT</label>
                      <input
                        type="number"
                        value={form.montant_marche_ht ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, montant_marche_ht: parseFloat(e.target.value) || undefined }))}
                        className={inputCls} style={inputStyle} placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Incidences délais</label>
                      <select
                        value={form.incidences_delais_type ?? 'non'}
                        onChange={e => setForm(prev => ({ ...prev, incidences_delais_type: e.target.value as OrdreDeService['incidences_delais_type'] }))}
                        className={inputCls} style={inputStyle}
                      >
                        <option value="non">Non</option>
                        <option value="oui">Oui</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Montant devis présenté HT</label>
                      <input
                        type="number"
                        value={form.montant_devis_presente ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, montant_devis_presente: parseFloat(e.target.value) || undefined }))}
                        className={inputCls} style={inputStyle} placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Montant devis accepté HT</label>
                      <input
                        type="number"
                        value={form.montant_devis_accepte ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, montant_devis_accepte: parseFloat(e.target.value) || undefined }))}
                        className={inputCls} style={inputStyle} placeholder="0.00"
                      />
                    </div>
                  </div>
                  {form.incidences_delais_type === 'oui' && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Détails incidences délais</label>
                      <input {...field('incidences_delais_details')} className={inputCls} style={inputStyle} placeholder="Préciser…" />
                    </div>
                  )}
                </div>

                {/* Article CCAP */}
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Article CCAP de référence</label>
                  <input {...field('article_ccap')} className={inputCls} style={inputStyle} placeholder="Ex: Art. 14.3" />
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setIsFormOpen(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.title || !form.os_number}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {saving ? 'Enregistrement…' : editingOs ? 'Sauvegarder' : "Créer l'OS"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* AR modal */}
        {arModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4"
              style={{ background: 'var(--tblr-surface)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>Accusé de réception</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>OS {arModal.os_number} — {arModal.title}</p>
                </div>
                <button onClick={() => setArModal(null)} className="p-2 rounded-lg" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Date de l'AR *</label>
                <input type="date" value={arDate} onChange={e => setArDate(e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Date d'exécution prévue</label>
                <input type="date" value={execDate} onChange={e => setExecDate(e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Notes</label>
                <textarea value={arNotes} onChange={e => setArNotes(e.target.value)} className={inputCls} style={inputStyle} rows={2} placeholder="Observations…" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setArModal(null)} className="flex-1 py-2.5 rounded-xl font-bold text-sm" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>Annuler</button>
                <button onClick={handleArConfirm} disabled={!arDate} className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40" style={{ background: '#2f9e44', color: '#fff' }}>
                  <IconCheck size={14} className="inline mr-1" />
                  Confirmer AR
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Delete confirm */}
        {osToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5 text-center"
              style={{ background: 'var(--tblr-surface)' }}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: '#ffe3e3', color: '#d63939' }}>
                <IconTrash size={28} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>Supprimer l'OS {osToDelete.os_number} ?</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Cette action est irréversible.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setOsToDelete(null)} className="flex-1 py-2.5 rounded-xl font-bold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>Annuler</button>
                <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl font-bold" style={{ background: '#d63939', color: '#fff' }}>Supprimer</button>
              </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>
    </div>
  );
}
