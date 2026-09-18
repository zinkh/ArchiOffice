// Lien direct vers la fiche d'un enregistrement créé/modifié par un agent —
// voir CLAUDE.md et packages/archioffice-agents/src/server/recordLinks.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecordPath, buildRecordUrl } from '../packages/archioffice-agents/src/server/recordLinks';

afterEach(() => { vi.unstubAllEnvs(); });

describe('buildRecordPath — routes directes par id', () => {
  it('projects, tenders, articles_type', () => {
    expect(buildRecordPath('projects', { id: 'p1' })).toBe('/projects/p1');
    expect(buildRecordPath('tenders', { id: 't1' })).toBe('/tenders/t1');
    expect(buildRecordPath('articles_type', { id: 'a1' })).toBe('/specifications/a1');
  });
});

describe('buildRecordPath — pages de liste avec ?open=', () => {
  it('contacts, proposals, invoices, references, tasks, contrats_moe, ordres_de_service', () => {
    expect(buildRecordPath('contacts', { id: 'c1' })).toBe('/contacts?open=c1');
    expect(buildRecordPath('proposals', { id: 'd1' })).toBe('/proposals?open=d1');
    expect(buildRecordPath('invoices', { id: 'i1' })).toBe('/invoices?open=i1');
    expect(buildRecordPath('references', { id: 'r1' })).toBe('/references?open=r1');
    expect(buildRecordPath('tasks', { id: 't1' })).toBe('/gantt?open=t1');
    expect(buildRecordPath('contrats_moe', { id: 'k1' })).toBe('/contrats?open=k1');
    expect(buildRecordPath('ordres_de_service', { id: 'o1' })).toBe('/ordres-de-service?open=o1');
  });
});

describe('buildRecordPath — meetings (nécessite un parent)', () => {
  it('priorise project_id, puis proposal_id, puis tender_id', () => {
    expect(buildRecordPath('meetings', { id: 'm1', project_id: 'p1' })).toBe('/reunions?parent=project%3Ap1&open=m1');
    expect(buildRecordPath('meetings', { id: 'm1', proposal_id: 'd1' })).toBe('/reunions?parent=proposal%3Ad1&open=m1');
    expect(buildRecordPath('meetings', { id: 'm1', tender_id: 't1' })).toBe('/reunions?parent=tender%3At1&open=m1');
    expect(buildRecordPath('meetings', { id: 'm1', project_id: 'p1', tender_id: 't1' })).toBe('/reunions?parent=project%3Ap1&open=m1');
  });

  it('rend null sans aucun parent — aucun endroit où envoyer le lien', () => {
    expect(buildRecordPath('meetings', { id: 'm1' })).toBeNull();
  });
});

describe('buildRecordPath — ressources sous onglet de la fiche projet', () => {
  it('visas, receptions, reserves ouvrent précisément le bon enregistrement (tab + open)', () => {
    expect(buildRecordPath('visas', { id: 'v1', project_id: 'p1' })).toBe('/projects/p1?tab=VISA&open=visas:v1');
    expect(buildRecordPath('receptions', { id: 'r1', project_id: 'p1' })).toBe('/projects/p1?tab=AOR&open=receptions:r1');
    expect(buildRecordPath('reserves', { id: 'rs1', project_id: 'p1' })).toBe('/projects/p1?tab=AOR&open=reserves:rs1');
  });

  it('milestones, permits, marches_entreprises, notes_honoraires ne posent que le bon onglet', () => {
    expect(buildRecordPath('milestones', { id: 'ms1', project_id: 'p1' })).toBe('/projects/p1?tab=INFOS');
    expect(buildRecordPath('permits', { id: 'pm1', project_id: 'p1' })).toBe('/projects/p1?tab=INFOS');
    expect(buildRecordPath('marches_entreprises', { id: 'me1', project_id: 'p1' })).toBe('/projects/p1?tab=DET');
    expect(buildRecordPath('notes_honoraires', { id: 'nh1', project_id: 'p1' })).toBe('/projects/p1?tab=HONOS');
  });

  it('rend null sans project_id — aucun endroit où envoyer le lien', () => {
    for (const key of ['visas', 'receptions', 'reserves', 'milestones', 'permits', 'marches_entreprises', 'notes_honoraires']) {
      expect(buildRecordPath(key, { id: 'x1' })).toBeNull();
    }
  });
});

describe('buildRecordPath — cas limites', () => {
  it("'specifications' (ressource retirée du système) et une clé inconnue rendent toujours null", () => {
    expect(buildRecordPath('specifications', { id: 's1', project_id: 'p1' })).toBeNull();
    expect(buildRecordPath('ressource-inconnue', { id: 'x1' })).toBeNull();
  });

  it('sans id, rend null quelle que soit la ressource', () => {
    expect(buildRecordPath('projects', {})).toBeNull();
    expect(buildRecordPath('projects', null)).toBeNull();
    expect(buildRecordPath('projects', undefined)).toBeNull();
  });
});

describe('buildRecordUrl — préfixe APP_URL', () => {
  it('rend une URL absolue quand APP_URL est défini', () => {
    vi.stubEnv('APP_URL', 'https://cabinet.example.com/');
    expect(buildRecordUrl('projects', { id: 'p1' })).toBe('https://cabinet.example.com/projects/p1');
  });

  it('retombe sur un chemin relatif sans APP_URL', () => {
    vi.stubEnv('APP_URL', '');
    expect(buildRecordUrl('projects', { id: 'p1' })).toBe('/projects/p1');
  });

  it('rend null quand buildRecordPath rend null', () => {
    vi.stubEnv('APP_URL', 'https://cabinet.example.com');
    expect(buildRecordUrl('specifications', { id: 's1' })).toBeNull();
  });
});
