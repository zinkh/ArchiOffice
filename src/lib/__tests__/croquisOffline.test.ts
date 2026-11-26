import { describe, expect, it } from 'vitest';
import type { Croquis } from '../../types';
import type { CroquisScene } from '../../types/croquis';
import {
  applyPendingCroquisWrites,
  croquisWriteEntity,
  croquisWriteId,
  indexPendingCroquis,
  nextCroquisTitle,
  parseCroquisWriteId,
  parseDraft,
  resolveCroquisState,
  sceneEquals,
  serializeDraft,
  type CroquisParent,
  type PendingLike,
} from '../croquisOffline';

const meeting: CroquisParent = { kind: 'meeting', id: 'm1', projectId: 'p1' };
const report: CroquisParent = { kind: 'siteReport', id: 'r1', projectId: 'p1' };

const rect = (id: string, x2 = 100) => ({
  id, type: 'rect' as const, x1: 0, y1: 0, x2, y2: 60, k: 1, seed: 7, rough: true, color: '#141414', sw: 2.2,
  fill: 'none' as const, angle: 45, gap: 7,
});
const scene = (...elements: ReturnType<typeof rect>[]): CroquisScene => ({ version: 1, elements });

const row = (id: string, extra: Partial<Croquis> = {}): Croquis => ({
  id, project_id: 'p1', meeting_id: 'm1', site_report_id: null, title: 'Plan', scene: scene(rect('a')),
  bg_path: null, bg_opacity: 0.35, created_at: '2026-06-01T10:00:00.000Z', updated_at: '2026-06-01T10:00:00.000Z', ...extra,
});

const write = (kind: Parameters<typeof croquisWriteId>[0], id: string, method: PendingLike['method'], jsonBody?: unknown, createdAt = 1000): PendingLike => ({
  id: croquisWriteId(kind, id), entity: croquisWriteEntity(kind), method, kind: jsonBody === undefined && (kind === 'background' || kind === 'preview') ? 'multipart' : 'json', jsonBody, createdAt,
});

describe('identifiants d\'écritures en file', () => {
  it('les construit et les relit, sorte comprise', () => {
    expect(parseCroquisWriteId(croquisWriteId('scene', 'abc-123'))).toEqual({ kind: 'scene', croquisId: 'abc-123' });
    expect(parseCroquisWriteId(croquisWriteId('backgroundClear', 'abc-123'))).toEqual({ kind: 'backgroundClear', croquisId: 'abc-123' });
    expect(parseCroquisWriteId(croquisWriteId('background', 'abc-123'))).toEqual({ kind: 'background', croquisId: 'abc-123' });
  });

  it('ignore ce qui n\'est pas un croquis', () => {
    expect(parseCroquisWriteId('notes:abc')).toBeNull();
    expect(parseCroquisWriteId('croquis-scene:')).toBeNull();
  });

  it('range les images en multipart et le reste en JSON', () => {
    expect(croquisWriteEntity('background')).toBe('croquisFile');
    expect(croquisWriteEntity('preview')).toBe('croquisFile');
    expect(croquisWriteEntity('scene')).toBe('croquis');
    expect(croquisWriteEntity('backgroundClear')).toBe('croquis');
  });

  it('n\'indexe que les entrées de croquis', () => {
    const index = indexPendingCroquis([
      write('scene', 'c1', 'PUT', {}),
      write('title', 'c1', 'PUT', {}),
      { id: 'notes:c1', entity: 'meeting', method: 'PUT', kind: 'json' },
    ]);
    expect([...index.keys()]).toEqual(['c1']);
    expect(Object.keys(index.get('c1')!).sort()).toEqual(['scene', 'title']);
  });
});

