import { describe, it, expect } from 'vitest';
import { htmlToBlocks } from '../diagReportBlocks';
import { diagAiAccess } from '../diagAiAccess';

describe('htmlToBlocks', () => {
  it('lit titres, paragraphes et mise en forme en ligne', () => {
    const b = htmlToBlocks('<h2>Structure</h2><p>La <strong>charpente</strong> est <em>saine</em>.</p>');
    expect(b[0]).toEqual({ type: 'h2', runs: [{ text: 'Structure' }] });
    expect(b[1]).toMatchObject({ type: 'p' });
    expect((b[1] as any).runs).toEqual([
      { text: 'La ' }, { text: 'charpente', bold: true }, { text: ' est ' }, { text: 'saine', italic: true }, { text: '.' },
    ]);
  });
  it('numérote les listes ordonnées et laisse les puces à part', () => {
    const b = htmlToBlocks('<ul><li><p>a</p></li></ul><ol><li><p>x</p></li><li><p>y</p></li></ol>');
    expect(b).toEqual([
      { type: 'li', ordered: false, index: 1, runs: [{ text: 'a' }] },
      { type: 'li', ordered: true, index: 1, runs: [{ text: 'x' }] },
      { type: 'li', ordered: true, index: 2, runs: [{ text: 'y' }] },
    ]);
  });
  it('gère citation, filet, saut de ligne et entités', () => {
    const b = htmlToBlocks('<blockquote><p>cité</p></blockquote><hr><p>A &amp; B<br>suite</p>');
    expect(b[0]).toMatchObject({ type: 'quote' });
    expect(b[1]).toEqual({ type: 'hr' });
    expect((b[2] as any).runs.map((r: any) => r.text).join('')).toBe('A & B\nsuite');
  });
  it('ignore les paragraphes vides et accepte le vide', () => {
    expect(htmlToBlocks('<p></p><p> </p>')).toEqual([]);
    expect(htmlToBlocks(null)).toEqual([]);
  });
});

describe('diagAiAccess', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  it('Enterprise : accès complet', () => { expect(diagAiAccess('enterprise', null, now)).toBe('full'); });
  it('essai en cours : aperçu', () => {
    expect(diagAiAccess('trial', '2026-11-20T00:00:00Z', now)).toBe('preview');
    expect(diagAiAccess(undefined, null, now)).toBe('preview');
  });
  it('essai expiré ou autre plan : verrouillé', () => {
    expect(diagAiAccess('trial', '2026-11-01T00:00:00Z', now)).toBe('locked');
    expect(diagAiAccess('expired', null, now)).toBe('locked');
    expect(diagAiAccess('pro', null, now)).toBe('locked');
  });
});
