import { describe, it, expect } from 'vitest';
import { isProjectDirty, projectSignature } from '../projectDirty';

describe('isProjectDirty', () => {
  const saved = { id: 'p1', name: 'Villa Martin', description: 'Extension', programme: null, remuneration: 0 };

  it('ne signale rien tant que la fiche est identique à celle chargée', () => {
    expect(isProjectDirty(saved, { ...saved })).toBe(false);
  });

  it('signale une saisie dans un champ texte', () => {
    expect(isProjectDirty(saved, { ...saved, description: 'Extension et surélévation' })).toBe(true);
  });

  it("ignore l'ordre des clés", () => {
    const reordered = { remuneration: 0, programme: null, description: 'Extension', name: 'Villa Martin', id: 'p1' };
    expect(isProjectDirty(saved, reordered)).toBe(false);
  });

  it('tient un champ vidé pour égal à un champ jamais rempli', () => {
    expect(isProjectDirty(saved, { ...saved, programme: '' })).toBe(false);
    expect(isProjectDirty(saved, { ...saved, chantier_notes: '' })).toBe(false);
  });

  it('ignore les montants repris du contrat quand un contrat est lié', () => {
    const synced = { ...saved, remuneration: 48000, construction_cost: 320000 };
    expect(isProjectDirty(saved, synced, { contractLinked: true })).toBe(false);
    expect(isProjectDirty(saved, synced)).toBe(true);
  });

  it("compare le contenu des listes (lots, cotraitants)", () => {
    const withLots = { ...saved, lots_list: [{ lot_number: '01', lot_title: 'Gros œuvre' }] };
    expect(isProjectDirty(withLots, { ...withLots, lots_list: [{ lot_title: 'Gros œuvre', lot_number: '01' }] })).toBe(false);
    expect(isProjectDirty(withLots, { ...withLots, lots_list: [] })).toBe(true);
  });

  it("ne signale rien sans fiche chargée", () => {
    expect(isProjectDirty(null, saved)).toBe(false);
    expect(projectSignature(null)).toBe('');
  });
});
