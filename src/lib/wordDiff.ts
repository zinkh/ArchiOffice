// Comparaison mot à mot de deux textes, pour montrer au confrère (et au cabinet) ce qu'une proposition
// change : les mots ajoutés, les mots retirés, le reste inchangé. Pur, sans HTML : l'écran affiche
// chaque segment lui-même, rien n'est injecté dans la page.

export type DiffSegment = { type: 'same' | 'add' | 'del'; text: string };

/** Au-delà, le calcul exact coûterait trop de mémoire : on rend l'ancien texte barré puis le nouveau. */
const MAX_CELLS = 4_000_000;

function push(out: DiffSegment[], type: DiffSegment['type'], text: string) {
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

export function wordDiff(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: 'same', text: before }] : [];
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const m = a.length;
  const n = b.length;
  if ((m + 1) * (n + 1) > MAX_CELLS) {
    const out: DiffSegment[] = [];
    if (before) out.push({ type: 'del', text: before });
    if (after) out.push({ type: 'add', text: after });
    return out;
  }
  // Plus longue sous-suite commune, remplie de la fin vers le début pour se parcourir dans l'ordre.
  const width = n + 1;
  const lcs = new Int32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push(out, 'same', a[i]); i++; j++; }
    else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) { push(out, 'del', a[i]); i++; }
    else { push(out, 'add', b[j]); j++; }
  }
  while (i < m) push(out, 'del', a[i++]);
  while (j < n) push(out, 'add', b[j++]);
  return out;
}
