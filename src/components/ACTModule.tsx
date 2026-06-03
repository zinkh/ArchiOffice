import React, { useState, useEffect, useCallback } from 'react';
import {
  IconPlus, IconTrash, IconCheck, IconChevronRight, IconChevronLeft,
  IconFileText, IconBuilding, IconUsers, IconScale, IconTrophy,
  IconDownload, IconMessageDots, IconMail, IconAlertTriangle,
  IconClipboardList, IconCurrencyEuro, IconPercentage, IconStar,
  IconX, IconEdit, IconEye, IconSend, IconCircleCheck,
} from '@tabler/icons-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import type { Contact, ProjectLot } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DCEDocument {
  id: string;
  nom: string;
  type_doc: 'RC' | 'CCAP' | 'CCTP' | 'DPGF' | 'Plans' | 'Autre';
  tous_lots: boolean;
  lots_ids: string[];
}

interface EntrepriseConsultee {
  id: string;
  contact_id?: string;
  nom: string;
  email?: string;
  lots_ids: string[];
  envoyer_dce: boolean;
}

interface CritereNotation {
  id: string;
  nom: string;
  poids: number;
}

interface PieceAdmin {
  id: string;
  nom: string;
}

interface QuestionReponse {
  id: string;
  entreprise_id: string;
  entreprise_nom: string;
  question: string;
  date_question: string;
  reponse?: string;
  date_reponse?: string;
  publique: boolean;
}

interface Offre {
  id: string;
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
}

interface Attribution {
  lot_id: string;
  entreprise_id: string;
  montant: number;
}

interface ComparatifArticle {
  id: string;
  code: string;
  titre: string;
  unite?: string;
  quantite?: number;
  estimatif?: number;
  prix: Record<string, number>;
  is_section_header?: boolean;
  is_subtotal?: boolean;
}

interface ComparatifLot {
  lot_id: string;
  articles: ComparatifArticle[];
}

interface Consultation {
  dce_documents: DCEDocument[];
  entreprises: EntrepriseConsultee[];
  criteres: CritereNotation[];
  pieces_admin: PieceAdmin[];
  questions: QuestionReponse[];
  offres: Offre[];
  attributions: Attribution[];
  comparatif: ComparatifLot[];
}

type Phase = 'preparation' | 'criteres' | 'portail' | 'collecte' | 'analyse';

const PHASES: { id: Phase; label: string; short: string; icon: React.ElementType }[] = [
  { id: 'preparation', label: 'Préparation de la consultation', short: 'Préparation', icon: IconFileText },
  { id: 'criteres', label: 'Critères d\'analyse', short: 'Critères', icon: IconScale },
  { id: 'portail', label: 'Portail entreprises / Q&R', short: 'Q & R', icon: IconMessageDots },
  { id: 'collecte', label: 'Collecte des offres', short: 'Offres', icon: IconCurrencyEuro },
  { id: 'analyse', label: 'Analyse & Attribution', short: 'Attribution', icon: IconTrophy },
];

const TYPE_DOC_LABELS: Record<string, string> = {
  RC: 'Règlement de la Consultation',
  CCAP: 'CCAP',
  CCTP: 'CCTP',
  DPGF: 'DPGF / BPU',
  Plans: 'Plans',
  Autre: 'Autre document',
};

const EMPTY_CONSULTATION: Consultation = {
  dce_documents: [],
  entreprises: [],
  criteres: [
    { id: 'prix', nom: 'Prix (offre financière)', poids: 60 },
    { id: 'tech', nom: 'Valeur technique (mémoire)', poids: 40 },
  ],
  pieces_admin: [
    { id: 'kbis', nom: 'Extrait Kbis ou équivalent' },
    { id: 'dc1', nom: 'DC1 — Lettre de candidature' },
    { id: 'dc2', nom: 'DC2 — Déclaration du candidat' },
    { id: 'assurance', nom: 'Attestation assurance décennale' },
    { id: 'urssaf', nom: 'Attestation de vigilance URSSAF' },
  ],
  questions: [],
  offres: [],
  attributions: [],
  comparatif: [],
};

function fmt(n?: number) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

// ── RAO PDF ───────────────────────────────────────────────────────────────────

