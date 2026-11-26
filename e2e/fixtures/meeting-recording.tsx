// Isolated browser fixture: real microphone capture, IndexedDB and panel;
// AI responses are intercepted by Playwright, with no production account.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingPanel } from '../../src/components/MeetingRecordingPanel';
import { appendMeetingNotes } from '../../src/lib/meetingRecordingDrafts';
import '../../src/index.css';

function Fixture() {
  const [notes, setNotes] = useState('Notes existantes');
  const kind = new URLSearchParams(location.search).get('kind') === 'siteReport' ? 'siteReport' : 'meeting';
  return <main className="max-w-3xl mx-auto p-4">
    <RecordingPanel kind={kind} parentId="browser-test" draftKey={`browser-test-${kind}`} canGenerate
      onInsert={async text => setNotes(previous => appendMeetingNotes(previous, text))} />
    <pre data-testid="saved-notes" className="whitespace-pre-wrap">{notes}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
