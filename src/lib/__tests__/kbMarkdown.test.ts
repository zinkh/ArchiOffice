// Markdown vers blocs de l'éditeur : src/lib/kbMarkdown.ts (pages d'un export Notion).
import { describe, expect, it } from 'vitest';
import { kbContentToText } from '../kb';
import { markdownToTiptap, parseInline, safeLink, type TiptapNode } from '../kbMarkdown';

const ALLOWED = new Set([
  'doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell', 'details', 'detailsSummary', 'detailsContent',
]);
function types(node: TiptapNode, out = new Set<string>()): Set<string> {
  out.add(node.type);
  (node.content || []).forEach(child => types(child, out));
  return out;
}
const blocks = (md: string) => markdownToTiptap(md).content;
const asText = (content: TiptapNode[]) => kbContentToText({ type: 'doc', content });

describe('parseInline', () => {
  it('lit gras, italique, barré et code, avec marques cumulées', () => {
    expect(parseInline('a **gras** b *ital* c ~~barré~~ d `code`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'gras', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' b ' },
      { type: 'text', text: 'ital', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' c ' },
      { type: 'text', text: 'barré', marks: [{ type: 'strike' }] },
      { type: 'text', text: ' d ' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
    ]);
    expect(parseInline('**gras _et italique_**')).toEqual([
      { type: 'text', text: 'gras ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'et italique', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ]);
  });

  it('ne prend pas un trait de soulignement de mot ni une étoile isolée pour de l\'italique', () => {
    expect(asText([{ type: 'paragraph', content: parseInline('snake_case_name et 3 * 4') }])).toBe('snake_case_name et 3 * 4');
  });

  it('garde les caractères échappés', () => {
    expect(parseInline('\\*pas italique\\*')).toEqual([{ type: 'text', text: '*pas italique*' }]);
  });

  it('crée des liens http(s), mailto et tel ; un autre schéma ne garde que le texte', () => {
    expect(parseInline('[AAZS](https://aazs.fr)')).toEqual([{ type: 'text', text: 'AAZS', marks: [{ type: 'link', attrs: { href: 'https://aazs.fr' } }] }]);
    expect(parseInline('[mail](mailto:contact@aazs.fr)')[0].marks).toEqual([{ type: 'link', attrs: { href: 'mailto:contact@aazs.fr' } }]);
    expect(parseInline('[piège](javascript:alert)')).toEqual([{ type: 'text', text: 'piège' }]);
    expect(parseInline('[page](Autre%20page%20abc.md)')).toEqual([{ type: 'text', text: 'page' }]);
    expect(safeLink('data:text/html,x')).toBeNull();
    expect(safeLink('HTTPS://x.fr')).toBe('HTTPS://x.fr');
  });

  it('remplace une image par un repère', () => {
    expect(asText([{ type: 'paragraph', content: parseInline('![plan RDC](plan.png)') }])).toBe('[Image : plan RDC]');
  });
});

describe('markdownToTiptap : blocs', () => {
  it('lit titres (niveau 4 ramené à 3), paragraphes et sauts de ligne', () => {
    const doc = blocks('# Titre\n\n#### Sous-titre\n\nligne 1\nligne 2\n\nautre');
    expect(doc.map(b => b.type)).toEqual(['heading', 'heading', 'paragraph', 'paragraph']);
    expect(doc[0].attrs).toEqual({ level: 1 });
    expect(doc[1].attrs).toEqual({ level: 3 });
    expect(doc[2].content!.map(n => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('lit un bloc de code sans interpréter son contenu', () => {
    const doc = blocks('```ts\nconst a = **1**;\n\n# pas un titre\n```\napres');
    expect(doc[0]).toEqual({ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = **1**;\n\n# pas un titre' }] });
    expect(doc[1].type).toBe('paragraph');
  });

  it('lit listes à puces, numérotées et imbriquées', () => {
    const doc = blocks('- un\n- deux\n  - sous-un\n  - sous-deux\n- trois\n\n3. trois\n4. quatre');
    expect(doc[0].type).toBe('bulletList');
    expect(doc[0].content).toHaveLength(3);
    const nested = doc[0].content![1].content!;
    expect(nested.map(n => n.type)).toEqual(['paragraph', 'bulletList']);
    expect(nested[1].content).toHaveLength(2);
    expect(doc[1]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
  });

  it('lit une liste de cases à cocher', () => {
    const doc = blocks('- [ ] à faire\n- [x] fait');
    expect(doc[0].type).toBe('taskList');
    expect(doc[0].content!.map(n => n.attrs)).toEqual([{ checked: false }, { checked: true }]);
    expect(asText(doc).split('\n').filter(Boolean)).toEqual(['à faire', 'fait']);
  });

  it('lit citations (avec blocs à l\'intérieur) et séparateurs', () => {
    const doc = blocks('> citation\n> **suite**\n\n---\n\navant\n***\naprès');
    expect(doc[0].type).toBe('blockquote');
    expect(doc.filter(b => b.type === 'horizontalRule')).toHaveLength(2);
  });

  it('lit un tableau avec ligne d\'en-tête et complète les cellules manquantes', () => {
    const doc = blocks('| Nom | Produits |\n| --- | --- |\n| La Rochère | Verre |\n| SOTTAS |');
    const table = doc[0];
    expect(table.type).toBe('table');
    expect(table.content![0].content!.map(c => c.type)).toEqual(['tableHeader', 'tableHeader']);
    expect(table.content).toHaveLength(3);
    expect(table.content![2].content).toHaveLength(2);
    expect(asText(doc)).toContain('La Rochère');
  });

  it('lit un bloc repliable de Notion (details et summary) et un encadré (aside)', () => {
    const md = '<details>\n<summary>Détails constructifs</summary>\n\nContenu **important**\n\n- point\n\n</details>\n\n<aside>\n💡 Astuce\n</aside>';
    const doc = blocks(md);
    expect(doc[0].type).toBe('details');
    expect(doc[0].content!.map(c => c.type)).toEqual(['detailsSummary', 'detailsContent']);
    expect(asText([doc[0].content![0]])).toBe('Détails constructifs');
    expect(doc[0].content![1].content!.map(c => c.type)).toEqual(['paragraph', 'bulletList']);
    expect(doc[1].type).toBe('blockquote');
    expect(asText([doc[1]])).toContain('Astuce');
  });

  it('un document vide reste valide', () => {
    expect(markdownToTiptap('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(markdownToTiptap('\n\n  \n').content).toEqual([{ type: 'paragraph' }]);
  });

  it('ne produit que des nœuds connus de l\'éditeur, même sur un Notion mélangé', () => {
    const md = [
      '# Fabricants', '', 'Intro avec [lien](https://aazs.fr) et ![img](a.png).', '',
      '> note', '', '1. un', '2. deux', '   - sous', '', '| a | b |', '|---|---|', '| 1 | 2 |', '',
      '<details><summary>Titre</summary>', 'dedans', '</details>', '', '```', 'code', '```', '<br>', 'fin',
    ].join('\n');
    for (const type of types({ type: 'doc', content: blocks(md) })) expect(ALLOWED.has(type), type).toBe(true);
  });

  it('résiste à une imbrication démesurée sans boucler', () => {
    expect(() => markdownToTiptap(`${'> '.repeat(40)}fond`)).not.toThrow();
    const nestedList = Array.from({ length: 40 }, (_, i) => `${'  '.repeat(i)}- niveau ${i}`).join('\n');
    expect(() => markdownToTiptap(nestedList)).not.toThrow();
  });
});
