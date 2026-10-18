import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
function luminance(hex: string) {
  const linear = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
describe('theme text contrast for small text (WCAG AA)', () => {
  for (const selector of [':root', '.dark']) {
    const block = css.match(selector === ':root' ? /:root \{\n([^}]+)\}/ : /\.dark \{\n([^}]+)\}/)![1];
    const token = (name: string) => block.match(new RegExp(`--tblr-${name}:\\s*(#[a-fA-F0-9]{6})`))![1];
    for (const text of ['text', 'muted']) for (const surface of ['surface', 'surface-2', 'bg']) {
      it(`${selector}: ${text} on ${surface} is at least 4.5:1`, () => {
        const [dark, light] = [luminance(token(text)), luminance(token(surface))].sort((a, b) => a - b);
        expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
