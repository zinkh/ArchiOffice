import { describe, expect, it } from 'vitest';
import { fitWithin, photoLabel } from '../feasibilityPhoto';

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
