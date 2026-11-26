import { describe, it, expect } from 'vitest';
import { applyMailSignature } from '../server/mailSignature';

describe('applyMailSignature', () => {
  it('ajoute la signature au texte et au HTML', () => {
    const r = applyMailSignature({ text: 'Bonjour', html: '<p>Bonjour</p>' }, 'Khaldoun\nAAZS');
    expect(r.text).toBe('Bonjour\n\nKhaldoun\nAAZS');
    expect(r.html).toContain('Khaldoun<br>AAZS');
  });
  it('ne double pas une signature déjà présente', () => {
    const r = applyMailSignature({ text: 'Bonjour\n\nKhaldoun' }, 'Khaldoun');
    expect(r.text).toBe('Bonjour\n\nKhaldoun');
  });
  it('ne change rien sans signature', () => {
    expect(applyMailSignature({ text: 'a' }, '')).toEqual({ text: 'a' });
  });
  it('échappe le HTML de la signature', () => {
    expect(applyMailSignature({ html: '<p>x</p>' }, '<b>').html).toContain('&lt;b&gt;');
  });
});
