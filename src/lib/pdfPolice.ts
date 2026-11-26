// ── Liberation Sans dans les PDF jsPDF ───────────────────────────────────────
// Les polices standard de jsPDF (Helvetica) n'écrivent que le jeu WinAnsi : ≤, ≥, ≈, ≠
// ou → y sont impossibles. Liberation Sans (SIL OFL 1.1, métriques d'Arial et de
// Helvetica : mise en page inchangée) les porte. Les quatre fichiers sont chargés à la
// demande, à l'export seulement ; en cas d'échec (hors ligne, test), l'appelant garde
// Helvetica et textePdf() remplace les symboles par leur équivalent ASCII.
import regulier from '../assets/fonts/LiberationSans-Regular.ttf?url';
import gras from '../assets/fonts/LiberationSans-Bold.ttf?url';
import italique from '../assets/fonts/LiberationSans-Italic.ttf?url';
import grasItalique from '../assets/fonts/LiberationSans-BoldItalic.ttf?url';

export const POLICE_LIBERATION = 'LiberationSans';

const FICHIERS = [
  { url: regulier, style: 'normal', fichier: 'LiberationSans-Regular.ttf' },
  { url: gras, style: 'bold', fichier: 'LiberationSans-Bold.ttf' },
  { url: italique, style: 'italic', fichier: 'LiberationSans-Italic.ttf' },
  { url: grasItalique, style: 'bolditalic', fichier: 'LiberationSans-BoldItalic.ttf' },
] as const;

// Lues une seule fois par session : un export par lot ou par bâtiment en produit plusieurs.
let base64Fichiers: Promise<string[]> | null = null;

function enBase64(octets: ArrayBuffer): string {
  const u8 = new Uint8Array(octets);
  let binaire = '';
  for (let i = 0; i < u8.length; i += 0x8000) binaire += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(binaire);
}

function lireFichiers(): Promise<string[]> {
  if (!base64Fichiers) {
    const lecture = Promise.all(FICHIERS.map(async f => {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(`Police ${f.fichier} : HTTP ${r.status}`);
      return enBase64(await r.arrayBuffer());
    }));
    // Un échec n'est pas retenu : le prochain export réessaie.
    lecture.catch(() => { if (base64Fichiers === lecture) base64Fichiers = null; });
    base64Fichiers = lecture;
  }
  return base64Fichiers;
}

/**
 * Enregistre Liberation Sans (normal, gras, italique, gras italique) dans le PDF.
 * Rend vrai quand la famille POLICE_LIBERATION est utilisable ; faux sinon, et
 * l'appelant reste alors sur Helvetica.
 */
export async function installerLiberationSans(pdf: any): Promise<boolean> {
  try {
    const donnees = await lireFichiers();
    FICHIERS.forEach((f, i) => {
      pdf.addFileToVFS(f.fichier, donnees[i]);
      pdf.addFont(f.fichier, POLICE_LIBERATION, f.style);
    });
    return true;
  } catch {
    return false;
  }
}
