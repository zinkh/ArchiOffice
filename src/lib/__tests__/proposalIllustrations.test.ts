import { describe, it, expect, vi } from 'vitest';
import {
  MAX_PROPOSAL_ILLUSTRATIONS, orderIllustrations, parseProposalIllustrations, serializeProposalIllustrations,
  type ProposalIllustration,
} from '../proposalIllustrations';
import { PROPOSAL_SECTION_DEFS, PRESET_COURT, PRESET_DETAILLE } from '../proposalExport';

// L'enregistrement automatique charge le client Supabase, qui exige l'environnement du navigateur.
vi.mock('../autoSaveDocument', () => ({ autoSaveDocument: vi.fn() }));

const image = (id: string, layer = 'photo', caption = ''): ProposalIllustration => ({
  document_id: id, file_url: `https://stockage.test/${id}.jpg`, layer, scale: 0, caption, captured_at: '2026-11-04T10:00:00Z',
});

describe('plan et photos d\'une proposition', () => {
  it('relit une liste enregistrée en JSON', () => {
    const json = serializeProposalIllustrations([image('a', 'plan_ign', 'Plan de situation'), image('b')]);
    expect(parseProposalIllustrations(json).map(i => i.document_id)).toEqual(['a', 'b']);
    expect(parseProposalIllustrations(json)[0].caption).toBe('Plan de situation');
  });

  it('ne lève jamais d\'exception sur une valeur absente ou illisible', () => {
    expect(parseProposalIllustrations(null)).toEqual([]);
    expect(parseProposalIllustrations('')).toEqual([]);
    expect(parseProposalIllustrations('{pas du json')).toEqual([]);
    expect(parseProposalIllustrations('{"a":1}')).toEqual([]);
  });

  it('écarte les entrées sans document ni adresse de fichier', () => {
    const json = JSON.stringify([{ caption: 'sans document' }, image('ok')]);
    expect(parseProposalIllustrations(json).map(i => i.document_id)).toEqual(['ok']);
  });

  it('plafonne le nombre d\'images', () => {
    const many = Array.from({ length: MAX_PROPOSAL_ILLUSTRATIONS + 5 }, (_, i) => image(`p${i}`));
    expect(parseProposalIllustrations(serializeProposalIllustrations(many))).toHaveLength(MAX_PROPOSAL_ILLUSTRATIONS);
  });

  it('place les extraits de plan avant les photos en gardant l\'ordre d\'ajout', () => {
    const ordered = orderIllustrations([image('p1'), image('m1', 'plan_ign'), image('p2'), image('m2', 'ortho')]);
    expect(ordered.map(i => i.document_id)).toEqual(['m1', 'm2', 'p1', 'p2']);
  });
});

describe('section « Plan et photos » de l\'éditeur de modèle', () => {
  it('est proposée dans le panneau de gauche, avant les signatures', () => {
    const ids = PROPOSAL_SECTION_DEFS.map(s => s.id);
    expect(ids).toContain('illustrations');
    expect(ids.indexOf('illustrations')).toBeLessThan(ids.indexOf('signatures'));
  });

  it('est cochée dans la version détaillée et décochée dans la version courte', () => {
    expect(PRESET_DETAILLE.illustrations).toBe(true);
    expect(PRESET_COURT.illustrations).toBe(false);
  });
});
