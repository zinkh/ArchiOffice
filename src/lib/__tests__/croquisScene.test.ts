import { describe, expect, it } from 'vitest';
import type { CroquisElement } from '../../types/croquis';
import {
  DEFAULT_STYLE,
  HATCH_PRESETS,
  MAX_ELEMENTS,
  applyStyleToElement,
  createElement,
  elementBBox,
  elementHandles,
  eraseAtPoint,
  hitElement,
  isWorthKeeping,
  moveHandle,
  parseScene,
  sanitizeScene,
  sceneBBox,
  serializeScene,
  topElementAt,
  translateElement,
} from '../croquis/scene';

const el = (extra: Partial<CroquisElement> = {}): CroquisElement => ({
  id: 'e1',
  type: 'rect',
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 60,
  k: 1,
  seed: 7,
  rough: true,
  color: '#141414',
  sw: 2.2,
  fill: 'none',
  angle: 45,
  gap: 7,
  ...extra,
});

describe('createElement', () => {
  it('garde la taille du trait à l\'écran : k vaut 1 / zoom', () => {
    expect(createElement('rect', 10, 20, DEFAULT_STYLE, 2).k).toBe(0.5);
    expect(createElement('rect', 10, 20, DEFAULT_STYLE, 0.25).k).toBe(4);
  });

  it('démarre le tracé au point cliqué, avec une graine strictement positive', () => {
    const e = createElement('line', 10, 20, DEFAULT_STYLE, 1);
    expect([e.x1, e.y1, e.x2, e.y2]).toEqual([10, 20, 10, 20]);
    expect(e.seed).toBeGreaterThan(0);
    expect(Number.isInteger(e.seed)).toBe(true);
  });

  it('ne remplit que les rectangles et les ellipses', () => {
    const style = { ...DEFAULT_STYLE, ...HATCH_PRESETS.construit };
    expect(createElement('rect', 0, 0, style, 1).fill).toBe('hachure');
    expect(createElement('ellipse', 0, 0, style, 1).fill).toBe('hachure');
    expect(createElement('line', 0, 0, style, 1).fill).toBe('none');
    expect(createElement('pen', 0, 0, style, 1).fill).toBe('none');
  });
});

describe('sanitizeScene', () => {
  it('refuse une valeur qui n\'a pas la forme d\'une scène', () => {
    expect(sanitizeScene(null)).toBeNull();
    expect(sanitizeScene([])).toBeNull();
    expect(sanitizeScene({ version: 2, elements: [] })).toBeNull();
    expect(sanitizeScene({ version: 1, elements: 'x' })).toBeNull();
  });

  it('ignore les éléments invalides sans faire échouer la scène', () => {
    const scene = sanitizeScene({
      version: 1,
      elements: [
        el({ id: 'ok' }),
        { id: 'a', type: 'cercle', x1: 0, y1: 0 },
        { id: 'b', type: 'rect', x1: 'zéro', y1: 0 },
        { type: 'rect', x1: 0, y1: 0 },
        'texte',
        null,
      ],
    });
    expect(scene?.elements.map((e) => e.id)).toEqual(['ok']);
  });

  it('refuse les identifiants en double : le premier est gardé', () => {
    const scene = sanitizeScene({ version: 1, elements: [el({ id: 'x', x2: 10 }), el({ id: 'x', x2: 99 })] });
    expect(scene?.elements).toHaveLength(1);
    expect(scene?.elements[0].x2).toBe(10);
  });

  it('remet une valeur par défaut quand la couleur, le remplissage ou la graine sont invalides', () => {
    const [e] = sanitizeScene({
      version: 1,
      elements: [{ ...el(), color: 'red', fill: 'bogus', seed: -3 }],
    })!.elements;
    expect(e.color).toBe(DEFAULT_STYLE.color);
    expect(e.fill).toBe('none');
    expect(e.seed).toBe(1);
  });

  it('borne l\'épaisseur, l\'espacement et l\'échelle', () => {
    const [e] = sanitizeScene({ version: 1, elements: [{ ...el(), sw: 999, gap: 0, k: 0 }] })!.elements;
    expect(e.sw).toBe(20);
    expect(e.gap).toBe(2);
    expect(e.k).toBe(0.01);
  });

  it('refuse les coordonnées hors limites ou non finies', () => {
    const scene = sanitizeScene({
      version: 1,
      elements: [el({ id: 'a', x1: 5e9 }), el({ id: 'b', y1: Number.NaN }), el({ id: 'c' })],
    });
    expect(scene?.elements.map((e) => e.id)).toEqual(['c']);
  });

  it('ne garde le remplissage que pour les rectangles et les ellipses', () => {
    const scene = sanitizeScene({
      version: 1,
      elements: [
        el({ id: 'r', type: 'rect', fill: 'hachure' }),
        el({ id: 'l', type: 'line', fill: 'hachure' }),
        el({ id: 'a', type: 'arrow', fill: 'solid' }),
      ],
    })!;
    expect(Object.fromEntries(scene.elements.map((e) => [e.id, e.fill]))).toEqual({ r: 'hachure', l: 'none', a: 'none' });
  });

  it('exige des points valides pour un crayon et écarte les points malformés', () => {
    const scene = sanitizeScene({
      version: 1,
      elements: [
        el({ id: 'sans', type: 'pen' }),
        { ...el({ id: 'vide', type: 'pen' }), pts: [] },
        { ...el({ id: 'bon', type: 'pen' }), pts: [[1, 2], [3, 4], 'x', [Number.NaN, 1], [5]] },
      ],
    })!;
    expect(scene.elements.map((e) => e.id)).toEqual(['bon']);
    expect(scene.elements[0].pts).toEqual([[1, 2], [3, 4]]);
  });

  it('retire les espaces d\'un texte et écarte un texte vide', () => {
    const scene = sanitizeScene({
      version: 1,
      elements: [
        { ...el({ id: 't1', type: 'text' }), text: '  Cloison à démolir  ' },
        { ...el({ id: 't2', type: 'text' }), text: '   ' },
        el({ id: 't3', type: 'text' }),
      ],
    })!;
    expect(scene.elements.map((e) => [e.id, e.text])).toEqual([['t1', 'Cloison à démolir']]);
  });

  it('plafonne le nombre d\'éléments', () => {
    const many = Array.from({ length: MAX_ELEMENTS + 50 }, (_, i) => el({ id: `e${i}` }));
    expect(sanitizeScene({ version: 1, elements: many })!.elements).toHaveLength(MAX_ELEMENTS);
  });
});