function generateRAO(
  lots: ProjectLot[],
  consultation: Consultation,
  projectName: string,
  lotId?: string
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const margin = 14;

  const lotsToAnalyse = lotId
    ? lots.filter(l => l.id === lotId)
    : lots.filter(l => consultation.offres.some(o => o.lot_id === l.id));

  let pageAdded = false;

  lotsToAnalyse.forEach((lot, idx) => {
    if (idx > 0) { doc.addPage(); pageAdded = true; }

    // Header
    doc.setFillColor(32, 107, 196);
    doc.rect(0, 0, W, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('RAPPORT D\'ANALYSE DES OFFRES', margin, 13);
    doc.setFontSize(9);
    doc.text(`${projectName} — Lot ${lot.lot_number} : ${lot.lot_title}`, W - margin, 13, { align: 'right' });

    const offresLot = consultation.offres.filter(o => o.lot_id === lot.id);
    if (offresLot.length === 0) {
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(10);
      doc.text('Aucune offre saisie pour ce lot.', W / 2, 60, { align: 'center' });
      return;
    }

    // Montants
    const montantsConformes = offresLot.filter(o => o.conforme).map(o => o.montant_base);
    const minMontant = Math.min(...montantsConformes);

    // Tableau
    const head = [['Entreprise', 'Montant HT', '% / moins-disant', 'Conformité', 'Note prix', 'Note tech.', ...consultation.criteres.map(c => `${c.nom}\n(${c.poids}%)`), 'NOTE GLOBALE', 'Rang']];
    const body = offresLot.map(offre => {
      const entreprise = consultation.entreprises.find(e => e.id === offre.entreprise_id);
      const nomEntreprise = entreprise?.nom || '—';
      const pctMinDisant = minMontant > 0 ? ((offre.montant_base - minMontant) / minMontant * 100).toFixed(1) + '%' : '—';
      const notePrix = offre.conforme && offre.montant_base > 0 ? (minMontant / offre.montant_base * 100).toFixed(1) : '—';
      const poidsPrix = consultation.criteres.find(c => c.id === 'prix')?.poids ?? 60;
      const poidsTech = consultation.criteres.find(c => c.id === 'tech')?.poids ?? 40;
      const noteGlobale = offre.conforme
        ? ((parseFloat(notePrix) || 0) * poidsPrix / 100 + (offre.note_technique || 0) * poidsTech / 100).toFixed(1)
        : 'NC';
      const extraCriteres = consultation.criteres.filter(c => c.id !== 'prix' && c.id !== 'tech').map(() => '—');
      return [
        nomEntreprise,
        fmt(offre.montant_base),
        offre.conforme ? `+${pctMinDisant}` : 'NC',
        offre.conforme ? '✓ Conforme' : `✗ ${offre.motif_nc || 'Non conforme'}`,
        notePrix,
        String(offre.note_technique || '—'),
        ...extraCriteres,
        noteGlobale,
        '—',
      ];
    });

    // Trier par note globale
    body.sort((a, b) => {
      const nA = parseFloat(a[a.length - 2]) || -1;
      const nB = parseFloat(b[b.length - 2]) || -1;
      return nB - nA;
    });
    body.forEach((row, i) => { row[row.length - 1] = String(i + 1); });

    autoTable(doc, {
      startY: 28,
      margin: { left: margin, right: margin },
      head,
      body,
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [32, 107, 196], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 255] },
      columnStyles: { 0: { cellWidth: 40 } },
    });

    // Attribution
    const attribution = consultation.attributions.find(a => a.lot_id === lot.id);
    if (attribution) {
      const entreprise = consultation.entreprises.find(e => e.id === attribution.entreprise_id);
      const finalY = (doc as any).lastAutoTable.finalY + 6;
      doc.setFillColor(212, 237, 218);
      doc.rect(margin, finalY, W - 2 * margin, 10, 'F');
      doc.setTextColor(47, 133, 90);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`▶  LOT ATTRIBUÉ À : ${entreprise?.nom || '—'} — ${fmt(attribution.montant)} HT`, margin + 3, finalY + 6.5);
    }
  });

  if (!pageAdded && lotsToAnalyse.length === 0) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(11);
    doc.text('Aucun lot avec des offres à analyser.', W / 2, 60, { align: 'center' });
  }

  const pages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 170);
    doc.text(`RAO — ${projectName} — Page ${i}/${pages}`, W / 2, 206, { align: 'center' });
  }
  doc.save(`RAO_${projectName.replace(/\s+/g, '_')}_${lotId ? `Lot${lotId}` : 'Global'}.pdf`);
}

// ── Excel Comparatif ──────────────────────────────────────────────────────────

async function generateComparatifExcel(lots: ProjectLot[], consultation: Consultation, projectName: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows: (string | number | undefined)[][] = [];
  const styles: { row: number; col: number; style: string }[] = [];

  const entreprises = consultation.entreprises;

  rows.push([projectName]);
  rows.push([`Date : ${new Date().toLocaleDateString('fr-FR')}`]);
  rows.push([]);
  const headerRow: (string | number | undefined)[] = ['Code', 'Titre', 'Estimatif HT (€)', ...entreprises.map(e => e.nom)];
  rows.push(headerRow);

  for (const lot of lots) {
    const cl = (consultation.comparatif || []).find(c => c.lot_id === lot.id);
    const lotRow: (string | number | undefined)[] = [`Lot ${lot.lot_number} - ${lot.lot_title}`, '', '', ...entreprises.map(() => undefined)];
    rows.push(lotRow);

    if (cl && cl.articles.length > 0) {
      for (const article of cl.articles) {
        if (article.is_section_header) {
          rows.push([article.code || '', article.titre, '', ...entreprises.map(() => undefined)]);
        } else if (article.is_subtotal) {
          const subtotalRow: (string | number | undefined)[] = ['', article.titre, ''];
          for (const e of entreprises) {
            const val = article.prix[e.id];
            subtotalRow.push(val != null ? val : undefined);
          }
          rows.push(subtotalRow);
        } else {
          const articleRow: (string | number | undefined)[] = [
            article.code || '',
            article.titre,
            article.estimatif != null ? article.estimatif : undefined,
          ];
          for (const e of entreprises) {
            const val = article.prix[e.id];
            articleRow.push(val != null ? val : undefined);
          }
          rows.push(articleRow);
        }
      }
    }

    // Sous-total lot depuis offres
    const lotOffresRow: (string | number | undefined)[] = ['', 'Sous-total du lot HT', ''];
    for (const e of entreprises) {
      const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === e.id);
      lotOffresRow.push(offre && offre.montant_base ? offre.montant_base : undefined);
    }
    rows.push(lotOffresRow);
    rows.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 45 }, { wch: 16 },
    ...entreprises.map(() => ({ wch: 18 })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Comparaison');

  // Per-company sheets
  for (const e of entreprises) {
    const eRows: (string | number | undefined)[][] = [];
    eRows.push([e.nom]);
    eRows.push([]);
    eRows.push(['Code', 'Désignation', 'Estimatif HT', 'Offre HT']);

    for (const lot of lots) {
      const cl = (consultation.comparatif || []).find(c => c.lot_id === lot.id);
      eRows.push([`Lot ${lot.lot_number} - ${lot.lot_title}`, '', '', '']);
      if (cl) {
        for (const article of cl.articles) {
          if (!article.is_section_header && !article.is_subtotal) {
            const val = article.prix[e.id];
            eRows.push([article.code || '', article.titre, article.estimatif ?? '', val ?? '']);
          }
        }
      }
      const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === e.id);
      eRows.push(['', 'Total lot HT', '', offre?.montant_base ?? '']);
      eRows.push([]);
    }

    const ews = XLSX.utils.aoa_to_sheet(eRows);
    ews['!cols'] = [{ wch: 12 }, { wch: 45 }, { wch: 16 }, { wch: 18 }];
    const sheetName = e.nom.substring(0, 31).replace(/[\\/:*?[\]]/g, '_');
    XLSX.utils.book_append_sheet(wb, ews, sheetName);
  }

  XLSX.writeFile(wb, `Comparatif_${projectName.replace(/\s+/g, '_')}.xlsx`);
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ACTModuleProps {
  projectId: string;
  projectName: string;
  lots: ProjectLot[];
  contacts: Contact[];
  onLotsChange: (lots: ProjectLot[]) => void;
}