describe('applyPendingCroquisWrites', () => {
  it('montre tout de suite un croquis créé hors ligne, marqué en attente', () => {
    const list = applyPendingCroquisWrites([], [
      write('create', 'c1', 'POST', { id: 'c1', meeting_id: 'm1', title: 'Séjour', scene: scene(rect('a')) }),
    ], meeting);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'c1', title: 'Séjour', meeting_id: 'm1', project_id: 'p1', pendingSync: true });
    expect(list[0].scene.elements).toHaveLength(1);
  });

  it('ne montre un croquis en attente que sous son propre parent', () => {
    const pending = [write('create', 'c1', 'POST', { id: 'c1', meeting_id: 'm1', title: 'X' })];
    expect(applyPendingCroquisWrites([], pending, report)).toEqual([]);
    expect(applyPendingCroquisWrites([], pending, { kind: 'meeting', id: 'm2' })).toEqual([]);
    const forReport = [write('create', 'c2', 'POST', { id: 'c2', site_report_id: 'r1', title: 'Y' })];
    expect(applyPendingCroquisWrites([], forReport, report).map((c) => c.id)).toEqual(['c2']);
  });

  it('n\'ajoute pas deux fois un croquis que le serveur renvoie déjà', () => {
    const list = applyPendingCroquisWrites([row('c1')], [write('create', 'c1', 'POST', { id: 'c1', meeting_id: 'm1', title: 'Plan' })], meeting);
    expect(list).toHaveLength(1);
  });

  it('rejoue par-dessus la liste les modifications en attente', () => {
    const list = applyPendingCroquisWrites([row('c1')], [
      write('scene', 'c1', 'PUT', { scene: scene(rect('a'), rect('b')), bg_opacity: 0.6 }),
      write('title', 'c1', 'PUT', { title: 'Plan RDC' }),
    ], meeting);
    expect(list[0].scene.elements).toHaveLength(2);
    expect(list[0]).toMatchObject({ bg_opacity: 0.6, title: 'Plan RDC', pendingSync: true });
  });

  it('retire un croquis dont la suppression est en attente', () => {
    const list = applyPendingCroquisWrites([row('c1'), row('c2')], [write('remove', 'c1', 'DELETE')], meeting);
    expect(list.map((c) => c.id)).toEqual(['c2']);
  });

  it('ne ressuscite pas un croquis créé puis supprimé avant l\'envoi', () => {
    const list = applyPendingCroquisWrites([], [
      write('create', 'c1', 'POST', { id: 'c1', meeting_id: 'm1', title: 'X' }),
      write('remove', 'c1', 'DELETE'),
    ], meeting);
    expect(list).toEqual([]);
  });

  it('montre le retour à la feuille blanche et un fond en attente d\'envoi', () => {
    const withBg = row('c1', { bg_path: 'https://x/fond.jpg', bg_width: 1200, bg_height: 800 });
    const cleared = applyPendingCroquisWrites([withBg], [write('backgroundClear', 'c1', 'DELETE')], meeting);
    expect(cleared[0]).toMatchObject({ bg_path: null, bg_width: null, bg_height: null, pendingSync: true });

    const uploading = applyPendingCroquisWrites([row('c2')], [write('background', 'c2', 'POST')], meeting);
    expect(uploading[0].pendingSync).toBe(true);
  });

  it('ne marque pas en attente un croquis sans écriture en file', () => {
    expect(applyPendingCroquisWrites([row('c1')], [], meeting)[0].pendingSync).toBeUndefined();
  });

  it('trie par date de création', () => {
    const list = applyPendingCroquisWrites(
      [row('c2', { created_at: '2026-06-03T10:00:00.000Z' }), row('c1', { created_at: '2026-06-01T10:00:00.000Z' })],
      [write('create', 'c3', 'POST', { id: 'c3', meeting_id: 'm1', title: 'Nouveau' }, Date.parse('2026-06-02T10:00:00Z'))],
      meeting,
    );
    expect(list.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
  });

  it('ne laisse pas une scène illisible en file abîmer la ligne', () => {
    const list = applyPendingCroquisWrites([row('c1')], [write('scene', 'c1', 'PUT', { scene: 'texte', bg_opacity: 0.5 })], meeting);
    expect(list[0].scene.elements).toHaveLength(1);
    expect(list[0].bg_opacity).toBe(0.5);
  });
});

describe('brouillon local', () => {
  it('se relit à l\'identique', () => {
    const raw = serializeDraft(scene(rect('a')), 0.5, 1234);
    expect(parseDraft(raw)).toEqual({ scene: scene(rect('a')), bgOpacity: 0.5, savedAt: 1234 });
  });

  it('rend null pour un brouillon absent, abîmé ou d\'une autre version', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('')).toBeNull();
    expect(parseDraft('{pas du json')).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, s: scene() }))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, s: 'texte' }))).toBeNull();
  });

  it('ramène une opacité illisible à la valeur par défaut', () => {
    const raw = JSON.stringify({ v: 1, t: 1, o: 'beaucoup', s: scene() });
    expect(parseDraft(raw)?.bgOpacity).toBe(0.35);
  });

  it('compare deux scènes sur leur forme sérialisée', () => {
    expect(sceneEquals(scene(rect('a')), scene(rect('a')))).toBe(true);
    expect(sceneEquals(scene(rect('a')), scene(rect('a', 101)))).toBe(false);
  });
});

describe('resolveCroquisState', () => {
  const serverRow = row('c1', { scene: scene(rect('serveur')), bg_opacity: 0.4 });
  const queued = indexPendingCroquis([write('scene', 'c1', 'PUT', { scene: scene(rect('file')), bg_opacity: 0.7 })]).get('c1');
  const draft = { scene: scene(rect('brouillon')), bgOpacity: 0.9, savedAt: 1 };

  it('préfère le brouillon non parti', () => {
    const state = resolveCroquisState(serverRow, queued, draft);
    expect(state.source).toBe('draft');
    expect(state.scene.elements[0].id).toBe('brouillon');
    expect(state.bgOpacity).toBe(0.9);
  });

  it('puis l\'écriture en file', () => {
    const state = resolveCroquisState(serverRow, queued, null);
    expect(state.source).toBe('queue');
    expect(state.scene.elements[0].id).toBe('file');
    expect(state.bgOpacity).toBe(0.7);
  });

  it('puis la valeur du serveur', () => {
    const state = resolveCroquisState(serverRow, undefined, null);
    expect(state).toMatchObject({ source: 'server', bgOpacity: 0.4 });
    expect(state.scene.elements[0].id).toBe('serveur');
  });

  it('retombe sur une feuille vide si la scène du serveur est illisible', () => {
    const broken = { ...serverRow, scene: 'abîmée' as unknown as CroquisScene };
    expect(resolveCroquisState(broken, undefined, null).scene).toEqual({ version: 1, elements: [] });
  });
});

describe('nextCroquisTitle', () => {
  it('numérote à partir de 1', () => {
    expect(nextCroquisTitle([], 'Croquis')).toBe('Croquis 1');
  });

  it('prend le numéro suivant le plus grand déjà pris', () => {
    expect(nextCroquisTitle(['Croquis 1', 'Croquis 4'], 'Croquis')).toBe('Croquis 5');
  });

  it('ne se fie pas aux titres libres, mais ne repart jamais en dessous du nombre de croquis', () => {
    expect(nextCroquisTitle(['Plan RDC', 'Façade'], 'Croquis')).toBe('Croquis 3');
  });

  it('accepte une base avec des caractères spéciaux', () => {
    expect(nextCroquisTitle(['Sketch (1) 2'], 'Sketch (1)')).toBe('Sketch (1) 3');
  });
});
