import { describe, expect, it } from 'vitest';
import {
  appendBlock, buildFeasibilityBlock, feasibilityContextForPrompt, formatEuros, sanitizeIllustrations,
  EMPTY_SITE_DATA, type FeasibilitySiteData,
} from '../feasibilityBlocks';
import { feasibilityCoverFields, feasibilityFilename } from '../feasibilityBlocks';

const proposal = {
  title: 'Maison Martin',
  adresse_terrain: '12 rue des Lilas',
  cp_ville_terrain: '54000 Nancy',
  ref_cadastrale: 'AB 123',
  surface_parcelle: '850',
  zone_plu: 'UB',
  surface_plancher: '140 m²',
  construction_cost: 320000,
  amount: 38400,
};

const site: FeasibilitySiteData = {
  address: { label: '12 Rue des Lilas 54000 Nancy', lat: 48.69, lon: 6.18, citycode: '54395', city: 'Nancy' },
  plu: { libelle: 'UB', libelong: 'Zone urbaine mixte', typezone: 'U', destdomi: null, urlfic: 'https://gpu/reglement.pdf', datappro: null, document: { nom: 'PLUi Métropole', typedoc: 'PLUi' } },
  risques: { url: 'https://georisques.gouv.fr/rapport', risques_naturels: ['Retrait-gonflement des argiles'], risques_technologiques: [] },
  monuments: [{ nom: 'Église Saint-Epvre', statut: 'classé', commune: 'Nancy', distance_m: 312.4 }],
};

describe('buildFeasibilityBlock', () => {
  it('builds the site block with units added to bare surfaces', () => {
    const block = buildFeasibilityBlock('terrain', proposal);
    expect(block).toContain('- Adresse : 12 rue des Lilas, 54000 Nancy');
    expect(block).toContain('- Références cadastrales : AB 123');
    expect(block).toContain('- Surface de la parcelle : 850 m²');
  });

  it('prefers the PLU zone read from the GPU over the value typed on the proposal', () => {
    const block = buildFeasibilityBlock('urbanisme', { ...proposal, zone_plu: 'UA' }, site);
    expect(block).toContain('- Zone : UB : Zone urbaine mixte');
    expect(block).toContain('- Document en vigueur : PLUi PLUi Métropole');
    expect(block).toContain('reglement.pdf');
  });

  it('falls back to the typed PLU zone when the site data is unavailable', () => {
    expect(buildFeasibilityBlock('urbanisme', proposal)).toContain('- Zone : UB');
  });

  it('says explicitly when no risk of a kind is recorded', () => {
    const block = buildFeasibilityBlock('risques', proposal, site);
    expect(block).toContain('Retrait-gonflement des argiles');
    expect(block).toContain('aucun risque technologique recensé');
  });

  it('lists nearby monuments and flags the ABF opinion', () => {
    const block = buildFeasibilityBlock('patrimoine', proposal, site);
    expect(block).toContain('Église Saint-Epvre (classé), à 312 m');
    expect(block).toContain('Architecte des Bâtiments de France');
  });

  it('returns an empty string when a block has no data', () => {
    expect(buildFeasibilityBlock('risques', proposal, EMPTY_SITE_DATA)).toBe('');
    expect(buildFeasibilityBlock('erp', {})).toBe('');
  });

  it('formats amounts with a plain space as thousands separator', () => {
    expect(formatEuros(320000)).toBe('320 000 €');
    expect(formatEuros(0)).toBe('');
    expect(buildFeasibilityBlock('enveloppe', proposal)).toContain('320 000 €');
  });
});

describe('appendBlock', () => {
  it('separates the block from existing text with a blank line', () => {
    expect(appendBlock('Texte.\n\n', 'Bloc')).toBe('Texte.\n\nBloc');
    expect(appendBlock('', 'Bloc')).toBe('Bloc');
    expect(appendBlock('Texte', '  ')).toBe('Texte');
  });
});

describe('feasibilityContextForPrompt', () => {
  it('omits empty blocks so the model never sees an unfilled label', () => {
    const ctx = feasibilityContextForPrompt({ title: 'X' }, EMPTY_SITE_DATA);
    expect(ctx).toContain('Opération : X');
    expect(ctx).not.toContain('Établissement recevant du public');
    expect(ctx).not.toMatch(/ : $/m);
  });
});

describe('sanitizeIllustrations', () => {
  it('keeps only well-formed entries and bounds their fields', () => {
    const out = sanitizeIllustrations([
      { document_id: 'd1', file_url: 'u1', layer: 'ortho', scale: '1500', caption: 'Vue' },
      { document_id: 3, file_url: 'u2' },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ document_id: 'd1', scale: 1500, caption: 'Vue' });
    expect(sanitizeIllustrations('nope')).toEqual([]);
  });
});

describe('export helpers', () => {
  it('lists only filled cover fields and builds an ASCII filename', () => {
    const fields = feasibilityCoverFields({ ...proposal, client_name: 'M. Martin', reference: 'P-2026-012' });
    expect(fields.map(([k]) => k)).toEqual(['Opération', "Maître d'ouvrage", 'Terrain', 'Références cadastrales', 'Référence']);
    expect(feasibilityFilename({ title: 'Réhabilitation école', reference: 'P-12' }, 'pdf')).toBe('Etude_faisabilite_P-12_Rehabilitation_ecole.pdf');
  });
});
