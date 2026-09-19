// Calcul des honoraires par mission (Esquisse, APS, APD...) et de leur
// répartition entre cotraitants — extrait de src/pages/Proposals.tsx pour
// être partagé avec l'onglet Honoraires d'un appel d'offres MAPA
// (src/pages/TenderDetail.tsx via src/components/HonorairesSection.tsx) :
// les deux doivent calculer exactement de la même façon, donc une seule
// implémentation plutôt que deux qui dérivent avec le temps.
import type { Contact } from '../types';

export interface FeeDistributionMission {
  id: string;
  name: string;
  category: 'Mission base' | 'Mission Exécution' | 'Missions complémentaires';
  default_pct?: number;
  amount?: number;
  percentages: Record<string, number>;
}

export interface FeeDistributionData {
  missions: FeeDistributionMission[];
}

export const DEFAULT_MISSIONS: Omit<FeeDistributionMission, 'amount' | 'percentages'>[] = [
  { id: 'esquisse', name: 'Esquisse', category: 'Mission base', default_pct: 10 },
  { id: 'aps', name: 'A.P.S.', category: 'Mission base', default_pct: 12 },
  { id: 'apd', name: 'A.P.D.', category: 'Mission base', default_pct: 14 },
  { id: 'projet', name: 'Projet', category: 'Mission base', default_pct: 18 },
  { id: 'act', name: 'A.C.T.', category: 'Mission base', default_pct: 7 },
  { id: 'visa', name: 'VISA', category: 'Mission base', default_pct: 7 },
  { id: 'det', name: 'D.E.T.', category: 'Mission base', default_pct: 25 },
  { id: 'aor', name: 'A.O.R.', category: 'Mission base', default_pct: 7 },
  { id: 'opc', name: 'OPC', category: 'Mission Exécution' },
];

export function defaultFeeDistribution(): FeeDistributionData {
  return { missions: DEFAULT_MISSIONS.map(m => ({ ...m, percentages: {} })) };
}

/**
 * Ratios (mission de base+exécution / mission de base seule, et
 * total / base seule) déduits de la répartition par mission — utilisés pour
 * afficher, à côté du % d'honoraires de base saisi, le % équivalent
 * "avec exécution" et "avec missions complémentaires" sans les stocker.
 */
export function calculateFeeRatios(feeDistribution: string | undefined): { exeRatio: number; totalRatio: number } {
  if (!feeDistribution) return { exeRatio: 1, totalRatio: 1 };
  try {
    const data = JSON.parse(feeDistribution);
    const missions = data.missions || [];
    const baseAmt = missions
      .filter((m: any) => m.category === 'Mission base')
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);

    if (baseAmt === 0) return { exeRatio: 1, totalRatio: 1 };

    const exeAmt = missions
      .filter((m: any) => m.category === 'Mission base' || m.category === 'Mission Exécution')
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);

    const totalAmt = missions
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);

    return { exeRatio: exeAmt / baseAmt, totalRatio: totalAmt / baseAmt };
  } catch {
    return { exeRatio: 1, totalRatio: 1 };
  }
}

export interface FeeDistributionSpecialty {
  id?: string;
  specialty_name?: string;
  contact_id?: string;
}

