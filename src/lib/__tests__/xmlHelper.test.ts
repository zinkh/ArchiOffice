import { describe, expect, it } from 'vitest';
import { proposalToXml, xmlToProposal } from '../xmlHelper';
import type { Proposal } from '../../types';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    title: 'Extension maison individuelle',
    client_id: 'c1',
    amount: 12500,
    status: 'Draft',
    description: 'Extension de 40m² avec véranda',
    created_at: '2026-01-15T00:00:00Z',
    project_code: 'PRJ-2026-001',
    site_city: 'Lyon',
    ...overrides,
  };
}

describe('xmlHelper', () => {
  it('round-trips the mapped fields through proposalToXml/xmlToProposal', () => {
    const proposal = makeProposal();
    const xml = proposalToXml(proposal);
    const parsed = xmlToProposal(xml);

    expect(parsed.title).toBe(proposal.title);
    expect(parsed.description).toBe(proposal.description);
    expect(parsed.project_code).toBe(proposal.project_code);
    expect(parsed.site_city).toBe(proposal.site_city);
  });

  it('does not emit XML for fields with no fieldMapping entry', () => {
    const proposal = makeProposal();
    const xml = proposalToXml(proposal);

    // `id`, `client_id`, `amount`, `status`, `created_at` have no mapping —
    // their raw values must not leak into the XML.
    expect(xml).not.toContain('>p1<');
    expect(xml).not.toContain('>c1<');
  });

  it('handles proposals with only unmapped fields by producing an empty FixKeys block', () => {
    const proposal = makeProposal({ title: undefined as unknown as string, description: '', project_code: undefined, site_city: undefined });
    const xml = proposalToXml(proposal);
    const parsed = xmlToProposal(xml);

    expect(parsed).toEqual({ description: '' });
  });

  it('accented French characters survive the round trip', () => {
    const proposal = makeProposal({ title: 'Réhabilitation d\'une école à Vénissieux' });
    const xml = proposalToXml(proposal);
    const parsed = xmlToProposal(xml);

    expect(parsed.title).toBe(proposal.title);
  });
});
