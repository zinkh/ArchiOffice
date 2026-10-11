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

  it('ne considère pas le début de page vide comme une absence complète', async () => {
    const mock = vi.fn(async (url: string) => {
      if (!url.includes('page_token=')) {
        return new Response(JSON.stringify({ data: [{ id: 'other', library_id: lib, name: 'manuel.pdf' }],
          next_page_token: 'page-2' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{ id: doc, library_id: lib, name: 'archioffice-' + contribution + '.txt' }],
        next_page_token: null,
      }), { status: 200 });
    });
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch)
      .findByName('archioffice-' + contribution + '.txt');
    expect(found?.id).toBe(doc);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('ne supprime jamais un document de test existant lors du rapprochement', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: doc, library_id: lib, name: 'fiche-test-utilisateur.pdf' }],
      next_page_token: null,
    }), { status: 200 }));
    const found = await makeMistralLibraryClient('key', lib, mock as typeof fetch)
      .findByName('archioffice-' + contribution + '.txt');
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
