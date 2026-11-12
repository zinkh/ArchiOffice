import { describe, expect, it } from 'vitest';
import { drawAgencyHeader, type CotraitantIdentity, type LogoImage } from '../pdfLetterhead';

const logo = (tag: string): LogoImage => ({ dataUrl: `data:${tag}`, format: 'PNG', width: 100, height: 50 });

function fauxPdf() {
  const textes: string[] = [];
  const images: string[] = [];
  const pdf: any = {
    internal: { pageSize: { getWidth: () => 210 }, getCurrentPageInfo: () => ({ pageNumber: 1 }) },
    setFont() {}, setFontSize() {}, setTextColor() {}, setDrawColor() {}, setLineWidth() {}, line() {},
    getTextWidth: (t: string) => t.length,
    splitTextToSize: (t: string) => [t],
    text: (t: string) => { textes.push(t); },
    addImage: (d: string) => { images.push(d); },
  };
  return { pdf, textes, images };
}

const settings: any = { agencyName: 'AAZS', address: '23 bd de l\'Europe', phone: '0684016633', email: 'contact@aazs.fr' };
const mandataire: CotraitantIdentity = {
  contactId: 'c1', titre: 'Bureau Martin', sousTitre: '', adresse: '1 rue du Test, 54000 Nancy',
  telephone: '0300000000', email: 'martin@example.fr', siret: '', logo: logo('martin'),
};

describe('en-tête avec un cotraitant mandataire', () => {
  it('imprime le logo et les coordonnées du mandataire, le cabinet passe dans le bandeau', () => {
    const { pdf, textes, images } = fauxPdf();
    drawAgencyHeader(pdf, settings, { title: 'CCAP', logo: logo('aazs'), partnerLogos: [], mandataire });
    expect(textes).toContain('Bureau Martin');
    expect(textes).toContain('1 rue du Test, 54000 Nancy');
    expect(textes.some(t => t.includes('martin@example.fr'))).toBe(true);
    expect(textes).not.toContain('AAZS');
    expect(images).toEqual(['data:martin', 'data:aazs']);
  });

  it('garde le cabinet en en-tête sans mandataire', () => {
    const { pdf, textes, images } = fauxPdf();
    drawAgencyHeader(pdf, settings, { title: 'CCAP', logo: logo('aazs'), partnerLogos: [], mandataire: null });
    expect(textes).toContain('AAZS');
    expect(images).toEqual(['data:aazs']);
  });
});
