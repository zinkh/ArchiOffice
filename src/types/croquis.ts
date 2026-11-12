// Types du croquis de réunion (voir src/lib/croquis/scene.ts pour la logique pure).

export type CroquisTool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser';

/** Types d'éléments dessinés (les outils `select`, `hand` et `eraser` n'en créent pas). */
export type CroquisShapeType = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

export type CroquisFill = 'none' | 'hachure' | 'cross-hatch' | 'zigzag' | 'dots' | 'solid';

/** Réglages de style appliqués aux nouveaux éléments et à l'élément sélectionné. */
export interface CroquisStyle {
  /** Trait main levée (Rough.js) ou net. */
  rough: boolean;
  color: string;
  /** Épaisseur du trait, en pixels d'écran à la création. */
  sw: number;
  fill: CroquisFill;
  /** Angle des hachures, en degrés. */
  angle: number;
  /** Espacement des hachures. */
  gap: number;
}

/**
 * Un élément de la scène. Entièrement sérialisable.
 *
 * - `seed` : sans lui Rough.js redessine un tracé différent à chaque rendu.
 * - `k` : échelle de l'écran à la création (1 / zoom). Trait, hachures et texte
 *   gardent ainsi leur taille quel que soit le zoom courant.
 * - `pts` : points du crayon libre (type `pen` seulement).
 * - `text` : contenu (type `text` seulement).
 */
export interface CroquisElement extends CroquisStyle {
  id: string;
  type: CroquisShapeType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  k: number;
  seed: number;
  pts?: [number, number][];
  text?: string;
}

export interface CroquisScene {
  /** Version du format, pour le faire évoluer sans casser les croquis enregistrés. */
  version: 1;
  elements: CroquisElement[];
}

export interface CroquisBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Poignée de redimensionnement d'un élément sélectionné. */
export interface CroquisHandle {
  x: number;
  y: number;
}
