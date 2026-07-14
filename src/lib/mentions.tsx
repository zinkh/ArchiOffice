import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';

export interface TeamMemberLite {
  id: string;
  name: string;
  email?: string;
}

export interface MentionTrigger {
  start: number;
  query: string;
}

// Finds an "@query" being typed right before the cursor, e.g. "hello @jul" -> { start: 6, query: 'jul' }
export function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(?:^|\s)@(\w*)$/);
  if (!match) return null;
  return { start: before.lastIndexOf('@'), query: match[1] };
}

type MentionableElement = HTMLTextAreaElement | HTMLInputElement;

// Self-contained @mention state for a single text field (composer or comment box).
// Each caller gets its own isolated value/mention state — mount one per input.
export function useMentionComposer(members: TeamMemberLite[], initialValue = '') {
  const [value, setValue] = useState(initialValue);
  const [mention, setMention] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTop, setMentionTop] = useState(0);
  const ref = useRef<MentionableElement>(null);

  const suggestions = mention
    ? members.filter(m => m.name?.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const handleChange = (e: React.ChangeEvent<MentionableElement>) => {
    const v = e.target.value;
    setValue(v);
    const cursor = e.target.selectionStart ?? v.length;
    const trigger = findMentionTrigger(v, cursor);
    setMention(trigger);
    setMentionIndex(0);
    if (trigger) setMentionTop(e.target.offsetTop + e.target.offsetHeight + 4);
  };

  const selectMention = (member: TeamMemberLite) => {
    setValue(prev => {
      if (!mention) return prev;
      const before = prev.slice(0, mention.start);
      const after = prev.slice(mention.start + 1 + mention.query.length);
      const insertion = `@${member.name} `;
      requestAnimationFrame(() => {
        const el = ref.current;
        if (el) {
          const pos = before.length + insertion.length;
          el.focus();
          el.setSelectionRange(pos, pos);
        }
      });
      return before + insertion + after;
    });
    setMention(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, onSubmit?: () => void) => {
    if (mention && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(suggestions[mentionIndex]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter') onSubmit?.();
  };

  const handleBlur = () => setTimeout(() => setMention(null), 100);

  return { value, setValue, ref, mention, mentionIndex, setMentionIndex, mentionTop, suggestions, handleChange, selectMention, handleKeyDown, handleBlur };
}

export function MentionDropdown({ suggestions, activeIndex, top, onHover, onSelect, renderAvatar }: {
  suggestions: TeamMemberLite[];
  activeIndex: number;
  top: number;
  onHover: (i: number) => void;
  onSelect: (member: TeamMemberLite) => void;
  renderAvatar: (name: string) => React.ReactNode;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div
      className="absolute left-0 z-30 rounded-lg shadow-lg py-1 min-w-[200px]"
      style={{ top, background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      {suggestions.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onMouseDown={e => { e.preventDefault(); onSelect(m); }}
          onMouseEnter={() => onHover(i)}
          className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors"
          style={{ background: i === activeIndex ? 'var(--tblr-surface-2)' : 'transparent', color: 'var(--tblr-text)' }}
        >
          {renderAvatar(m.name || 'U')}
          <span className="truncate">{m.name}</span>
        </button>
      ))}
    </div>
  );
}

// Renders text, turning any "@Full Name" that matches a known team member into a
// clickable link to their profile in the team directory.
export function renderTextWithMentions(text: string, members: TeamMemberLite[]): React.ReactNode {
  if (!text) return text;
  const candidates = members.filter(m => m.name?.trim()).sort((a, b) => b.name.length - a.name.length);
  if (candidates.length === 0) return text;

  const pattern = candidates.map(m => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`@(${pattern})(?=[\\s.,!?;:]|$)`, 'gu');

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const name = match[1];
    const member = candidates.find(m => m.name === name);
    nodes.push(
      <Link
        key={`mention-${key++}`}
        to={`/team?member=${member?.id}`}
        className="font-semibold hover:underline"
        style={{ color: 'var(--tblr-primary)' }}
      >
        @{name}
      </Link>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
