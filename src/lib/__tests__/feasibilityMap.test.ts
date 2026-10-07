import { describe, expect, it } from 'vitest';
import {
  approximateScale, geometryCenter, geometryRings, lonLatToWorldPx, metersPerPixel, niceScaleBar, planMapExtract, pointInGeometry, shiftCenter, TILE_SIZE,
} from '../feasibilityMap';

describe('geometryCenter', () => {
  it('returns the centre of the bounding box over every polygon', () => {
    const multi = { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[6, 1], [8, 1], [8, 5], [6, 5], [6, 1]]],
    ] };
    expect(geometryCenter(multi)).toEqual({ lon: 4, lat: 2.5 });
  });

  it('returns null without geometry', () => {
    expect(geometryCenter(null)).toBeNull();
    expect(geometryCenter({ type: 'Point', coordinates: [1, 2] })).toBeNull();
  });
});

describe('shiftCenter', () => {
  it('moves the centre opposite to the drag, north when dragging down', () => {
    const c = shiftCenter({ lon: 6, lat: 0 }, 100, 100, 1);
    expect(c.lon).toBeLessThan(6);
    expect(c.lat).toBeGreaterThan(0);
  });

  it('is a no-op for a zero drag', () => {
    expect(shiftCenter({ lon: 6, lat: 48 }, 0, 0, 2)).toEqual({ lon: 6, lat: 48 });
  });
});

describe('lonLatToWorldPx', () => {
  it('maps (0, 0) to the centre of the world at any zoom', () => {
    expect(lonLatToWorldPx(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const p = lonLatToWorldPx(0, 0, 3);
    expect(p.x).toBeCloseTo(TILE_SIZE * 4);
    expect(p.y).toBeCloseTo(TILE_SIZE * 4);
  });
});

describe('planMapExtract', () => {
  const opts = { lon: 6.18, lat: 48.69, widthM: 250, outW: 1200, outH: 800, maxZoom: 19 };

  it('picks the coarsest zoom that still gives one tile pixel per output pixel', () => {
    const plan = planMapExtract(opts);
    expect(metersPerPixel(opts.lat, plan.z)).toBeLessThanOrEqual(opts.widthM / opts.outW);
    expect(metersPerPixel(opts.lat, plan.z - 1)).toBeGreaterThan(opts.widthM / opts.outW);
    expect(plan.scale).toBeLessThanOrEqual(1);
  });

  it('caps the zoom at the layer maximum, upscaling the tiles', () => {
    const plan = planMapExtract({ ...opts, widthM: 50, maxZoom: 17 });
    expect(plan.z).toBe(17);
    expect(plan.scale).toBeGreaterThan(1);
  });

  it('projects the centre to the middle of the image and covers it with tiles', () => {
    const plan = planMapExtract(opts);
    const c = plan.project(opts.lon, opts.lat);
    expect(c.x).toBeCloseTo(600, 5);
    expect(c.y).toBeCloseTo(400, 5);
    const minX = Math.min(...plan.tiles.map(t => t.dx));
    const maxX = Math.max(...plan.tiles.map(t => t.dx + t.size));
    const minY = Math.min(...plan.tiles.map(t => t.dy));
    const maxY = Math.max(...plan.tiles.map(t => t.dy + t.size));
    expect(minX).toBeLessThanOrEqual(0);
    expect(minY).toBeLessThanOrEqual(0);
    expect(maxX).toBeGreaterThanOrEqual(1200);
    expect(maxY).toBeGreaterThanOrEqual(800);
  });
});

describe('niceScaleBar', () => {
  it('rounds to 1, 2 or 5 times a power of ten within the available width', () => {
    const bar = niceScaleBar(0.25, 220); // 55 m disponibles
    expect(bar.meters).toBe(50);
    expect(bar.px).toBe(200);
    expect(bar.label).toBe('50 m');
    expect(niceScaleBar(10, 220).label).toBe('2 km');
  });
});

describe('approximateScale', () => {
  it('gives a rounded denominator for a 170 mm print width', () => {
    expect(approximateScale(250)).toBe(1250);
    expect(approximateScale(1000)).toBe(5000);
  });
});

describe('pointInGeometry', () => {
  const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };

  it('handles holes and multipolygons', () => {
    expect(pointInGeometry(2, 2, square)).toBe(true);
    expect(pointInGeometry(5, 5, square)).toBe(false);
    expect(pointInGeometry(20, 20, square)).toBe(false);
    expect(pointInGeometry(21, 21, { type: 'MultiPolygon', coordinates: [square.coordinates, [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]]] })).toBe(true);
    expect(pointInGeometry(1, 1, null)).toBe(false);
  });

  it('returns all rings for drawing', () => {
    expect(geometryRings(square)).toHaveLength(2);
    expect(geometryRings({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });
});
