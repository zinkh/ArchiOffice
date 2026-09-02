// Unit coverage for the BOAMP connector's pure parts (server/tenderBoampConnector.ts):
// config normalization, the ODSQL where clause, record → tender_rss_matches
// mapping, and the local filters. The HTTP path (fetchBoampRecords) is
// exercised against a stubbed axios so the 400 → degraded-retry fallback is
// covered without any network access.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

import axios from 'axios';
import {
  normalizeBoampConfig, buildBoampWhere, mapBoampRecord, isAvisInitial, recordMatchesConfig,
  villeOf, fetchBoampRecords, BOAMP_API_URL,
} from '../server/tenderBoampConnector';

const source = { id: 'src-1', tenant_id: 'tenant-1' };

describe('normalizeBoampConfig', () => {
  it('applies defaults and drops invalid values', () => {
    expect(normalizeBoampConfig(undefined)).toEqual({ departements: [], types_marche: [], avis_initiaux_seulement: true, jours_recents: 7 });
    expect(normalizeBoampConfig({
      departements: ['54', ' 57 ', '2a', 'xx', '54', '971'],
      types_marche: ['services', 'TRAVAUX', 'bidule'],
      avis_initiaux_seulement: false,
      jours_recents: '30',
    })).toEqual({ departements: ['54', '57', '2A', '971'], types_marche: ['SERVICES', 'TRAVAUX'], avis_initiaux_seulement: false, jours_recents: 30 });
    expect(normalizeBoampConfig({ jours_recents: 400 }).jours_recents).toBe(7);
  });
});

describe('buildBoampWhere', () => {
  const now = new Date('2026-09-02T10:00:00Z');
  it('always filters on publication date, and on departments when configured', () => {
    const cfg = normalizeBoampConfig({ departements: ['54', '57'], jours_recents: 7 });
    expect(buildBoampWhere(cfg, { now })).toBe(`dateparution >= date'2026-08-26' and code_departement in ("54", "57")`);
    expect(buildBoampWhere(cfg, { now, withDepartements: false })).toBe(`dateparution >= date'2026-08-26'`);
    expect(buildBoampWhere(normalizeBoampConfig({}), { now })).toBe(`dateparution >= date'2026-08-26'`);
  });
});

describe('mapBoampRecord', () => {
  it('maps a structured notice into a tender_rss_matches row', () => {
    const row = mapBoampRecord({
      idweb: '26-123456',
      objet: "Maîtrise d'œuvre pour la réhabilitation du groupe scolaire",
      nomacheteur: 'Commune de Vandœuvre-lès-Nancy',
      dateparution: '2026-09-01',
      datelimitereponse: '2026-09-30T12:00:00+02:00',
      code_departement: ['54'],
      type_marche_facette: 'Services',
      procedure_libelle: 'Procédure adaptée',
      nature_libelle: 'Avis initial',
      descripteur_libelle: ["Maîtrise d'oeuvre", 'Architecture'],
      url_avis: 'https://www.boamp.fr/avis/detail/26-123456',
      donnees: JSON.stringify({ OBJET: { LIEU_EXEC: { VILLE: 'Vandœuvre-lès-Nancy', CP: '54500' } } }),
    }, source);

    expect(row.tenant_id).toBe('tenant-1');
    expect(row.source_id).toBe('src-1');
    expect(row.guid).toBe('26-123456');
    expect(row.title).toBe("Maîtrise d'œuvre pour la réhabilitation du groupe scolaire");
    expect(row.link).toBe('https://www.boamp.fr/avis/detail/26-123456');
    expect(row.pouvoir_adjudicateur).toBe('Commune de Vandœuvre-lès-Nancy');
    expect(row.date_limite_reponse).toBe('2026-09-30');
    expect(row.ville_execution).toBe('Vandœuvre-lès-Nancy');
    expect(row.pub_date).toBe('2026-09-01T00:00:00.000Z');
    expect(row.status).toBe('new');
    expect(row.description).toContain('Type de marché : Services');
    expect(row.description).toContain('Procédure : Procédure adaptée');
    expect(row.description).toContain('Référence BOAMP : 26-123456');
  });

  it('falls back to a BOAMP search link and department label when fields are missing', () => {
    const row = mapBoampRecord({ idweb: '26-1', objet: 'Objet', code_departement: '57' }, source);
    expect(row.link).toBe('https://www.boamp.fr/pages/avis/?q=idweb:%2226-1%22');
    expect(villeOf({ code_departement: ['57', '54'] })).toBe('Dépt. 57, 54');
    expect(row.date_limite_reponse).toBeNull();
  });
});

