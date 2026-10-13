// Indice et date de diffusion de l'étude de faisabilité : validation pure
// (sanitizeFeasibilityMeta) de la route PUT /api/proposals/:id/feasibility-meta.
import { describe, expect, it } from 'vitest';
import { sanitizeFeasibilityMeta } from '../server/routes/proposalFeasibility';

describe('sanitizeFeasibilityMeta', () => {
  it('accepte un indice et une date valides', () => {
    expect(sanitizeFeasibilityMeta({ indice: ' B ', issueDate: '2026-10-13' })).toEqual({ indice: 'B', issueDate: '2026-10-13' });
  });

  it('traite le vide comme non renseigné', () => {
    expect(sanitizeFeasibilityMeta({ indice: '', issueDate: '' })).toEqual({ indice: null, issueDate: null });
    expect(sanitizeFeasibilityMeta({})).toEqual({ indice: null, issueDate: null });
  });

  it('refuse un indice trop long ou une date mal formée', () => {
    expect(sanitizeFeasibilityMeta({ indice: 'ABCDE' })).toBeNull();
    expect(sanitizeFeasibilityMeta({ issueDate: '13/10/2026' })).toBeNull();
    expect(sanitizeFeasibilityMeta({ issueDate: '2026-13-45' })).toBeNull();
  });
});
