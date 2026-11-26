import { describe, it, expect } from 'vitest';
import { isPlausibleProjectId } from '../packages/archioffice-agents/src/server/routes';

// Incident : l'affaire affichée en haut du chat n'arrivait pas à l'agent, qui demandait « quelle opération ? ».
// Le filtre n'acceptait que de l'hexadécimal alors que projects.id est un TEXT.
describe('isPlausibleProjectId', () => {
  it('accepte un UUID comme un identifiant texte', () => {
    expect(isPlausibleProjectId('3f2b8c1e-5a6d-4e7f-9b0a-1c2d3e4f5a6b')).toBe(true);
    expect(isPlausibleProjectId('proj-2608_mm.imob')).toBe(true);
    expect(isPlausibleProjectId('1730000000000')).toBe(true);
  });

  it('refuse ce qui n’a pas la forme d’un identifiant', () => {
    expect(isPlausibleProjectId('')).toBe(false);
    expect(isPlausibleProjectId('a b')).toBe(false);
    expect(isPlausibleProjectId("x'; drop table projects;--")).toBe(false);
    expect(isPlausibleProjectId('a'.repeat(129))).toBe(false);
    expect(isPlausibleProjectId(undefined)).toBe(false);
    expect(isPlausibleProjectId({ id: 'x' })).toBe(false);
  });
});
