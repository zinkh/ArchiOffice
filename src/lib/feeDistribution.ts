// Calcul des honoraires par mission (Esquisse, APS, APD...) et de leur
// répartition entre cotraitants — extrait de src/pages/Proposals.tsx pour
// être partagé avec l'onglet Honoraires d'un appel d'offres MAPA
// (src/pages/TenderDetail.tsx via src/components/HonorairesSection.tsx) :
// les deux doivent calculer exactement de la même façon, donc une seule
// implémentation plutôt que deux qui dérivent avec le temps.
import type { Contact } from '../types';
import type { AgencySettings } from './proposalExport';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO,
  type Cellule, type Colonne, type StyleLigne,
} from './xlsxLetterhead';

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

/**
 * Exporte la grille de répartition en xlsx, formules incluses — mêmes colonnes
 * que FeeDistributionGrid. Le classeur reste une calculette (le solde, le
 * relatif et les sous-totaux se recalculent) sous l'en-tête du cabinet : les
 * formules visent donc des lignes décalées par cet en-tête, d'où le compteur
 * de lignes tenu ici plutôt qu'un rang déduit du tableau.
 */
export async function exportFeeDistributionToXlsx(
  feeDistribution: string | undefined,
  specialtiesList: FeeDistributionSpecialty[] | undefined,
  contacts: Contact[],
  vatRate: number | undefined,
  filenameLabel: string,
  settings: AgencySettings = {},
): Promise<void> {
  if (!feeDistribution) return;
  try {
    const data = JSON.parse(feeDistribution);
    const specialties = specialtiesList || [];
    const selectedContacts = specialties.map(s => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name,
      };
    }).filter(c => c.id);

    const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
    const pct = '0.##';
    const colonnes: Colonne[] = [
      { header: 'Désignation', width: 36 },
      { header: 'Montant HT', width: 16, align: 'right', numFmt: FORMAT_EURO },
      { header: 'Rel %', width: 9, align: 'right', numFmt: pct },
      { header: 'Solde', width: 14, align: 'right', numFmt: FORMAT_EURO },
      { header: 'Architecte %', width: 12, align: 'right', numFmt: pct },
      { header: 'Architecte €', width: 14, align: 'right', numFmt: FORMAT_EURO },
    ];
    selectedContacts.forEach(c => {
      colonnes.push({ header: `${c.name} %`, width: 12, align: 'right', numFmt: pct });
      colonnes.push({ header: `${c.name} €`, width: 14, align: 'right', numFmt: FORMAT_EURO });
    });
    const f = ajouterFeuille(wb, {
      nom: 'Répartition Honoraires', settings, logo,
      title: 'Répartition des honoraires',
      subtitle: filenameLabel,
      colonnes,
    });

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

    // Numéro de la dernière ligne écrite : la suivante porte ce numéro + 1.
    let ligne = f.entete;
    const ecrire = (valeurs: Cellule[], style?: StyleLigne) => { f.ligne(valeurs, style); ligne++; };
    const sousTotaux: number[] = [];
    let baseSubtotalRow = 0;
    // Lignes de mission dont la colonne « Rel % » (part dans le total de la mission
    // de base) attend la ligne du sous-total, connue seulement après la première catégorie.
    const lignesRelatives: number[] = [];

    categories.forEach((cat) => {
      ecrire([cat.label], { gras: true, fond: 'doux' });
      const missions = data.missions.filter((m: any) => m.category === cat.category);
      const startRow = ligne + 1;

      missions.forEach((m: any) => {
        const r = ligne + 1;
        const rowData: Cellule[] = [m.name, m.amount || 0, 0];

        let soldeFormula = `B${r}*(100-(${getCol(4)}${r}`;
        selectedContacts.forEach((_, i) => {
          soldeFormula += `+${getCol(6 + i * 2)}${r}`;
        });
        soldeFormula += "))/100";
        rowData.push({ f: soldeFormula });

        rowData.push(m.percentages['architect'] || 0);
        rowData.push({ f: `B${r}*E${r}/100` });

        selectedContacts.forEach((c, i) => {
          rowData.push(m.percentages[c.id as string] || 0);
          rowData.push({ f: `B${r}*${getCol(6 + i * 2)}${r}/100` });
        });

        lignesRelatives.push(r);
        ecrire(rowData);
      });

      const subRowIdx = ligne + 1;
      if (cat.category === "Mission base") baseSubtotalRow = subRowIdx;
      sousTotaux.push(subRowIdx);

      const subRow: Cellule[] = [`Sous-total ${cat.label}`];
      subRow.push({ f: `SUM(B${startRow}:B${subRowIdx - 1})` });
      subRow.push({ f: `SUM(C${startRow}:C${subRowIdx - 1})` });
      subRow.push({ f: `SUM(D${startRow}:D${subRowIdx - 1})` });
      subRow.push("");
      subRow.push({ f: `SUM(F${startRow}:F${subRowIdx - 1})` });
      selectedContacts.forEach((_, i) => {
        subRow.push("");
        subRow.push({ f: `SUM(${getCol(7 + i * 2)}${startRow}:${getCol(7 + i * 2)}${subRowIdx - 1})` });
      });
      ecrire(subRow, { gras: true, fond: 'groupe' });
      f.vide(); ligne++;
    });

    for (const row of lignesRelatives) {
      const cell = f.ws.getRow(row).getCell(3);
      cell.value = { formula: `B${row}/$B$${baseSubtotalRow}*100` };
      cell.numFmt = pct;
    }

    const htSumFormula = sousTotaux.map(r => `B${r}`).join("+");
    f.total(["TOTAL GENERAL HT", { f: htSumFormula }]); ligne++;
    const vat = vatRate || 20;
    f.ligne([`TVA (${vat}%)`, { f: `B${ligne}*${vat}/100` }]); ligne++;
    f.total(["TOTAL GENERAL TTC", { f: `B${ligne - 1}+B${ligne}` }]);

    await enregistrerClasseur(wb, `Repartition_Honoraires_${filenameLabel || 'Projet'}.xlsx`);
  } catch (e) {
    console.error("Export failed:", e);
  }
}
