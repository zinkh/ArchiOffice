import { describe, expect, it } from 'vitest';
import { backgroundFormat, photosToSources, plansToSources } from '../croquis/projectBackground';

const base = 'https://x.supabase.co/storage/v1/object/public/plans/t1/p1';

describe('backgroundFormat', () => {
  it('reconnaît un PDF et une image dans une référence de bucket', () => {
    expect(backgroundFormat(`${base}/a/Plan-RDC.pdf`)).toBe('pdf');
    expect(backgroundFormat(`${base}/a/facade.PNG`)).toBe('image');
    expect(backgroundFormat(`${base}/a/facade.jpeg`)).toBe('image');
    expect(backgroundFormat(`${base}/a/photo.webp`)).toBe('image');
  });

  it('lit le nom du fichier dans une référence vers l\'espace du cabinet', () => {
    const ref = 'archioffice+external://webdav/conn/abc123?name=Plan%20R%2B1.pdf';
    expect(backgroundFormat(ref)).toBe('pdf');
    expect(backgroundFormat('archioffice+external://webdav/conn/abc?name=coupe.jpg')).toBe('image');
  });

  it('retombe sur le nom du plan quand la référence n\'en dit rien', () => {
    expect(backgroundFormat(`${base}/a/12345`, 'Plan RDC.pdf')).toBe('pdf');
  });

  it('refuse les formats qu\'on ne sait pas poser en fond', () => {
    expect(backgroundFormat(`${base}/a/plan.dwg`)).toBeNull();
    expect(backgroundFormat(`${base}/a/plan.dxf`)).toBeNull();
    expect(backgroundFormat(`${base}/a/notice.docx`)).toBeNull();
    expect(backgroundFormat(`${base}/a/sans-extension`)).toBeNull();
  });

  it('ne se laisse pas tromper par un point au milieu du nom', () => {
    expect(backgroundFormat(`${base}/a/plan.pdf.dwg`)).toBeNull();
  });
});

describe('plansToSources', () => {
  const plan = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: `Plan ${id}`, file_url: `${base}/${id}/plan-${id}.pdf`, index: 'A', version: 1, ...extra,
  });

  it('ne propose que la dernière version de chaque plan', () => {
    const list = plansToSources([
      plan('1'),
      plan('2', { parent_id: '1', index: 'B', version: 2 }),
      plan('3', { parent_id: '2', index: 'C', version: 3 }),
      plan('4'),
    ]);
    expect(list.map((s) => s.id)).toEqual(['3', '4']);
  });

  it('écarte les plans sans fichier et les formats illisibles', () => {
    const list = plansToSources([
      plan('1'),
      plan('2', { file_url: '' }),
      plan('3', { file_url: `${base}/3/plan.dwg`, name: 'Plan 3' }),
      plan('4', { file_url: null }),
    ]);
    expect(list.map((s) => s.id)).toEqual(['1']);
  });

  it('dit si le plan est un PDF et décrit son indice et sa version', () => {
    const [pdf, image] = plansToSources([
      plan('1', { index: 'B', version: 2 }),
      plan('2', { file_url: `${base}/2/coupe.png`, index: 'A', version: 1 }),
    ]);
    expect(pdf).toMatchObject({ kind: 'plan', isPdf: true, detail: 'Indice B · v2' });
    expect(image).toMatchObject({ isPdf: false, detail: 'Indice A' });
  });

  it('trie par nom, les nombres lus comme des nombres', () => {
    const list = plansToSources([
      plan('a', { name: 'Plan 10' }),
      plan('b', { name: 'Plan 2' }),
      plan('c', { name: 'plan 1' }),
    ]);
    expect(list.map((s) => s.name)).toEqual(['plan 1', 'Plan 2', 'Plan 10']);
  });

  it('rend une liste vide sans plan', () => {
    expect(plansToSources([])).toEqual([]);
  });
});

describe('photosToSources', () => {
  it('aplatit les photos des observations, chacune une fois', () => {
    const list = photosToSources([
      { photos: ['u1', 'u2'], lot: { lot_title: 'Gros œuvre' } },
      { photos: ['u2', 'u3'] },
      { photos: null },
      {},
    ]);
    expect(list.map((s) => s.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('porte l\'intitulé du lot de l\'observation', () => {
    const [first, third] = photosToSources([{ photos: ['u1'], lot: { lot_title: ' Menuiserie ' } }, { photos: ['u3'] }]);
    expect(first).toMatchObject({ kind: 'photo', detail: 'Menuiserie', fileUrl: 'u1', isPdf: false, name: '' });
    expect(third.detail).toBe('');
  });

  it('ignore les références vides', () => {
    expect(photosToSources([{ photos: ['', 'u1'] }]).map((s) => s.id)).toEqual(['u1']);
  });
});
