import { describe, it, expect } from 'vitest';
import { imagesFromClipboard } from '../packages/archioffice-agents/src/client/chatUpload';

const item = (type: string, name: string, kind = 'file') => ({
  kind, type, getAsFile: () => new File(['x'], name, { type }),
});
const data = (items: any[]) => ({ items }) as unknown as DataTransfer;
const NOW = new Date('2026-11-26T14:05:09.000Z');

describe('imagesFromClipboard', () => {
  it('rend [] pour un collage de texte', () => {
    expect(imagesFromClipboard(data([{ kind: 'string', type: 'text/plain', getAsFile: () => null }]), NOW)).toEqual([]);
    expect(imagesFromClipboard(null, NOW)).toEqual([]);
  });

  it('renomme une capture « image.png » avec un nom horodaté', () => {
    const [f] = imagesFromClipboard(data([item('image/png', 'image.png')]), NOW);
    expect(f.name).toBe('capture-20261126-140509.png');
    expect(f.type).toBe('image/png');
  });

  it('numérote plusieurs images et garde un vrai nom de fichier', () => {
    const files = imagesFromClipboard(data([item('image/jpeg', 'image.jpeg'), item('image/png', 'plan.png')]), NOW);
    expect(files.map(f => f.name)).toEqual(['capture-20261126-140509-1.jpg', 'plan.png']);
  });

  it('ignore les fichiers qui ne sont pas des images', () => {
    expect(imagesFromClipboard(data([item('application/pdf', 'a.pdf')]), NOW)).toEqual([]);
  });
});
