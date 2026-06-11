export interface ArtifactSpec {
  type: 'table' | 'document' | 'code' | 'chart';
  title?: string;
  content: any;
}

export interface Artifact {
  type: ArtifactSpec['type'];
  title?: string;
  content: any;
}

// Delimiter the AI is instructed to use when embedding a structured artifact.
// The system prompt should tell the model to wrap artifact JSON in these tags.
const OPEN  = '```artifact';
const CLOSE = '```';

export function parseArtifactFromText(raw: string): { cleanText: string; spec: ArtifactSpec | null } {
  const start = raw.indexOf(OPEN);
  if (start === -1) return { cleanText: raw.trim(), spec: null };

  const end = raw.indexOf(CLOSE, start + OPEN.length);
  if (end === -1) return { cleanText: raw.trim(), spec: null };

  const json = raw.slice(start + OPEN.length, end).trim();
  const before = raw.slice(0, start).trim();
  const after  = raw.slice(end + CLOSE.length).trim();
  const cleanText = [before, after].filter(Boolean).join('\n\n');

  try {
    const spec = JSON.parse(json) as ArtifactSpec;
    if (!spec.type || !spec.content) return { cleanText: raw.trim(), spec: null };
    return { cleanText, spec };
  } catch {
    return { cleanText: raw.trim(), spec: null };
  }
}

export function generateArtifact(spec: ArtifactSpec): Artifact {
  return { type: spec.type, title: spec.title, content: spec.content };
}
