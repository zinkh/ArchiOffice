import { describe, it, expect } from 'vitest';
import { aiTextToHtml, htmlToPlainText } from '../richText';
import { filterSlashItems, matchSlash, SLASH_ITEMS } from '../slashMenu';
import { buildDiagPrompt } from '../diagReports';

describe('aiTextToHtml', () => {
  it('convertit titres, listes, gras et paragraphes', () => {
    const html = aiTextToHtml('## Structure\nLa **charpente** est saine.\n\n- Poutre\n- Solive\n\n1. Étape');
    expect(html).toContain('<h2>Structure</h2>');
    expect(html).toContain('<strong>charpente</strong>');
    expect(html).toContain('<ul><li><p>Poutre</p></li><li><p>Solive</p></li></ul>');
    expect(html).toContain('<ol><li><p>Étape</p></li></ol>');
  });
  it('échappe tout HTML renvoyé par le modèle', () => {
    const html = aiTextToHtml('<script>alert(1)</script> & <img src=x onerror=1>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('htmlToPlainText', () => {
  it('garde les retours de ligne et décode les entités', () => {
    expect(htmlToPlainText('<h2>A &amp; B</h2><p>x</p><ul><li>un</li></ul>')).toBe('A & B\nx\n- un');
  });
  it('accepte le vide', () => { expect(htmlToPlainText(null)).toBe(''); });
});

describe('menu « / »', () => {
  it('détecte une commande en début de paragraphe ou après une espace', () => {
    expect(matchSlash('/ecr')).toEqual({ query: 'ecr', from: 0 });
    expect(matchSlash('Bonjour /ia')).toEqual({ query: 'ia', from: 8 });
  });
  it("n'ouvre rien pour une fraction ou un chemin", () => {
    expect(matchSlash('3/4')).toBeNull();
    expect(matchSlash('a/b/c')).toBeNull();
  });
  const label = (i: { id: string }) => ({ ai_write: "Écrire avec l'IA", h2: 'Titre' } as Record<string, string>)[i.id] ?? i.id;
  it('retrouve « Écrire avec l\'IA » sans accent, par /ecr ou /ia', () => {
    expect(filterSlashItems(SLASH_ITEMS, 'ecr', label, true).map(i => i.id)).toContain('ai_write');
    expect(filterSlashItems(SLASH_ITEMS, 'ia', label, true).length).toBeGreaterThan(3);
  });
  it("masque les commandes IA quand l'IA n'est pas fournie", () => {
    expect(filterSlashItems(SLASH_ITEMS, '', label, false).every(i => i.action.type === 'block')).toBe(true);
  });
});

describe('buildDiagPrompt', () => {
  const base = { instruction: '', selection: '', document: '', reportTitle: 'Diagnostic structure', facts: 'Opération : Maison', projectDocs: '', otherReports: '' };
  it("donne à l'IA la fiche, le rapport en cours et l'interdiction d'inventer", () => {
    const p = buildDiagPrompt({ ...base, mode: 'write', instruction: 'décrire la charpente', document: 'Texte existant' });
    expect(p).toContain('Opération : Maison');
    expect(p).toContain('Texte existant');
    expect(p).toContain('décrire la charpente');
    expect(p).toMatch(/N'invente aucune mesure/);
  });
  it('un mode de réécriture reçoit le passage à traiter', () => {
    const p = buildDiagPrompt({ ...base, mode: 'shorten', selection: 'Un très long passage' });
    expect(p).toContain('PASSAGE À TRAITER :\nUn très long passage');
    expect(p).toContain('prêt à remplacer');
  });
});
