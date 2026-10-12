// Structure-preserving extraction for regulatory texts, CCTP, DPGF and CR.
// Offsets are stable for a given source and never invent page numbers.
export interface RagChunk { ordinal: number; content: string; section_title: string | null; page_number: number | null }

const TARGET = 1500;
const OVERLAP = 180;
const MAX_CHUNKS = 160;
const HEADING_RE = /^(?:lot\s*\d+[\w.-]*|chapitre\s+\d+[\w.-]*|article\s+\d+[\w.-]*|\d+(?:\.\d+){1,5}\s+\S|[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\s-]{8,})/i;

export function chunkRagText(input: string): RagChunk[] {
  const text = String(input || '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g,' ').trim().slice(0, 500000);
  if (!text) return [];
  const paragraphs = text.split(/\n\s*\n|(?<=\.)\n(?=\d+(?:\.\d+)*\s)/).map(p => p.trim()).filter(Boolean);
  const chunks: RagChunk[] = [];
  let section: string | null = null;
  let current = '';
  const flush = () => {
    if (!current.trim() || chunks.length >= MAX_CHUNKS) return;
    chunks.push({ ordinal: chunks.length, content: current.trim(), section_title: section, page_number: null });
    current = '';
  };
  for (const para of paragraphs) {
    const first = para.split('\n')[0].slice(0,160).trim();
    if (first.length < 120 && HEADING_RE.test(first)) {
      if (current.length > TARGET / 2) flush();
      section = first;
    }
    // Split exceptionally long paragraphs without losing text or indexing huge blobs.
    let rest = para;
    while (rest) {
      if (chunks.length >= MAX_CHUNKS) break;
      const room = TARGET - current.length - (current ? 2 : 0);
      if (room < 180) {
        const tail = current.slice(-OVERLAP);
        flush();
        current = tail;
        continue;
      }
      if (rest.length <= room) {
        current += (current ? '\n\n' : '') + rest;
        rest = '';
      } else {
        let split = rest.lastIndexOf(' ', room);
        if (split < Math.floor(room * .6)) split = room;
        current += (current ? '\n\n' : '') + rest.slice(0,split);
        rest = rest.slice(split).trimStart();
        const tail = current.slice(-OVERLAP);
        flush();
        current = tail;
      }
    }
    if (chunks.length >= MAX_CHUNKS) break;
  }
  flush();
  return chunks;
}
