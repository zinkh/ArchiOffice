// Pied de page et pagination d'un PDF qui mêle portrait et paysage (annexe de plans) : chaque page se règle sur SA
// taille. La taille était lue une seule fois, celle de la dernière page : le pied des pages portrait se dessinait à
// 210 mm au lieu de 297 mm, en plein milieu des fiches.
import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { drawAgencyFooters } from '../pdfLetterhead';

describe('drawAgencyFooters', () => {
  it('place le pied de chaque page selon sa propre hauteur', () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.addPage('a4', 'landscape');
    doc.addPage('a4', 'portrait');

    const posees: { page: number; y: number; texte: string }[] = [];
    const texte = doc.text.bind(doc);
    vi.spyOn(doc, 'text').mockImplementation(((...args: any[]) => {
      posees.push({ page: doc.getCurrentPageInfo().pageNumber, y: args[2], texte: String(args[0]) });
      return (texte as any)(...args);
    }) as any);

    drawAgencyFooters(doc, { agencyName: 'AAZS' } as any, { title: 'Test', margin: 14 } as any);

    const pagination = posees.filter(p => /^P\d\|3$/.test(p.texte));
    expect(pagination.map(p => p.page)).toEqual([1, 2, 3]);
    for (const p of pagination) {
      doc.setPage(p.page);
      expect(p.y).toBeCloseTo(doc.internal.pageSize.getHeight() - 7, 1);
    }
    // Portrait : 297 - 7 ; paysage : 210 - 7.
    expect(pagination[0].y).toBeCloseTo(290, 0);
    expect(pagination[1].y).toBeCloseTo(203, 0);
    expect(pagination[2].y).toBeCloseTo(290, 0);
  });
});
