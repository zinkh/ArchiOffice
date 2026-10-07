import { describe, expect, it } from 'vitest';
import { fitWithin, moveItem, nearestRectIndex, photoLabel } from '../feasibilityPhoto';

describe('fitWithin', () => {
  it('shrinks the longest side to the limit, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ w: 1500, h: 2000 });
  });

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ w: 800, h: 600 });
  });
});

describe('photoLabel', () => {
  it('drops the extension and turns underscores into spaces', () => {
    expect(photoLabel('facade_sud_2026.JPG')).toBe('facade sud 2026');
    expect(photoLabel('IMG.0001.jpeg')).toBe('IMG.0001');
  });
});

describe('moveItem', () => {
  it('moves an item without mutating the input', () => {
    const src = ['a', 'b', 'c', 'd'];
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(src, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(src).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps the target and ignores an unknown source', () => {
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('nearestRectIndex', () => {
  const rects = [
    { left: 0, top: 0, width: 100, height: 100 },
    { left: 110, top: 0, width: 100, height: 100 },
    { left: 0, top: 110, width: 100, height: 100 },
  ];
  it('picks the rectangle whose centre is closest, across rows', () => {
    expect(nearestRectIndex(rects, 160, 40)).toBe(1);
    expect(nearestRectIndex(rects, 30, 190)).toBe(2);
    expect(nearestRectIndex([], 0, 0)).toBe(-1);
  });
});
