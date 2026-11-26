// Blocs du menu « / » de la base de données : src/lib/kbBlocks.ts (logique pure).
import { describe, expect, it } from 'vitest';
import { KB_BLOCKS, KB_TRANSFORMABLE, filterKbBlocks, kbBlockOfNode } from '../kbBlocks';

const labels: Record<string, string> = {
  kb_block_text: 'Texte', kb_block_h1: 'Titre 1', kb_block_h2: 'Titre 2', kb_block_h3: 'Titre 3',
  kb_block_bullet: 'Liste à puces', kb_block_ordered: 'Liste numérotée', kb_block_todo: 'Liste de tâches',
  kb_block_toggle: 'Bloc repliable', kb_block_quote: 'Citation', kb_block_code: 'Code',
  kb_block_divider: 'Séparateur', kb_block_table: 'Tableau', kb_block_image: 'Image', kb_block_file: 'Fichier',
};
const label = (item: { labelKey: string }) => labels[item.labelKey] ?? item.labelKey;

describe('filterKbBlocks', () => {
  it('rend tous les blocs sans recherche', () => {
    expect(filterKbBlocks(KB_BLOCKS, '', label)).toHaveLength(KB_BLOCKS.length);
  });

  it('retrouve un bloc par son libellé, sans accent ni casse', () => {
    expect(filterKbBlocks(KB_BLOCKS, 'numerot', label).map(b => b.id)).toEqual(['ordered']);
    expect(filterKbBlocks(KB_BLOCKS, 'SÉPAR', label).map(b => b.id)).toEqual(['divider']);
  });

  it('retrouve un bloc par un mot-clé', () => {
    expect(filterKbBlocks(KB_BLOCKS, 'pdf', label).map(b => b.id)).toEqual(['file']);
    expect(filterKbBlocks(KB_BLOCKS, 'h2', label).map(b => b.id)).toEqual(['h2']);
    expect(filterKbBlocks(KB_BLOCKS, 'cocher', label).map(b => b.id)).toEqual(['todo']);
  });

  it('ne rend rien quand rien ne correspond', () => {
    expect(filterKbBlocks(KB_BLOCKS, 'zzzz', label)).toEqual([]);
  });
});

describe('kbBlockOfNode', () => {
  it('relie les nœuds Tiptap aux blocs', () => {
    expect(kbBlockOfNode('paragraph')).toBe('text');
    expect(kbBlockOfNode('heading', { level: 2 })).toBe('h2');
    expect(kbBlockOfNode('heading', { level: 5 })).toBeNull();
    expect(kbBlockOfNode('taskList')).toBe('todo');
    expect(kbBlockOfNode('details')).toBe('toggle');
    expect(kbBlockOfNode('kbFile')).toBe('file');
    expect(kbBlockOfNode('inconnu')).toBeNull();
  });

  it('chaque bloc transformable existe dans la liste du menu', () => {
    const ids = new Set(KB_BLOCKS.map(b => b.id));
    expect(KB_TRANSFORMABLE.every(id => ids.has(id))).toBe(true);
  });
});
