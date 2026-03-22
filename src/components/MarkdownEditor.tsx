import React, { useRef } from 'react';
import { IconBold, IconItalic, IconList, IconHeading } from '@tabler/icons-react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertMarkdown = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
    
    onChange(newText);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <button className="p-1.5 hover:bg-white dark:hover:bg-zinc-700 rounded" onClick={() => insertMarkdown('**', '**')}><IconBold size={16} /></button>
        <button className="p-1.5 hover:bg-white dark:hover:bg-zinc-700 rounded" onClick={() => insertMarkdown('*', '*')}><IconItalic size={16} /></button>
        <button className="p-1.5 hover:bg-white dark:hover:bg-zinc-700 rounded" onClick={() => insertMarkdown('- ', '')}><IconList size={16} /></button>
        <button className="p-1.5 hover:bg-white dark:hover:bg-zinc-700 rounded" onClick={() => insertMarkdown('# ', '')}><IconHeading size={16} /></button>
      </div>
      <textarea
        ref={textareaRef}
        className="w-full h-32 px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
