// Contrôle des octets des remises d'entreprises : la liste blanche tient sur le
// CONTENU, jamais sur le nom ni le type MIME annoncés.
import { describe, expect, it } from 'vitest';
import { listerEntreesZip, verifierOctets } from '../server/consultationDepot/fileRules';
import {
  construireZip, faussePdf, fausseDocx, fausseXlsx, fausseOds, MIME_ODT,
} from './fixtures/zipBuilder';

describe('verifierOctets — formats acceptés', () => {
  it('accepte un PDF, un Word, un Excel, un ODS et un ODT valides', () => {
    expect(verifierOctets('devis.pdf', faussePdf())).toEqual({ ok: true, mime: 'application/pdf' });
    expect(verifierOctets('memoire.docx', fausseDocx()).ok).toBe(true);
    expect(verifierOctets('bordereau.xlsx', fausseXlsx()).ok).toBe(true);
    expect(verifierOctets('bordereau.ods', fausseOds()).ok).toBe(true);
    expect(verifierOctets('memoire.odt', fausseOds(MIME_ODT)).ok).toBe(true);
  });

  it('accepte une extension en majuscules', () => {
    expect(verifierOctets('DEVIS.PDF', faussePdf()).ok).toBe(true);
  });
});

describe('verifierOctets — formats refusés', () => {
  it('refuse les plans DWG et DXF, quel que soit leur contenu', () => {
    expect(verifierOctets('plan.dwg', Buffer.from('AC1032\0\0\0')).ok).toBe(false);
    expect(verifierOctets('plan.dxf', Buffer.from('0\nSECTION\n')).ok).toBe(false);
  });

  it('refuse les formats à macros et les anciens binaires', () => {
    expect(verifierOctets('a.docm', fausseDocx()).ok).toBe(false);
    expect(verifierOctets('a.xlsm', fausseXlsx()).ok).toBe(false);
    expect(verifierOctets('a.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])).ok).toBe(false);
    expect(verifierOctets('a.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])).ok).toBe(false);
  });

  it("refuse un ancien binaire Office renommé en .docx", () => {
    const r = verifierOctets('a.docx', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(600)]));
    expect(r.ok).toBe(false);
    expect((r as any).raison).toContain('.doc');
  });

  it('refuse un exécutable déguisé en PDF', () => {
    expect(verifierOctets('devis.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])).ok).toBe(false);
  });

  it('refuse une page HTML déguisée en PDF', () => {
    expect(verifierOctets('devis.pdf', Buffer.from('<!DOCTYPE html><script>x</script>')).ok).toBe(false);
  });

  it("refuse un PDF qui lance une action à l'ouverture", () => {
    expect(verifierOctets('a.pdf', Buffer.from('%PDF-1.7\n/OpenAction<</S/Launch /F(cmd.exe)>>')).ok).toBe(false);
  });

  it('refuse un fichier vide', () => {
    expect(verifierOctets('a.pdf', Buffer.alloc(0)).ok).toBe(false);
  });

  it('refuse un .docx qui contient une macro VBA', () => {
    const z = construireZip([
      { name: '[Content_Types].xml' }, { name: 'word/document.xml' }, { name: 'word/vbaProject.bin' },
    ]);
    expect(verifierOctets('a.docx', z).ok).toBe(false);
  });

  it('refuse une archive qui embarque un programme', () => {
    const z = construireZip([{ name: '[Content_Types].xml' }, { name: 'xl/workbook.xml' }, { name: 'xl/run.exe' }]);
    expect(verifierOctets('a.xlsx', z).ok).toBe(false);
  });

  it('refuse un .xlsx qui est en réalité un .docx', () => {
    expect(verifierOctets('a.xlsx', fausseDocx()).ok).toBe(false);
  });

  it('refuse un .ods dont le type déclaré est celui d’un texte', () => {
    expect(verifierOctets('a.ods', fausseOds(MIME_ODT)).ok).toBe(false);
  });

  it('refuse un ODS avec des macros Basic', () => {
    const z = construireZip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet' }, { name: 'content.xml' }, { name: 'Basic/Standard/Module1.xml' }]);
    expect(verifierOctets('a.ods', z).ok).toBe(false);
  });

  it('refuse une archive illisible', () => {
    expect(verifierOctets('a.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(80)])).ok).toBe(false);
  });
});

describe('listerEntreesZip', () => {
  it("rend les noms d'entrées dans l'ordre", () => {
    const z = construireZip([{ name: 'a.txt' }, { name: 'dossier/é.xml' }]);
    expect(listerEntreesZip(z)).toEqual(['a.txt', 'dossier/é.xml']);
  });

  it('rend null sans annuaire central', () => {
    expect(listerEntreesZip(Buffer.from('rien'))).toBeNull();
  });
});
