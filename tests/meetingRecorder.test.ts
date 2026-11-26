import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingRecorder, RECORDING_SEGMENT_MS, RECORDING_SEGMENT_BYTES } from '../src/lib/meetingRecorder';
import { appendMeetingNotes, recordingDraftKey } from '../src/lib/meetingRecordingDrafts';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type.includes('webm'));
  state = 'inactive';
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(_stream: unknown, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    FakeRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; this.emit('header'); }
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.emit('footer'); this.onstop?.(); });
  }
}

let track: { stop: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
let stream: any;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  FakeRecorder.instances = [];
  FakeRecorder.isTypeSupported.mockImplementation(type => type.includes('webm'));
  track = { stop: vi.fn(), addEventListener: vi.fn() };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('meeting audio capture', () => {
  it('assembles chunks into independently decodable segments, in order, over a long meeting', async () => {
    const snapshot = vi.fn(); const stopped = vi.fn();
    const capture = new MeetingRecorder(snapshot, stopped, vi.fn());
    await capture.start();
    FakeRecorder.instances[0].emit('first');
    await vi.advanceTimersByTimeAsync(RECORDING_SEGMENT_MS);
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(track.stop).not.toHaveBeenCalled();
    FakeRecorder.instances[1].emit('second');
    capture.stop();
    await Promise.resolve();
    const segments: Blob[] = snapshot.mock.lastCall![0];
    expect(await Promise.all(segments.map(segment => segment.text()))).toEqual(['headerfirstfooter', 'headersecondfooter']);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('releases permission arriving after navigation without starting a recorder', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(r => { resolve = r; }) as any);
    const capture = new MeetingRecorder(vi.fn(), vi.fn(), vi.fn());
    const pending = capture.start();
    capture.stop(); resolve(stream); await pending;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('keeps the tail when stopped during segment rotation', async () => {
    const snapshot = vi.fn(); const stopped = vi.fn();
    const capture = new MeetingRecorder(snapshot, stopped, vi.fn());
    await capture.start();
    vi.advanceTimersByTime(RECORDING_SEGMENT_MS);
    capture.stop();
    await Promise.resolve();
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(await snapshot.mock.lastCall![0][0].text()).toBe('headerfooter');
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('rotates on size before the upload limit and chooses MP4 for Safari', async () => {
    FakeRecorder.isTypeSupported.mockImplementation(type => type === 'audio/mp4');
    const capture = new MeetingRecorder(vi.fn(), vi.fn(), vi.fn());
    await capture.start();
    expect(FakeRecorder.instances[0].mimeType).toBe('audio/mp4');
    FakeRecorder.instances[0].ondataavailable?.({ data: new Blob([new Uint8Array(RECORDING_SEGMENT_BYTES)]) });
    await Promise.resolve();
    expect(FakeRecorder.instances).toHaveLength(2);
    capture.stop(); await Promise.resolve();
  });

  it('retains received audio and stops the mic after a capture error', async () => {
    const snapshot = vi.fn(); const error = vi.fn();
    const capture = new MeetingRecorder(snapshot, vi.fn(), error);
    await capture.start();
    FakeRecorder.instances[0].emit('recoverable');
    FakeRecorder.instances[0].onerror?.();
    await Promise.resolve();
    expect(await snapshot.mock.lastCall![0][0].text()).toContain('recoverable');
    expect(track.stop).toHaveBeenCalled(); expect(error).toHaveBeenCalled();
  });

  it('reports permission failure without leaving capture active', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('denied'));
    const stopped = vi.fn();
    const capture = new MeetingRecorder(vi.fn(), stopped, vi.fn());
    await expect(capture.start()).rejects.toThrow('denied');
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});

it('keeps drafts isolated by account, cabinet, meeting type and meeting id', () => {
  const keys = [
    recordingDraftKey('a', 'one', 'meeting', 'id'), recordingDraftKey('b', 'one', 'meeting', 'id'),
    recordingDraftKey('a', 'two', 'meeting', 'id'), recordingDraftKey('a', 'one', 'siteReport', 'id'),
    recordingDraftKey('a', 'one', 'meeting', 'other'),
  ];
  expect(new Set(keys).size).toBe(5);
  expect(appendMeetingNotes('Notes existantes', 'Décisions à relire')).toBe('Notes existantes\n\nDécisions à relire');
});
