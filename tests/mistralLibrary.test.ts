import { describe, expect, it, vi } from 'vitest';
import { makeMistralLibraryClient, MistralLibraryError } from '../server/knowledge/mistralLibrary';

const lib = '01a12a77-dd1c-77eb-84b0-25cac8adccf4';
const doc = '01b22b88-ee2d-77eb-84b0-25cac8adccf4';
const contribution = '019d2e3f-87ab-77b8-9e2e-4b21e4c558f1';

describe('Mistral Libraries — transport sécurisé (API simulée)', () => {
  it('envoie un fichier texte avec nom opaque, sans clés ni métadonnées cabinet', async () => {
    const mock = vi.fn(async (url: string, opts: RequestInit) => {
      expect(url).toBe('https://api.mistral.ai/v1/libraries/' + lib + '/documents');
      expect(opts.method).toBe('POST');
      expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-secret');
      expect(opts.body).toBeInstanceOf(FormData);
      const file = (opts.body as FormData).get('file') as File;
      expect(file.name).toBe('archioffice-' + contribution + '.txt');
      const body = await file.text();
      expect(body).toContain('Bardage bois : entraxe 600 mm.');
      expect(body).toContain(contribution);
      expect(body).not.toContain('test-secret');
      return new Response(JSON.stringify({ id: doc, library_id: lib, name: file.name }), { status: 200 });
    });
    const client = makeMistralLibraryClient('test-secret', lib, mock as typeof fetch);
    const result = await client.upload('Bardage bois : entraxe 600 mm.', contribution);
    expect(result.id).toBe(doc);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refuse une déduplication Mistral qui pointerait vers un fichier ajouté manuellement', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({
      id: doc, library_id: lib, name: 'donnees-de-test-client.txt',
    }), { status: 200 }));
    const client = makeMistralLibraryClient('key', lib, mock as typeof fetch);
    await expect(client.upload('Extrait fictif', contribution)).rejects.toThrow(/Réponse de téléversement/);
  });

  const name = 'archioffice-' + contribution + '.txt';
  const page = (data: unknown[], hasMore: boolean, current = 0) => new Response(JSON.stringify({
    data, pagination: { total_items: 0, total_pages: 0, current_page: current, page_size: 100, has_more: hasMore },
  }), { status: 200 });
  const other = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'o' + i, library_id: lib, name: 'manuel-' + i + '.pdf' }));

  it('parcourt les pages (page, has_more) et retrouve un document hors de la première page', async () => {
    const mock = vi.fn(async (url: string) => {
      const n = Number(new URL(url).searchParams.get('page'));
      if (n === 0) return page(other(100), true, 0);
      if (n === 1) return page(other(100), true, 1);
      return page([{ id: doc, library_id: lib, name }], false, 2);
    });
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name);
    expect(found?.id).toBe(doc);
    const pages = mock.mock.calls.map(c => new URL(c[0] as string).searchParams.get('page'));
    expect(pages).toEqual(['0', '1', '2']);
  });

  it('envoie page_size et page, jamais un jeton de page', async () => {
    const mock = vi.fn(async (_url: string) => page([{ id: doc, library_id: lib, name }], false));
    await makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name);
    const first = new URL(mock.mock.calls[0][0] as string).searchParams;
    expect(first.get('page_size')).toBe('100');
    expect(first.get('page')).toBe('0');
    expect(first.get('search')).toBe(name);
    expect(first.has('page_token')).toBe(false);
  });

  it('confirme l’absence par un parcours complet quand la recherche ne trouve rien', async () => {
    const mock = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      // `search` ne renvoie rien (sémantique incertaine) alors que le document existe.
      if (q.get('search')) return page([], false);
      return page([{ id: doc, library_id: lib, name }], false);
    });
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name);
    expect(found?.id).toBe(doc);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('ne conclut à l’absence qu’après avoir lu toute la bibliothèque', async () => {
    const mock = vi.fn(async (url: string) => {
      const n = Number(new URL(url).searchParams.get('page'));
      return page(other(100), n < 2, n);
    });
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name);
    expect(found).toBeNull();
    // recherche (3 pages) puis parcours complet de confirmation (3 pages)
    expect(mock).toHaveBeenCalledTimes(6);
  });

  it('échoue fermé sans indicateur de pagination : jamais d’absence affirmée à tort', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ data: other(3) }), { status: 200 }));
    await expect(makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name))
      .rejects.toThrow(/incohérente/);
  });

  it('refuse d’arbitrer quand plusieurs copies portent le même nom', async () => {
    const mock = vi.fn(async () => page([
      { id: doc, library_id: lib, name }, { id: 'autre', library_id: lib, name },
    ], false));
    await expect(makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name))
      .rejects.toThrow(/Plusieurs copies/);
  });

  it('ne supprime jamais un document de test existant lors du rapprochement', async () => {
    const mock = vi.fn(async () => page([{ id: doc, library_id: lib, name: 'fiche-test-utilisateur.pdf' }], false));
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch).findByName(name);
    expect(found).toBeNull();
  });

  it('supprime uniquement un identifiant explicite dans la bibliothèque ciblée', async () => {
    const mock = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe('https://api.mistral.ai/v1/libraries/' + lib + '/documents/' + doc);
      expect(options.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });
    await makeMistralLibraryClient('key', lib, mock as typeof fetch).remove(doc);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('traite la suppression déjà effective (404) uniquement après contrôle de la bibliothèque', async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith('/' + doc)) return new Response(null, { status: 404 });
      expect(url).toBe('https://api.mistral.ai/v1/libraries/' + lib);
      return new Response(JSON.stringify({ id: lib }), { status: 200 });
    });
    await makeMistralLibraryClient('key', lib, mock as typeof fetch).remove(doc);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('ne masque pas une erreur de suppression par un succès fictif', async () => {
    const mock = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(makeMistralLibraryClient('key', lib, mock as typeof fetch).remove(doc))
      .rejects.toBeInstanceOf(MistralLibraryError);
  });
});
