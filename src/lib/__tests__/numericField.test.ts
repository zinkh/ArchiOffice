import { describe, expect, it } from 'vitest';
import { coverImageProblem, isDateRangeInverted, MAX_AMOUNT, parseNumericInput } from '../numericField';

describe('parseNumericInput', () => {
  it('returns 0 for an empty or unreadable entry', () => {
    expect(parseNumericInput('')).toBe(0);
    expect(parseNumericInput('abc')).toBe(0);
    expect(parseNumericInput(undefined)).toBe(0);
    expect(parseNumericInput('Infinity')).toBe(0);
  });

  it('clamps negatives to the minimum', () => {
    expect(parseNumericInput('-50')).toBe(0);
    expect(parseNumericInput('-50', { min: -100 })).toBe(-50);
  });

  it('caps absurdly large amounts', () => {
    expect(parseNumericInput('99999999999999')).toBe(MAX_AMOUNT);
  });

  it('accepts a French decimal comma', () => {
    expect(parseNumericInput('1234,5')).toBe(1234.5);
  });

  it('bounds a percentage and rounds integers', () => {
    expect(parseNumericInput('150', { max: 100, integer: true })).toBe(100);
    expect(parseNumericInput('33.6', { max: 100, integer: true })).toBe(34);
  });
});

describe('isDateRangeInverted', () => {
  it('flags only a deadline before the start', () => {
    expect(isDateRangeInverted('2026-09-01', '2026-08-01')).toBe(true);
    expect(isDateRangeInverted('2026-09-01', '2026-09-01')).toBe(false);
    expect(isDateRangeInverted('', '2026-08-01')).toBe(false);
    expect(isDateRangeInverted('2026-09-01', null)).toBe(false);
  });
});

describe('coverImageProblem', () => {
  it('rejects non-images and oversized files', () => {
    expect(coverImageProblem({ type: 'application/pdf', size: 10 })).toBe('type');
    expect(coverImageProblem({ type: 'image/png', size: 20 * 1024 * 1024 })).toBe('size');
    expect(coverImageProblem({ type: 'image/jpeg', size: 1024 })).toBeNull();
  });
});
