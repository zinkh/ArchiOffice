import { describe, it, expect } from 'vitest';
import { computeBoardCells } from '../inspirationExport';

describe('computeBoardCells', () => {
  it('rend une case par référence, dans la zone utile', () => {
    const cells = computeBoardCells(7, 'grid', 14, 40, 270, 300);
    expect(cells).toHaveLength(7);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(14 - 0.001);
      expect(c.x + c.w).toBeLessThanOrEqual(14 + 270 + 0.001);
      expect(c.y + c.h).toBeLessThanOrEqual(40 + 300 + 0.001);
    }
  });

  it('rend une liste vide sans référence', () => {
    expect(computeBoardCells(0, 'grid', 14, 40, 270, 300)).toEqual([]);
  });

  it('donne à la première référence de la mosaïque une case double sans chevauchement', () => {
    const cells = computeBoardCells(5, 'mosaic', 14, 40, 270, 400);
    expect(cells[0].w).toBeGreaterThan(cells[1].w * 1.9);
    const [big, ...others] = cells;
    for (const c of others) {
      const overlap = c.x < big.x + big.w - 0.01 && c.x + c.w > big.x + 0.01
        && c.y < big.y + big.h - 0.01 && c.y + c.h > big.y + 0.01;
      expect(overlap).toBe(false);
    }
  });

  it('réduit une planche trop haute plutôt que de déborder', () => {
    const cells = computeBoardCells(30, 'grid', 14, 40, 270, 150);
    for (const c of cells) expect(c.y + c.h).toBeLessThanOrEqual(40 + 150 + 0.001);
  });
});
