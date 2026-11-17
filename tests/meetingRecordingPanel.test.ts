// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn(), get: vi.fn(), put: vi.fn(), stop: vi.fn(), start: vi.fn(), user: { currentUser: { id: 'user' }, activeTenantId: 'tenant', tenantPlan: 'enterprise', isTrialExpired: false } }));
vi.mock('../src/UserContext', () => ({ useUser: () => mocks.user }));
vi.mock('../src/lib/api', () => ({ apiFetch: mocks.api }));
vi.mock('../src/lib/meetingRecordingDrafts', async importOriginal => ({
  ...await importOriginal<any>(), recordingDrafts: { get: mocks.get, put: mocks.put },
}));
vi.mock('../src/lib/meetingRecorder', () => ({
  TRANSCRIPTION_MAX_BYTES: 10 * 1024 * 1024,
  MeetingRecorder: class {
    constructor(private snapshot: any, private stopped: any) {}
    async start() { mocks.start(); this.snapshot([new Blob(['audio'], { type: 'audio/webm' })]); }
    stop() { mocks.stop(); this.stopped(); }
  },
}));
import MeetingRecordingPanel from '../src/components/MeetingRecordingPanel';

let root: Root; let host: HTMLDivElement; let insert: Mock<(notes: string, insertionId: string) => Promise<void>>;
const draft = () => ({ key: 'key', segments: [new Blob(['one']), new Blob(['two'])], transcripts: [], transcript: '', notes: '', insertionId: 'insert-stable' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(draft()); mocks.put.mockResolvedValue('key');
  mocks.user.tenantPlan = 'enterprise';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MediaRecorder', class {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`); URL.revokeObjectURL = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  insert = vi.fn().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
async function mount(parentId = 'meeting-a', kind: 'meeting' | 'siteReport' = 'meeting') {
  await act(async () => root.render(React.createElement(MeetingRecordingPanel, { kind, parentId, onInsert: insert })));
}
async function click(label: string) { await act(async () => button(label).click()); }

it('resumes a failed transcription from the pending segment and inserts only on explicit review', async () => {
  mocks.api.mockResolvedValueOnce({ text: 'Première partie.' }).mockRejectedValueOnce(new Error('Connexion interrompue'));
  await mount(); await click('Transcrire et préparer');
  expect(host.textContent).toContain('Connexion interrompue');
  expect(insert).not.toHaveBeenCalled();
  expect(mocks.put.mock.lastCall![0].transcripts).toEqual(['Première partie.']);
  mocks.api.mockResolvedValueOnce({ text: 'Deuxième partie.' }).mockResolvedValueOnce({ notes: 'Notes proposées' });
  await click('Transcrire et préparer');
  expect(mocks.api).toHaveBeenCalledTimes(4); // first segment was not uploaded/billed twice
  expect(JSON.parse(mocks.api.mock.lastCall![1].body)).toEqual({ transcript: 'Première partie.\n\nDeuxième partie.', kind: 'meeting' });
  expect(insert).not.toHaveBeenCalled();
  await click('Ajouter aux notes');
  expect(insert).toHaveBeenCalledExactlyOnceWith('Notes proposées', 'insert-stable');
  expect(button('Ajouter aux notes').disabled).toBe(true);
});

it('keeps the transcript when notes generation fails, for manual insertion', async () => {
  mocks.api.mockResolvedValueOnce({ text: 'Un' }).mockResolvedValueOnce({ text: 'Deux' }).mockRejectedValueOnce(new Error('Crédit insuffisant'));
  await mount('report-a', 'siteReport'); await click('Transcrire et préparer');
  expect(host.textContent).toContain('Crédit insuffisant');
  await click('Ajouter la transcription seule');
  expect(insert).toHaveBeenCalledWith('Un\n\nDeux', 'insert-stable');
});

it('retries failed insertion with the same id and preserves the editable draft', async () => {
  mocks.get.mockResolvedValue({ ...draft(), notes: 'Constat de chantier' });
  insert.mockRejectedValueOnce(new Error('Enregistrement refusé')).mockResolvedValueOnce(undefined);
  await mount('report-a', 'siteReport'); await click('Ajouter aux rubriques');
  expect(button('Ajouter aux rubriques').disabled).toBe(false);
  await click('Ajouter aux rubriques');
  expect(insert.mock.calls).toEqual([['Constat de chantier', 'insert-stable'], ['Constat de chantier', 'insert-stable']]);
});

it('stops the microphone and loads the other meeting’s draft on navigation', async () => {
  mocks.get.mockResolvedValue(undefined);
  await mount(); await click('Démarrer');
  expect(mocks.start).toHaveBeenCalledOnce();
  await mount('meeting-b');
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.get.mock.calls.map(call => call[0])).toEqual([
    JSON.stringify(['user', 'tenant', 'meeting', 'meeting-a']), JSON.stringify(['user', 'tenant', 'meeting', 'meeting-b']),
  ]);
});

it('disables conversion without the plan but retains playback and export', async () => {
  mocks.user.tenantPlan = 'pro';
  await mount();
  expect(button('Transcrire et préparer').disabled).toBe(true);
  expect(host.querySelectorAll('audio')).toHaveLength(2);
  expect(host.querySelectorAll('a[download]')).toHaveLength(2);
});
