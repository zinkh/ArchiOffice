// ── Export PDF d'une note d'honoraires ───────────────────────────────────────
// Reprend le modèle papier du cabinet (page de garde + annexe de ventilation
// par mission et par intervenant) avec l'en-tête/pied de page/pagination
// partagés (drawAgencyHeader/drawAgencyFooters, cf. pdfLetterhead.ts) — même
// convention que bpuExport.ts.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import { montantEnLettres } from './numberToFrenchWords';
import type { NoteHonoraires, ContratMOE, NoteHonorairePhase } from '../types';

const fmt = (n?: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const sanitize = (s: string) => (s || 'note').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

interface ProjectSummary {
  name: string;
  client?: string;
  construction_cost?: number;
}

export async function exportNoteHonorairesToPDF(
  note: NoteHonoraires,
  contrat: ContratMOE | null | undefined,
  project: ProjectSummary,
  settings: AgencySettings,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);

  const letterhead = {
    title: `Note d'Honoraires N° ${note.numero || ''}`,
    subtitle: project.name,
    reference: note.date ? new Date(note.date).toLocaleDateString('fr-FR') : undefined,
    margin: 14,
    logo,
  };
  let y = drawAgencyHeader(doc, settings, letterhead);

  // ── Parties ────────────────────────────────────────────────────────────
  const champ = (label: string, value?: string) => {
    if (!value) return;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(17, 24, 39);
    doc.text(label, 14, y);
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(value, 128) as string[];
    doc.text(wrapped, 60, y);
    y += 5 * Math.max(1, wrapped.length);
  };

  const moeNames = [
    settings.agencyName,
    ...(contrat?.cotraitants || []).map(c => c.contact_name || c.specialty).filter(Boolean),
  ].filter(Boolean).join('\n');

  y += 2;
  champ('Concerne :', project.name);
  champ("Maître d'Ouvrage :", project.client);
  champ("Maître d'Œuvre :", moeNames);
  champ('Objet :', note.objet);
  if (project.construction_cost) champ('Coût prévisionnel des travaux HT :', `${fmt(project.construction_cost)} €`);
  y += 4;

  // ── Récapitulatif financier ────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    body: [
      ['Montant des Honoraires Cumulés HT', `${fmt(note.montant_cumule_ht ?? note.montant_ht)} €`],
      ["Montant à l'Acompte Précédent HT", `${fmt(note.montant_cumule_precedent_ht ?? 0)} €`],
      ['Montant du Présent Acompte HT', `${fmt(note.montant_ht)} €`],
      [`TVA à ${note.tva_rate ?? 20} %`, `${fmt(note.montant_tva)} €`],
      ['Montant du Présent Acompte TTC', `${fmt(note.montant_ttc)} €`],
      ...(note.pct_facturation_cumule != null
        ? [['Avancement cumulé de la facturation', `${fmt(note.pct_facturation_cumule)} %`]]
        : []),
    ],
    styles: { fontSize: 9.5, textColor: [17, 24, 39] },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (data: any) => {
      if (data.row.raw[0] === 'Montant du Présent Acompte HT' || data.row.raw[0] === 'Montant du Présent Acompte TTC') {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(17, 24, 39);
  const lettres = montantEnLettres(note.montant_ttc || 0);
  const arret = doc.splitTextToSize(`Arrêtée la présente note d'honoraires à la somme de : ${lettres}.`, 180) as string[];
  doc.text(arret, 14, y);
  y += 5 * arret.length + 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Fait le ${new Date().toLocaleDateString('fr-FR')}`, 14, y);
  y += 6;
  doc.text(settings.architectName || settings.agencyName || '', 14, y);

  // ── Annexe : ventilation par mission et par intervenant ───────────────
  const cotraitants = note.cotraitants_facturation || [];
  const sousTraitants = note.sous_traitants_facturation || [];
  const intervenants: { key: string; nom: string; isAgence: boolean }[] = [
    { key: '__agence__', nom: settings.agencyName || 'Agence', isAgence: true },
    ...cotraitants.map(c => ({ key: c.contact_id || c.nom, nom: c.nom, isAgence: false })),
    ...sousTraitants.map(s => ({ key: s.contact_id || s.nom, nom: s.nom, isAgence: false })),
  ];

  if ((note.phases || []).length > 0) {
    const landscape = intervenants.length > 3;
    (doc as any).addPage('a4', landscape ? 'landscape' : 'portrait');
    const annexeLetterhead = { ...letterhead, title: `Annexe — Note N° ${note.numero || ''}`, subtitle: 'Ventilation par mission' };
    const ay = drawAgencyHeader(doc, settings, annexeLetterhead);

    const findPhase = (list: NoteHonorairePhase[] | undefined, phaseId: string) => (list || []).find(p => p.phase_id === phaseId);
    const cellFor = (intervenantKey: string, phaseId: string) => {
      if (intervenantKey === '__agence__') {
        const p = findPhase(note.phases, phaseId);
        return p ? `${p.avancement_pct || 0}% · ${fmt(p.montant_phase)} €` : '—';
      }
      const owner = [...cotraitants, ...sousTraitants].find(c => (c.contact_id || c.nom) === intervenantKey);
      const p = findPhase(owner?.phases, phaseId);
      return p ? `${p.avancement_pct || 0}% · ${fmt(p.montant_phase)} €` : '—';
    };
    const totalFor = (intervenantKey: string) => {
      if (intervenantKey === '__agence__') return note.montant_ht || 0;
      const owner = [...cotraitants, ...sousTraitants].find(c => (c.contact_id || c.nom) === intervenantKey);
      return owner?.montant_ht || 0;
    };

    const body = (note.phases || []).map(phase => [
      phase.phase_name?.split('—')[0].trim() || phase.phase_id,
      ...intervenants.map(iv => cellFor(iv.key, phase.phase_id)),
    ]);
    const totalsRow = ['Total HT', ...intervenants.map(iv => `${fmt(totalFor(iv.key))} €`)];

    autoTable(doc, {
      startY: ay,
      head: [['Mission', ...intervenants.map(iv => iv.nom)]],
      body,
      foot: [totalsRow],
      styles: { fontSize: 7.5, textColor: [17, 24, 39] },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      footStyles: { fillColor: [225, 225, 225], textColor: [17, 24, 39], fontStyle: 'bold' },
      columnStyles: Object.fromEntries(intervenants.map((_, i) => [i + 1, { halign: 'right' }])),
      margin: { left: 14, right: 14, bottom: 25 },
    });
  }

  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`NH_${sanitize(note.numero || '')}_${sanitize(project.name)}.pdf`);
}
