// Source Sans 3 auto-hébergée (paquet @fontsource) et embarquée en base64 dans
// le HTML : le rendu Chromium ne dépend d'aucun accès réseau. Repli Helvetica /
// Arial si un fichier manquait.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WEIGHTS = [400, 600, 700] as const;
const SUBSETS: Array<{ name: string; range: string }> = [
  { name: 'latin', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { name: 'latin-ext', range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
];

let cached: string | null = null;

export function sourceSansFontFaces(): string {
  if (cached !== null) return cached;
  const require = createRequire(import.meta.url);
  let dir: string;
  try {
    dir = require.resolve('@fontsource/source-sans-3/package.json').replace(/package\.json$/, 'files/');
  } catch {
    cached = '';
    return cached;
  }
  const faces: string[] = [];
  for (const weight of WEIGHTS) {
    for (const subset of SUBSETS) {
      try {
        const b64 = readFileSync(`${dir}source-sans-3-${subset.name}-${weight}-normal.woff2`).toString('base64');
        faces.push(
          `@font-face{font-family:'Source Sans 3';font-style:normal;font-weight:${weight};font-display:block;` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${subset.range};}`,
        );
      } catch { /* un fichier manquant n'empêche pas l'export */ }
    }
  }
  cached = faces.join('\n');
  return cached;
}
