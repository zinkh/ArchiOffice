// Fabrique de petites archives ZIP (entrées non compressées) pour les tests
// qui ont besoin d'un « faux .docx / .xlsx / .ods » dont seul l'annuaire des
// entrées compte (server/consultationDepot/fileRules.ts ne décompresse rien).
export interface EntreeZip { name: string; data?: string }

export function construireZip(entrees: EntreeZip[]): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;

  for (const e of entrees) {
    const nom = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data ?? '', 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nom.length, 26);
    locaux.push(local, nom, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, nom);

    decalage += 30 + nom.length + data.length;
  }

  const annuaire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(annuaire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, annuaire, fin]);
}

export const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';
export const MIME_ODT = 'application/vnd.oasis.opendocument.text';

export const faussePdf = () => Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
export const fausseDocx = () => construireZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'word/document.xml', data: '<w/>' }]);
export const fausseXlsx = () => construireZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'xl/workbook.xml', data: '<w/>' }]);
export const fausseOds = (mime = MIME_ODS) => construireZip([{ name: 'mimetype', data: mime }, { name: 'content.xml', data: '<c/>' }]);
