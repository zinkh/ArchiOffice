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
