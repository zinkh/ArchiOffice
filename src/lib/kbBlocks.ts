// Blocs de l'éditeur de la « Base de données » (menu « / » et « Transformer en ») : logique pure, sans Tiptap.
// L'application du bloc à l'éditeur est dans src/components/kb/BlockEditor.tsx.
import { foldText } from './slashMenu';

export type KbBlock =
  | 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'toggle' | 'quote' | 'code'
  | 'divider' | 'table' | 'image' | 'file';

export interface KbBlockItem {
  id: KbBlock;
  /** Clé i18next du libellé. */
  labelKey: string;
  /** Mots-clés supplémentaires pour la recherche (français, sans accent). */
  keywords: string[];
}

export const KB_BLOCKS: readonly KbBlockItem[] = [
  { id: 'text', labelKey: 'kb_block_text', keywords: ['texte', 'paragraphe', 'normal'] },
  { id: 'h1', labelKey: 'kb_block_h1', keywords: ['titre', 'h1', 'grand'] },
  { id: 'h2', labelKey: 'kb_block_h2', keywords: ['titre', 'h2', 'moyen'] },
  { id: 'h3', labelKey: 'kb_block_h3', keywords: ['titre', 'h3', 'sous-titre', 'petit'] },
  { id: 'bullet', labelKey: 'kb_block_bullet', keywords: ['liste', 'puces', 'tirets'] },
  { id: 'ordered', labelKey: 'kb_block_ordered', keywords: ['liste', 'numerotee', 'numeros'] },
  { id: 'todo', labelKey: 'kb_block_todo', keywords: ['tache', 'cases', 'cocher', 'checklist', 'todo'] },
  { id: 'toggle', labelKey: 'kb_block_toggle', keywords: ['repliable', 'deplier', 'accordeon', 'detail'] },
  { id: 'quote', labelKey: 'kb_block_quote', keywords: ['citation', 'encadre', 'remarque'] },
  { id: 'code', labelKey: 'kb_block_code', keywords: ['code', 'monospace'] },
  { id: 'divider', labelKey: 'kb_block_divider', keywords: ['separateur', 'ligne', 'trait'] },
  { id: 'table', labelKey: 'kb_block_table', keywords: ['tableau', 'grille', 'colonnes'] },
  { id: 'image', labelKey: 'kb_block_image', keywords: ['image', 'photo', 'illustration', 'plan'] },
  { id: 'file', labelKey: 'kb_block_file', keywords: ['fichier', 'document', 'pdf', 'piece', 'joindre'] },
];

/** Blocs qui remplacent le type du bloc courant (menu « Transformer en »). */
export const KB_TRANSFORMABLE: readonly KbBlock[] = ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'todo', 'toggle', 'quote', 'code'];

/** `label` : le libellé déjà traduit, pour qu'on retrouve « Titre 2 » en tapant « /titre » ou « /h2 ». */
export function filterKbBlocks(items: readonly KbBlockItem[], query: string, label: (item: KbBlockItem) => string): KbBlockItem[] {
  const q = foldText(query.trim());
  return items.filter(item => !q || foldText(label(item)).includes(q) || item.keywords.some(k => foldText(k).startsWith(q)));
}

/** Types de nœud Tiptap → bloc affiché, pour le menu « Transformer en » (le bloc courant est marqué). */
export function kbBlockOfNode(nodeType: string, attrs: Record<string, unknown> = {}): KbBlock | null {
  switch (nodeType) {
    case 'paragraph': return 'text';
    case 'heading': return attrs.level === 1 ? 'h1' : attrs.level === 2 ? 'h2' : attrs.level === 3 ? 'h3' : null;
    case 'bulletList': return 'bullet';
    case 'orderedList': return 'ordered';
    case 'taskList': return 'todo';
    case 'details': return 'toggle';
    case 'blockquote': return 'quote';
    case 'codeBlock': return 'code';
    case 'horizontalRule': return 'divider';
    case 'table': return 'table';
    case 'image': return 'image';
    case 'kbFile': return 'file';
    default: return null;
  }
}
