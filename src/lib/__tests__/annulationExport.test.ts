import { describe, expect, it } from 'vitest';
import { ExportAnnule, estAnnulation, verifierAnnulation } from '../annulation';
import { produireDossier } from '../exportDossier';

describe('annulation d\'un export', () => {
  it('ne fait rien sans signal ou tant que l\'annulation n\'est pas demandée', () => {
    expect(() => verifierAnnulation(undefined)).not.toThrow();
    expect(() => verifierAnnulation(new AbortController().signal)).not.toThrow();
  });

  it('lève ExportAnnule dès que l\'annulation est demandée', () => {
    const c = new AbortController();
    c.abort();
    expect(() => verifierAnnulation(c.signal)).toThrow(ExportAnnule);
    expect(estAnnulation(new ExportAnnule())).toBe(true);
    expect(estAnnulation(new Error('autre'))).toBe(false);
  });

  it('produireDossier s\'arrête sans rien livrer quand l\'annulation est déjà demandée', async () => {
    const c = new AbortController();
    c.abort();
    await expect(produireDossier({
      dpgf: { titre: 'T', lots: [] } as any, bpu: null, documents: { cctp: 'pdf', dpgf: 'pdf' },
      selection: { lotNumeros: null, batimentCodes: null, phaseCodes: null },
      avecPrix: false, cctpParBatiment: false, settings: {} as any, signal: c.signal,
    })).rejects.toBeInstanceOf(ExportAnnule);
  });
});