export default function ACTModule({ projectId, projectName, lots, contacts, onLotsChange }: ACTModuleProps) {
  const [phase, setPhase] = useState<Phase>('preparation');
  const [consultation, setConsultation] = useState<Consultation>(EMPTY_CONSULTATION);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Lot form
  const [showLotForm, setShowLotForm] = useState(false);
  const [lotForm, setLotForm] = useState({ lot_number: '', lot_title: '' });

  // Q&R form
  const [showQRForm, setShowQRForm] = useState(false);
  const [qrForm, setQrForm] = useState({ entreprise_id: '', question: '', reponse: '', publique: false });
  const [repondreId, setRepondreId] = useState<string | null>(null);

  // Comparatif
  const [showComparatif, setShowComparatif] = useState(false);
  const [expandedComparatifLots, setExpandedComparatifLots] = useState<Set<string>>(new Set());

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/api/projects/${projectId}/act`);
      if (data?.consultation && Object.keys(data.consultation).length > 0) {
        setConsultation({ ...EMPTY_CONSULTATION, ...data.consultation });
      }
      if (data?.act_phase) setPhase(data.act_phase as Phase);
    } catch { /* first load */ }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (c: Consultation, p: Phase) => {
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/act`, {
        method: 'PUT',
        body: JSON.stringify({ consultation: c, act_phase: p }),
      });
      setDirty(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }, [projectId]);

  const update = (c: Consultation) => {
    setConsultation(c);
    setDirty(true);
  };

  // ── Lot helpers ───────────────────────────────────────────────────────────

  const addLot = () => {
    if (!lotForm.lot_title.trim()) return;
    const newLot: ProjectLot = {
      id: crypto.randomUUID(),
      project_id: projectId,
      lot_number: lotForm.lot_number || String(lots.length + 1),
      lot_title: lotForm.lot_title,
    };
    onLotsChange([...lots, newLot]);
    setLotForm({ lot_number: '', lot_title: '' });
    setShowLotForm(false);
  };

  const removeLot = (id: string) => {
    if (!confirm('Supprimer ce lot ?')) return;
    onLotsChange(lots.filter(l => l.id !== id));
  };

  // ── Phase helpers ─────────────────────────────────────────────────────────

  const goPhase = (p: Phase) => {
    if (dirty) save(consultation, p);
    else save(consultation, p);
    setPhase(p);
  };

  const phaseIdx = PHASES.findIndex(p => p.id === phase);

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Stepper */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
        <div className="flex items-center gap-0 overflow-x-auto">
          {PHASES.map((p, i) => {
            const Icon = p.icon;
            const active = p.id === phase;
            const done = i < phaseIdx;
            return (
              <React.Fragment key={p.id}>
                <button
                  onClick={() => goPhase(p.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex-shrink-0',
                    active ? 'bg-blue-600 text-white shadow-sm' :
                    done ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' :
                    'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  )}
                >
                  {done && !active ? <IconCircleCheck size={14} /> : <Icon size={14} />}
                  <span className="hidden sm:inline">{p.short}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
                {i < PHASES.length - 1 && (
                  <IconChevronRight size={14} className="flex-shrink-0 mx-1 text-zinc-300 dark:text-zinc-600" />
                )}
              </React.Fragment>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => save(consultation, phase)}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-all"
            >
              <IconCheck size={12} />
              {saving ? 'Enregistrement…' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Phase 1 : Préparation ─────────────────────────────────────── */}
      {phase === 'preparation' && (
        <div className="space-y-6">

          {/* Lots */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <IconClipboardList size={15} /> Lots de travaux
              </h3>
              <button onClick={() => setShowLotForm(!showLotForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all">
                <IconPlus size={13} /> Ajouter un lot
              </button>
            </div>
            {showLotForm && (
              <div className="px-5 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 flex gap-3">
                <input className="w-20 px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="N°" value={lotForm.lot_number} onChange={e => setLotForm({ ...lotForm, lot_number: e.target.value })} />
                <input className="flex-1 px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Désignation du lot (ex : Gros œuvre)" value={lotForm.lot_title} onChange={e => setLotForm({ ...lotForm, lot_title: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && addLot()} />
                <button onClick={addLot} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">Ajouter</button>
                <button onClick={() => setShowLotForm(false)} className="p-1.5 text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400 w-16">N°</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Désignation</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Entreprise attribuée</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-zinc-400">Montant HT</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lots.map(lot => {
                  const attr = consultation.attributions.find(a => a.lot_id === lot.id);
                  const entreprise = attr ? consultation.entreprises.find(e => e.id === attr.entreprise_id) : null;
                  return (
                    <tr key={lot.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-bold text-zinc-700 dark:text-zinc-300">{lot.lot_number}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">{lot.lot_title}</td>
                      <td className="px-4 py-3 text-zinc-500">{entreprise?.nom || lot.contact_name || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-700 dark:text-zinc-300">
                        {attr?.montant ? fmt(attr.montant) : fmt((lot.base_amount || 0) + (lot.options_amount || 0))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => removeLot(lot.id)} className="p-1 text-zinc-300 hover:text-red-500 transition-colors"><IconTrash size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
                {lots.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400 italic text-sm">Aucun lot défini. Ajoutez les lots de travaux.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* DCE Documents */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconFileText size={15} /> Dossier de Consultation des Entreprises (DCE)
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Listez les documents du DCE et précisez leur disponibilité par lot</p>
              </div>
              <button onClick={() => {
                const newDoc: DCEDocument = { id: crypto.randomUUID(), nom: '', type_doc: 'RC', tous_lots: true, lots_ids: [] };
                update({ ...consultation, dce_documents: [...consultation.dce_documents, newDoc] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-3">
              {consultation.dce_documents.length === 0 && (
                <p className="text-sm text-zinc-400 italic text-center py-4">Aucun document DCE. Cliquez sur "Ajouter" pour commencer.</p>
              )}
              {consultation.dce_documents.map((doc, idx) => (
                <div key={doc.id} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      className="px-2.5 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      value={doc.type_doc}
                      onChange={e => {
                        const docs = [...consultation.dce_documents];
                        docs[idx] = { ...doc, type_doc: e.target.value as DCEDocument['type_doc'], nom: TYPE_DOC_LABELS[e.target.value] || '' };
                        update({ ...consultation, dce_documents: docs });
                      }}
                    >
                      {Object.entries(TYPE_DOC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input
                      className="px-2.5 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Intitulé précis"
                      value={doc.nom}
                      onChange={e => {
                        const docs = [...consultation.dce_documents];
                        docs[idx] = { ...doc, nom: e.target.value };
                        update({ ...consultation, dce_documents: docs });
                      }}
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                        <input type="checkbox" checked={doc.tous_lots} onChange={e => {
                          const docs = [...consultation.dce_documents];
                          docs[idx] = { ...doc, tous_lots: e.target.checked };
                          update({ ...consultation, dce_documents: docs });
                        }} className="rounded w-3.5 h-3.5" />
                        Tous les lots
                      </label>
                      {!doc.tous_lots && lots.map(lot => (
                        <label key={lot.id} className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer">
                          <input type="checkbox"
                            checked={doc.lots_ids.includes(lot.id)}
                            onChange={e => {
                              const docs = [...consultation.dce_documents];
                              const ids = e.target.checked ? [...doc.lots_ids, lot.id] : doc.lots_ids.filter(i => i !== lot.id);
                              docs[idx] = { ...doc, lots_ids: ids };
                              update({ ...consultation, dce_documents: docs });
                            }}
                            className="rounded w-3.5 h-3.5"
                          />
                          Lot {lot.lot_number}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => update({ ...consultation, dce_documents: consultation.dce_documents.filter(d => d.id !== doc.id) })} className="p-1 text-zinc-300 hover:text-red-500 transition-colors flex-shrink-0 mt-1"><IconTrash size={13} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Entreprises consultées */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconBuilding size={15} /> Entreprises consultées
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Sélectionnez les entreprises et affectez-leur les lots</p>
              </div>
              <button onClick={() => {
                const newE: EntrepriseConsultee = { id: crypto.randomUUID(), nom: '', lots_ids: [], envoyer_dce: true };
                update({ ...consultation, entreprises: [...consultation.entreprises, newE] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Entreprise</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Email</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Lots assignés</th>
                    <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400">Envoyer DCE</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {consultation.entreprises.map((e, idx) => (
                    <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td className="px-4 py-3">
                        <select
                          className="w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                          value={e.contact_id || ''}
                          onChange={ev => {
                            const contact = contacts.find(c => c.id === ev.target.value);
                            const nom = contact ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()) : '';
                            const email = contact?.email_work || contact?.email || '';
                            const newE = [...consultation.entreprises];
                            newE[idx] = { ...e, contact_id: ev.target.value, nom, email };
                            update({ ...consultation, entreprises: newE });
                          }}
                        >
                          <option value="">— Sélectionner —</option>
                          {contacts.map(c => (
                            <option key={c.id} value={c.id}>{c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}</option>
                          ))}
                        </select>
                        {!e.contact_id && (
                          <input className="mt-1 w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none"
                            placeholder="Ou saisir un nom" value={e.nom}
                            onChange={ev => { const es = [...consultation.entreprises]; es[idx] = { ...e, nom: ev.target.value }; update({ ...consultation, entreprises: es }); }} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input className="w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none"
                          placeholder="email@entreprise.fr" value={e.email || ''}
                          onChange={ev => { const es = [...consultation.entreprises]; es[idx] = { ...e, email: ev.target.value }; update({ ...consultation, entreprises: es }); }} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {lots.map(lot => (
                            <label key={lot.id} className={cn(
                              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-colors',
                              e.lots_ids.includes(lot.id)
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-200'
                            )}>
                              <input type="checkbox" className="hidden"
                                checked={e.lots_ids.includes(lot.id)}
                                onChange={ev => {
                                  const es = [...consultation.entreprises];
                                  const ids = ev.target.checked ? [...e.lots_ids, lot.id] : e.lots_ids.filter(i => i !== lot.id);
                                  es[idx] = { ...e, lots_ids: ids };
                                  update({ ...consultation, entreprises: es });
                                }}
                              />
                              {e.lots_ids.includes(lot.id) && <IconCheck size={9} />}
                              Lot {lot.lot_number}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={!!e.envoyer_dce}
                          onChange={ev => { const es = [...consultation.entreprises]; es[idx] = { ...e, envoyer_dce: ev.target.checked }; update({ ...consultation, entreprises: es }); }}
                          className="w-4 h-4 rounded accent-blue-600" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => update({ ...consultation, entreprises: consultation.entreprises.filter(en => en.id !== e.id) })} className="p-1 text-zinc-300 hover:text-red-500"><IconTrash size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {consultation.entreprises.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400 italic text-sm">Aucune entreprise consultée.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 2 : Critères ────────────────────────────────────────── */}
      {phase === 'criteres' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Critères de notation */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconPercentage size={15} /> Critères de notation
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Total : {consultation.criteres.reduce((s, c) => s + c.poids, 0)} % (doit être 100 %)</p>
              </div>
              <button onClick={() => {
                const nc: CritereNotation = { id: crypto.randomUUID(), nom: '', poids: 0 };
                update({ ...consultation, criteres: [...consultation.criteres, nc] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-2">
              {consultation.criteres.map((c, idx) => (
                <div key={c.id} className="flex items-center gap-3">
                  <input className="flex-1 text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nom du critère" value={c.nom}
                    onChange={e => { const cr = [...consultation.criteres]; cr[idx] = { ...c, nom: e.target.value }; update({ ...consultation, criteres: cr }); }} />
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <input type="number" min={0} max={100}
                      className="w-16 text-sm text-center px-2 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      value={c.poids}
                      onChange={e => { const cr = [...consultation.criteres]; cr[idx] = { ...c, poids: parseInt(e.target.value) || 0 }; update({ ...consultation, criteres: cr }); }} />
                    <span className="text-xs text-zinc-400">%</span>
                  </div>
                  <button onClick={() => update({ ...consultation, criteres: consultation.criteres.filter(x => x.id !== c.id) })} className="p-1 text-zinc-300 hover:text-red-500"><IconTrash size={13} /></button>
                </div>
              ))}
              {(() => {
                const total = consultation.criteres.reduce((s, c) => s + c.poids, 0);
                if (total !== 100) return (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs mt-3">
                    <IconAlertTriangle size={14} />
                    Total actuel : {total} % — Le total doit être égal à 100 %
                  </div>
                );
                return <p className="text-xs text-green-600 dark:text-green-400 font-bold flex items-center gap-1 mt-3"><IconCheck size={12} /> Total : 100 %</p>;
              })()}
            </div>
          </div>

          {/* Pièces administratives obligatoires */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconClipboardList size={15} /> Pièces administratives obligatoires
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Documents requis pour la conformité de l'offre</p>
              </div>
              <button onClick={() => {
                const np: PieceAdmin = { id: crypto.randomUUID(), nom: '' };
                update({ ...consultation, pieces_admin: [...consultation.pieces_admin, np] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-2">
              {consultation.pieces_admin.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-2">
                  <IconCheck size={14} className="text-green-500 flex-shrink-0" />
                  <input className="flex-1 text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                    value={p.nom}
                    onChange={e => { const ps = [...consultation.pieces_admin]; ps[idx] = { ...p, nom: e.target.value }; update({ ...consultation, pieces_admin: ps }); }}
                    placeholder="ex : Attestation URSSAF" />
                  <button onClick={() => update({ ...consultation, pieces_admin: consultation.pieces_admin.filter(x => x.id !== p.id) })} className="p-1 text-zinc-300 hover:text-red-500"><IconTrash size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 3 : Portail / Q&R ──────────────────────────────────── */}
      {phase === 'portail' && (
        <div className="space-y-6">
          {/* Récapitulatif DCE */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <IconEye size={15} /> Documents DCE disponibles
              </h3>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {consultation.dce_documents.map(doc => (
                <div key={doc.id} className="flex items-start gap-3 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
                  <IconFileText size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{doc.nom || TYPE_DOC_LABELS[doc.type_doc]}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {doc.tous_lots ? 'Tous les lots' : `Lots : ${doc.lots_ids.map(lid => lots.find(l => l.id === lid)?.lot_number).filter(Boolean).join(', ')}`}
                    </p>
                  </div>
                </div>
              ))}
              {consultation.dce_documents.length === 0 && <p className="text-sm text-zinc-400 italic col-span-3">Aucun document DCE défini à la phase 1.</p>}
            </div>
          </div>

          {/* Questions / Réponses */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconMessageDots size={15} /> Questions / Réponses
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Centralisez les questions des entreprises et les réponses publiques</p>
              </div>
              <button onClick={() => setShowQRForm(!showQRForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Nouvelle question
              </button>
            </div>

            {showQRForm && (
              <div className="p-5 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <select className="text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none"
                    value={qrForm.entreprise_id}
                    onChange={e => setQrForm({ ...qrForm, entreprise_id: e.target.value })}>
                    <option value="">— Entreprise —</option>
                    {consultation.entreprises.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={qrForm.publique} onChange={e => setQrForm({ ...qrForm, publique: e.target.checked })} className="rounded w-4 h-4" />
                    Réponse publique (visible par tous)
                  </label>
                </div>
                <textarea className="w-full text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-20"
                  placeholder="Question de l'entreprise…"
                  value={qrForm.question} onChange={e => setQrForm({ ...qrForm, question: e.target.value })} />
                <textarea className="w-full text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-16"
                  placeholder="Réponse (optionnel pour l'instant)…"
                  value={qrForm.reponse} onChange={e => setQrForm({ ...qrForm, reponse: e.target.value })} />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowQRForm(false)} className="px-3 py-1.5 text-xs text-zinc-500">Annuler</button>
                  <button onClick={() => {
                    if (!qrForm.question.trim()) return;
                    const entreprise = consultation.entreprises.find(e => e.id === qrForm.entreprise_id);
                    const newQ: QuestionReponse = {
                      id: crypto.randomUUID(),
                      entreprise_id: qrForm.entreprise_id,
                      entreprise_nom: entreprise?.nom || 'Anonyme',
                      question: qrForm.question,
                      date_question: new Date().toISOString().split('T')[0],
                      reponse: qrForm.reponse || undefined,
                      date_reponse: qrForm.reponse ? new Date().toISOString().split('T')[0] : undefined,
                      publique: qrForm.publique,
                    };
                    update({ ...consultation, questions: [...consultation.questions, newQ] });
                    setQrForm({ entreprise_id: '', question: '', reponse: '', publique: false });
                    setShowQRForm(false);
                  }} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">Enregistrer</button>
                </div>
              </div>
            )}

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {consultation.questions.map(q => (
                <div key={q.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{q.entreprise_nom}</span>
                        <span className="text-[10px] text-zinc-400">{new Date(q.date_question).toLocaleDateString('fr-FR')}</span>
                        {q.publique && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">Publique</span>}
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2">{q.question}</p>
                      {q.reponse ? (
                        <div className="mt-2 ml-4 pl-3 border-l-2 border-blue-300">
                          <p className="text-xs text-zinc-500 mb-0.5">Réponse — {q.date_reponse && new Date(q.date_reponse).toLocaleDateString('fr-FR')}</p>
                          <p className="text-sm text-blue-700 dark:text-blue-300">{q.reponse}</p>
                        </div>
                      ) : (
                        repondreId === q.id ? (
                          <div className="mt-2 ml-4 space-y-2">
                            <textarea className="w-full text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-16"
                              placeholder="Votre réponse…"
                              onChange={e => {
                                const qs = consultation.questions.map(x => x.id === q.id ? { ...x, _draft: e.target.value } : x);
                                setConsultation({ ...consultation, questions: qs });
                              }} />
                            <div className="flex gap-2">
                              <button onClick={() => setRepondreId(null)} className="text-xs text-zinc-500 px-2 py-1">Annuler</button>
                              <button onClick={() => {
                                const qs = consultation.questions.map(x => {
                                  if (x.id !== q.id) return x;
                                  const { _draft, ...rest } = x as any;
                                  return { ...rest, reponse: _draft || '', date_reponse: new Date().toISOString().split('T')[0] };
                                });
                                update({ ...consultation, questions: qs });
                                setRepondreId(null);
                              }} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg font-bold">Répondre</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setRepondreId(q.id)} className="mt-2 ml-4 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                            <IconSend size={11} /> Répondre
                          </button>
                        )
                      )}
                    </div>
                    <button onClick={() => update({ ...consultation, questions: consultation.questions.filter(x => x.id !== q.id) })} className="p-1 text-zinc-300 hover:text-red-500 flex-shrink-0"><IconTrash size={13} /></button>
                  </div>
                </div>
              ))}
              {consultation.questions.length === 0 && <div className="px-4 py-8 text-center text-zinc-400 italic text-sm">Aucune question enregistrée.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 4 : Collecte des offres ─────────────────────────────── */}
      {phase === 'collecte' && (
        <div className="space-y-6">
          {lots.map(lot => {
            const entreprisesLot = consultation.entreprises.filter(e => e.lots_ids.includes(lot.id));
            return (
              <div key={lot.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-black">Lot {lot.lot_number}</span>
                    {lot.lot_title}
                  </h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{entreprisesLot.length} entreprise(s) consultée(s) sur ce lot</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Entreprise</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-zinc-400">Montant HT (€)</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400">Note technique /100</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400">Conforme</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400">Motif NC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {entreprisesLot.map(entreprise => {
                        const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id)
                          || { id: crypto.randomUUID(), lot_id: lot.id, entreprise_id: entreprise.id, montant_base: 0, note_technique: 0, conforme: true, motif_nc: '' };
                        const updateOffre = (updates: Partial<Offre>) => {
                          const existing = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id);
                          let newOffres;
                          if (existing) {
                            newOffres = consultation.offres.map(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id ? { ...o, ...updates } : o);
                          } else {
                            newOffres = [...consultation.offres, { ...offre, ...updates }];
                          }
                          update({ ...consultation, offres: newOffres });
                        };
                        return (
                          <tr key={entreprise.id} className={cn('hover:bg-zinc-50 dark:hover:bg-zinc-800/30', !offre.conforme && 'bg-red-50/50 dark:bg-red-900/10')}>
                            <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">{entreprise.nom}</td>
                            <td className="px-4 py-3">
                              <input type="number" min={0} step={100}
                                className="w-full text-right px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                                value={offre.montant_base || ''}
                                onChange={e => updateOffre({ montant_base: parseFloat(e.target.value) || 0 })}
                                placeholder="0.00" />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" min={0} max={100}
                                className="w-20 mx-auto block text-center px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                                value={offre.note_technique || ''}
                                onChange={e => updateOffre({ note_technique: parseFloat(e.target.value) || 0 })}
                                placeholder="—" />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="checkbox" checked={!!offre.conforme}
                                onChange={e => updateOffre({ conforme: e.target.checked })}
                                className="w-4 h-4 rounded accent-green-600" />
                            </td>
                            <td className="px-4 py-3">
                              {!offre.conforme && (
                                <input className="w-full text-xs px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg bg-white dark:bg-zinc-900 outline-none"
                                  placeholder="Motif de non-conformité"
                                  value={offre.motif_nc || ''}
                                  onChange={e => updateOffre({ motif_nc: e.target.value })} />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {entreprisesLot.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-400 italic text-sm">Aucune entreprise affectée à ce lot (phase 1).</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {lots.length === 0 && <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-400 italic">Aucun lot défini. Créez les lots en phase 1.</div>}

          {/* ── Comparatif détaillé ──────────────────────────────────────── */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <IconScale size={15} /> Comparatif détaillé des offres
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">Tableau article par article — saisie manuelle ou auto-rempli depuis les offres</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Auto-fill lot totals from offres into comparatif
                    const comp: ComparatifLot[] = lots.map(lot => {
                      const existing = (consultation.comparatif || []).find(cl => cl.lot_id === lot.id);
                      const articles: ComparatifArticle[] = existing?.articles || [];
                      // Ensure a sous-total-lot row exists
                      const hasTotalRow = articles.some(a => a.is_subtotal && a.code === '__lot_total__');
                      const totalRow: ComparatifArticle = hasTotalRow
                        ? articles.find(a => a.is_subtotal && a.code === '__lot_total__')!
                        : { id: crypto.randomUUID(), code: '__lot_total__', titre: 'Sous-total du lot HT', is_subtotal: true, prix: {} };
                      // Fill prices from offres
                      const newPrix: Record<string, number> = { ...totalRow.prix };
                      consultation.offres.filter(o => o.lot_id === lot.id).forEach(o => {
                        if (o.montant_base) newPrix[o.entreprise_id] = o.montant_base;
                      });
                      const newTotalRow = { ...totalRow, prix: newPrix };
                      const filtered = articles.filter(a => !(a.is_subtotal && a.code === '__lot_total__'));
                      return { lot_id: lot.id, articles: [...filtered, newTotalRow] };
                    });
                    update({ ...consultation, comparatif: comp });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                >
                  <IconCheck size={13} /> Auto-remplir totaux
                </button>
                <button
                  onClick={() => generateComparatifExcel(lots, consultation, projectName)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition-all"
                >
                  <IconDownload size={13} /> Export Excel
                </button>
                <button
                  onClick={() => setShowComparatif(!showComparatif)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition-all"
                >
                  {showComparatif ? <IconX size={13} /> : <IconEye size={13} />}
                  {showComparatif ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </div>

            {showComparatif && (
              <div className="p-5 space-y-6">
                {lots.length === 0 && <p className="text-sm text-zinc-400 italic text-center py-4">Aucun lot défini.</p>}
                {lots.map(lot => {
                  const cl: ComparatifLot = (consultation.comparatif || []).find(c => c.lot_id === lot.id) || { lot_id: lot.id, articles: [] };
                  const entreprisesLot = consultation.entreprises.filter(e => e.lots_ids.includes(lot.id));
                  const isExpanded = expandedComparatifLots.has(lot.id);

                  const updateCL = (newArticles: ComparatifArticle[]) => {
                    const newComp = (consultation.comparatif || []).filter(c => c.lot_id !== lot.id);
                    newComp.push({ lot_id: lot.id, articles: newArticles });
                    update({ ...consultation, comparatif: newComp });
                  };

                  const updateArticle = (idx: number, patch: Partial<ComparatifArticle>) => {
                    const arts = [...cl.articles];
                    arts[idx] = { ...arts[idx], ...patch };
                    updateCL(arts);
                  };

                  const updatePrix = (idx: number, entrepriseId: string, val: number) => {
                    const arts = [...cl.articles];
                    arts[idx] = { ...arts[idx], prix: { ...arts[idx].prix, [entrepriseId]: val } };
                    updateCL(arts);
                  };

                  const removeArticle = (idx: number) => {
                    updateCL(cl.articles.filter((_, i) => i !== idx));
                  };

                  const addSection = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: 'Nouvelle section', is_section_header: true, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  const addArticle = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: '', estimatif: undefined, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  const addSubtotal = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: 'Sous-total HT', is_subtotal: true, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  return (
                    <div key={lot.id} className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedComparatifLots(prev => {
                          const next = new Set(prev);
                          next.has(lot.id) ? next.delete(lot.id) : next.add(lot.id);
                          return next;
                        })}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <IconChevronRight size={14} className="rotate-90 transition-transform" /> : <IconChevronRight size={14} className="transition-transform" />}
                          <span className="text-xs font-black text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">Lot {lot.lot_number}</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{lot.lot_title}</span>
                          <span className="text-[10px] text-zinc-400">({cl.articles.length} lignes)</span>
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={addSection} className="px-2 py-1 text-[10px] font-bold rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300">+ Section</button>
                          <button onClick={addArticle} className="px-2 py-1 text-[10px] font-bold rounded bg-blue-100 text-blue-700 hover:bg-blue-200">+ Article</button>
                          <button onClick={addSubtotal} className="px-2 py-1 text-[10px] font-bold rounded bg-amber-100 text-amber-700 hover:bg-amber-200">+ Sous-total</button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs" style={{ minWidth: `${300 + entreprisesLot.length * 140}px` }}>
                            <thead className="bg-zinc-100 dark:bg-zinc-800">
                              <tr>
                                <th className="px-3 py-2 text-left font-bold text-zinc-500 w-20">Code</th>
                                <th className="px-3 py-2 text-left font-bold text-zinc-500">Désignation</th>
                                <th className="px-3 py-2 text-right font-bold text-zinc-500 w-28">Estimatif HT</th>
                                {entreprisesLot.map(e => (
                                  <th key={e.id} className="px-3 py-2 text-right font-bold text-zinc-700 dark:text-zinc-300 w-36 whitespace-nowrap">{e.nom}</th>
                                ))}
                                <th className="w-8"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {cl.articles.map((article, idx) => {
                                if (article.is_section_header) {
                                  return (
                                    <tr key={article.id} className="bg-blue-50 dark:bg-blue-900/10">
                                      <td className="px-3 py-2">
                                        <input className="w-full bg-transparent text-[10px] font-bold text-blue-600 outline-none border-b border-blue-200 dark:border-blue-800"
                                          value={article.code} onChange={e => updateArticle(idx, { code: e.target.value })} placeholder="Réf." />
                                      </td>
                                      <td colSpan={2 + entreprisesLot.length} className="px-3 py-2">
                                        <input className="w-full bg-transparent text-xs font-bold text-blue-700 dark:text-blue-300 uppercase outline-none"
                                          value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2 text-right">
                                        <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                      </td>
                                    </tr>
                                  );
                                }
                                if (article.is_subtotal) {
                                  return (
                                    <tr key={article.id} className="bg-amber-50 dark:bg-amber-900/10 font-bold">
                                      <td className="px-3 py-2 text-zinc-400 text-[10px]">{article.code !== '__lot_total__' ? article.code : ''}</td>
                                      <td className="px-3 py-2">
                                        <input className="w-full bg-transparent text-xs font-bold text-amber-700 dark:text-amber-400 outline-none"
                                          value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} readOnly={article.code === '__lot_total__'} />
                                      </td>
                                      <td className="px-3 py-2 text-right text-zinc-400">—</td>
                                      {entreprisesLot.map(e => (
                                        <td key={e.id} className="px-3 py-2 text-right">
                                          <input type="number" min={0} step={100}
                                            className="w-full text-right px-1.5 py-1 border border-amber-200 dark:border-amber-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-amber-400 text-xs font-bold"
                                            value={article.prix[e.id] ?? ''}
                                            onChange={ev => updatePrix(idx, e.id, parseFloat(ev.target.value) || 0)}
                                            placeholder="—" />
                                        </td>
                                      ))}
                                      <td className="px-2 py-2 text-right">
                                        {article.code !== '__lot_total__' && (
                                          <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                }
                                return (
                                  <tr key={article.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                    <td className="px-3 py-2">
                                      <input className="w-full text-[10px] px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400"
                                        value={article.code} onChange={e => updateArticle(idx, { code: e.target.value })} placeholder="1.3.1" />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input className="w-full text-xs px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400"
                                        value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} placeholder="Désignation de l'article" />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="number" min={0} step={100}
                                        className="w-full text-right px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400 text-xs"
                                        value={article.estimatif ?? ''}
                                        onChange={e => updateArticle(idx, { estimatif: parseFloat(e.target.value) || undefined })}
                                        placeholder="—" />
                                    </td>
                                    {entreprisesLot.map(e => (
                                      <td key={e.id} className="px-3 py-2">
                                        <input type="number" min={0} step={100}
                                          className="w-full text-right px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400 text-xs"
                                          value={article.prix[e.id] ?? ''}
                                          onChange={ev => updatePrix(idx, e.id, parseFloat(ev.target.value) || 0)}
                                          placeholder="—" />
                                      </td>
                                    ))}
                                    <td className="px-2 py-2 text-right">
                                      <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {cl.articles.length === 0 && (
                                <tr>
                                  <td colSpan={4 + entreprisesLot.length} className="px-4 py-6 text-center text-zinc-400 italic">
                                    Cliquez sur "+ Section", "+ Article" ou "+ Sous-total" pour construire le comparatif de ce lot.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Phase 5 : Analyse & Attribution ──────────────────────────── */}
      {phase === 'analyse' && (
        <div className="space-y-6">
          {/* Bouton global RAO */}
          <div className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div>
              <p className="text-sm font-bold text-zinc-900 dark:text-white">Rapport d'Analyse des Offres (RAO)</p>
              <p className="text-[10px] text-zinc-400">Génère un PDF comparatif pour tous les lots ou par lot</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => generateRAO(lots, consultation, projectName)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all">
                <IconDownload size={14} /> RAO Global
              </button>
            </div>
          </div>

          {/* Par lot */}
          {lots.map(lot => {
            const offresLot = consultation.offres.filter(o => o.lot_id === lot.id);
            const offresConformes = offresLot.filter(o => o.conforme && o.montant_base > 0);
            const minMontant = offresConformes.length > 0 ? Math.min(...offresConformes.map(o => o.montant_base)) : 0;
            const attribution = consultation.attributions.find(a => a.lot_id === lot.id);
            const poidsPrix = consultation.criteres.find(c => c.id === 'prix')?.poids ?? 60;
            const poidsTech = consultation.criteres.find(c => c.id === 'tech')?.poids ?? 40;

            const scored = offresLot.map(offre => {
              const entreprise = consultation.entreprises.find(e => e.id === offre.entreprise_id);
              const notePrix = offre.conforme && offre.montant_base > 0 && minMontant > 0
                ? minMontant / offre.montant_base * 100 : 0;
              const noteGlobale = offre.conforme
                ? notePrix * poidsPrix / 100 + (offre.note_technique || 0) * poidsTech / 100 : 0;
              return { offre, entreprise, notePrix, noteGlobale };
            }).sort((a, b) => b.noteGlobale - a.noteGlobale);

            return (
              <div key={lot.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-black">Lot {lot.lot_number}</span>
                    {lot.lot_title}
                    {attribution && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">
                        ✓ Attribué à {consultation.entreprises.find(e => e.id === attribution.entreprise_id)?.nom}
                      </span>
                    )}
                  </h3>
                  <button onClick={() => generateRAO(lots, consultation, projectName, lot.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-all">
                    <IconDownload size={13} /> RAO Lot
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase text-zinc-400">Rang</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase text-zinc-400">Entreprise</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase text-zinc-400">Montant HT</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase text-zinc-400">% / moins-disant</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase text-zinc-400">Note prix ({poidsPrix}%)</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase text-zinc-400">Note tech. ({poidsTech}%)</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase text-zinc-400">NOTE GLOBALE</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase text-zinc-400">Attribuer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {scored.map(({ offre, entreprise, notePrix, noteGlobale }, rank) => {
                        const isAttribue = attribution?.entreprise_id === offre.entreprise_id;
                        const pctMinDisant = minMontant > 0 && offre.montant_base > 0
                          ? ((offre.montant_base - minMontant) / minMontant * 100).toFixed(1) : '—';
                        return (
                          <tr key={offre.id} className={cn(
                            'hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors',
                            isAttribue && 'bg-green-50 dark:bg-green-900/10',
                            !offre.conforme && 'bg-red-50/50 dark:bg-red-900/10',
                          )}>
                            <td className="px-4 py-3 text-center">
                              {offre.conforme ? (
                                <span className={cn('text-sm font-black', rank === 0 ? 'text-yellow-500' : rank === 1 ? 'text-zinc-500' : rank === 2 ? 'text-amber-600' : 'text-zinc-400')}>
                                  {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                                </span>
                              ) : <span className="text-red-500 text-xs font-bold">NC</span>}
                            </td>
                            <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">{entreprise?.nom || '—'}</td>
                            <td className="px-4 py-3 text-right font-bold text-zinc-900 dark:text-white">{fmt(offre.montant_base)}</td>
                            <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                              {offre.conforme && pctMinDisant !== '—' ? `+${pctMinDisant}%` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center font-bold" style={{ color: offre.conforme ? '#206bc4' : '#d63939' }}>
                              {offre.conforme ? notePrix.toFixed(1) : 'NC'}
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-indigo-600 dark:text-indigo-400">
                              {offre.conforme ? (offre.note_technique || '—') : 'NC'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={cn('text-sm font-black px-2 py-0.5 rounded-lg', offre.conforme && rank === 0 ? 'bg-green-100 text-green-700' : 'text-zinc-400')}>
                                {offre.conforme ? noteGlobale.toFixed(1) : 'NC'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {offre.conforme && (
                                <button onClick={() => {
                                  const newAttrs = consultation.attributions.filter(a => a.lot_id !== lot.id);
                                  if (!isAttribue) {
                                    newAttrs.push({ lot_id: lot.id, entreprise_id: offre.entreprise_id, montant: offre.montant_base });
                                  }
                                  update({ ...consultation, attributions: newAttrs });
                                }} className={cn(
                                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                                  isAttribue
                                    ? 'bg-green-600 text-white hover:bg-red-100 hover:text-red-600'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-green-100 hover:text-green-700'
                                )}>
                                  {isAttribue ? '✓ Attribué' : 'Attribuer'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {scored.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-400 italic text-sm">Aucune offre saisie pour ce lot (phase 4).</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation bas */}
      <div className="flex justify-between pt-2">
        <button
          onClick={() => phaseIdx > 0 && goPhase(PHASES[phaseIdx - 1].id)}
          disabled={phaseIdx === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition-all"
        >
          <IconChevronLeft size={14} /> Phase précédente
        </button>
        <button
          onClick={() => phaseIdx < PHASES.length - 1 && goPhase(PHASES[phaseIdx + 1].id)}
          disabled={phaseIdx === PHASES.length - 1}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 transition-all"
        >
          Phase suivante <IconChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