describe('serializeScene et parseScene', () => {
  it('relit à l\'identique une scène sérialisée', () => {
    const scene = {
      version: 1 as const,
      elements: [
        el({ id: 'r', fill: 'hachure', color: '#c8322b' }),
        { ...el({ id: 'p', type: 'pen' }), pts: [[1, 2], [3, 4]] as [number, number][] },
        { ...el({ id: 't', type: 'text' }), text: 'Extension à construire' },
      ],
    };
    expect(parseScene(serializeScene(scene))).toEqual(scene);
  });

  it('arrondit les nombres à deux décimales', () => {
    const json = serializeScene({ version: 1, elements: [el({ x1: 1.23456, y1: 7.891 })] });
    expect(JSON.parse(json).elements[0].x1).toBe(1.23);
    expect(JSON.parse(json).elements[0].y1).toBe(7.89);
  });

  it('renvoie null pour un JSON illisible, sans lever d\'exception', () => {
    expect(parseScene('{pas du json')).toBeNull();
    expect(parseScene('42')).toBeNull();
  });
});

describe('boîtes englobantes', () => {
  it('normalise un rectangle tracé de droite à gauche', () => {
    expect(elementBBox(el({ x1: 100, y1: 60, x2: 0, y2: 0 }))).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  });

  it('englobe tous les points d\'un crayon', () => {
    const pen = { ...el({ type: 'pen' }), pts: [[5, 10], [-5, 30], [20, 0]] as [number, number][] };
    expect(elementBBox(pen)).toEqual({ x: -5, y: 0, w: 25, h: 30 });
  });

  it('utilise la largeur mesurée d\'un texte quand elle est connue', () => {
    const text = { ...el({ type: 'text', x1: 10, y1: 20 }), text: 'Séjour' };
    expect(elementBBox(text, 80)).toMatchObject({ x: 10, y: 20, w: 80 });
    expect(elementBBox(text).w).toBeGreaterThan(0);
  });

  it('renvoie null pour une scène vide et l\'union des boîtes sinon', () => {
    expect(sceneBBox([])).toBeNull();
    const box = sceneBBox([el({ x1: 0, y1: 0, x2: 10, y2: 10 }), el({ id: 'b', x1: 50, y1: 40, x2: 60, y2: 90 })]);
    expect(box).toEqual({ x: 0, y: 0, w: 60, h: 90 });
  });
});