/** Exporte la grille de répartition en xlsx, formules incluses — mêmes colonnes que FeeDistributionGrid. */
export async function exportFeeDistributionToXlsx(
  feeDistribution: string | undefined,
  specialtiesList: FeeDistributionSpecialty[] | undefined,
  contacts: Contact[],
  vatRate: number | undefined,
  filenameLabel: string,
): Promise<void> {
  if (!feeDistribution) return;
  try {
    const XLSX = await import('xlsx');
    const { saveAs } = await import('file-saver');
    const data = JSON.parse(feeDistribution);
    const specialties = specialtiesList || [];
    const selectedContacts = specialties.map(s => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name,
      };
    }).filter(c => c.id);

    const aoa: any[][] = [];

    const h1: any[] = ["Désignation", "Montant HT", "Rel %", "Solde", "Architecte", ""];
    selectedContacts.forEach(c => h1.push(c.name, ""));
    aoa.push(h1);

    const h2: any[] = ["", "", "", "", "%", "€"];
    selectedContacts.forEach(() => h2.push("%", "€"));
    aoa.push(h2);

    const getCol = (idx: number) => {
      let letter = '';
      idx++;
      while (idx > 0) {
        const mod = (idx - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        idx = Math.floor((idx - mod) / 26);
      }
      return letter;
    };

    const categories = [
      { label: "Mission base", category: "Mission base" },
      { label: "Mission Exécution", category: "Mission Exécution" },
      { label: "Missions complémentaires", category: "Missions complémentaires" },
    ];

    let currentRow = 2; // Rows already in aoa
    const baseSubtotalRowRef = { row: 0 };

    categories.forEach((cat) => {
      aoa.push([cat.label]);
      currentRow++;

      const missions = data.missions.filter((m: any) => m.category === cat.category);
      const startRow = currentRow + 1;

      missions.forEach((m: any) => {
        currentRow++;
        const r = currentRow;
        const rowData: any[] = [m.name];

        rowData.push(m.amount || 0);
        rowData.push(0);

        let soldeFormula = `B${r}*(100-(${getCol(4)}${r}`;
        selectedContacts.forEach((_, i) => {
          soldeFormula += `+${getCol(6 + i * 2)}${r}`;
        });
        soldeFormula += "))/100";
        rowData.push({ f: soldeFormula });

        rowData.push(m.percentages['architect'] || 0);
        rowData.push({ f: `B${r}*E${r}/100` });

        selectedContacts.forEach((c, i) => {
          const pct = m.percentages[c.id as string] || 0;
          rowData.push(pct);
          rowData.push({ f: `B${r}*${getCol(6 + i * 2)}${r}/100` });
        });

        aoa.push(rowData);
      });

      currentRow++;
      const subRowIdx = currentRow;
      if (cat.category === "Mission base") baseSubtotalRowRef.row = subRowIdx;

      const subRow: any[] = [`Sous-total ${cat.label}`];
      subRow.push({ f: `SUM(B${startRow}:B${subRowIdx - 1})` });
      subRow.push({ f: `SUM(C${startRow}:C${subRowIdx - 1})` });
      subRow.push({ f: `SUM(D${startRow}:D${subRowIdx - 1})` });
      subRow.push("");
      subRow.push({ f: `SUM(F${startRow}:F${subRowIdx - 1})` });

      selectedContacts.forEach((_, i) => {
        subRow.push("");
        subRow.push({ f: `SUM(${getCol(7 + i * 2)}${startRow}:${getCol(7 + i * 2)}${subRowIdx - 1})` });
      });

      aoa.push(subRow);
      aoa.push([]);
      currentRow++;
    });

    const baseSubtotalRow = baseSubtotalRowRef.row;
    let rowPtr = 2;
    categories.forEach(cat => {
      rowPtr++;
      const missions = data.missions.filter((m: any) => m.category === cat.category);
      missions.forEach(() => {
        rowPtr++;
        aoa[rowPtr - 1][2] = { f: `B${rowPtr}/$B$${baseSubtotalRow}*100` };
      });
      rowPtr++;
      rowPtr++;
    });

    const subtotalRows: number[] = [];
    aoa.forEach((row, i) => {
      if (row[0] && typeof row[0] === 'string' && row[0].startsWith("Sous-total")) {
        subtotalRows.push(i + 1);
      }
    });

    const htSumFormula = subtotalRows.map(r => `B${r}`).join("+");
    aoa.push(["TOTAL GENERAL HT", { f: htSumFormula }]);
    currentRow++;

    const vat = vatRate || 20;
    aoa.push([`TVA (${vat}%)`, { f: `B${currentRow}*${vat}/100` }]);
    currentRow++;

    aoa.push(["TOTAL GENERAL TTC", { f: `B${currentRow - 1}+B${currentRow}` }]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Répartition Honoraires");

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Repartition_Honoraires_${filenameLabel || 'Projet'}.xlsx`);
  } catch (e) {
    console.error("Export failed:", e);
  }
}
