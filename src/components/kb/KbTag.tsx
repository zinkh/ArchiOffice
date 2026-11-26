// Étiquette colorée de la « Base de données ». Les couleurs sont des couleurs de DONNÉES (palette
// --kb-* de src/index.css), jamais les couleurs d'état. Rayon de 4 px (DESIGN.md).
import type { KbOption, KbTagColor } from '../../lib/kb';

export function KbTag({ option }: { option: Pick<KbOption, 'label' | 'color'> }) {
  return <span className="kb-tag" data-color={option.color} title={option.label}>{option.label}</span>;
}

export function KbSwatch({ color }: { color: KbTagColor }) {
  return <span className="kb-swatch kb-tag" data-color={color} aria-hidden style={{ padding: 0, background: 'var(--kb-dot)' }} />;
}