describe('hitElement', () => {
  it('touche une ligne à proximité et pas au loin', () => {
    const line = el({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(hitElement(line, 50, 8, 1)).toBe(true);
    expect(hitElement(line, 50, 30, 1)).toBe(false);
  });

  it('garde une tolérance constante à l\'écran : elle se resserre quand on zoome', () => {
    const line = el({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(hitElement(line, 50, 8, 1)).toBe(true);
    expect(hitElement(line, 50, 8, 4)).toBe(false);
  });

  it('ne touche l\'intérieur d\'un rectangle vide que par son bord', () => {
    const rect = el({ fill: 'none' });
    expect(hitElement(rect, 50, 30, 1)).toBe(false);
    expect(hitElement(rect, 0, 30, 1)).toBe(true);
    expect(hitElement(rect, 200, 200, 1)).toBe(false);
  });

  it('touche tout l\'intérieur d\'un rectangle rempli', () => {
    expect(hitElement(el({ fill: 'hachure' }), 50, 30, 1)).toBe(true);
  });

  it('distingue le centre et le contour d\'une ellipse vide', () => {
    const ellipse = el({ type: 'ellipse', fill: 'none' });
    expect(hitElement(ellipse, 50, 30, 1)).toBe(false);
    expect(hitElement(ellipse, 100, 30, 1)).toBe(true);
    expect(hitElement(el({ type: 'ellipse', fill: 'solid' }), 50, 30, 1)).toBe(true);
  });

  it('touche un crayon le long de son tracé, y compris un simple point', () => {
    const pen = { ...el({ type: 'pen' }), pts: [[0, 0], [100, 0]] as [number, number][] };
    expect(hitElement(pen, 50, 5, 1)).toBe(true);
    expect(hitElement(pen, 50, 30, 1)).toBe(false);
    const dot = { ...el({ type: 'pen' }), pts: [[10, 10]] as [number, number][] };
    expect(hitElement(dot, 12, 10, 1)).toBe(true);
    expect(hitElement(dot, 40, 10, 1)).toBe(false);
  });

  it('touche un texte dans sa boîte', () => {
    const text = { ...el({ type: 'text', x1: 0, y1: 0 }), text: 'Cuisine' };
    expect(hitElement(text, 10, 10, 1)).toBe(true);
    expect(hitElement(text, 500, 500, 1)).toBe(false);
  });
});

describe('topElementAt et eraseAtPoint', () => {
  const dessous = el({ id: 'dessous', fill: 'solid' });
  const dessus = el({ id: 'dessus', fill: 'solid' });

  it('choisit l\'élément dessiné en dernier', () => {
    expect(topElementAt([dessous, dessus], 50, 30, 1)?.id).toBe('dessus');
    expect(topElementAt([dessous, dessus], 500, 500, 1)).toBeNull();
  });

  it('gomme les éléments sous le point et compte ce qui part', () => {
    const loin = el({ id: 'loin', x1: 500, y1: 500, x2: 600, y2: 560, fill: 'solid' });
    const res = eraseAtPoint([dessous, dessus, loin], 50, 30, 1);
    expect(res.removed).toBe(2);
    expect(res.elements.map((e) => e.id)).toEqual(['loin']);
  });

  it('renvoie la même liste quand il n\'y a rien à gommer', () => {
    const list = [dessous];
    const res = eraseAtPoint(list, 500, 500, 1);
    expect(res.removed).toBe(0);
    expect(res.elements).toBe(list);
  });
});

describe('modifications immuables', () => {
  it('déplace un élément sans toucher à l\'original', () => {
    const original = { ...el({ type: 'pen' }), pts: [[0, 0], [10, 10]] as [number, number][] };
    const moved = translateElement(original, 5, -2);
    expect([moved.x1, moved.y1, moved.x2, moved.y2]).toEqual([5, -2, 105, 58]);
    expect(moved.pts).toEqual([[5, -2], [15, 8]]);
    expect(original.pts).toEqual([[0, 0], [10, 10]]);
    expect(original.x1).toBe(0);
  });

  it('expose quatre poignées sur une forme, deux sur un segment, aucune sur un texte', () => {
    expect(elementHandles(el())).toHaveLength(4);
    expect(elementHandles(el({ type: 'arrow' }))).toHaveLength(2);
    expect(elementHandles({ ...el({ type: 'text' }), text: 'x' })).toHaveLength(0);
  });

  it('redimensionne par un coin sans modifier l\'original', () => {
    const original = el();
    const resized = moveHandle(original, 2, 200, 120);
    expect([resized.x2, resized.y2]).toEqual([200, 120]);
    expect([resized.x1, resized.y1]).toEqual([0, 0]);
    expect([original.x2, original.y2]).toEqual([100, 60]);
  });

  it('déplace l\'extrémité d\'un segment, et ignore un index inconnu', () => {
    const line = el({ type: 'line' });
    expect(moveHandle(line, 0, 9, 9)).toMatchObject({ x1: 9, y1: 9, x2: 100, y2: 60 });
    expect(moveHandle(line, 5, 9, 9)).toBe(line);
  });

  it('change le style sans remplir un crayon ni un trait', () => {
    expect(applyStyleToElement(el(), { fill: 'hachure', color: '#c8322b' })).toMatchObject({ fill: 'hachure', color: '#c8322b' });
    expect(applyStyleToElement(el({ type: 'line' }), { fill: 'hachure' }).fill).toBe('none');
  });
});

describe('isWorthKeeping', () => {
  it('écarte un simple clic mais garde un point de crayon', () => {
    expect(isWorthKeeping(el({ type: 'line', x2: 0, y2: 0 }), 1)).toBe(false);
    expect(isWorthKeeping(el({ type: 'line', x2: 40, y2: 0 }), 1)).toBe(true);
    expect(isWorthKeeping({ ...el({ type: 'pen', x2: 0, y2: 0 }), pts: [[0, 0]] }, 1)).toBe(true);
  });
});
