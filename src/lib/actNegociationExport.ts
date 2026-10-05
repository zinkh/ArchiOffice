// ── Exports de la négociation (module ACT) ───────────────────────────────────
// Trois documents, à la charte du cabinet (en-tête, nuances de gris, pied de
// page, pagination « P1|2 ») :
//   - le procès-verbal d'ouverture des offres, par lot ;
//   - la fiche de négociation d'une entreprise sur un lot (historique des tours) ;
//   - la synthèse économique de l'opération (PDF et Excel).
// Aucun montant n'est recalculé ici : tout vient de `actNegociation.ts`.
import type { ProjectLot } from '../types';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO,
  type Cellule, type Colonne,
} from './xlsxLetterhead';
import {
  BASE_KEY, DECISION_LIBELLES, STATUT_LIBELLES, controleTolerance,
  formaterPourcent, gainObtenu, lignesSynthese, montantCourant, montantOuverture,
  montantVerifie, objectifTotal, parametresDe, piecesManquantes, piecesOffreDe,
  resteAObtenir, statutNegociation, toursOrdonnes, totalA, totauxOperation,
  trouverNegociation, type DonneesNegociation, type Etage, type OffreMontant,
  type PieceAttendue,
} from './actNegociation';

export interface EntrepriseExport { id: string; nom: string; email?: string; lots_ids?: string[] }
interface OffreExport extends OffreMontant { motif_nc?: string }

/** Ce que ces exports lisent d'une consultation. */
export interface ConsultationNegociationExport extends DonneesNegociation {
  entreprises: EntrepriseExport[];
  offres: OffreExport[];
  attributions: { lot_id: string; entreprise_id: string; montant: number }[];
  pieces_admin?: PieceAttendue[];
  comparatif?: { lot_id: string; articles: { is_subtotal?: boolean; estimatif?: number }[] }[];
}

/** L'espace fine insécable (U+202F) de `Intl` n'existe pas dans les polices standard de jsPDF : elle s'y affiche « / ». */
const euros = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/[\u202F\u00A0]/g, ' ');

const dateFr = (iso?: string) => {
  if (!iso) return '—';
  const [a, m, j] = iso.split('-');
  return a && m && j ? `${j}/${m}/${a}` : iso;
};

const nomFichier = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

const intituleLot = (lot: ProjectLot) => `Lot ${lot.lot_number} : ${lot.lot_title}`;

async function nouveauPdf(orientation: 'portrait' | 'landscape', settings: AgencySettings) {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadLogoDataUrl(settings.logoUrl),
  ]);
  return { doc: new jsPDF({ orientation, unit: 'mm', format: 'a4' }), autoTable, logo };
}

// ── Procès-verbal d'ouverture des offres ─────────────────────────────────────

