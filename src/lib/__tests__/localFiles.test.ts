// Facts for the gate: importers/callers = Vitest only; no existing test covers src/lib/localFiles.ts;
// no data files are read or written; user instruction: "Arborescence lisible + boutons (Recommandé)".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));

import { canUseLocalFiles, openLocalFile, revealLocalFile } from '../localFiles';
import { formatBytes } from '../../components/StorageTreeMigrationCard';

const ref = { bucket: 'documents', path: 't/a/b.pdf' };

describe('localFiles', () => {
  const alertMock = vi.fn();
  let bridge: { isDesktop: boolean; revealFile: ReturnType<typeof vi.fn>; openFile: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    apiFetch.mockReset();
    alertMock.mockReset();
    bridge = { isDesktop: true, revealFile: vi.fn(), openFile: vi.fn() } as any;
    (globalThis as any).window = { archiofficeDesktop: bridge };
    (globalThis as any).alert = alertMock;
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('ne fait rien hors du client de bureau', async () => {
    (globalThis as any).window = {};
    expect(canUseLocalFiles()).toBe(false);
    await revealLocalFile('x');
    await openLocalFile('x');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('révèle le fichier dans l’Explorateur', async () => {
    apiFetch.mockResolvedValue({ available: true, ...ref });
    bridge.revealFile.mockResolvedValue(true);
    await revealLocalFile('url');
    expect(bridge.revealFile).toHaveBeenCalledWith(ref);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('signale un fichier absent de ce poste', async () => {
    apiFetch.mockResolvedValue({ available: false });
    await revealLocalFile('url');
    expect(alertMock).toHaveBeenCalledWith('local_file_unavailable');
  });

  it.each([
    ['ok', null],
    ['introuvable', 'local_file_unavailable'],
    ['type_non_ouvrable', 'local_file_not_openable'],
    ['echec', 'local_file_open_failed'],
  ])('ouvre : résultat %s', async (result, message) => {
    apiFetch.mockResolvedValue({ available: true, ...ref });
    bridge.openFile.mockResolvedValue(result);
    await openLocalFile('url');
    if (message) expect(alertMock).toHaveBeenCalledWith(message);
    else expect(alertMock).not.toHaveBeenCalled();
  });

  it('alerte si l’API échoue', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiFetch.mockRejectedValue(new Error('boom'));
    await openLocalFile('url');
    expect(alertMock).toHaveBeenCalledWith('local_file_open_failed');
    spy.mockRestore();
  });
});

describe('formatBytes', () => {
  it('formate les tailles', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(900)).toBe('900 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 Mo');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 Go');
  });
});
