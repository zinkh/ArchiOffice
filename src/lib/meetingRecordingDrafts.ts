import Dexie, { type Table } from 'dexie';

export interface MeetingRecordingDraft {
  key: string;
  segments: Blob[];
  // undefined means not transcribed; an empty string means silence, already processed.
  transcripts: (string | undefined)[];
  transcript: string;
  notes: string;
  insertionId: string;
  inserted?: boolean;
}

class RecordingDatabase extends Dexie {
  drafts!: Table<Omit<MeetingRecordingDraft, 'segments'>, string>;
  segments!: Table<{ draftKey: string; index: number; audio: Blob }, [string, number]>;
  constructor() {
    super('ArchiOfficeMeetingRecordings');
    this.version(1).stores({ drafts: 'key', segments: '[draftKey+index], draftKey' });
  }
}
const database = new RecordingDatabase();
// Keep completed sequences by reference: a five-second checkpoint must not
// rewrite hours of audio on a phone. Only the growing/new segment is written.
const savedSegments = new Map<string, Blob[]>();
export const recordingDrafts = {
  async get(key: string): Promise<MeetingRecordingDraft | undefined> {
    const metadata = await database.drafts.get(key);
    if (!metadata) return undefined;
    const rows = await database.segments.where('draftKey').equals(key).sortBy('index');
    const segments = rows.map(row => row.audio);
    savedSegments.set(key, segments);
    return { ...metadata, segments };
  },
  async put(draft: MeetingRecordingDraft): Promise<void> {
    const { segments, ...metadata } = draft;
    const previous = savedSegments.get(draft.key) ?? [];
    await database.transaction('rw', database.drafts, database.segments, async () => {
      await database.drafts.put(metadata);
      for (let index = 0; index < segments.length; index++) {
        if (segments[index] !== previous[index]) {
          await database.segments.put({ draftKey: draft.key, index, audio: segments[index] });
        }
      }
      await database.segments.where('draftKey').equals(draft.key).filter(row => row.index >= segments.length).delete();
    });
    savedSegments.set(draft.key, segments);
  },
};

export function recordingDraftKey(userId: string, tenantId: string | null, kind: string, parentId: string) {
  return JSON.stringify([userId, tenantId, kind, parentId]);
}

export function appendMeetingNotes(existing: string, added: string) {
  return [existing.trimEnd(), added.trim()].filter(Boolean).join('\n\n');
}
