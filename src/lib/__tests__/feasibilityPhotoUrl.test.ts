import { describe, expect, it } from 'vitest';
import { isHttpUrl } from '../feasibilityPhoto';

describe('isHttpUrl', () => {
  it('accepte une adresse http ou https', () => {
    expect(isHttpUrl('https://exemple.fr/photo.jpg')).toBe(true);
    expect(isHttpUrl('  http://exemple.fr/a.png ')).toBe(true);
  });

  it('refuse un schéma autre que http(s) et un texte qui n\'est pas une adresse', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isHttpUrl('photo.jpg')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
