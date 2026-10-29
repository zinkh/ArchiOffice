import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, markdownToPlainText, safeHref } from '../packages/archioffice-agents/src/client/chatMarkdownParser';

describe('Markdown des réponses d\'agent', () => {
  it('rend un lien en gras comme dans la réponse de Sophie', () => {
    const nodes = parseInline('- **[BIOTOPE](https://www.archioffice.fr/contacts?open=572d)** (créé).'.slice(2));
    expect(nodes[0]).toMatchObject({ t: 'bold', c: [{ t: 'link', href: 'https://www.archioffice.fr/contacts?open=572d', c: [{ t: 'text', v: 'BIOTOPE' }] }] });
    expect(nodes[1]).toEqual({ t: 'text', v: ' (créé).' });
  });

  it('analyse titres, listes, séparateurs et italique', () => {
    const blocks = parseMarkdown('#### **Écologue** :\n- **[A](/contacts?open=1)** (créé).\n- B\n\n---\n### **Détails** :\n- **Échéance** : *26/10/2026* (par défaut).');
    expect(blocks.map(b => b.t)).toEqual(['heading', 'list', 'hr', 'heading', 'list']);
    expect(blocks[0]).toMatchObject({ level: 4 });
    const last: any = blocks[4];
    expect(last.items[0].c.some((n: any) => n.t === 'italic')).toBe(true);
  });

  it('numérote une liste ordonnée et garde les sous-listes', () => {
    const [list]: any = parseMarkdown('1. **Assigner** la tâche\n   - à Christian\n2. Vérifier');
    expect(list).toMatchObject({ t: 'list', ordered: true, start: 1 });
    expect(list.items).toHaveLength(2);
    expect(list.items[0].sub[0]).toMatchObject({ t: 'list', ordered: false });
  });

  it('analyse un tableau', () => {
    const [table]: any = parseMarkdown('| Lot | Montant |\n|---|--:|\n| 01 | 1 000 € |');
    expect(table.t).toBe('table');
    expect(table.head).toHaveLength(2);
    expect(table.rows[0]).toHaveLength(2);
    expect(table.align).toEqual([null, 'right']);
  });

  it('transforme une adresse nue en lien sans la ponctuation finale', () => {
    const nodes = parseInline('Voir https://www.archioffice.fr/gantt?open=1.');
    expect(nodes[1]).toMatchObject({ t: 'link', href: 'https://www.archioffice.fr/gantt?open=1' });
    expect(nodes[2]).toEqual({ t: 'text', v: '.' });
  });

  it('écarte les schémas dangereux', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/contacts?open=1')).toBe('/contacts?open=1');
    const nodes = parseInline('[clic](javascript:alert(1))');
    expect(nodes.some(n => n.t === 'link')).toBe(false);
    expect(nodes[0]).toEqual({ t: 'text', v: 'clic' });
  });

  it('ne prend pas snake_case ni une multiplication pour de l\'italique', () => {
    expect(parseInline('le champ client_phone et 2 * 3 * 4')).toEqual([{ t: 'text', v: 'le champ client_phone et 2 * 3 * 4' }]);
  });

  it('garde le code en ligne et en bloc tel quel', () => {
    expect(parseInline('`**non**`')).toEqual([{ t: 'code', v: '**non**' }]);
    expect(parseMarkdown('```json\n{"a": 1}\n```')).toEqual([{ t: 'code', lang: 'json', v: '{"a": 1}' }]);
  });

  it('rend un texte brut lisible à voix haute', () => {
    const plain = markdownToPlainText('### **Détails** :\n- **Échéance** : *26/10/2026*\n- [Tâche](https://x.fr/a)');
    expect(plain).toBe('Détails :\n\nÉchéance : 26/10/2026. Tâche');
  });
});
