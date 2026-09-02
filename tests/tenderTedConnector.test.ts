// Unit coverage for the TED connector's pure parts (server/tenderTedConnector.ts)
// plus its HTTP path against a stubbed axios, mirroring tenderBoampConnector.test.ts.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

import axios from 'axios';
import {
  normalizeTedConfig, buildTedQuery, mapTedNotice, pickLang, isCompetitionNotice, recordMatchesTedConfig,
  fetchTedNotices, TED_API_URL, TED_FIELDS_FULL, TED_FIELDS_MINIMAL,
} from '../server/tenderTedConnector';

const source = { id: 'src-ted', tenant_id: 'tenant-1' };
const now = new Date('2026-09-02T10:00:00Z');

describe('normalizeTedConfig', () => {
  it('defaults to French buyers and pads short CPV codes', () => {
    expect(normalizeTedConfig(undefined)).toEqual({ pays: ['FRA'], nuts: [], cpv: [], avis_initiaux_seulement: true, jours_recents: 7 });
    expect(normalizeTedConfig({ pays: ['fra', 'BEL', 'xx'], nuts: ['frf', 'FRF31', 'bad!'], cpv: ['712', '71300000', 'abc'], avis_initiaux_seulement: false, jours_recents: 30 }))
      .toEqual({ pays: ['FRA', 'BEL'], nuts: ['FRF', 'FRF31'], cpv: ['71200000', '71300000'], avis_initiaux_seulement: false, jours_recents: 30 });
    // An explicitly empty country list means "all countries".
    expect(normalizeTedConfig({ pays: [] }).pays).toEqual([]);
  });
});

describe('buildTedQuery', () => {
  it('pushes every criterion in full mode and only date + country in fallback mode', () => {
    const cfg = normalizeTedConfig({ nuts: ['FRF'], cpv: ['71200000', '713'] });
    expect(buildTedQuery(cfg, { now })).toBe(
      'publication-date >= 20260826 AND buyer-country IN (FRA) AND place-of-performance IN (FRF) AND classification-cpv IN (71200000 71300000) AND form-type = competition'
    );
    expect(buildTedQuery(cfg, { now, full: false })).toBe('publication-date >= 20260826 AND buyer-country IN (FRA)');
    expect(buildTedQuery(normalizeTedConfig({ pays: [], avis_initiaux_seulement: false }), { now })).toBe('publication-date >= 20260826');
  });
});

describe('pickLang / mapTedNotice', () => {
  it('prefers French text in multilingual fields', () => {
    expect(pickLang({ eng: 'Architectural services', fra: "Services d'architecture" })).toBe("Services d'architecture");
    expect(pickLang({ deu: ['Nur Deutsch'] })).toBe('Nur Deutsch');
    expect(pickLang(['', 'x'])).toBe('x');
    expect(pickLang(null)).toBeNull();
  });

  it('maps a notice into a tender_rss_matches row', () => {
    const row = mapTedNotice({
      'publication-number': '512345-2026',
      'notice-title': { fra: "Concours de maîtrise d'œuvre pour un groupe scolaire", eng: 'Design contest' },
      'buyer-name': { fra: ['Métropole du Grand Nancy'] },
      'buyer-country': ['FRA'],
      'publication-date': '2026-09-01+02:00',
      'deadline-receipt-tender-date-lot': ['2026-10-15+02:00'],
      'place-of-performance': ['FRF31'],
      'classification-cpv': ['71200000', '71221000'],
      'form-type': 'competition',
      'procedure-type': 'open',
      'estimated-value-lot': [2500000],
      links: { html: { ENG: 'https://ted.europa.eu/en/notice/-/detail/512345-2026', FRA: 'https://ted.europa.eu/fr/notice/-/detail/512345-2026' } },
    }, source);

    expect(row.guid).toBe('512345-2026');
    expect(row.title).toBe("Concours de maîtrise d'œuvre pour un groupe scolaire");
    expect(row.link).toBe('https://ted.europa.eu/fr/notice/-/detail/512345-2026');
    expect(row.pouvoir_adjudicateur).toBe('Métropole du Grand Nancy');
    expect(row.pub_date).toBe('2026-09-01T00:00:00.000Z');
    expect(row.date_limite_reponse).toBe('2026-10-15');
    expect(row.ville_execution).toBe('NUTS FRF31');
    expect(row.montant_travaux).toBe(2500000);
    expect(row.description).toContain('CPV : 71200000, 71221000');
    expect(row.description).toContain('Référence TED : 512345-2026');
  });

  it('builds a detail link from the publication number when links are absent', () => {
    const row = mapTedNotice({ 'publication-number': '1-2026', 'notice-title': 'x' }, source);
    expect(row.link).toBe('https://ted.europa.eu/fr/notice/-/detail/1-2026');
  });
});

