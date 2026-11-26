// Éditeur de blocs de la « Base de données » (mini-Notion) : Tiptap, contenu en JSON (editor.getJSON()).
// Menu « / » (titres, listes, tâches, bloc repliable, citation, code, séparateur, tableau, image, fichier),
// poignée de bloc avec menu (transformer en, dupliquer, supprimer) et glisser-déposer des blocs.
// Le parent donne une `key` propre à la page : changer de page remonte l'éditeur au lieu de resynchroniser.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import {
  IconCaretRight, IconCheckbox, IconCode, IconCopy, IconGripVertical, IconH1, IconH2, IconH3, IconList,
  IconListNumbers, IconPaperclip, IconPhoto, IconQuote, IconSeparatorHorizontal, IconTable, IconTrash, IconTypography,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { matchSlash } from '../../lib/slashMenu';
import { KB_BLOCKS, KB_TRANSFORMABLE, filterKbBlocks, kbBlockOfNode, type KbBlock, type KbBlockItem } from '../../lib/kbBlocks';
import { uploadKbFile } from '../../lib/kbUpload';
import { KbFile, KbImage } from './kbExtensions';

const BLOCK_ICONS: Record<KbBlock, Icon> = {
  text: IconTypography, h1: IconH1, h2: IconH2, h3: IconH3, bullet: IconList, ordered: IconListNumbers,
  todo: IconCheckbox, toggle: IconCaretRight, quote: IconQuote, code: IconCode, divider: IconSeparatorHorizontal,
  table: IconTable, image: IconPhoto, file: IconPaperclip,
};

interface BlockEditorProps {
  /** Page à laquelle les images et fichiers sont rattachés. */
  pageId: string;
  /** Document Tiptap (JSON), ou null pour une page vide. */
  value: unknown;
  onChange: (json: JSONContent) => void;
  disabled?: boolean;
}

interface SlashState { query: string; from: number; to: number; top: number; left: number }
interface HandleMenu { top: number; left: number; pos: number; nodeType: string; attrs: Record<string, unknown> }

interface BlockPickers { image: () => void; file: () => void }

/** Applique un bloc à la sélection : transforme le bloc courant, ou insère le bloc (séparateur, tableau, fichier). */
function applyBlock(editor: Editor, block: KbBlock, pickers: BlockPickers): void {
  if (block === 'divider') { editor.chain().focus().setHorizontalRule().run(); return; }
  if (block === 'table') { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); return; }
  if (block === 'image') { pickers.image(); return; }
  if (block === 'file') { pickers.file(); return; }

  const chain = editor.chain().focus();
  if (editor.isActive('details')) chain.unsetDetails();
  chain.clearNodes();
  switch (block) {
    case 'text': break;
    case 'h1': chain.setHeading({ level: 1 }); break;
    case 'h2': chain.setHeading({ level: 2 }); break;
    case 'h3': chain.setHeading({ level: 3 }); break;
    case 'bullet': chain.toggleBulletList(); break;
    case 'ordered': chain.toggleOrderedList(); break;
    case 'todo': chain.toggleTaskList(); break;
    case 'toggle': chain.setDetails(); break;
    case 'quote': chain.setBlockquote(); break;
    case 'code': chain.setCodeBlock(); break;
  }
  chain.run();
}

