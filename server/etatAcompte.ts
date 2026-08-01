// Shared by server.ts (SuperPDP and Chorus Pro integrations, still inline)
// and server/routes/marchesEntreprises.ts. Computes and renders the "état
// d'acompte" (interim payment statement) for a construction-market
// situation — shared logic so the PDF download and the two invoicing
// integrations' attachment upload always agree on the same figures.
export function computeEtatAcompte(sit: any, marche: any, details: any[]) {
  const montantHt = details.reduce((s: number, d: any) => s + Number(d.montant_situation || d.montant_periode || 0), 0);
  const coeff = Number(sit.revision_coeff ?? 1);
  const revisionMontant = marche?.revision_active ? montantHt * (coeff - 1) : 0;
  const htRevise = montantHt + revisionMontant;
  const tvaRate = Number(marche?.tva_rate ?? 20) / 100;
  const tva = htRevise * tvaRate;
  const ttc = htRevise + tva;
  const retenue = Number(sit.retenue_garantie_pct ?? marche?.retenue_garantie_pct ?? 5) / 100 * ttc;
  const avanceRemb = Number(sit.avance_remboursement ?? 0);
  const penalites = Number(sit.penalites_ht ?? 0);
  const net = ttc - retenue - avanceRemb - penalites;
  return { montantHt, coeff, revisionMontant, htRevise, tvaRate, tva, ttc, retenue, avanceRemb, penalites, net };
}

// Génère le PDF de l'état d'acompte — partagé entre le téléchargement direct
// et le dépôt en pièce jointe complémentaire sur SuperPDP/Chorus Pro.
export async function buildEtatAcomptePdfBuffer(sit: any, marche: any, details: any[], agencyName: string): Promise<Buffer> {
  const { montantHt, coeff, revisionMontant, htRevise, tva, ttc, retenue, avanceRemb, penalites, net } = computeEtatAcompte(sit, marche, details);

  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  pdf.setFontSize(16); pdf.setFont('helvetica', 'bold');
  pdf.text(`ÉTAT D'ACOMPTE N°${sit.numero_situation}`, 20, 20);
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
  if (agencyName) pdf.text(`Architecte : ${agencyName}`, 20, 30);
  pdf.text(`Date situation : ${new Date(sit.date_situation).toLocaleDateString('fr-FR')}`, 20, 36);
  if (marche) {
    pdf.text(`Entreprise : ${marche.entreprise_nom}`, 20, 42);
    pdf.text(`Lot : ${marche.lot_numero} — ${marche.lot_titre}`, 20, 48);
    pdf.text(`Marché HT : ${Number(marche.montant_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`, 20, 54);
  }

  const f = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  autoTable(pdf, {
    startY: 65,
    head: [['', 'Montant HT']],
    body: [
      ['Décompte mensuel (travaux de la période)', `${f(montantHt)} €`],
      ...(marche?.revision_active ? [
        [`Révision des prix (Cn = ${coeff.toFixed(6)})`, `${revisionMontant >= 0 ? '+' : ''}${f(revisionMontant)} €`],
        ['Total HT révisé', `${f(htRevise)} €`],
      ] : []),
      [`TVA ${marche?.tva_rate ?? 20} %`, `+ ${f(tva)} €`],
      ['─────────────────────────────', ''],
      ['TOTAL TTC', `${f(ttc)} €`],
      ['─────────────────────────────', ''],
      [`Retenue de garantie ${marche?.retenue_garantie_pct ?? 5} %`, `- ${f(retenue)} €`],
      ...(avanceRemb > 0 ? [['Remboursement avance', `- ${f(avanceRemb)} €`]] : []),
      ...(penalites > 0 ? [['Pénalités de retard', `- ${f(penalites)} €`]] : []),
      ['─────────────────────────────', ''],
      ['NET À PAYER TTC', `${f(net)} €`],
    ],
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (data: any) => {
      if (data.row.raw[0] === 'NET À PAYER TTC' || data.row.raw[0] === 'TOTAL TTC') {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Annexe : détail postes
  if (details.length > 0) {
    (pdf as any).addPage();
    pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
    pdf.text('DÉTAIL DU DÉCOMPTE MENSUEL', 20, 20);
    autoTable(pdf, {
      startY: 28,
      head: [['Désignation', 'U', 'Qté', 'P.U. HT', 'Av. N-1 %', 'Av. N %', 'Montant période HT']],
      body: details.map((d: any) => {
        const item = d.dpgf_item;
        return [
          item?.designation ?? '—',
          item?.unite ?? '—',
          item?.quantite_prevue ?? '—',
          item ? `${f(item.prix_unitaire_ht)} €` : '—',
          d.avancement_n_moins_1 ? `${d.avancement_n_moins_1}%` : '0%',
          `${d.pourcentage_avancement ?? 0}%`,
          `${f(Number(d.montant_situation || d.montant_periode || 0))} €`,
        ];
      }),
      foot: [['', '', '', '', '', 'Total HT', `${f(montantHt)} €`]],
      styles: { fontSize: 8 },
      columnStyles: { 6: { halign: 'right' } },
    });
  }

  return Buffer.from(pdf.output('arraybuffer'));
}
