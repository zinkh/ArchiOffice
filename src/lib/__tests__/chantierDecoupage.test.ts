import { describe, expect, it } from 'vitest';
import {
  sanitizeDecoupage, registreDepuisDocument, batimentsActifs, etiquetteDecoupage,
  correspondDecoupage, SANS_AFFECTATION, superposerEcrituresEnAttente,
} from '../chantierDecoupage';

const registre = sanitizeDecoupage({
  batiments: [{ id: 'b2', code: 'B', libelle: 'Préau', ordre: 1 }, { id: 'b1', code: 'A', libelle: 'Principal', ordre: 0 }],
  phases: [{ id: 'p1', code: 'PH1', libelle: 'Gros œuvre', ordre: 0 }],
});

describe('registre de bâtiments et phases', () => {
  it('trie par ordre, écarte les doublons d’identifiant et les entrées invalides', () => {
    const r = sanitizeDecoupage({
      batiments: [{ id: 'a', code: 'A', ordre: 1 }, { id: 'a', code: 'Z', ordre: 0 }, { code: 'sans id' }, null, 'x'],
    });
    expect(r.batiments?.map(b => b.id)).toEqual(['a']);
    expect(r.multiBatiments).toBe(true);
  });

  it('un registre vide n’est jamais actif', () => {
    const r = sanitizeDecoupage({ multiBatiments: true, batiments: [] });
    expect(r.multiBatiments).toBe(false);
    expect(batimentsActifs(r)).toEqual([]);
  });

  it('reprend celui d’un DPGF en gardant les identifiants', () => {
    const r = registreDepuisDocument({ batiments: [{ id: 'x', code: 'A', libelle: '', ordre: 0 }], phases: [] });
    expect(r.batiments?.[0].id).toBe('x');
    expect(r.multiPhases).toBe(false);
  });

  it('étiquette un enregistrement, sans afficher un identifiant disparu', () => {
    expect(etiquetteDecoupage({ batiment_id: 'b1', phase_id: 'p1' }, registre)).toBe('A · PH1');
    expect(etiquetteDecoupage({ batiment_id: 'supprimé' }, registre)).toBe('');
  });

  it('filtre par bâtiment, phase ou absence d’affectation', () => {
    const item = { batiment_id: 'b1', phase_id: null };
    expect(correspondDecoupage(item, { batimentId: 'b1', phaseId: '' })).toBe(true);
    expect(correspondDecoupage(item, { batimentId: 'b2', phaseId: '' })).toBe(false);
    expect(correspondDecoupage(item, { batimentId: '', phaseId: SANS_AFFECTATION })).toBe(true);
    expect(correspondDecoupage(item, { batimentId: SANS_AFFECTATION, phaseId: '' })).toBe(false);
  });
});

describe('superposition de la file hors ligne', () => {
  const url = '/api/projects/p/reports';
  it('ajoute un compte-rendu créé hors ligne absent de la liste', () => {
    const out = superposerEcrituresEnAttente(
      [{ id: 'r1', date: '2026-10-01', report_number: 1 } as any],
      [{ method: 'POST', url, createdAt: 1, jsonBody: { id: 'r2', date: '2026-10-07' } }],
      'p',
    );
    expect(out.map(r => r.id)).toEqual(['r2', 'r1']);
    expect(out[0].pendingSync).toBe(true);
  });

  it('rejoue les modifications en attente sans lever le drapeau de création', () => {
    const out = superposerEcrituresEnAttente(
      [],
      [
        { method: 'POST', url, createdAt: 1, jsonBody: { id: 'r2', date: '2026-10-07' } },
        { method: 'PUT', url: '/api/reports/r2', createdAt: 2, jsonBody: { meteo: 'Pluie', pendingSync: false } },
      ],
      'p',
    );
    expect(out[0]).toMatchObject({ id: 'r2', meteo: 'Pluie', pendingSync: true });
  });

  it('applique une modification en attente à un compte-rendu déjà connu du serveur', () => {
    const out = superposerEcrituresEnAttente(
      [{ id: 'r1', date: '2026-10-01', statut: 'brouillon' } as any],
      [{ method: 'PUT', url: '/api/reports/r1', createdAt: 5, jsonBody: { statut: 'diffuse' } }],
      'p',
    );
    expect(out[0]).toMatchObject({ statut: 'diffuse' });
    expect(out[0].pendingSync).toBeUndefined();
  });
});