describe('local filters', () => {
  it('detects non-initial notices from any of the nature/type fields', () => {
    expect(isAvisInitial({ nature_libelle: 'Avis initial' })).toBe(true);
    expect(isAvisInitial({ nature: 'ATTRIBUTION' })).toBe(false);
    expect(isAvisInitial({ type_avis: 'Avis rectificatif' })).toBe(false);
    expect(isAvisInitial({ famille_libelle: 'Résultat de marché' })).toBe(false);
    expect(isAvisInitial({})).toBe(true);
  });

  it('applies departments, contract types and initial-only', () => {
    const cfg = normalizeBoampConfig({ departements: ['54'], types_marche: ['SERVICES'] });
    expect(recordMatchesConfig({ code_departement: ['54'], type_marche: ['Services'] }, cfg)).toBe(true);
    expect(recordMatchesConfig({ code_departement: ['75'], type_marche: ['Services'] }, cfg)).toBe(false);
    expect(recordMatchesConfig({ code_departement: ['54'], type_marche_facette: 'Travaux' }, cfg)).toBe(false);
    expect(recordMatchesConfig({ code_departement: ['54'], type_marche: ['Services'], nature: 'ATTRIBUTION' }, cfg)).toBe(false);
    expect(recordMatchesConfig({ code_departement: ['54'], type_marche: ['Services'], nature: 'ATTRIBUTION' }, { ...cfg, avis_initiaux_seulement: false })).toBe(true);
  });
});

describe('fetchBoampRecords', () => {
  const mockedGet = axios.get as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => mockedGet.mockReset());

  it('queries the API with the where clause and paginates', async () => {
    const page = (n: number, size: number) => ({ data: { total_count: 150, results: Array.from({ length: size }, (_, i) => ({ idweb: `${n}-${i}`, code_departement: ['54'] })) } });
    mockedGet.mockResolvedValueOnce(page(0, 100)).mockResolvedValueOnce(page(1, 50));

    const cfg = normalizeBoampConfig({ departements: ['54'] });
    const result = await fetchBoampRecords(cfg, { now: new Date('2026-09-02T10:00:00Z') });

    expect(result.records).toHaveLength(150);
    expect(result.apiTotal).toBe(150);
    expect(result.degraded).toBe(false);
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet.mock.calls[0][0]).toBe(BOAMP_API_URL);
    expect(mockedGet.mock.calls[0][1].params).toMatchObject({ where: `dateparution >= date'2026-08-26' and code_departement in ("54")`, limit: 100, offset: 0 });
    expect(mockedGet.mock.calls[1][1].params).toMatchObject({ offset: 100 });
  });

  it('retries without the department clause on HTTP 400 and filters locally', async () => {
    mockedGet
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'Unknown field code_departement' } } })
      .mockResolvedValueOnce({ data: { total_count: 2, results: [{ idweb: 'a', code_departement: ['54'] }, { idweb: 'b', code_departement: ['75'] }] } });

    const result = await fetchBoampRecords(normalizeBoampConfig({ departements: ['54'] }), { now: new Date('2026-09-02T10:00:00Z') });

    expect(result.degraded).toBe(true);
    expect(result.records.map(r => r.idweb)).toEqual(['a']);
    expect(mockedGet.mock.calls[1][1].params.where).toBe(`dateparution >= date'2026-08-26'`);
  });

  it('surfaces a readable error for other failures', async () => {
    mockedGet.mockRejectedValueOnce({ response: { status: 503, data: { message: 'Service Unavailable' } } });
    await expect(fetchBoampRecords(normalizeBoampConfig({}))).rejects.toThrow('BOAMP API HTTP 503 : Service Unavailable');
  });
});