describe('local filters', () => {
  it('recognises contract notices from form-type or notice-type', () => {
    expect(isCompetitionNotice({ 'form-type': 'competition' })).toBe(true);
    expect(isCompetitionNotice({ 'form-type': 'result' })).toBe(false);
    expect(isCompetitionNotice({ 'notice-type': 'cn-standard' })).toBe(true);
    expect(isCompetitionNotice({ 'notice-type': 'can-standard' })).toBe(false);
    expect(isCompetitionNotice({})).toBe(true);
  });

  it('matches NUTS and CPV by prefix and keeps notices missing those fields', () => {
    const cfg = normalizeTedConfig({ nuts: ['FRF'], cpv: ['712'] });
    expect(recordMatchesTedConfig({ 'buyer-country': ['FRA'], 'place-of-performance': ['FRF31'], 'classification-cpv': ['71221000'], 'form-type': 'competition' }, cfg)).toBe(true);
    expect(recordMatchesTedConfig({ 'buyer-country': ['FRA'], 'place-of-performance': ['FR10'], 'classification-cpv': ['71221000'] }, cfg)).toBe(false);
    expect(recordMatchesTedConfig({ 'buyer-country': ['FRA'], 'place-of-performance': ['FRF31'], 'classification-cpv': ['45000000'] }, cfg)).toBe(false);
    expect(recordMatchesTedConfig({ 'buyer-country': ['DEU'], 'place-of-performance': ['FRF31'], 'classification-cpv': ['71221000'] }, cfg)).toBe(false);
    expect(recordMatchesTedConfig({ 'notice-title': 'minimal fields only' }, cfg)).toBe(true);
    expect(recordMatchesTedConfig({ 'form-type': 'result' }, cfg)).toBe(false);
  });
});

describe('fetchTedNotices', () => {
  const mockedPost = axios.post as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => mockedPost.mockReset());

  it('posts the expert query with the full field set and paginates', async () => {
    const page = (n: number, size: number) => ({ data: { totalNoticeCount: 120, notices: Array.from({ length: size }, (_, i) => ({ 'publication-number': `${n}-${i}`, 'buyer-country': ['FRA'] })) } });
    mockedPost.mockResolvedValueOnce(page(1, 100)).mockResolvedValueOnce(page(2, 20));

    const result = await fetchTedNotices(normalizeTedConfig({ nuts: ['FRF'] }), { now });

    expect(result.notices).toHaveLength(120);
    expect(result.apiTotal).toBe(120);
    expect(result.degraded).toBe(false);
    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(mockedPost.mock.calls[0][0]).toBe(TED_API_URL);
    expect(mockedPost.mock.calls[0][1]).toMatchObject({ query: 'publication-date >= 20260826 AND buyer-country IN (FRA) AND place-of-performance IN (FRF) AND form-type = competition', fields: TED_FIELDS_FULL, page: 1, limit: 100 });
    expect(mockedPost.mock.calls[1][1]).toMatchObject({ page: 2 });
  });

  it('falls back to the minimal field set on HTTP 400', async () => {
    mockedPost
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'Unknown field estimated-value-lot' } } })
      .mockResolvedValueOnce({ data: { totalNoticeCount: 1, notices: [{ 'publication-number': 'a', 'notice-title': 'x' }] } });

    const result = await fetchTedNotices(normalizeTedConfig({}), { now });

    expect(result.degraded).toBe(true);
    expect(result.notices).toHaveLength(1);
    expect(mockedPost.mock.calls[1][1].fields).toEqual(TED_FIELDS_MINIMAL);
  });

  it('surfaces a readable error for other failures', async () => {
    mockedPost.mockRejectedValueOnce({ response: { status: 429, data: { message: 'Too Many Requests' } } });
    await expect(fetchTedNotices(normalizeTedConfig({}))).rejects.toThrow('TED API HTTP 429 : Too Many Requests');
  });
});
