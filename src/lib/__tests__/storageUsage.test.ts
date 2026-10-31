import { describe, it, expect } from 'vitest';
import { formatBytes, storageLevel, storagePercent } from '../storageUsage';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('formatBytes', () => {
  it('écrit les mégaoctets avec une décimale sous 100', () => {
    expect(formatBytes(92.4 * MB)).toBe('92,4 Mo');
  });

  it('écrit les gigaoctets, sans décimale au-delà de 100', () => {
    expect(formatBytes(5 * GB)).toBe('5 Go');
    expect(formatBytes(1.5 * GB)).toBe('1,5 Go');
    expect(formatBytes(500 * GB)).toMatch(/^500 Go$/);
  });

  it('écrit les petites tailles en Ko et en octets', () => {
    expect(formatBytes(512 * 1024)).toBe('512 Ko');
    expect(formatBytes(300)).toBe('300 o');
  });

  it('ne rend jamais NaN ni un nombre négatif', () => {
    expect(formatBytes(NaN)).toBe('0 o');
    expect(formatBytes(-5)).toBe('0 o');
  });

  it('utilise les unités anglaises pour la langue anglaise', () => {
    expect(formatBytes(5 * GB, 'en')).toBe('5 GB');
    expect(formatBytes(92.4 * MB, 'en-GB')).toBe('92.4 MB');
  });
});

describe('storageLevel', () => {
  it('distingue normal, proche du plafond, plein et expiré', () => {
    expect(storageLevel(10 * MB, 100 * MB)).toBe('ok');
    expect(storageLevel(80 * MB, 100 * MB)).toBe('warning');
    expect(storageLevel(100 * MB, 100 * MB)).toBe('full');
    expect(storageLevel(150 * MB, 100 * MB)).toBe('full');
  });

  it('lit un plafond à zéro comme un abonnement expiré, pas comme un cabinet à 0 %', () => {
    expect(storageLevel(0, 0)).toBe('expired');
    expect(storageLevel(5 * MB, 0)).toBe('expired');
  });
});

describe('storagePercent', () => {
  it('arrondit et borne à 0-100', () => {
    expect(storagePercent(50 * MB, 100 * MB)).toBe(50);
    expect(storagePercent(250 * MB, 100 * MB)).toBe(100);
  });

  it('n\'affiche jamais 0 % quand quelque chose est occupé', () => {
    expect(storagePercent(1, 5 * GB)).toBe(1);
  });

  it('rend 0 sans plafond ou sans octet', () => {
    expect(storagePercent(0, 100 * MB)).toBe(0);
    expect(storagePercent(5 * MB, 0)).toBe(0);
  });
});
