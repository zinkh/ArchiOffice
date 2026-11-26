// ── Texte sûr pour les polices standard de jsPDF ─────────────────────────────
// Helvetica n'écrit que le jeu WinAnsi (Windows-1252). Un seul caractère hors
// de ce jeu (≤, ≥, ≈, →, ∅, espace fine insécable...) fait passer TOUTE la
// ligne en encodage 2 octets : lettres espacées démesurément, largeur mesurée
// fausse, ligne qui déborde de la page. On remplace donc ces caractères par un
// équivalent lisible AVANT de mesurer et d'écrire.

const REMPLACEMENTS: Record<string, string> = {
  '≤': '<=', '≥': '>=', '≈': '~', '≠': '!=', '→': '->', '←': '<-', '↔': '<->',
  '−': '-', '‑': '-', '‒': '-', '―': '-', '∅': 'Ø', '⌀': 'Ø', '∞': 'infini',
  '√': 'racine', '∑': 'somme', 'Δ': 'delta', 'λ': 'lambda', 'Ω': 'ohm',
  '✓': 'x', '✔': 'x', '✗': 'x', '✘': 'x', '□': '[ ]', '☐': '[ ]', '☑': '[x]',
  '▪': '-', '■': '-', '●': '•', '◦': '-', '‣': '-', '′': "'", '″': '"',
  '㎡': 'm²', '㎥': 'm³', '㎜': 'mm', '㎝': 'cm', '㎞': 'km', '℃': '°C',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '​': '', '‌': '', '‍': '', '﻿': '',
};

// Les caractères de 0x80 à 0x9F de Windows-1252 qui ne sont pas du Latin-1.
const WINANSI_SPECIAUX = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const estWinAnsi = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return c.length === 1 && (code === 9 || code === 10 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_SPECIAUX.has(c));
};

// Symboles que Liberation Sans porte en plus du WinAnsi (vérifiés sur ses quatre styles).
const GLYPHES_LIBERATION = new Set('≤≥≈≠→←↔−‒―∞√∑ΔλΩ□▪■●◦′″∂∆∏∫◊');

/**
 * Le texte, débarrassé de tout caractère que la police ne sait pas écrire. Par défaut
 * Helvetica (WinAnsi) ; `liberation: true` garde aussi les symboles de Liberation Sans
 * (≤, ≥, ≈, ≠, →...) quand cette police est embarquée dans le PDF.
 */
export function textePdf(texte: string, opts: { liberation?: boolean } = {}): string {
  if (!texte) return texte;
  let sortie = '';
  for (const c of texte) {
    if (estWinAnsi(c) || (opts.liberation && GLYPHES_LIBERATION.has(c))) { sortie += c; continue; }
    if (c in REMPLACEMENTS) { sortie += REMPLACEMENTS[c]; continue; }
    // Lettre accentuée hors Latin-1 (ă, ő...) : on garde la lettre de base.
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    sortie += [...base].every(estWinAnsi) ? base : '';
  }
  return sortie;
}
