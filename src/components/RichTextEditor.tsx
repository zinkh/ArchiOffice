// Éditeur de texte riche réutilisable (Tiptap) : gras, italique, titres, listes,
// citation, et un menu « / » (blocs + commandes IA). Le texte produit par l'IA
// n'entre jamais directement dans le document : il s'affiche d'abord dans un
// panneau, à valider, à régénérer ou à refuser.
//
// `value` / `onChange` échangent du HTML. Le parent met une `key` propre au
// document édité (identifiant du rapport...) : changer de document remonte
// l'éditeur au lieu de synchroniser le contenu à la main.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  IconArrowBackUp, IconArrowForwardUp, IconBold, IconH2, IconH3, IconItalic,
  IconList, IconListNumbers, IconLoader2, IconSparkles,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { aiTextToHtml, htmlToPlainText } from '../lib/richText';
import { filterSlashItems, matchSlash, SLASH_ITEMS, type AiMode, type SlashItem } from '../lib/slashMenu';

export interface AiWriteRequest {
  mode: AiMode;
  /** Consigne libre de l'architecte (mode « écrire », facultative pour « reformuler »). */
  instruction: string;
  /** Texte sélectionné ou paragraphe courant, pour les modes de réécriture. */
  selection: string;
  /** Contenu actuel du document, en texte brut, pour que l'IA s'y raccorde. */
  document: string;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Fournie : les commandes IA apparaissent (menu « / » et barre d'outils). Elle renvoie le texte proposé. */
  ai?: (request: AiWriteRequest) => Promise<string>;
  /** Sans `ai` : le message affiché quand on lance une commande IA (plan insuffisant). Les commandes restent visibles. */
  aiLocked?: string;
  minHeight?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

interface SlashState { query: string; from: number; to: number; top: number; left: number }
interface AiPanelState {
  mode: AiMode;
  instruction: string;
  status: 'input' | 'loading' | 'ready' | 'error';
  result: string;
  error: string;
  target: { from: number; to: number };
  selection: string;
  /** Commande IA indisponible (plan) : pas de nouvelle tentative possible. */
  locked?: boolean;
}

const REWRITE_MODES: readonly AiMode[] = ['rewrite', 'shorten', 'expand', 'fix'];
const MAX_DOCUMENT_CHARS = 20_000;

function ToolbarButton({ label, active, disabled, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Garde le focus (et la sélection) dans l'éditeur.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'p-1.5 rounded-md border transition-colors disabled:opacity-40',
        active ? 'border-[var(--tblr-border-color)] bg-[var(--tblr-bg-surface-secondary,#f1f5f9)]' : 'border-transparent hover:bg-[var(--tblr-bg-surface-secondary,#f1f5f9)]',
      )}
      style={{ color: 'var(--tblr-body-color)' }}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder, ai, aiLocked, minHeight = 320, disabled, ariaLabel }: RichTextEditorProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dismissedRef = useRef<number | null>(null);
  const requestRef = useRef(0);

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<AiPanelState | null>(null);

  const items = useMemo(
    () => (slash ? filterSlashItems(SLASH_ITEMS, slash.query, i => t(i.labelKey) as string, !!ai || !!aiLocked) : []),
    [slash, ai, aiLocked, t],
  );

  // Les gestionnaires clavier de l'éditeur sont créés une fois : ils lisent l'état courant ici.
  const live = useRef({ slash, items, active });
  live.current = { slash, items, active };
  const runItemRef = useRef<(item: SlashItem) => void>(() => {});