export function BlockEditor({ pageId, value, onChange, disabled }: BlockEditorProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dismissedRef = useRef<number | null>(null);
  const handleNode = useRef<{ pos: number; nodeType: string; attrs: Record<string, unknown> } | null>(null);

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<HandleMenu | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const items = useMemo(
    () => (slash ? filterKbBlocks(KB_BLOCKS, slash.query, i => t(i.labelKey) as string) : []),
    [slash, t],
  );

  // Les gestionnaires clavier de l'éditeur sont créés une fois : ils lisent l'état courant ici.
  const live = useRef({ slash, items, active });
  live.current = { slash, items, active };
  const runItemRef = useRef<(item: KbBlockItem) => void>(() => {});

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
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? (t('kb_ph_heading') as string) : (t('kb_ph_text') as string)),
        includeChildren: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      TableKit.configure({ table: { resizable: true } }),
      KbImage,
      KbFile,
    ],
    content: (value as JSONContent | null) || undefined,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => { onChange(ed.getJSON()); updateSlash(ed); },
    onSelectionUpdate: ({ editor: ed }) => updateSlash(ed),
    editorProps: {
      attributes: { class: 'kb-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('kb_editor_label') as string },
      handleKeyDown: (_view, event) => {
        const { slash: s, items: list, active: idx } = live.current;
        if (!s) return false;
        // Échap ferme le menu même quand aucun bloc ne correspond à la recherche.
        if (event.key === 'Escape') { dismissedRef.current = s.from; setSlash(null); return true; }
        if (!list.length) return false;
        if (event.key === 'ArrowDown') { setActive((idx + 1) % list.length); return true; }
        if (event.key === 'ArrowUp') { setActive((idx - 1 + list.length) % list.length); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { runItemRef.current(list[idx] ?? list[0]); return true; }
        return false;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  const pickers: BlockPickers = {
    image: () => imageInput.current?.click(),
    file: () => fileInput.current?.click(),
  };

  runItemRef.current = (item: KbBlockItem) => {
    const ed = editorRef.current;
    const s = live.current.slash;
    if (!ed || !s) return;
    ed.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
    setSlash(null);
    applyBlock(ed, item.id, pickers);
  };

  // Envoi d'une image ou d'un fichier : déposé sur la page, inséré à la position du curseur.
  const upload = async (files: FileList | null, kind: 'image' | 'file') => {
    const ed = editorRef.current;
    if (!ed || !files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const doc = await uploadKbFile(pageId, file);
        const node: JSONContent = kind === 'image'
          ? { type: 'image', attrs: { src: '', alt: file.name, fileUrl: doc.file_url } }
          : { type: 'kbFile', attrs: { documentId: doc.id, fileUrl: doc.file_url, name: file.name } };
        ed.chain().focus().insertContent(node).run();
      }
    } catch (e: any) {
      setUploadError(e?.message || (t('kb_upload_error') as string));
    } finally {
      setUploading(false);
    }
  };

  // ── Menu de la poignée de bloc ───────────────────────────────────────────
  const openHandleMenu = (event: React.MouseEvent<HTMLElement>) => {
    const target = handleNode.current;
    if (!target) return;
    const box = wrapRef.current?.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu(prev => (prev
      ? null
      : { top: rect.bottom - (box?.top ?? 0) + 4, left: Math.max(0, rect.left - (box?.left ?? 0)), ...target }));
  };

  const blockAt = (m: HandleMenu) => editorRef.current?.state.doc.nodeAt(m.pos) ?? null;

  const transformTo = (m: HandleMenu, block: KbBlock) => {
    const ed = editorRef.current;
    if (!ed || !blockAt(m)) return;
    ed.chain().focus().setTextSelection(m.pos + 1).run();
    applyBlock(ed, block, pickers);
    setMenu(null);
  };
  const duplicate = (m: HandleMenu) => {
    const ed = editorRef.current;
    const node = blockAt(m);
    if (!ed || !node) return;
    ed.chain().focus().insertContentAt(m.pos + node.nodeSize, node.toJSON()).run();
    setMenu(null);
  };
  const remove = (m: HandleMenu) => {
    const ed = editorRef.current;
    const node = blockAt(m);
    if (!ed || !node) return;
    ed.chain().focus().deleteRange({ from: m.pos, to: m.pos + node.nodeSize }).run();
    setMenu(null);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  if (!editor) return null;
  const currentBlock = menu ? kbBlockOfNode(menu.nodeType, menu.attrs) : null;
  const canTransform = !!currentBlock && KB_TRANSFORMABLE.includes(currentBlock);

  return (
    <div ref={wrapRef} className="relative">
      {!disabled && (
        <DragHandle
          editor={editor}
          onNodeChange={({ node, pos }) => {
            handleNode.current = node ? { pos, nodeType: node.type.name, attrs: node.attrs as Record<string, unknown> } : null;
            if (!node) setMenu(null);
          }}
        >
          <button
            type="button"
            className="kb-drag-handle"
            aria-label={t('kb_handle_menu') as string}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={openHandleMenu}
          >
            <IconGripVertical size={16} aria-hidden />
          </button>
        </DragHandle>
      )}

      <EditorContent editor={editor} />

      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={e => { void upload(e.target.files, 'image'); e.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden onChange={e => { void upload(e.target.files, 'file'); e.target.value = ''; }} />

      {uploading && <p role="status" className="mt-2 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_uploading')}</p>}
      {uploadError && <p role="alert" className="mt-2 text-[0.8125rem]" style={{ color: 'var(--tblr-danger)' }}>{uploadError}</p>}

      {slash && (
        <ul
          role="listbox"
          aria-label={t('kb_slash_label') as string}
          className="absolute z-30 w-[17.5rem] max-h-72 overflow-y-auto p-1 rounded-lg border"
          style={{ top: slash.top, left: slash.left, background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          {items.length === 0 && <li className="px-2 py-1.5 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_slash_empty')}</li>}
          {items.map((item, index) => {
            const BlockIcon = BLOCK_ICONS[item.id];
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={event => { event.preventDefault(); runItemRef.current(item); }}
                onMouseEnter={() => setActive(index)}
                className={cn('flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-[0.875rem]', index === active && 'bg-[var(--tblr-primary-lt)]')}
                style={{ color: 'var(--tblr-text)' }}
              >
                <BlockIcon size={16} aria-hidden style={{ color: 'var(--tblr-muted)' }} />
                {t(item.labelKey)}
              </li>
            );
          })}
        </ul>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setMenu(null)} aria-hidden />
          <div
            role="menu"
            aria-label={t('kb_handle_menu') as string}
            className="absolute z-40 w-56 p-1 rounded-lg border"
            style={{ top: menu.top, left: menu.left, background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
          >
            {canTransform && (
              <>
                <p className="px-2 pt-1 pb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('kb_menu_turn_into')}</p>
                {KB_BLOCKS.filter(b => KB_TRANSFORMABLE.includes(b.id)).map(b => {
                  const BlockIcon = BLOCK_ICONS[b.id];
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="menuitem"
                      onClick={() => transformTo(menu, b.id)}
                      className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]', currentBlock === b.id && 'font-semibold')}
                      style={{ color: 'var(--tblr-text)' }}
                    >
                      <BlockIcon size={16} aria-hidden style={{ color: 'var(--tblr-muted)' }} />
                      {t(b.labelKey)}
                    </button>
                  );
                })}
                <div className="my-1 border-t" style={{ borderColor: 'var(--tblr-border)' }} />
              </>
            )}
            <button type="button" role="menuitem" onClick={() => duplicate(menu)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-text)' }}>
              <IconCopy size={16} aria-hidden style={{ color: 'var(--tblr-muted)' }} />{t('kb_menu_duplicate')}
            </button>
            <button type="button" role="menuitem" onClick={() => remove(menu)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-danger)' }}>
              <IconTrash size={16} aria-hidden />{t('kb_menu_delete')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
