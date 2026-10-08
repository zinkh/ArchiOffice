import { describe, it, expect } from 'vitest';
import { lotPresenceStatus } from '../siteReportPresence';

describe('lotPresenceStatus', () => {
  const lot = { lot_title: 'PLATRERIE' };

  it('lit la présence saisie dans attendance, repérée par l\'intitulé du lot', () => {
    expect(lotPresenceStatus(lot, [{ role: 'PLATRERIE', present: false, status: 'AE' }])).toBe('AE');
  });

  it('déduit le statut d\'une ligne ancienne sans champ status', () => {
    expect(lotPresenceStatus(lot, [{ role: 'PLATRERIE', present: true }])).toBe('P');
    expect(lotPresenceStatus(lot, [{ role: 'PLATRERIE', present: false, excused: true }])).toBe('AE');
    expect(lotPresenceStatus(lot, [{ role: 'PLATRERIE', present: false }])).toBe('ANE');
  });

  it('retombe sur le suivi du lot, puis sur « Présent » comme à l\'écran', () => {
    expect(lotPresenceStatus(lot, [], 'R')).toBe('R');
    expect(lotPresenceStatus(lot, [])).toBe('P');
  });
});

import { concernedLabel, pdfOrientation } from '../siteReportPresence';

describe('mentions du suivi des lots et format de page', () => {
  it('imprime W, D ou W/D, et rien sinon', () => {
    expect(concernedLabel('W')).toBe('W');
    expect(concernedLabel('D')).toBe('D');
    expect(concernedLabel('WD')).toBe('W/D');
    expect(concernedLabel(undefined)).toBe('');
  });

  it('ne passe en paysage que sur demande', () => {
    expect(pdfOrientation('landscape')).toBe('landscape');
    expect(pdfOrientation('portrait')).toBe('portrait');
    expect(pdfOrientation(null)).toBe('portrait');
  });
});
