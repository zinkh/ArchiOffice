// ── Lecture des champs d'un acte d'engagement PDF rempli ─────────────────────
// Sépare l'accès à pdf.js (navigateur) de l'interprétation des champs
// (`lireActeFormulaire`, pure et testée) : la bibliothèque est fournie par
// l'appelant, qui règle son propre worker.
import { AE_KEYWORD } from './actEngagementForm';

/** Ce que ce module utilise de pdf.js. */
interface PdfjsMinimal {
  getDocument(src: { data: Uint8Array }): { promise: Promise<{
    numPages: number;
    getMetadata(): Promise<{ info?: Record<string, unknown> }>;
    getPage(n: number): Promise<{ getAnnotations(): Promise<Array<Record<string, any>>> }>;
  }> };
}

export class FormulaireNonReconnuError extends Error {
  constructor() { super('Ce PDF n\'est pas un acte d\'engagement généré par ArchiOffice.'); }
}

/** Champs de formulaire du PDF : nom → texte, ou booléen pour une case à cocher. */
export async function champsDepuisPdf(data: ArrayBuffer, pdfjs: PdfjsMinimal): Promise<Record<string, string | boolean>> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const meta = await doc.getMetadata();
  const mots = String(meta.info?.Keywords ?? '');
  if (!mots.includes(AE_KEYWORD.replace(/-v\d+$/, ''))) throw new FormulaireNonReconnuError();

  const champs: Record<string, string | boolean> = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const annotations = await (await doc.getPage(n)).getAnnotations();
    for (const a of annotations) {
      if (a.subtype !== 'Widget' || !a.fieldName) continue;
      if (a.checkBox) {
        const v = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
        champs[a.fieldName] = !!v && String(v).toLowerCase() !== 'off';
      } else {
        const v = Array.isArray(a.fieldValue) ? a.fieldValue.join(' ') : a.fieldValue;
        champs[a.fieldName] = typeof v === 'string' ? v : '';
      }
    }
  }
  return champs;
}
