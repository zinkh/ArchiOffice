// Cross-source deduplication of tender watch matches (server/tenderDedup.ts):
// key normalization, and dropDuplicates() against the in-memory fake
// Supabase used by the Supertest suites.
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { normalizeForKey, dedupTitleKey, dedupBuyerKey, dropDuplicates } from '../server/tenderDedup';

describe('normalizeForKey', () => {
  it('ignores case, accents, ligatures, punctuation and spacing', () => {
    expect(normalizeForKey("Maîtrise d'œuvre  – Réhabilitation (Écoles)")).toBe('maitrisedoeuvrerehabilitationecoles');
    expect(normalizeForKey('MAITRISE D OEUVRE - REHABILITATION ECOLES')).toBe('maitrisedoeuvrerehabilitationecoles');
    expect(dedupTitleKey("Maîtrise d'œuvre – Réhabilitation")).toBe(dedupTitleKey('maitrise d oeuvre rehabilitation'));
    expect(dedupTitleKey('   ')).toBeNull();
    expect(dedupBuyerKey(null)).toBeNull();
    expect(dedupTitleKey('a')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('dropDuplicates', () => {
  const fake = new FakeSupabaseAdmin();
  const tenant = 'tenant-dedup';
  const row = (source_id: string, guid: string, title: string, buyer: string | null) => ({
    source_id, guid, title, pouvoir_adjudicateur: buyer,
    dedup_key: dedupTitleKey(title), dedup_buyer: dedupBuyerKey(buyer),
  });

  it('drops rows already known from another source, but not same-source re-reads, and dedupes within the batch', async () => {
    fake.seed('tender_rss_matches', [
      { id: 'm1', tenant_id: tenant, ...row('boamp', '26-1', "Maîtrise d'œuvre pour la réhabilitation de l'école", 'Commune de Nancy') },
      { id: 'm2', tenant_id: tenant, ...row('rss', 'r-9', 'Construction d’une médiathèque', null) },
      { id: 'other', tenant_id: 'tenant-other', ...row('ted', 'x', 'Extension du gymnase', 'Ville de Metz') },
    ]);

    const kept = await dropDuplicates(fake, tenant, [
      // Same notice on TED, same buyer spelled differently → duplicate.
      row('ted', '100-2026', "MAITRISE D'OEUVRE POUR LA REHABILITATION DE L'ECOLE", 'COMMUNE DE NANCY'),
      // Same title, different (known) buyer → a different market, kept.
      row('ted', '101-2026', "Maîtrise d'œuvre pour la réhabilitation de l'école", 'Commune de Metz'),
      // RSS row has no buyer: matches on title alone → duplicate.
      row('boamp', '26-2', 'Construction d’une médiathèque', 'Ville de Nancy'),
      // Same source + guid as an existing row: left to the (source_id, guid) upsert.
      row('rss', 'r-9', 'Construction d’une médiathèque', null),
      // Only another tenant knows this one → kept.
      row('ted', '102-2026', 'Extension du gymnase', 'Ville de Metz'),
      // Duplicate inside the batch itself → second occurrence dropped.
      row('ted', '103-2026', 'Extension du gymnase', 'Ville de Metz'),
    ]);

    expect(kept.map(k => k.guid)).toEqual(['101-2026', 'r-9', '102-2026']);
  });
});
