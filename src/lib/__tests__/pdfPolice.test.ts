import { afterEach, describe, expect, it, vi } from 'vitest';
import { installerLiberationSans, POLICE_LIBERATION } from '../pdfPolice';

const fauxPdf = () => ({ addFileToVFS: vi.fn(), addFont: vi.fn() });

describe('installerLiberationSans', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('enregistre les quatre styles de la famille', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })));
    const pdf = fauxPdf();
    expect(await installerLiberationSans(pdf)).toBe(true);
    expect(pdf.addFont.mock.calls.map(c => [c[1], c[2]])).toEqual([
      [POLICE_LIBERATION, 'normal'], [POLICE_LIBERATION, 'bold'], [POLICE_LIBERATION, 'italic'], [POLICE_LIBERATION, 'bolditalic'],
    ]);
  });

  it('rend faux, sans lever d’erreur, quand un fichier est introuvable (repli Helvetica)', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { installerLiberationSans: installer } = await import('../pdfPolice');
    expect(await installer(fauxPdf())).toBe(false);
  });
});