  const updateSlash = useCallback((ed: Editor) => {
    const { selection } = ed.state;
    if (!ed.isEditable || !selection.empty || !selection.$from.parent.isTextblock) { setSlash(null); return; }
    const { $from } = selection;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = matchSlash(textBefore);
    if (!match) { setSlash(null); return; }
    const slashPos = $from.start() + match.from;
    if (dismissedRef.current === slashPos) { setSlash(null); return; }
    const coords = ed.view.coordsAtPos(slashPos);
    const box = wrapRef.current?.getBoundingClientRect();
    setSlash(prev => {
      if (!prev || prev.query !== match.query || prev.from !== slashPos) setActive(0);
      return {
        query: match.query, from: slashPos, to: selection.from,
        top: coords.bottom - (box?.top ?? 0) + 6,
        left: Math.max(0, Math.min(coords.left - (box?.left ?? 0), (box?.width ?? 320) - 280)),
      };
    });
  }, []);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: placeholder || '' })],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor: ed }) => { onChange(ed.getHTML()); updateSlash(ed); },
    onSelectionUpdate: ({ editor: ed }) => updateSlash(ed),
    editorProps: {
      attributes: { class: 'rt-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': ariaLabel || '' },
      handleKeyDown: (_view, event) => {
        const { slash: s, items: list, active: idx } = live.current;
        if (!s || !list.length) return false;
        if (event.key === 'ArrowDown') { setActive((idx + 1) % list.length); return true; }
        if (event.key === 'ArrowUp') { setActive((idx - 1 + list.length) % list.length); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { runItemRef.current(list[idx] ?? list[0]); return true; }
        if (event.key === 'Escape') { dismissedRef.current = s.from; setSlash(null); return true; }
        return false;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: !!ed?.isActive('bold'), italic: !!ed?.isActive('italic'),
      h2: !!ed?.isActive('heading', { level: 2 }), h3: !!ed?.isActive('heading', { level: 3 }),
      bullet: !!ed?.isActive('bulletList'), ordered: !!ed?.isActive('orderedList'),
      canUndo: !!ed?.can().undo(), canRedo: !!ed?.can().redo(),
    }),
  });

  // ── Rédaction assistée ───────────────────────────────────────────────────
  const runAi = useCallback(async (next: AiPanelState) => {
    const ed = editorRef.current;
    if (!ai || !ed) return;
    const id = ++requestRef.current;
    setPanel({ ...next, status: 'loading', error: '' });
    try {
      const text = await ai({
        mode: next.mode, instruction: next.instruction, selection: next.selection,
        document: htmlToPlainText(ed.getHTML()).slice(0, MAX_DOCUMENT_CHARS),
      });
      if (requestRef.current !== id) return;
      if (!text.trim()) throw new Error(t('richtext_ai_empty') as string);
      setPanel(p => (p ? { ...p, status: 'ready', result: text } : p));
    } catch (e: any) {
      if (requestRef.current !== id) return;
      setPanel(p => (p ? { ...p, status: 'error', error: e?.error || e?.message || (t('richtext_ai_error') as string) } : p));
    }
  }, [ai, t]);

  const startAi = useCallback((mode: AiMode) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!ai) {
      if (aiLocked) setPanel({ mode, instruction: '', status: 'error', result: '', error: aiLocked, target: { from: 0, to: 0 }, selection: '', locked: true });
      return;
    }
    const { from, to, empty, $from } = ed.state.selection;
    const blockRange = { from: $from.before(), to: $from.after() };
    let target = blockRange;
    let selection = '';

    if (REWRITE_MODES.includes(mode)) {
      if (!empty) { target = { from, to }; selection = ed.state.doc.textBetween(from, to, '\n'); }
      else { selection = $from.parent.textContent; }
      if (!selection.trim()) {
        setPanel({ mode, instruction: '', status: 'error', result: '', error: t('richtext_ai_need_text') as string, target, selection });
        return;
      }
    } else if ($from.parent.textContent.trim()) {
      // Écrire / continuer : le texte vient après le paragraphe courant.
      target = { from: $from.after(), to: $from.after() };
    }

    const next: AiPanelState = { mode, instruction: '', status: 'input', result: '', error: '', target, selection };
    if (mode === 'write' || mode === 'rewrite') setPanel(next);
    else void runAi(next);
  }, [ai, aiLocked, runAi, t]);

  const acceptAi = () => {
    const ed = editorRef.current;
    if (!ed || !panel) return;
    const size = ed.state.doc.content.size;
    const range = { from: Math.min(panel.target.from, size), to: Math.min(panel.target.to, size) };
    ed.chain().focus().insertContentAt(range, aiTextToHtml(panel.result)).run();
    setPanel(null);
  };

  const closePanel = () => { requestRef.current++; setPanel(null); editorRef.current?.commands.focus(); };

  // ── Menu « / » ───────────────────────────────────────────────────────────
  runItemRef.current = (item: SlashItem) => {
    const ed = editorRef.current;
    const s = live.current.slash;
    if (!ed || !s) return;
    ed.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
    setSlash(null);
    if (item.action.type === 'ai') { startAi(item.action.mode); return; }
    const chain = ed.chain().focus();
    switch (item.action.block) {
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'bullet': chain.toggleBulletList().run(); break;
      case 'ordered': chain.toggleOrderedList().run(); break;
      case 'quote': chain.toggleBlockquote().run(); break;
      case 'divider': chain.setHorizontalRule().run(); break;
    }
  };

  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const aiLabel = (mode: AiMode) => t(SLASH_ITEMS.find(i => i.action.type === 'ai' && i.action.mode === mode)!.labelKey) as string;

  return (
    <div
      ref={wrapRef}
      className="rt-editor relative rounded-lg border"
      style={{ borderColor: 'var(--tblr-border-color)', background: 'var(--tblr-bg-surface, #fff)' }}
    >
      {!disabled && (
        <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--tblr-border-color)' }}>
          <ToolbarButton label={t('richtext_bold') as string} active={state?.bold} onClick={() => chain().toggleBold().run()}><IconBold size={16} /></ToolbarButton>
          <ToolbarButton label={t('richtext_italic') as string} active={state?.italic} onClick={() => chain().toggleItalic().run()}><IconItalic size={16} /></ToolbarButton>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--tblr-border-color)' }} aria-hidden="true" />
          <ToolbarButton label={t('richtext_slash_h2') as string} active={state?.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><IconH2 size={16} /></ToolbarButton>
          <ToolbarButton label={t('richtext_slash_h3') as string} active={state?.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><IconH3 size={16} /></ToolbarButton>
          <ToolbarButton label={t('richtext_slash_bullet') as string} active={state?.bullet} onClick={() => chain().toggleBulletList().run()}><IconList size={16} /></ToolbarButton>
          <ToolbarButton label={t('richtext_slash_ordered') as string} active={state?.ordered} onClick={() => chain().toggleOrderedList().run()}><IconListNumbers size={16} /></ToolbarButton>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--tblr-border-color)' }} aria-hidden="true" />
          <ToolbarButton label={t('richtext_undo') as string} disabled={!state?.canUndo} onClick={() => chain().undo().run()}><IconArrowBackUp size={16} /></ToolbarButton>
          <ToolbarButton label={t('richtext_redo') as string} disabled={!state?.canRedo} onClick={() => chain().redo().run()}><IconArrowForwardUp size={16} /></ToolbarButton>
          {(ai || aiLocked) && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => startAi('write')}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold"
                style={{ borderColor: 'var(--tblr-border-color)', color: 'var(--tblr-body-color)' }}
              >
                <IconSparkles size={14} />{aiLabel('write')}
              </button>
              {(['rewrite', 'shorten', 'expand', 'fix'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => startAi(mode)}
                  className="rounded-md px-2 py-1 text-xs hover:bg-[var(--tblr-bg-surface-secondary,#f1f5f9)]"
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  {aiLabel(mode)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {panel && (
        <div className="border-b px-3 py-3 text-sm" style={{ borderColor: 'var(--tblr-border-color)' }} role="region" aria-live="polite" aria-label={t('richtext_ai_panel') as string}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
            <IconSparkles size={14} />{aiLabel(panel.mode)}
          </div>

          {panel.status === 'input' && (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={e => { e.preventDefault(); if (panel.mode === 'write' && !panel.instruction.trim()) return; void runAi(panel); }}
            >
              <input
                autoFocus
                value={panel.instruction}
                onChange={e => setPanel({ ...panel, instruction: e.target.value })}
                onKeyDown={e => { if (e.key === 'Escape') closePanel(); }}
                placeholder={t(panel.mode === 'write' ? 'richtext_ai_write_placeholder' : 'richtext_ai_rewrite_placeholder') as string}
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--tblr-border-color)', background: 'transparent', color: 'var(--tblr-body-color)' }}
              />
              <div className="flex gap-2">
                <button type="submit" className="rounded-md border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--tblr-body-color)', color: 'var(--tblr-body-color)' }}>{t('richtext_ai_generate')}</button>
                <button type="button" onClick={closePanel} className="rounded-md px-3 py-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('richtext_ai_cancel')}</button>
              </div>
            </form>
          )}

          {panel.status === 'loading' && (
            <div className="flex items-center gap-2" style={{ color: 'var(--tblr-muted)' }}>
              <IconLoader2 size={16} className="animate-spin" />{t('richtext_ai_loading')}
              <button type="button" onClick={closePanel} className="ml-auto rounded-md px-2 py-1 text-xs">{t('richtext_ai_cancel')}</button>
            </div>
          )}

          {panel.status === 'error' && (
            <div className="flex flex-wrap items-center gap-2">
              <span role="alert" className="text-sm" style={{ color: 'var(--tblr-danger, #b42318)' }}>{panel.error}</span>
              <div className="ml-auto flex gap-2">
                {!panel.locked && (panel.selection.trim() || panel.mode === 'write' || panel.mode === 'continue')
                  ? <button type="button" onClick={() => void runAi(panel)} className="rounded-md border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--tblr-border-color)' }}>{t('richtext_ai_retry')}</button>
                  : null}
                <button type="button" onClick={closePanel} className="rounded-md px-3 py-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('richtext_ai_close')}</button>
              </div>
            </div>
          )}

          {panel.status === 'ready' && (
            <>
              {/* aiTextToHtml échappe tout le texte du modèle : seules les balises qu'elle produit passent. */}
              <div className="rt-content max-h-72 overflow-auto rounded-md border px-3 py-2" style={{ borderColor: 'var(--tblr-border-color)' }} dangerouslySetInnerHTML={{ __html: aiTextToHtml(panel.result) }} />
              <p className="mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('richtext_ai_disclosure')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={acceptAi} className="rounded-md border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: 'var(--tblr-body-color)', color: 'var(--tblr-body-color)' }}>
                  {t(REWRITE_MODES.includes(panel.mode) ? 'richtext_ai_replace' : 'richtext_ai_insert')}
                </button>
                <button type="button" onClick={() => void runAi(panel)} className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--tblr-border-color)' }}>{t('richtext_ai_regenerate')}</button>
                <button type="button" onClick={closePanel} className="rounded-md px-3 py-1.5 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('richtext_ai_discard')}</button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ minHeight }} className="px-4 py-3" onClick={() => editor.commands.focus()}>
        <EditorContent editor={editor} />
      </div>

      {slash && items.length > 0 && (
        <ul
          role="listbox"
          aria-label={t('richtext_slash_menu') as string}
          className="absolute z-30 max-h-72 w-64 overflow-auto rounded-lg border py-1 shadow-lg"
          style={{ top: slash.top, left: slash.left, borderColor: 'var(--tblr-border-color)', background: 'var(--tblr-bg-surface, #fff)' }}
          onMouseDown={e => e.preventDefault()}
        >
          {items.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onClick={() => runItemRef.current(item)}
                onMouseEnter={() => setActive(index)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', index === active && 'bg-[var(--tblr-bg-surface-secondary,#f1f5f9)]')}
                style={{ color: 'var(--tblr-body-color)' }}
              >
                {item.action.type === 'ai' && <IconSparkles size={14} aria-hidden="true" />}
                {t(item.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