export async function genererPVOuverture(
  lots: ProjectLot[], consultation: ConsultationNegociationExport, projectName: string,
  settings: AgencySettings = {}, lotId?: string,
): Promise<void> {
  const { doc, autoTable, logo } = await nouveauPdf('landscape', settings);
  const margin = 12;
  const W = 297;
  const lettre = { title: "PV d'ouverture des offres", subtitle: projectName, margin, logo };
  const pieces = [...(consultation.pieces_admin ?? []), ...piecesOffreDe(consultation)];
  const lotsPV = (lotId ? lots.filter(l => l.id === lotId) : lots)
    .filter(l => consultation.offres.some(o => o.lot_id === l.id));

  if (lotsPV.length === 0) {
    const y = drawAgencyHeader(doc, settings, lettre);
    doc.setFontSize(11);
    doc.setTextColor(...TABLEAU_GRIS.texte);
    doc.text('Aucune offre reçue à ce jour.', W / 2, y + 30, { align: 'center' });
  }

  lotsPV.forEach((lot, idx) => {
    if (idx > 0) doc.addPage();
    const y = drawAgencyHeader(doc, settings, { ...lettre, subtitle: `${projectName} | ${intituleLot(lot)}` });
    const offresLot = consultation.offres.filter(o => o.lot_id === lot.id);
    const maxOptions = Math.max(0, ...offresLot.map(o => (trouverNegociation(consultation.negociations, lot.id, o.entreprise_id)?.lignes.filter(l => l.kind === 'option').length ?? 0)));

    const head = [[
      'N°', 'Entreprise', 'Pièces', 'Base HT',
      ...Array.from({ length: maxOptions }, (_, i) => `Option ${i + 1}`),
      'Total HT', 'Variantes', 'Remarques',
    ]];
    const body = offresLot.map((o, i) => {
      const ent = consultation.entreprises.find(e => e.id === o.entreprise_id);
      const neg = trouverNegociation(consultation.negociations, lot.id, o.entreprise_id);
      const manque = piecesManquantes(pieces, consultation.pieces_recues, o.entreprise_id);
      const options = neg?.lignes.filter(l => l.kind === 'option') ?? [];
      const variantes = neg?.lignes.filter(l => l.kind === 'variante') ?? [];
      return [
        String(i + 1),
        ent?.nom ?? '—',
        manque.length === 0 ? 'Complètes' : `${pieces.length - manque.length}/${pieces.length}`,
        euros(o.montant_base),
        ...Array.from({ length: maxOptions }, (_, k) => (options[k] ? euros(options[k].montant_ouverture) : '')),
        euros(totalA(o, neg, 'ouverture')),
        variantes.map(v => `${v.libelle} : ${euros(v.montant_ouverture)}`).join('\n') || '—',
        o.conforme === false ? `Non conforme : ${o.motif_nc || 'motif non précisé'}` : manque.length ? `Manque : ${manque.map(p => p.nom).join(', ')}` : '',
      ];
    });
    const colDroite = Array.from({ length: 2 + maxOptions }, (_, k) => 3 + k);
    autoTable(doc, {
      ...tableauGris(margin),
      startY: y,
      head, body,
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 52 },
        ...Object.fromEntries(colDroite.map(c => [c, { halign: 'right', cellWidth: 27 }])),
      },
    });

    const fin = (doc as any).lastAutoTable?.finalY ?? y;
    const bas = Math.min(fin + 14, 175);
    doc.setFontSize(8);
    doc.setTextColor(...TABLEAU_GRIS.texte);
    doc.text("Lieu et date d'ouverture :", margin, bas);
    doc.text('Signature du responsable de la commission :', W / 2 - 20, bas);
    doc.text('Signature du mandataire :', W - margin - 60, bas);
  });

  drawAgencyFooters(doc, settings, lettre);
  doc.save(`PV_ouverture_${nomFichier(projectName)}${lotId ? `_${lotId}` : ''}.pdf`);
}

// ── Fiche de négociation d'une entreprise ────────────────────────────────────

