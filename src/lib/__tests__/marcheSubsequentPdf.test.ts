import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montantSubsequentHT, rendreMarcheSubsequent, type MarcheContrat } from '../marcheSubsequentPdf';
import type { RenduPdf } from '../certificatPaiementPdf';

/** Rendu réel jsPDF ; collecte le texte posé et les cellules des tableaux. */
function rendu(): { r: RenduPdf; textes: string[]; cellules: string[] } {
  const pdf: any = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const textes: string[] = [];
  const cellules: string[] = [];
  const texte = pdf.text.bind(pdf);
  pdf.text = (t: string | string[], ...args: unknown[]) => {
    textes.push(...(Array.isArray(t) ? t : [t]).map(String));
    return texte(t, ...args);
  };
  const tableau = (doc: any, options: any) => {
    for (const ligne of [...(options.body ?? []), ...(options.foot ?? [])]) {
      cellules.push(...ligne.map((c: any) => String(c?.content ?? c)));
    }
    return (autoTable as any)(doc, options);
  };
  return { r: { pdf, autoTable: tableau as any, settings: { agencyName: "Atelier d'architecture" } as any }, textes, cellules };
}

const accordCadre: MarcheContrat = {
  entreprise_nom: 'Dupont SARL', entreprise_siret: '12345678900011', lot_numero: '02', lot_titre: 'Carrelage',
  type_marche: 'accord_cadre', mode_execution: 'marches_subsequents', montant_maxi_ht: 1000, montant_mini_ht: 200,
  date_fin_accord_cadre: '2027-12-31', statut_signature: 'signe', date_signature: '2026-10-01', tva_rate: 20,
};
const sub = (extra: Partial<MarcheContrat> & { id?: string } = {}): MarcheContrat & { id?: string } => ({
  ...accordCadre, type_marche: 'subsequent', numero_subsequent: 2, objet: 'Carrelage salle B', date_notification: '2026-10-20',
  lignes_commande: [
    { articleId: 'a1', refBpu: '1.1', designation: 'Carrelage grès', unite: 'm²', quantite: 10, prixUnitaire: 45 },
    { articleId: 'a2', designation: 'Plinthe', unite: 'ml', quantite: 12.5, prixUnitaire: 8 },
  ],
  ...extra,
});

describe('rendreMarcheSubsequent', () => {
  it('rend un PDF avec le titre, les lignes et les signatures', () => {
    const { r, textes } = rendu();
    rendreMarcheSubsequent(r, accordCadre, sub(), [], { code: '26014', nom: 'Entretien', maitreOuvrage: 'Commune' });
    const contenu = textes.join('\n');
    expect(contenu).toContain('MARCHÉ SUBSÉQUENT N° 2');
    expect(contenu).toContain('Le pouvoir adjudicateur');
    expect(r.pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
    expect(r.pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('calcule le montant depuis les lignes, la TVA et la situation du plafond', () => {
    expect(montantSubsequentHT(sub())).toBe(550);
    expect(montantSubsequentHT(sub({ lignes_commande: [], montant_ht: 99 }))).toBe(99);
    const { r, cellules } = rendu();
    rendreMarcheSubsequent(r, accordCadre, sub(), [{ id: 'autre', montant_ht: 300 }], {});
    expect(cellules).toContain('550,00 €');   // total HT
    expect(cellules).toContain('110,00 €');   // TVA 20 %
    expect(cellules).toContain('660,00 €');   // TTC
    expect(cellules).toContain('850,00 €');   // commandé après
    expect(cellules).toContain('150,00 €');   // reste disponible
  });

  it('ne compte pas le subséquent lui-même dans le déjà commandé', () => {
    const { r, cellules } = rendu();
    rendreMarcheSubsequent(r, accordCadre, sub({ id: 'moi' }), [{ id: 'moi', montant_ht: 550 }], {});
    expect(cellules).toContain('0,00 €');
    expect(cellules).toContain('450,00 €');   // reste disponible : 1000 - 0 - 550
  });

  it('un résilié ne consomme pas le plafond', () => {
    const { r, cellules } = rendu();
    rendreMarcheSubsequent(r, accordCadre, sub(), [{ id: 'x', montant_ht: 400, statut: 'resilie' }], {});
    expect(cellules).toContain('450,00 €');
  });

  it('passe sur plusieurs pages quand les lignes sont nombreuses', () => {
    const { r } = rendu();
    const lignes = Array.from({ length: 80 }, (_, i) => ({ articleId: `a${i}`, designation: `Article ${i}`, unite: 'u', quantite: 1, prixUnitaire: 1 }));
    rendreMarcheSubsequent(r, accordCadre, sub({ lignes_commande: lignes }), [], {});
    expect(r.pdf.getNumberOfPages()).toBeGreaterThan(1);
  });
});
