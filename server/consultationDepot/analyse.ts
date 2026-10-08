// Lecture du texte d'une offre déposée, pour en proposer les montants probables
// (src/lib/depotMontants.ts). Sans modèle, sans OCR, sans coût : un document
// scanné rend simplement « aucun texte exploitable ». Les montants sont une
// SUGGESTION confirmée par l'architecte, jamais appliquée seule.
//
// Le texte n'est volontairement pas tronqué à 20 000 caractères comme celui des
// agents : le total d'un devis se trouve presque toujours à la fin du document.
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { extensionDe } from '../../src/lib/consultationDepot';
import { parseMontantFr } from '../../src/lib/depotMontants';
import { lireEntreeZip } from './fileRules';

const MOTS_MONTANT = /total|montant|prix|forfait|\bh\.?t\b|\bttc\b/i;

/** Un tableur : une ligne par rangée. Les cellules numériques d'une rangée qui parle de montant reçoivent « € », puisque les cellules d'un devis n'en portent pas toujours. */
export async function texteDeTableur(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx');
  const classeur = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  const lignes: string[] = [];
  for (const nom of classeur.SheetNames.slice(0, 20)) {
    const grille = XLSX.utils.sheet_to_json<any[]>(classeur.Sheets[nom], { header: 1, defval: '', raw: false, blankrows: false });
    for (const rangee of grille.slice(0, 5000)) {
      const cellules = rangee.map(c => String(c ?? '').trim()).filter(Boolean);
      if (!cellules.length) continue;
      const parleDeMontant = cellules.some(c => MOTS_MONTANT.test(c));
      lignes.push(cellules.map(c => (parleDeMontant && /^[\d\s  .,]+$/.test(c) && parseMontantFr(c) !== null ? `${c} €` : c)).join('  '));
    }
  }
  return lignes.join('\n');
}

/** Le texte d'un texte OpenDocument : balises retirées, un saut de ligne par paragraphe. */
export function texteDeOdt(buffer: Buffer): string | null {
  const contenu = lireEntreeZip(buffer, 'content.xml');
  if (!contenu) return null;
  return contenu.toString('utf8')
    .replace(/<\/text:(p|h)>/g, '\n')
    .replace(/<text:tab\/>/g, ' ')
    .replace(/<text:s[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Le texte d'un fichier déposé, ou null s'il n'y en a aucun d'exploitable. */
export async function lireTexteDepot(nomFichier: string, buffer: Buffer): Promise<string | null> {
  const ext = extensionDe(nomFichier);
  let texte: string | null = null;
  if (ext === 'pdf') texte = (await pdfParse(buffer)).text;
  else if (ext === 'docx') texte = (await mammoth.extractRawText({ buffer })).value;
  else if (ext === 'xlsx' || ext === 'ods') texte = await texteDeTableur(buffer);
  else if (ext === 'odt') texte = texteDeOdt(buffer);
  return texte && texte.trim() ? texte : null;
}