export async function genererFicheNegociation(
  lot: ProjectLot, entreprise: EntrepriseExport, consultation: ConsultationNegociationExport,
  projectName: string, settings: AgencySettings = {},
): Promise<void> {
  const { doc, autoTable, logo } = await nouveauPdf('portrait', settings);
  const margin = 14;
  const lettre = { title: 'Fiche de négociation', subtitle: `${projectName} | ${intituleLot(lot)}`, margin, logo };
  let y = drawAgencyHeader(doc, settings, lettre);

  const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id);
  const neg = trouverNegociation(consultation.negociations, lot.id, entreprise.id);
  const attribue = consultation.attributions.some(a => a.lot_id === lot.id && a.entreprise_id === entreprise.id);
  const statut = STATUT_LIBELLES[statutNegociation(neg, offre, attribue)];

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TABLEAU_GRIS.texte);
  doc.text(entreprise.nom, margin, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Statut : ${statut}${entreprise.email ? `   |   ${entreprise.email}` : ''}`, margin, y + 7);
  y += 11;

  const cles = [BASE_KEY, ...(neg?.lignes ?? []).map(l => l.id)];
  const libelle = (cle: string) => (cle === BASE_KEY ? 'Base' : neg?.lignes.find(l => l.id === cle)?.libelle ?? cle);
  const tours = toursOrdonnes(neg);
  const head = [['Ligne', 'Ouverture', 'Vérifié', ...tours.map(t => dateFr(t.date)), 'Actuel', 'Objectif']];
  const body: string[][] = cles.map(cle => [
    libelle(cle),
    euros(montantOuverture(offre, neg, cle)),
    euros(montantVerifie(offre, neg, cle)),
    ...tours.map(t => (t.montants[cle] != null ? euros(t.montants[cle]) : '')),
    euros(montantCourant(offre, neg, cle)),
    neg?.objectifs?.[cle] != null ? euros(neg.objectifs[cle]) : '—',
  ]);
  body.push([
    'Total base + options',
    euros(totalA(offre, neg, 'ouverture')), euros(totalA(offre, neg, 'verifie')),
    ...tours.map((_, i) => euros(totalApresTour(offre, neg, i))),
    euros(totalA(offre, neg, 'courant')), euros(objectifTotal(offre, neg)),
  ]);

  autoTable(doc, {
    ...tableauGris(margin), startY: y, head, body,
    columnStyles: Object.fromEntries(Array.from({ length: head[0].length - 1 }, (_, i) => [i + 1, { halign: 'right' }])),
    didParseCell: (data: any) => { if (data.section === 'body' && data.row.index === body.length - 1) data.cell.styles.fontStyle = 'bold'; },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  doc.setFontSize(8.5);
  const gain = gainObtenu(offre, neg);
  const reste = resteAObtenir(offre, neg);
  doc.text(`Gain obtenu depuis l'ouverture : ${euros(gain)}   |   Reste à obtenir sur l'objectif : ${euros(reste)}`, margin, y);
  y += 5;
  if (neg?.remarque_verification) {
    const lignes = doc.splitTextToSize(`Vérification des prix : ${neg.remarque_verification}`, 182) as string[];
    doc.text(lignes, margin, y);
    y += lignes.length * 4 + 2;
  }

  const remarques = tours.filter(t => t.remarque || t.auteur || t.finale);
  if (remarques.length) {
    autoTable(doc, {
      ...tableauGris(margin), startY: y + 2,
      head: [['Date', 'Intervenant', 'Remarque']],
      body: remarques.map(t => [dateFr(t.date), t.auteur ?? '', `${t.finale ? '[Offre finale] ' : ''}${t.remarque ?? ''}`]),
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 34 } },
    });
  }

  drawAgencyFooters(doc, settings, lettre);
  doc.save(`Negociation_${nomFichier(entreprise.nom)}_Lot${nomFichier(lot.lot_number)}.pdf`);
}

/** Total base + options d'une offre une fois le tour `rang` (0 = le plus ancien) passé. */
function totalApresTour(offre: OffreMontant | undefined, neg: ReturnType<typeof trouverNegociation>, rang: number): number {
  if (!neg) return totalA(offre, neg, 'ouverture');
  return totalA(offre, { ...neg, tours: toursOrdonnes(neg).slice(0, rang + 1) }, 'courant');
}

// ── Synthèse économique ──────────────────────────────────────────────────────

export async function genererSynthesePDF(
  lots: ProjectLot[], consultation: ConsultationNegociationExport, projectName: string,
  settings: AgencySettings = {}, etage: Etage = 'courant',
): Promise<void> {
  const { doc, autoTable, logo } = await nouveauPdf('landscape', settings);
  const margin = 10;
  const lettre = { title: 'Synthèse économique des offres', subtitle: projectName, margin, logo };
  const y = drawAgencyHeader(doc, settings, lettre);

  const params = parametresDe(consultation);
  const lignes = lignesSynthese(lots, consultation, etage);
  const totaux = totauxOperation(lignes, params);
  const nomEntreprise = (id: string | null) => consultation.entreprises.find(e => e.id === id)?.nom ?? '—';

  const body = lignes.map(l => {
    const lot = lots.find(x => x.id === l.lot_id)!;
    return [
      `${lot.lot_number}  ${lot.lot_title}`,
      euros(l.estimation_apd), euros(l.estimation_pro_base), euros(l.estimation_pro_options),
      l.evolution == null ? '—' : `${euros(l.evolution)}\n${formaterPourcent(l.evolution_pct)}`,
      nomEntreprise(l.moinsDisantId),
      euros(l.moinsDisantBase),
      l.ecart_base == null ? '—' : `${euros(l.ecart_base)}\n${formaterPourcent(l.ecart_base_pct)}`,
      euros(l.moinsDisantTotal),
      l.ecart_total == null ? '—' : `${euros(l.ecart_total)}\n${formaterPourcent(l.ecart_total_pct)}`,
      euros(l.objectif),
      `${DECISION_LIBELLES[l.decision]}${l.observation ? `\n${l.observation}` : ''}`,
    ];
  });

  autoTable(doc, {
    ...tableauGris(margin), startY: y,
    styles: { ...tableauGris().styles, fontSize: 7 },
    head: [['Lot', 'Est. APD', 'Est. PRO base', 'Est. PRO + opt.', 'Évolution', 'Moins-disant', 'Base HT', 'Écart base', 'Base + opt. HT', 'Écart base + opt.', 'Objectif', 'Décision']],
    body,
    foot: [[
      'Total HT', euros(totaux.estimation_apd), euros(totaux.estimation_pro_base), euros(totaux.estimation_pro_options),
      `${euros(totaux.evolution)}\n${formaterPourcent(totaux.evolution_pct)}`, '',
      euros(totaux.offres_base), `${euros(totaux.ecart_base)}\n${formaterPourcent(totaux.ecart_base_pct)}`,
      euros(totaux.offres_total), `${euros(totaux.ecart_total)}\n${formaterPourcent(totaux.ecart_total_pct)}`,
      euros(totaux.objectif), '',
    ]],
    columnStyles: Object.fromEntries([1, 2, 3, 4, 6, 7, 8, 9, 10].map(c => [c, { halign: 'right' }])),
    showFoot: 'lastPage',
  });

  let yy = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
  const controle = controleTolerance(totaux.offres_total, totaux.estimation_pro_options, params);
  const libelleNiveau = { ok: 'sous l\'estimation', tolere: 'dans la tolérance du CCAP', depasse: 'au-delà de la tolérance du CCAP' }[controle.niveau];
  doc.setFontSize(8.5);
  doc.setTextColor(...TABLEAU_GRIS.texte);
  const lignesTexte = [
    `TVA ${params.tva_pct} % : ${euros(totaux.tva_total)}   |   Montant TTC des offres : ${euros(totaux.ttc_offres_total)}   |   Estimation TTC : ${euros(totaux.ttc_estimation_pro_options)}`,
    `Tolérance du CCAP : ${params.tolerance_pct} %   |   Estimation actualisée (coefficient ${controle.coefficient.toFixed(4)}) : ${euros(controle.estimation_actualisee)}   |   Plafond : ${euros(controle.plafond)}`,
    `Dépassement des offres : ${euros(controle.depassement)} (${formaterPourcent(controle.depassement_pct)}) : ${libelleNiveau}.`,
  ];
  for (const t of lignesTexte) { doc.text(t, margin, yy); yy += 5; }

  drawAgencyFooters(doc, settings, lettre);
  doc.save(`Synthese_economique_${nomFichier(projectName)}.pdf`);
}

export async function genererSyntheseExcel(
  lots: ProjectLot[], consultation: ConsultationNegociationExport, projectName: string,
  settings: AgencySettings = {}, etage: Etage = 'courant',
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const params = parametresDe(consultation);
  const lignes = lignesSynthese(lots, consultation, etage);
  const totaux = totauxOperation(lignes, params);
  const nomEntreprise = (id: string | null) => consultation.entreprises.find(e => e.id === id)?.nom ?? '';
  const n = (v: number | null): Cellule => (v == null ? '' : v);

  const euro = (header: string, width = 16): Colonne => ({ header, width, align: 'right', numFmt: FORMAT_EURO });
  const pct = (header: string): Colonne => ({ header, width: 10, align: 'right', numFmt: '0.0%' });
  const f = ajouterFeuille(wb, {
    nom: 'Synthèse', settings, logo, title: 'Synthèse économique des offres', subtitle: projectName, paysage: true,
    colonnes: [
      { header: 'Lot', width: 44 },
      euro('Estimation APD'), euro('Estimation PRO base'), euro('Estimation PRO + options'),
      euro('Évolution'), pct('Évolution %'),
      { header: 'Moins-disant', width: 26 },
      euro('Base HT'), euro('Écart base'), pct('Écart base %'),
      euro('Base + options HT'), euro('Écart base + options'), pct('Écart base + opt. %'),
      euro('Objectif de négociation'),
      { header: 'Décision', width: 16 }, { header: 'Observations', width: 34 },
    ],
  });
  const premiere = f.entete + 1;
  lignes.forEach(l => {
    const lot = lots.find(x => x.id === l.lot_id)!;
    f.ligne([
      `${lot.lot_number}  ${lot.lot_title}`,
      n(l.estimation_apd), n(l.estimation_pro_base), n(l.estimation_pro_options),
      n(l.evolution), n(l.evolution_pct),
      nomEntreprise(l.moinsDisantId),
      n(l.moinsDisantBase), n(l.ecart_base), n(l.ecart_base_pct),
      n(l.moinsDisantTotal), n(l.ecart_total), n(l.ecart_total_pct),
      n(l.objectif), DECISION_LIBELLES[l.decision], l.observation,
    ]);
  });
  const derniere = f.entete + lignes.length;
  const somme = (col: string): Cellule => (lignes.length ? { f: `SUM(${col}${premiere}:${col}${derniere})` } : 0);
  f.total([
    'Total HT', somme('B'), somme('C'), somme('D'), n(totaux.evolution), n(totaux.evolution_pct), '',
    n(totaux.offres_base), n(totaux.ecart_base), n(totaux.ecart_base_pct),
    n(totaux.offres_total), n(totaux.ecart_total), n(totaux.ecart_total_pct), n(totaux.objectif), '', '',
  ]);
  f.vide();

  const controle = controleTolerance(totaux.offres_total, totaux.estimation_pro_options, params);
  f.ligne([`TVA ${params.tva_pct} %`, '', '', '', '', '', '', '', '', '', n(totaux.tva_total)]);
  f.ligne(['Montant TTC', '', '', n(totaux.ttc_estimation_pro_options), '', '', '', '', '', '', n(totaux.ttc_offres_total)], { gras: true });
  f.vide();
  f.ligne([`Tolérance du CCAP : ${params.tolerance_pct} %`, '', '', n(controle.estimation_actualisee), '', '', 'Plafond', '', '', '', n(controle.plafond)]);
  f.ligne([`Estimation actualisée (coefficient ${controle.coefficient.toFixed(4)})`, '', '', n(controle.estimation_actualisee)]);

  // ── Détail des offres par lot, tour par tour ──────────────────────────────
  const d = ajouterFeuille(wb, {
    nom: 'Négociation', settings, logo, title: 'Suivi des négociations', subtitle: projectName, paysage: true,
    colonnes: [
      { header: 'Lot', width: 36 }, { header: 'Entreprise', width: 28 }, { header: 'Statut', width: 16 },
      euro('Ouverture base + opt.'), euro('Vérifié'), euro('Actuel'), euro('Objectif'), euro('Gain obtenu'), euro('Reste à obtenir'),
      { header: 'Dernière remarque', width: 40 },
    ],
  });
  for (const lot of lots) {
    const offresLot = consultation.offres.filter(o => o.lot_id === lot.id);
    if (!offresLot.length) continue;
    d.ligne([`Lot ${lot.lot_number} ${lot.lot_title}`], { gras: true, fond: 'groupe', fusionner: true });
    for (const o of offresLot) {
      const neg = trouverNegociation(consultation.negociations, lot.id, o.entreprise_id);
      const attribue = consultation.attributions.some(a => a.lot_id === lot.id && a.entreprise_id === o.entreprise_id);
      const dernier = toursOrdonnes(neg).filter(t => t.remarque).pop();
      d.ligne([
        '', consultation.entreprises.find(e => e.id === o.entreprise_id)?.nom ?? '',
        STATUT_LIBELLES[statutNegociation(neg, o, attribue)],
        totalA(o, neg, 'ouverture'), totalA(o, neg, 'verifie'), totalA(o, neg, 'courant'),
        objectifTotal(o, neg), gainObtenu(o, neg), resteAObtenir(o, neg),
        dernier ? `${dateFr(dernier.date)} : ${dernier.remarque}` : '',
      ]);
    }
  }
  await enregistrerClasseur(wb, `Synthese_economique_${nomFichier(projectName)}.xlsx`);
}
